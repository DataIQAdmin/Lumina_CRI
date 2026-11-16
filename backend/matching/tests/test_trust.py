"""The trust score: five rules at 20% each, the bands, and what holds a record at Review whatever its score."""

from datetime import timedelta
from types import SimpleNamespace

from django.utils import timezone

from matching.trust import band_of, recency, score_profile

NOW = timezone.now()
CORE = SimpleNamespace(name="Core banking")
APP = SimpleNamespace(name="Mobile app")


def record(source_id=1, key="C1", days=10, values=None, keys=None, rows=(1, 1), held=()):
    values = values if values is not None else {f: "x" for f in ("name", "dob", "pan", "aadhaar", "mobile", "email", "address")}
    return SimpleNamespace(id=hash(key), source_id=source_id, source=CORE if source_id == 1 else APP, key=key,
                           values=values, keys=keys or {"name": "rohan kumar", "dob": "1990-05-12", "pan": "fp1"},
                           updated_at=NOW - timedelta(days=days) if days is not None else None,
                           rows={"total": rows[0], "clean": rows[1]}, held=list(held))


def test_a_complete_recent_unique_clean_record_is_high():
    trust, parts, holds = score_profile(record(), [], [], NOW)
    assert {r: p["score"] for r, p in parts.items()} == {"uniqueness": 100, "recency": 100, "completeness": 100,
                                                        "consistency": 100, "accuracy": 100}
    assert trust == 100 and holds == [] and band_of(trust) == "High"


def test_each_rule_is_worth_20_percent():
    # Old (40), 5 of 7 fields (71), half its rows held back (50): (100 + 40 + 71 + 100 + 50) / 5 = 72
    values = {f: "x" for f in ("name", "dob", "pan", "mobile", "email")}
    trust, parts, _ = score_profile(record(days=200, values=values, rows=(2, 1)), [], [], NOW)
    assert parts["recency"]["score"] == 40 and parts["completeness"]["score"] == 71 and parts["accuracy"]["score"] == 50
    assert "missing Aadhaar, Address" in parts["completeness"]["why"]
    assert trust == 72 and band_of(trust) == "Review"


def test_recency_bands():
    assert [recency(NOW - timedelta(days=d), NOW)[0] for d in (0, 30, 31, 90, 91, 180, 181, 365, 366)] == \
        [100, 100, 80, 80, 60, 60, 40, 40, 20]
    assert recency(None, NOW)[0] == 20


def test_score_bands():
    assert [band_of(s) for s in (100, 90, 89, 75, 74, 50, 49, 0)] == \
        ["High", "High", "Good", "Good", "Review", "Review", "Low", "Low"]


def test_a_duplicate_in_the_same_system_scores_zero_uniqueness():
    twin = record(key="C9")
    _, parts, _ = score_profile(record(), [twin], [], NOW)
    assert parts["uniqueness"]["score"] == 0 and "C9" in parts["uniqueness"]["why"]


def test_other_systems_must_agree_for_consistency():
    app = record(source_id=2, key="usr_1", keys={"name": "rohan k", "dob": "1991-05-12", "pan": "fp1"})
    _, parts, holds = score_profile(record(), [app], [], NOW)
    assert parts["consistency"]["score"] == 67  # name and PAN agree, date of birth does not
    assert "Date of birth differs from Mobile app" in parts["consistency"]["why"]
    assert holds == ["Conflicting identity details"]


def test_a_high_score_never_overrides_an_unresolved_match_or_failed_identity():
    trust, parts, holds = score_profile(record(), [], [{"conflicts": []}], NOW)
    assert parts["uniqueness"]["score"] == 50 and trust == 90
    assert band_of(trust, holds) == "Review"
    trust, _, holds = score_profile(record(held=["pan"], rows=(3, 3)), [], [], NOW)
    assert trust == 100 and holds == ["PAN failed its format rule"] and band_of(trust, holds) == "Review"
