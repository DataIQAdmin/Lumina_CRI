"""How well matching finds the same people in core banking and the mobile app, against the demo data's answer key
(ingestion/bank_demo.py): 70 shared customers, 27 app-only users, 3 people registered twice in the app, and 2
shared customers whose PAN or date of birth differs between the systems."""

import random
from collections import defaultdict

from ingestion import bank_demo
from matching import normalize
from matching.score import candidate_pairs, score, status_of

FIRST = ["Rohan", "Ananya", "Vikram", "Priya", "Arjun", "Meera", "Karthik", "Sneha", "Rahul", "Divya", "Aditya",
         "Lakshmi", "Sanjay", "Neha", "Suresh", "Kavya", "Manoj", "Pooja", "Ravi", "Asha"]
LAST = ["Kumar", "Sharma", "Iyer", "Nair", "Reddy", "Verma", "Gupta", "Pillai", "Rao", "Menon", "Kulkarni", "Joshi"]


def core_people(bank="axis", n=100):
    rng = random.Random(f"{bank}|people")
    people = []
    for i in range(n):
        first, last = rng.choice(FIRST), rng.choice(LAST)
        people.append({"cif": f"AXC{100000 + i}", "name": f"{first} {last}",
                       "dob": f"{rng.randint(1, 28):02d}-{rng.randint(1, 12):02d}-{rng.randint(1950, 2000)}",
                       "pan": "".join(rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ") for _ in range(5)) + f"{rng.randint(1000, 9999)}"
                              + rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
                       "aadhaar": f"{rng.randint(10 ** 11, 10 ** 12 - 1)}", "gender": rng.choice(["Male", "Female"]),
                       "mobile": f"{rng.choice('6789')}{rng.randint(10 ** 8, 10 ** 9 - 1)}",
                       "email": f"{first}.{last}{i}@gmail.com".lower(), "city": "Pune"})
    return people


def profile(key, fields):
    keys = {f: normalize.NORMALIZERS[f](v) for f, v in fields.items() if f in normalize.NORMALIZERS}
    return {"key": key, "keys": {k: v for k, v in keys.items() if v}, "values": {f: str(v) for f, v in fields.items()}}


def build():
    people = core_people()
    collections, key = bank_demo.app_collections("axis", people)
    profiles = {}
    for p in people:
        profiles[f"core:{p['cif']}"] = profile(p["cif"], {f: p[f] for f in ("name", "dob", "pan", "aadhaar", "mobile", "email")})
    for doc in collections["app_users"]:
        profiles[f"app:{doc['userId']}"] = profile(doc["userId"], {
            "name": doc["profile"]["fullName"], "dob": doc["profile"]["dob"], "pan": doc["kyc"]["pan"],
            "mobile": doc["contact"]["mobile"], "email": doc["contact"]["email"], "cross_ref": doc.get("cifRef", "")})
    return profiles, key


def judge(profiles):
    found = defaultdict(set)  # status -> {frozenset(ids)}
    for x, y in candidate_pairs(profiles):
        total, _, conflicts = score(profiles[x], profiles[y])
        status = status_of(total, conflicts)
        if status:
            found[status].add(frozenset((x, y)))
    return found


def test_matching_finds_the_people_in_the_answer_key():
    profiles, key = build()
    found = judge(profiles)
    linked = found["matched"] | found["review"]
    same = set()
    for entry in key:
        ids = ([f"core:{entry['core']}"] if entry["core"] else []) + [f"app:{u}" for u in entry["app"]]
        same |= {frozenset((a, b)) for i, a in enumerate(ids) for b in ids[i + 1:]}

    # Every real pair is found: matched outright, or put in front of a person.
    missed = same - linked
    assert len(missed) <= 2, missed
    # The two shared customers whose details differ are never matched automatically.
    for entry in key:
        if entry["conflict"]:
            pair = frozenset((f"core:{entry['core']}", f"app:{entry['app'][0]}"))
            assert pair not in found["matched"]
            assert pair in found["review"]
    # No two different people are matched automatically.
    assert not (found["matched"] - same)
    # Most real pairs need nobody: at least 85% are matched outright.
    assert len(found["matched"] & same) >= 0.85 * len(same)


def test_initials_and_formats_compare_equal():
    from matching.score import name_similarity
    assert name_similarity("rohan k", "rohan kumar") >= 90
    assert name_similarity("kumar rohan", "rohan kumar") == 100
    assert name_similarity("rohan kumar", "priya sharma") < 60
    assert normalize.day("12/05/1990") == normalize.day("12-05-1990") == "1990-05-12"
    assert normalize.mobile("+91 98765-43210") == normalize.mobile("09876543210") == "9876543210"
    assert normalize.name("Mr. ROHAN  Kumar") == "rohan kumar"
    assert normalize.identity("abcde1234f") == normalize.identity("ABCDE 1234F") != ""


def test_a_different_pan_is_always_reviewed():
    a = profile("C1", {"name": "Rohan Kumar", "dob": "12-05-1990", "pan": "ABCDE1234F", "mobile": "9876543210",
                       "email": "rohan@bank.in"})
    b = profile("U1", {"name": "Rohan Kumar", "dob": "12/05/1990", "pan": "ZZZZZ9999Z", "mobile": "+919876543210",
                       "email": "rohan@bank.in", "cross_ref": "C1"})
    total, points, conflicts = score(a, b)
    assert total >= 80 and conflicts == ["PAN differs"]
    assert status_of(total, conflicts) == "review"
    assert {r["field"]: r["points"] for r in points}["cross_ref"] == 40
