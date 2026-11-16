"""The match score of two profiles, 0 to 100, with every point explained.

Plain Python, no database, so it is easy to test and to explain on screen.

Points for each thing two profiles share (capped at 100):
  ID in another system points to the other's Customer ID  40
  PAN 35 · Aadhaar 35 · name up to 25 (by similarity) · date of birth 15 · mobile 15 · email 10
A conflict (different PAN, different Aadhaar, different date of birth, or names too different) is never matched
automatically, however high the score: a person decides. Same rule as the trust score's: a high score never
overrides conflicting identity details.
"""

from collections import defaultdict
from itertools import combinations

from rapidfuzz import fuzz

POINTS = {"cross_ref": 40, "pan": 35, "aadhaar": 35, "name": 25, "dob": 15, "mobile": 15, "email": 10}
LABELS = {"cross_ref": "ID in another system", "pan": "PAN", "aadhaar": "Aadhaar", "name": "Name",
          "dob": "Date of birth", "mobile": "Mobile", "email": "Email"}
AUTO = 80  # at or above, with no conflict: the same person, linked automatically
REVIEW = 50  # 50 to 79, or any conflict at 50 or above: a person decides
NAME_FLOOR = 60  # below this the names are too different: a conflict
BLOCK_LIMIT = 50  # a shared date of birth or email in more profiles than this is too common to compare on


def name_similarity(a, b):
    """0 to 100. Word order does not matter, and an initial matches its word: "rohan k" is close to
    "rohan kumar", "k rohan" too."""
    if not a or not b:
        return 0
    best = fuzz.token_sort_ratio(a, b)
    short, long = sorted([a.split(), b.split()], key=len)
    left = list(long)
    hits = 0
    for word in short:
        found = next((w for w in left if w == word or (len(word) == 1 and w.startswith(word))
                      or (len(w) == 1 and word.startswith(w))), None)
        if found:
            left.remove(found)
            hits += 1
    if hits == len(short) and short and short[0] in (long[0], long[-1]):
        best = max(best, 90 if len(short) < len(long) or any(len(w) == 1 for w in short + long) else 100)
    return round(best)


def score(a, b):
    """(score, points, conflicts) for two profiles given as {"key": customer id, "keys": {...}, "values": {...}}."""
    ka, kb = a["keys"], b["keys"]
    rows, conflicts, total = [], [], 0

    def add(field, result, got, detail=""):
        nonlocal total
        total += got
        rows.append({"field": field, "label": LABELS[field], "result": result, "points": got, "detail": detail,
                     "a": a["values"].get(field, ""), "b": b["values"].get(field, "")})

    linked = (ka.get("cross_ref") and ka["cross_ref"] == b["key"]) or (kb.get("cross_ref") and kb["cross_ref"] == a["key"])
    if ka.get("cross_ref") or kb.get("cross_ref"):
        add("cross_ref", "same" if linked else "missing", POINTS["cross_ref"] if linked else 0,
            "points to the other's Customer ID" if linked else "does not point to the other")
    for field in ("pan", "aadhaar", "dob", "mobile", "email"):
        x, y = ka.get(field), kb.get(field)
        if not x or not y:
            add(field, "missing", 0, "missing on one side")
        elif x == y:
            add(field, "same", POINTS[field])
        else:
            add(field, "different", 0)
            if field in ("pan", "aadhaar", "dob"):
                conflicts.append(f"{LABELS[field]} differs")
    similarity = name_similarity(ka.get("name", ""), kb.get("name", ""))
    if not ka.get("name") or not kb.get("name"):
        add("name", "missing", 0, "missing on one side")
    else:
        add("name", "same" if similarity == 100 else "similar" if similarity >= NAME_FLOOR else "different",
            round(POINTS["name"] * similarity / 100), f"{similarity}% alike")
        if similarity < NAME_FLOOR:
            conflicts.append("Names are too different")
    return min(total, 100), rows, conflicts


def status_of(total, conflicts):
    """"matched", "review" or None (not the same person)."""
    if total < REVIEW:
        return None
    return "review" if conflicts or total < AUTO else "matched"


def candidate_pairs(profiles):
    """Blocking: only profiles sharing a PAN, Aadhaar, mobile, email or date of birth, or linked by an ID in
    another system, are compared. profiles: {id: profile}. Returns sorted (id, id) pairs."""
    buckets = defaultdict(list)
    by_key = defaultdict(list)
    for pid, p in profiles.items():
        by_key[p["key"]].append(pid)
        for field in ("pan", "aadhaar", "mobile", "email", "dob"):
            if p["keys"].get(field):
                buckets[(field, p["keys"][field])].append(pid)
    pairs = set()
    for (field, _), ids in buckets.items():
        if len(ids) > BLOCK_LIMIT and field in ("dob", "email"):
            continue
        pairs.update(combinations(sorted(ids), 2))
    for pid, p in profiles.items():
        for other in by_key.get(p["keys"].get("cross_ref") or "", []):
            if other != pid:
                pairs.add(tuple(sorted((pid, other))))
    return sorted(pairs)
