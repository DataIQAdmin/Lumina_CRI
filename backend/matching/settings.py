"""This organization's settings for matching, trust scores and golden records, with the defaults agreed from the
trust score document. Administrators change them on Settings; saving runs matching again so every score and golden
record follows them at once."""

from copy import deepcopy

from sources.models import Source

from .score import POINTS, LABELS

RULES = ["uniqueness", "recency", "completeness", "consistency", "accuracy"]
GOLDEN_FIELDS = ["name", "dob", "gender", "pan", "aadhaar", "mobile", "email", "address"]
GOLDEN_LABELS = {**LABELS, "gender": "Gender", "address": "Address (with city, state and pincode)"}
DEFAULTS = {
    "weights": {r: 20 for r in RULES},  # percent, adding up to 100
    "bands": {"high": 90, "good": 75, "review": 50},  # lowest score of each band; below review is Low
    "points": dict(POINTS),
    "auto": 80,
    "review": 50,
    "source_order": [],  # source codes, first comes first; sources not listed follow by trust
    "field_rules": {"name": "order", "dob": "order", "gender": "order", "pan": "order", "aadhaar": "order",
                    "mobile": "recent", "email": "recent", "address": "recent"},
}


class SettingsError(ValueError):
    pass


def current():
    """The settings in force: the saved ones over the defaults."""
    from .models import MatchSettings

    row = MatchSettings.objects.filter(pk=1).values("values", "version").first() or {"values": {}, "version": 0}
    saved = row["values"] or {}
    out = deepcopy(DEFAULTS)
    for key, value in saved.items():
        if isinstance(out.get(key), dict) and isinstance(value, dict):
            out[key].update(value)
        elif key in out:
            out[key] = value
    out["version"] = row["version"]  # which settings a score was worked out with; never saved inside values
    return out


def source_rank(settings=None):
    """{source id: rank}, 0 first: the saved order, then the rest by trust, highest first."""
    settings = settings or current()
    order = settings["source_order"]
    sources = sorted(Source.objects.all(), key=lambda s: (order.index(s.code) if s.code in order else len(order),
                                                         -float(s.trust), s.name))
    return {s.id: i for i, s in enumerate(sources)}


def _whole(value, what, low=0, high=100):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value or not low <= value <= high:
        raise SettingsError(f"{what} must be a whole number from {low} to {high}.")
    return int(value)


def clean(data):
    """Checked settings from what the screen sent, or SettingsError saying what is wrong."""
    out = deepcopy(DEFAULTS)
    weights = {r: _whole((data.get("weights") or {}).get(r, -1), f"The weight of {r}") for r in RULES}
    if sum(weights.values()) != 100:
        raise SettingsError(f"The five weights must add up to 100; now they add up to {sum(weights.values())}.")
    out["weights"] = weights
    bands = {b: _whole((data.get("bands") or {}).get(b, -1), f"The {b} band", 1, 100) for b in ("high", "good", "review")}
    if not bands["high"] > bands["good"] > bands["review"]:
        raise SettingsError("Bands must go down: High above Good above Review.")
    out["bands"] = bands
    out["points"] = {f: _whole((data.get("points") or {}).get(f, -1), f"Points for {LABELS[f]}") for f in POINTS}
    out["auto"] = _whole(data.get("auto", -1), "The match score", 1, 100)
    out["review"] = _whole(data.get("review", -1), "The review score", 1, 100)
    if out["review"] >= out["auto"]:
        raise SettingsError("The review score must be below the match score.")
    codes = set(Source.objects.values_list("code", flat=True))
    order = [c for c in (data.get("source_order") or []) if isinstance(c, str)]
    if any(c not in codes for c in order) or len(set(order)) != len(order):
        raise SettingsError("The source order lists an unknown source, or one twice.")
    out["source_order"] = order
    rules = data.get("field_rules") or {}
    for field in GOLDEN_FIELDS:
        if rules.get(field) not in ("order", "recent"):
            raise SettingsError(f"Say how {GOLDEN_LABELS[field]} is chosen: source order or most recent.")
        out["field_rules"][field] = rules[field]
    return out
