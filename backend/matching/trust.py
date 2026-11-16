"""The trust score: how reliable one customer record is, 0 to 100, from the five rules of the trust score
document, each worth 20%:

  Uniqueness    100 no duplicate · 50 a possible duplicate waiting for review · 0 a duplicate in the same system
  Recency       last updated 0-30 days 100 · 31-90 80 · 91-180 60 · 181-365 40 · older, or no date, 20
  Completeness  needed fields filled (name, date of birth, PAN, Aadhaar, mobile, email, address), out of 7
  Consistency   name, date of birth, PAN and Aadhaar agreeing with the same person's other systems
  Accuracy      the customer's rows that pass every format rule

Bands: 90-100 High, 75-89 Good, 50-74 Review, below 50 Low (quarantine). A high score never overrides failed
identity, conflicting critical IDs or unresolved matches: any of these keeps the band at Review at best.
A person's score is the average of their records' scores.
"""

from collections import defaultdict

from django.utils import timezone

from .models import MatchPair, Profile
from .score import LABELS, name_similarity
from .settings import current

NEEDED = ["name", "dob", "pan", "aadhaar", "mobile", "email", "address"]
NEEDED_LABELS = {**LABELS, "address": "Address"}
CRITICAL = ["name", "dob", "pan", "aadhaar"]
RULES = ["uniqueness", "recency", "completeness", "consistency", "accuracy"]
WEIGHT = 20  # percent, each rule
BANDS = [(90, "High"), (75, "Good"), (50, "Review"), (0, "Low")]
RECENCY = [(30, 100), (90, 80), (180, 60), (365, 40)]
OLD = 20


def band_of(score, holds=(), bands=None):
    floors = [(bands["high"], "High"), (bands["good"], "Good"), (bands["review"], "Review"), (0, "Low")] if bands else BANDS
    band = next(name for floor, name in floors if score >= floor)
    return "Review" if holds and band in ("High", "Good") else band


def recency(updated_at, now):
    if updated_at is None:
        return OLD, "No last-updated date"
    days = max((now - updated_at).days, 0)
    points = next((p for limit, p in RECENCY if days <= limit), OLD)
    return points, f"Last updated {days} day{'' if days == 1 else 's'} ago"


def score_profile(p, family, pending, now, weights=None):
    """(trust, parts, holds) of one profile. family: the other profiles of the same person; pending: the review
    pairs it is in, as dicts with "conflicts"."""
    parts, holds = {}, []
    names = lambda ps: ", ".join(q.key for q in ps)  # noqa: E731

    twins = [q for q in family if q.source_id == p.source_id]
    if twins:
        parts["uniqueness"] = (0, f"Also in {p.source.name} as {names(twins)}: a duplicate")
    elif pending:
        parts["uniqueness"] = (50, f"{len(pending)} possible duplicate{'' if len(pending) == 1 else 's'} waiting for review")
        holds.append("A possible match is waiting for review")
    else:
        parts["uniqueness"] = (100, "No duplicate found")

    parts["recency"] = recency(p.updated_at, now)

    filled = [f for f in NEEDED if p.values.get(f)]
    missing = [NEEDED_LABELS[f] for f in NEEDED if f not in filled]
    parts["completeness"] = (round(100 * len(filled) / len(NEEDED)),
                             f"{len(filled)} of {len(NEEDED)} needed fields" + (f"; missing {', '.join(missing)}" if missing else ""))

    checks, agree, differ = 0, 0, []
    for q in family:
        if q.source_id == p.source_id:
            continue
        for field in CRITICAL:
            x, y = p.keys.get(field), q.keys.get(field)
            if not x or not y:
                continue
            checks += 1
            if (name_similarity(x, y) >= 90) if field == "name" else x == y:
                agree += 1
            else:
                differ.append(f"{LABELS[field]} differs from {q.source.name}")
    for pair in pending:
        for conflict in pair["conflicts"]:
            checks += 1
            differ.append(conflict)
    if checks == 0:
        parts["consistency"] = (100, "No other system to compare with")
    else:
        parts["consistency"] = (round(100 * agree / checks), f"{agree} of {checks} checks agree" + (f"; {'; '.join(differ)}" if differ else ""))
    if any(d.split(" differs")[0] in ("PAN", "Aadhaar", "Date of birth") for d in differ):
        holds.append("Conflicting identity details")

    total, clean = p.rows.get("total", 0), p.rows.get("clean", 0)
    parts["accuracy"] = (round(100 * clean / total) if total else 0, f"{clean} of {total} rows pass every format rule")
    failed = [NEEDED_LABELS[f] for f in p.held if f in ("pan", "aadhaar")]
    if failed:
        holds.append(f"{' and '.join(failed)} failed its format rule")

    weights = weights or {r: WEIGHT for r in RULES}
    trust = round(sum(parts[r][0] * weights[r] for r in RULES) / 100)
    return trust, {r: {"score": parts[r][0], "why": parts[r][1]} for r in RULES}, holds


def score_all(now=None):
    """Score every profile again: after matching, and after each decision."""
    now = now or timezone.now()
    settings = current()
    profiles = list(Profile.objects.select_related("source"))
    people = defaultdict(list)
    for p in profiles:
        people[p.person].append(p)
    pending = defaultdict(list)
    for a, b, conflicts in MatchPair.objects.filter(status=MatchPair.REVIEW).values_list("a_id", "b_id", "conflicts"):
        pending[a].append({"conflicts": conflicts})
        pending[b].append({"conflicts": conflicts})
    for p in profiles:
        family = [q for q in people[p.person] if q.id != p.id]
        p.trust, p.parts, p.holds = score_profile(p, family, pending[p.id], now, settings["weights"])
        p.band = band_of(p.trust, p.holds, settings["bands"])
    Profile.objects.bulk_update(profiles, ["trust", "parts", "holds", "band"], batch_size=500)


def person_score(profiles, bands=None):
    """(score, band, holds) of a person from their records."""
    scored = [p for p in profiles if p.trust is not None]
    if not scored:
        return None, "", []
    holds = sorted({h for p in scored for h in p.holds})
    score = round(sum(p.trust for p in scored) / len(scored))
    return score, band_of(score, holds, bands), holds
