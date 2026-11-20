"""The trust score: five checks at 20% each, saved with their evidence, the bands, and what holds a record at
Review whatever its score."""

from datetime import timedelta
from types import SimpleNamespace

from django.utils import timezone

from matching.trust import band_of, recency, score_profile

NOW = timezone.now()
FIELDS = ("name", "dob", "pan", "aadhaar", "mobile", "email", "address")
SOURCES = {1: SimpleNamespace(name="Core Banking"), 2: SimpleNamespace(name="CRM"), 3: SimpleNamespace(name="FinOne")}


def field(value, passed=True, tested=True):
    return {"value": value, "key": value.lower(), "tested": tested, "passed": passed}


def record(source_id=1, key="C1", days=10, raw=None, **changes):
    raw = raw if raw is not None else {f: field(f"{f} value") for f in FIELDS}
    for f, v in changes.items():
        if v is None:
            raw.pop(f, None)
        else:
            raw[f] = v
    return SimpleNamespace(id=hash((source_id, key)), source_id=source_id, source=SOURCES[source_id], key=key, raw=raw,
                           values={f: v["value"] for f, v in raw.items()}, keys={},
                           updated_at=NOW - timedelta(days=days) if days is not None else None)


def scores(parts):
    return {r: p["score"] for r, p in parts.items()}


def test_a_complete_recent_unique_clean_record_is_high():
    trust, parts, holds = score_profile(record(), [], [], NOW)
    assert scores(parts) == {"uniqueness": 100, "recency": 100, "completeness": 100, "consistency": 100, "accuracy": 100}
    assert trust == 100 and holds == [] and band_of(trust) == "High"
    assert parts["accuracy"]["points"] == 20 and parts["accuracy"]["weight"] == 20


def test_the_worked_example_of_the_plan():
    """Rahul Sharma in three systems: A Core Banking 100, B CRM 79 held at Review, C FinOne 87."""
    def rahul(source_id, key, days, **changes):
        raw = {"name": field("Rahul Sharma"), "dob": field("1990-05-12"), "pan": field("ABCDE1234F"),
               "aadhaar": field("4821"), "mobile": field("9876543210"), "email": field("rahul.sharma@mail.com"),
               "address": field("Bangalore")}
        return record(source_id, key, days, raw=raw, **changes)

    a = rahul(1, "C101", 10)
    b = rahul(2, "C102", 120, email=None)
    c = rahul(3, "C103", 45, name=field("Rahul S", passed=False), address=field("Hyderabad"))

    trust_a, parts_a, holds_a = score_profile(a, [b, c], [], NOW)
    trust_b, parts_b, holds_b = score_profile(b, [a, c], [{"conflicts": [], "other": "C109"}], NOW)
    trust_c, parts_c, holds_c = score_profile(c, [a, b], [], NOW)

    assert scores(parts_a) == {"uniqueness": 100, "recency": 100, "completeness": 100, "consistency": 100, "accuracy": 100}
    assert scores(parts_b) == {"uniqueness": 50, "recency": 60, "completeness": 85.71, "consistency": 100, "accuracy": 100}
    assert scores(parts_c) == {"uniqueness": 100, "recency": 80, "completeness": 100, "consistency": 71.43, "accuracy": 85.71}
    assert (trust_a, trust_b, trust_c) == (100, 79, 87)
    assert band_of(trust_a, holds_a) == "High"
    assert band_of(trust_b, holds_b) == "Review" and holds_b == ["A possible match is waiting for review"]
    assert band_of(trust_c, holds_c) == "Good"

    # The evidence says exactly why.
    assert parts_b["completeness"]["evidence"]["missing"] == ["email"]
    assert len(parts_b["consistency"]["evidence"]["fields"]) == 6  # the empty email is not compared
    assert parts_b["uniqueness"]["evidence"]["pending"] == ["C109"]
    differ = [f["field"] for f in parts_c["consistency"]["evidence"]["fields"] if not f["agree"]]
    assert differ == ["name", "address"]
    name = next(f for f in parts_c["consistency"]["evidence"]["fields"] if f["field"] == "name")
    assert name["majority"] == "Rahul Sharma" and name["mine"] == "Rahul S"
    assert [f["field"] for f in parts_c["accuracy"]["evidence"]["fields"] if not f["passed"]] == ["name"]
    assert round(sum(p["points"] for p in parts_b.values()), 2) == 79.14


def test_an_empty_value_lowers_completeness_only():
    trust, parts, _ = score_profile(record(email=None, aadhaar=None), [record(2, "X")], [], NOW)
    assert parts["completeness"]["score"] == 71.43
    assert parts["consistency"]["score"] == 100 and parts["accuracy"]["score"] == 100


def test_two_records_that_disagree_have_no_majority():
    other = record(2, "X", mobile=field("9000000001"))
    _, parts, holds = score_profile(record(), [other], [], NOW)
    mobile = next(f for f in parts["consistency"]["evidence"]["fields"] if f["field"] == "mobile")
    assert not mobile["agree"] and mobile["majority"] == ""
    assert parts["consistency"]["score"] == 85.71 and holds == []  # mobile is not an identity detail


def test_recency_bands():
    assert [recency(NOW - timedelta(days=d), NOW)[0] for d in (0, 30, 31, 90, 91, 180, 181, 365, 366)] == \
        [100, 100, 80, 80, 60, 60, 40, 40, 20]
    assert recency(None, NOW)[0] == 20


def test_score_bands():
    assert [band_of(s) for s in (100, 90, 89, 75, 74, 50, 49, 0)] == \
        ["High", "High", "Good", "Good", "Review", "Review", "Low", "Low"]


def test_a_duplicate_in_the_same_system_scores_zero_uniqueness():
    _, parts, _ = score_profile(record(), [record(key="C9")], [], NOW)
    assert parts["uniqueness"]["score"] == 0 and parts["uniqueness"]["evidence"]["twins"] == ["C9"]


def test_a_conflicting_identity_detail_holds_the_record():
    other = record(2, "X", dob=field("1991-05-12"))
    _, parts, holds = score_profile(record(), [other], [], NOW)
    assert holds == ["Conflicting identity details"]


def test_a_high_score_never_overrides_an_open_match_or_a_failed_id():
    trust, _, holds = score_profile(record(), [], [{"conflicts": [], "other": "C9"}], NOW)
    assert trust == 90 and band_of(trust, holds) == "Review"
    trust, parts, holds = score_profile(record(pan=field("BAD", passed=False)), [], [], NOW)
    assert parts["accuracy"]["score"] == 85.71
    assert holds == ["PAN failed its format rule"] and band_of(trust, holds) == "Review"


def test_weights_change_the_points():
    weights = {"uniqueness": 25, "recency": 10, "completeness": 15, "consistency": 20, "accuracy": 30}
    trust, parts, _ = score_profile(record(days=200), [], [], NOW, weights)
    assert parts["recency"]["points"] == 4 and trust == 94  # 25 + 4 + 15 + 20 + 30
