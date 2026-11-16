"""Matching, end to end: build every source's profiles from its clean rows and field mapping, score the pairs
that share something, link the sure ones and queue the rest for a person, then group profiles into people.

Decisions people made ("same person", "not the same") are kept across runs.
"""

from collections import defaultdict

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from ingestion.models import FieldMap, RawTable
from ingestion.rules import judged_rows
from sources.models import Source

from . import normalize
from .models import MatchPair, MatchRun, Profile
from .score import candidate_pairs, score, status_of
from .settings import current
from .trust import score_all

LINKS = ("customer_id", "updated_at")
DECIDED = (MatchPair.CONFIRMED, MatchPair.REJECTED)


def _mapping(source):
    """{table: {field: column}} of a source."""
    out = defaultdict(dict)
    for m in FieldMap.objects.filter(source=source):
        out[m.table][m.field] = m.column
    return out


def build_profiles(source):
    """{customer id: profile} of one source. Every customer with a row in a mapped table gets a profile (all rows
    are scored); its values come only from clean rows. When a customer has several clean rows in a table (two phone
    numbers), the newest one counts. rows: how many of the customer's rows there are and how many are clean;
    held: fields that have a value only in held-back rows."""
    profiles = defaultdict(lambda: {"values": {}, "keys": {}, "tables": {}, "updated_at": None,
                                    "rows": {"total": 0, "clean": 0}, "held": set()})
    for name, fields in _mapping(source).items():
        table = RawTable.objects.filter(source=source, name=name).first()
        if table is None or fields.get("customer_id") not in (table.columns or []):
            continue
        at = {f: table.columns.index(c) for f, c in fields.items() if c in table.columns}
        best, held = {}, defaultdict(set)
        for position, plain, shown, passed in judged_rows(table):
            key = normalize.text(plain[at["customer_id"]])
            if not key:
                continue
            p = profiles[key]
            p["rows"]["total"] += 1
            when = normalize.moment(plain[at["updated_at"]]) if "updated_at" in at else None
            if when and (p["updated_at"] is None or _later(when, p["updated_at"])):
                p["updated_at"] = when
            if not passed:
                held[key] |= {f for f, i in at.items() if f not in LINKS and normalize.text(plain[i])}
                continue
            p["rows"]["clean"] += 1
            kept = best.get(key)
            if kept is None or (when and (kept[0] is None or _later(when, kept[0]))):
                best[key] = (when, plain, shown)
        for key, (when, plain, shown) in best.items():
            p = profiles[key]
            for field, i in at.items():
                if field in LINKS or not normalize.text(shown[i]):
                    continue
                p["values"][field] = normalize.text(shown[i])
                p["tables"][field] = table.name
                clean = normalize.NORMALIZERS.get(field)
                if clean:
                    p["keys"][field] = clean(plain[i])
        for key, fields_held in held.items():
            profiles[key]["held"] |= fields_held
    out = {}
    for key, p in profiles.items():
        p["held"] = sorted(f for f in p["held"] if f not in p["values"])
        p["keys"] = {k: v for k, v in p["keys"].items() if v}
        out[key] = p
    return out


def _later(x, y):
    """x after y, comparing dates with and without a time zone safely."""
    strip = lambda d: d.replace(tzinfo=None) if d.tzinfo else d
    return strip(x) > strip(y)


def _aware(d):
    if d is None:
        return None
    return d if d.tzinfo else timezone.make_aware(d)


@transaction.atomic
def run(user=""):
    """Rebuild all profiles and pairs. Returns the summary shown on screen."""
    kept = {(p.a.source_id, p.a.key, p.b.source_id, p.b.key): (p.status, p.decided_by, p.decided_at)
            for p in MatchPair.objects.filter(status__in=DECIDED).select_related("a", "b")}
    MatchPair.objects.all().delete()
    seen = set()
    for source in Source.objects.filter(enabled=True, field_maps__isnull=False).distinct():
        for key, built in build_profiles(source).items():
            Profile.objects.update_or_create(source=source, key=key, defaults={
                "values": built["values"], "keys": built["keys"], "tables": built["tables"],
                "updated_at": _aware(built["updated_at"]), "rows": built["rows"], "held": built["held"]})
            seen.add((source.id, key))
    for p in Profile.objects.all():
        if (p.source_id, p.key) not in seen:
            p.delete()

    profiles = {p.id: p for p in Profile.objects.select_related("source")}
    flat = {pid: {"key": p.key, "keys": p.keys, "values": p.values} for pid, p in profiles.items()}
    made = []
    settings = current()
    for x, y in candidate_pairs(flat):
        total, points, conflicts = score(flat[x], flat[y], settings["points"])
        a, b = profiles[x], profiles[y]
        decision = kept.get((a.source_id, a.key, b.source_id, b.key)) or kept.get((b.source_id, b.key, a.source_id, a.key))
        status = decision[0] if decision else status_of(total, conflicts, settings["auto"], settings["review"])
        if status:
            made.append(MatchPair(a=a, b=b, score=total, points=points, conflicts=conflicts, status=status,
                                  decided_by=decision[1] if decision else "", decided_at=decision[2] if decision else None))
    MatchPair.objects.bulk_create(made)
    regroup()
    score_all()
    summary = summarize()
    MatchRun.objects.create(ran_by=user, summary=summary)
    return summary


def regroup():
    """Put linked profiles (matched automatically or confirmed by a person) into one person each."""
    ids = list(Profile.objects.values_list("id", flat=True))
    parent = {i: i for i in ids}

    def root(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in MatchPair.objects.filter(status__in=[MatchPair.MATCHED, MatchPair.CONFIRMED]).values_list("a_id", "b_id"):
        parent[root(b)] = root(a)
    groups = defaultdict(list)
    for i in ids:
        groups[root(i)].append(i)
    for members in groups.values():
        Profile.objects.filter(id__in=members).update(person=f"P-{min(members)}")


def summarize():
    per_source = defaultdict(int)
    for name in Profile.objects.values_list("source__name", flat=True):
        per_source[name] += 1
    pairs = MatchPair.objects.all()
    people = Profile.objects.values("person").distinct().count()
    return {
        "profiles": sum(per_source.values()),
        "per_source": dict(per_source),
        "people": people,
        "matched": pairs.filter(status=MatchPair.MATCHED).count(),
        "confirmed": pairs.filter(status=MatchPair.CONFIRMED).count(),
        "review": pairs.filter(status=MatchPair.REVIEW, conflicts=[]).count(),
        "conflicts": pairs.filter(status=MatchPair.REVIEW).exclude(conflicts=[]).count(),
        "rejected": pairs.filter(status=MatchPair.REJECTED).count(),
    }


def decide(pair, same, user=""):
    pair.status = MatchPair.CONFIRMED if same else MatchPair.REJECTED
    pair.decided_by = user
    pair.decided_at = timezone.now()
    pair.save(update_fields=["status", "decided_by", "decided_at"])
    regroup()
    score_all()
    pair.a.refresh_from_db(fields=["person"])
    pair.b.refresh_from_db(fields=["person"])


@transaction.atomic
def keep_apart(profile, user=""):
    """Take one record out of its person: every link between it and the person's other records becomes "not the
    same", so matching again keeps them apart too."""
    others = Profile.objects.filter(person=profile.person).exclude(id=profile.id)
    links = MatchPair.objects.filter(status__in=[MatchPair.MATCHED, MatchPair.CONFIRMED]).filter(
        Q(a=profile, b__in=others) | Q(b=profile, a__in=others))
    count = links.update(status=MatchPair.REJECTED, decided_by=user, decided_at=timezone.now())
    regroup()
    score_all()
    profile.refresh_from_db(fields=["person"])
    return count
