"""Bronze-layer data profiling: plain counts for every column of a table, nothing more.

Every column shows how many values are filled, empty and unique. On top of that:
- number-like columns (phone, Aadhaar, PAN, pincode, IDs) show how many values have each length,
  e.g. phone: 10 digits 430, 9 digits 40, 7 digits 30;
- email columns show how many stay within EMAIL_LIMIT characters and how many go over it;
- free text such as names has no length count: a name can be any length;
- columns with only a few different values (PhoneType, Gender) count each value. Identity numbers never do.
"""

import re
from collections import Counter

from .raw import _words, is_identity

EMAIL_LIMIT = 50
MOST_LENGTHS = 6  # lengths listed per column; the rest are added up as "Other lengths"
COUNTED_WORDS = {"id", "no", "number", "num", "code", "phone", "mobile", "contact", "fax", "std", "aadhaar", "aadhar",
                 "pan", "pincode", "pin", "zip", "postal", "ifsc", "card", "passport", "voter", "licence", "license",
                 "ckyc", "uid"}
# A column named for a number but holding something about it: PhoneType, PhoneRiskScore, CardStatus...
NOT_COUNTED_WORDS = {"type", "flag", "status", "provider", "time", "date", "score", "frequency", "category",
                     "preference", "method", "name", "timestamp"}
NUMBER_MARKS = re.compile(r"[\s+()-]")
FEW_VALUES = 8  # a column with this many different values or fewer shows a count for each
ENOUGH_ROWS = 20  # below this a value could point at one person, so values are not listed


def _text(value):
    return "" if value is None else str(value).strip()


def _is_counted(column):
    words = set(_words(column))
    return bool(words & COUNTED_WORDS) and not words & NOT_COUNTED_WORDS


def _is_email(filled):
    return bool(filled) and sum("@" in v for v in filled) * 2 >= len(filled)


def _length_label(text):
    number = NUMBER_MARKS.sub("", text)
    if number.isdigit():
        return f"{len(number)} digit{'' if len(number) == 1 else 's'}"
    return f"{len(text)} character{'' if len(text) == 1 else 's'}"


def _counts(column, filled):
    """[{label, count}] for the column, most common first; [] for free text."""
    if _is_email(filled):
        over = sum(len(v) > EMAIL_LIMIT for v in filled)
        return [{"label": f"Up to {EMAIL_LIMIT} characters", "count": len(filled) - over},
                {"label": f"Over {EMAIL_LIMIT} characters", "count": over}]
    if not _is_counted(column):
        return []
    lengths = Counter(_length_label(v) for v in filled).most_common()
    out = [{"label": label, "count": count} for label, count in lengths[:MOST_LENGTHS]]
    rest = sum(count for _, count in lengths[MOST_LENGTHS:])
    return out + ([{"label": "Other lengths", "count": rest}] if rest else [])


def _values(column, filled):
    """[{label, count}] of each value for a column with few of them, most common first."""
    if len(filled) < ENOUGH_ROWS or is_identity(column) or _is_email(filled):
        return []
    found = Counter(filled)
    if len(found) > FEW_VALUES:
        return []
    return [{"label": label, "count": count} for label, count in found.most_common()]


def profile_column(column, values):
    filled = [t for t in (_text(v) for v in values) if t]
    return {"name": column, "filled": len(filled), "empty": len(values) - len(filled), "unique": len(set(filled)),
            "counts": _counts(column, filled), "values": _values(column, filled)}


def label_of(column_profile, text):
    """Which count of a profiled column a value falls in: "Empty", a length ("10 digits"), "Up to 50 characters",
    one of the listed values, or "Other lengths". None when the column has no counts (free text)."""
    text = _text(text)
    if not text:
        return "Empty"
    counts = [c["label"] for c in column_profile.get("counts", [])]
    if counts and counts[0].startswith("Up to "):
        return counts[0] if len(text) <= EMAIL_LIMIT else counts[1]
    if counts:
        label = _length_label(text)
        return label if label in counts else "Other lengths"
    values = {v["label"] for v in column_profile.get("values") or []}
    return text if text in values else None


def profile_table(columns, rows):
    """The profile of one table from its readable rows (lists in column order)."""
    return {"rows": len(rows), "columns": [
        profile_column(column, [row[i] if i < len(row) else None for row in rows])
        for i, column in enumerate(columns)]}
