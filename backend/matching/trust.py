"""The trust score: how reliable one customer record is, 0 to 100, from the five checks of the trust score
document, each worth 20% by default:

  Uniqueness    100 no duplicate · 50 a possible duplicate waiting for review · 0 a duplicate in the same system
  Recency       last updated 0-30 days 100 · 31-90 80 · 91-180 60 · 181-365 40 · older, or no date, 20
  Completeness  needed fields filled (name, date of birth, PAN, Aadhaar, mobile, email, address) out of 7
  Consistency   needed fields agreeing with the value most of the person's records hold, out of those compared
  Accuracy      filled fields passing their column rule, out of the filled fields that have a rule

An empty value lowers Completeness only: it is not compared and not tested. Two records that disagree with no
third to settle it have no majority, so both count as differing.

Bands: 90-100 High, 75-89 Good, 50-74 Review, below 50 Low (quarantine). A high score never overrides an open
possible duplicate, a conflicting PAN, Aadhaar or date of birth, or a PAN or Aadhaar failing its rule: any of these
keeps the band at Review at best. A person's score is the average of their records' scores.

Every check is saved with its evidence (the values, dates and rules behind it), so the screen shows the calculation
exactly as it ran and never works it out again.
"""

from collections import Counter, defaultdict

from django.utils import timezone

from .models import GoldenRecord, MatchPair, Profile
from .score import LABELS
from .settings import current

NEEDED = ["name", "dob", "pan", "aadhaar", "mobile", "email", "address"]
NEEDED_LABELS = {**LABELS, "address": "Address", "gender": "Gender", "city": "City", "state": "State", "pincode": "Pincode"}
CRITICAL = ["dob", "pan", "aadhaar"]
RULES = ["uniqueness", "recency", "completeness", "consistency", "accuracy"]
WEIGHT = 20  # percent, each check
BANDS = [(90, "High"), (75, "Good"), (50, "Review"), (0, "Low")]
RECENCY = [(30, 100, "0 to 30 days"), (90, 80, "31 to 90 days"), (180, 60, "91 to 180 days"), (365, 40, "181 to 365 days")]
OLD = 20


def band_of(score, holds=(), bands=None):
    floors = [(bands["high"], "High"), (bands["good"], "Good"), (bands["review"], "Review"), (0, "Low")] if bands else BANDS
    band = next(name for floor, name in floors if score >= floor)
    return "Review" if holds and band in ("High", "Good") else band


def recency(updated_at, now):
    """(points, why, evidence)"""
    if updated_at is None:
        return OLD, "No last-updated date", {"date": None, "days": None, "band": "No date"}
    days = max((now - updated_at).days, 0)
    points, label = next(((p, lab) for limit, p, lab in RECENCY if days <= limit), (OLD, "over 365 days"))
    return points, f"Last updated {days} day{'' if days == 1 else 's'} ago", \
        {"date": updated_at.isoformat(), "days": days, "band": label}


def raw_of(p):
    """Every field the record holds, clean or not: {field: {value, key, tested, passed}}. Records built before raw
    values were kept fall back to their clean values (untested)."""
    raw = getattr(p, "raw", None)
    if raw:
        return {f: v for f, v in raw.items() if v.get("value")}
    keys = p.keys or {}
    return {f: {"value": v, "key": keys.get(f) or str(v).strip().lower(), "tested": False, "passed": True}
            for f, v in (p.values or {}).items() if v}


def _pct(part, whole):
    return round(100 * part / whole, 2) if whole else 100.0


def score_profile(p, family, pending, now, weights=None):
    """(trust, parts, holds) of one profile. family: the other profiles of the same person; pending: the review
    pairs it is in, as dicts with "conflicts" and "other" (the other record's key)."""
    parts, holds = {}, []
    raw = raw_of(p)

    # Uniqueness
    twins = [q for q in family if q.source_id == p.source_id]
    if twins:
        parts["uniqueness"] = (0, f"Also in {p.source.name} as {', '.join(q.key for q in twins)}: a duplicate",
                               {"twins": [q.key for q in twins], "pending": []})
    elif pending:
        n = len(pending)
        parts["uniqueness"] = (50, f"{n} possible duplicate{'' if n == 1 else 's'} waiting for review",
                               {"twins": [], "pending": [x.get("other", "") for x in pending]})
        holds.append("A possible match is waiting for review")
    else:
        parts["uniqueness"] = (100, "No duplicate found", {"twins": [], "pending": []})

    # Recency
    parts["recency"] = recency(p.updated_at, now)

    # Completeness: an empty value counts here and only here.
    filled = [f for f in NEEDED if f in raw]
    missing = [f for f in NEEDED if f not in raw]
    parts["completeness"] = (_pct(len(filled), len(NEEDED)),
                             f"{len(filled)} of {len(NEEDED)} needed fields filled"
                             + (f"; missing {', '.join(NEEDED_LABELS[f] for f in missing)}" if missing else ""),
                             {"filled": filled, "missing": missing, "needed": len(NEEDED)})

    # Consistency: each needed field against the value most of the person's records hold.
    others = [q for q in family if q.source_id != p.source_id]
    checks = []
    for field in NEEDED:
        mine = raw.get(field)
        if not mine or not mine.get("key"):
            continue
        theirs = [(q, raw_of(q).get(field)) for q in others]
        theirs = [(q, v) for q, v in theirs if v and v.get("key")]
        if not theirs:
            continue
        counts = Counter([mine["key"]] + [v["key"] for _, v in theirs])
        top, n = counts.most_common(1)[0]
        majority = top if n * 2 > sum(counts.values()) else None
        shown = next((v["value"] for _, v in theirs if v["key"] == majority), mine["value"]) if majority else ""
        checks.append({"field": field, "label": NEEDED_LABELS[field], "mine": mine["value"], "majority": shown,
                       "agree": majority is not None and mine["key"] == majority, "compared": len(theirs) + 1,
                       "others": [{"source": q.source.name, "key": q.key, "value": v["value"]} for q, v in theirs]})
    if not checks:
        parts["consistency"] = (100, "No other system to compare with", {"fields": []})
    else:
        agree = sum(c["agree"] for c in checks)
        differ = [c["label"] for c in checks if not c["agree"]]
        parts["consistency"] = (_pct(agree, len(checks)),
                                f"{agree} of {len(checks)} fields agree with the customer's other records"
                                + (f"; {', '.join(differ)} differ" if differ else ""), {"fields": checks})
        if any(not c["agree"] for c in checks if c["field"] in CRITICAL):
            holds.append("Conflicting identity details")

    # Accuracy: filled fields that have a column rule, and whether they pass it.
    tested = [{"field": f, "label": NEEDED_LABELS.get(f, f), "value": v["value"], "passed": bool(v["passed"])}
              for f, v in raw.items() if v.get("tested")]
    failed = [t for t in tested if not t["passed"]]
    if not tested:
        parts["accuracy"] = (100, "No filled field has a column rule yet", {"fields": []})
    else:
        parts["accuracy"] = (_pct(len(tested) - len(failed), len(tested)),
                             f"{len(tested) - len(failed)} of {len(tested)} filled fields pass their rule"
                             + (f"; {', '.join(t['label'] for t in failed)} fail" if failed else ""), {"fields": tested})
    bad_ids = [NEEDED_LABELS[t["field"]] for t in failed if t["field"] in ("pan", "aadhaar")]
    if bad_ids:
        holds.append(f"{' and '.join(bad_ids)} failed its format rule")

    weights = weights or {r: WEIGHT for r in RULES}
    out = {}
    for r in RULES:
        score, why, evidence = parts[r]
        out[r] = {"score": score, "why": why, "weight": weights[r], "points": round(score * weights[r] / 100, 2),
                  "evidence": evidence}
    exact = round(sum(x["points"] for x in out.values()), 2)
    return round(exact), out, holds


def score_all(now=None):
    """Score every profile again, then rebuild every golden record: after matching, and after each decision."""
    from . import golden

    now = now or timezone.now()
    settings = current()
    profiles = list(Profile.objects.select_related("source"))
    people = defaultdict(list)
    for p in profiles:
        people[p.person].append(p)
    by_id = {p.id: p for p in profiles}
    pending = defaultdict(list)
    for a, b, conflicts in MatchPair.objects.filter(status=MatchPair.REVIEW).values_list("a_id", "b_id", "conflicts"):
        pending[a].append({"conflicts": conflicts, "other": by_id[b].key if b in by_id else ""})
        pending[b].append({"conflicts": conflicts, "other": by_id[a].key if a in by_id else ""})
    for p in profiles:
        family = [q for q in people[p.person] if q.id != p.id]
        p.trust, p.parts, p.holds = score_profile(p, family, pending[p.id], now, settings["weights"])
        p.band = band_of(p.trust, p.holds, settings["bands"])
        p.settings_version = settings["version"]
    Profile.objects.bulk_update(profiles, ["trust", "parts", "holds", "band", "settings_version"], batch_size=500)

    GoldenRecord.objects.exclude(person__in=list(people)).delete()
    for person, records in people.items():
        GoldenRecord.objects.update_or_create(person=person, defaults={
            "rows": golden.snapshot(golden.build(records, settings)), "settings_version": settings["version"]})


def person_score(profiles, bands=None):
    """(score, band, holds) of a person from their records."""
    scored = [p for p in profiles if p.trust is not None]
    if not scored:
        return None, "", []
    holds = sorted({h for p in scored for h in p.holds})
    score = round(sum(p.trust for p in scored) / len(scored))
    return score, band_of(score, holds, bands), holds
