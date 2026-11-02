"""The silver layer: every raw table cleaned the same simple way, using what profiling learned about each column.

Raw rows are never changed. Silver is worked out from them: a summary of what cleaning changes is kept on the
RawTable (silver), and the cleaned rows themselves are produced page by page when someone looks at them.

Cleaning, per value:
  - spaces trimmed and doubled spaces made single; blank text becomes empty
  - yes/no values written as true / false
  - dates written as YYYY-MM-DD (with a time: YYYY-MM-DD HH:MM:SS); impossible dates emptied
  - percentages without the % sign
  - emails in small letters; invalid emails emptied
  - Indian mobile numbers as 10 digits; numbers that cannot be one emptied
  - PIN codes that are not 6 digits emptied
  - Aadhaar numbers damaged by Excel (4.05E+11) emptied: the real number cannot be recovered
Per row: exact copies of an earlier row (apart from their own ID) are left out.
"""

import re

from .table_profile import EMAIL, PERCENT, _phone_rule, date_format, kind

KEEP_EXAMPLES = 3

LABELS = {
    "spaces": "Extra spaces removed",
    "boolean": "Written as true / false",
    "date": "Date written as YYYY-MM-DD",
    "datetime": "Date and time written as YYYY-MM-DD HH:MM:SS",
    "bad_date": "Impossible date emptied",
    "percent": "% sign removed",
    "email_case": "Email in small letters",
    "bad_email": "Invalid email emptied",
    "phone": "Mobile written as 10 digits",
    "bad_phone": "Not a mobile number, emptied",
    "bad_pincode": "Not a 6-digit PIN code, emptied",
    "excel": "Damaged by Excel, emptied",
    "blank": "Blank text emptied",
}


def plan(profile):
    """{column: set of cleaning steps} from a table's profile."""
    steps = {}
    for c in profile.get("columns", []):
        rules = {r["key"] for r in c["rules"]}
        wanted = set()
        if c["identity"]:
            if "aadhaar_excel" in rules:
                wanted.add("excel")
        else:
            wanted.add("text")
            if c["type"] == "boolean":
                wanted.add("boolean")
            if c["type"] == "date":
                wanted.add("date")
            if c["type"] == "percent":
                wanted.add("percent")
            for key in ("email", "phone", "pincode"):
                if key in rules:
                    wanted.add(key)
        steps[c["name"]] = wanted
    return steps


def _date_text(text):
    label, day = date_format(text)
    if day is None:
        return None
    if label == "YYYY-MM-DD with time":
        time = re.search(r"\d{2}:\d{2}(:\d{2})?", text).group(0)
        return f"{day.isoformat()} {time if len(time) == 8 else time + ':00'}"
    return day.isoformat()


def clean_value(value, steps):
    """(new value, change key or None). change is the reason the value changed, for the summary."""
    if value is None:
        return None, None
    if not isinstance(value, str):
        return value, None
    if "excel" in steps:
        return (None, "excel") if re.fullmatch(r"X*[\d.]*[eE][+-]?\d+", value.strip()) else (value, None)
    if "text" not in steps:
        return value, None
    text = re.sub(r"\s+", " ", value).strip()
    change = "spaces" if text != value else None
    if not text:
        return None, ("blank" if value else None)
    if "boolean" in steps and kind(text) == "boolean":
        new = "true" if text.lower() in ("true", "yes", "y") else "false"
        return new, (change or ("boolean" if new != text else None))
    if "date" in steps and date_format(text)[0]:
        new = _date_text(text)
        if new is None:
            return None, "bad_date"
        moved = ("datetime" if " " in new else "date") if new != text else None
        return new, (change or moved)
    if "percent" in steps and PERCENT.match(text):
        return text.rstrip("%").strip(), "percent"
    if "email" in steps:
        if not EMAIL.match(text):
            return None, "bad_email"
        lower = text.lower()
        return lower, (change or ("email_case" if lower != text else None))
    if "phone" in steps:
        if not _phone_rule(text):
            return None, "bad_phone"
        digits = re.sub(r"\D", "", text)[-10:]
        return digits, (change or ("phone" if digits != text else None))
    if "pincode" in steps and not re.fullmatch(r"[1-9]\d{5}", text):
        return None, "bad_pincode"
    return text, change


def clean_row(values, columns, steps):
    """(cleaned values, {column index: change key})."""
    out, changes = [], {}
    for i, value in enumerate(values):
        new, change = clean_value(value, steps.get(columns[i], set()) if i < len(columns) else set())
        out.append(new)
        if change:
            changes[i] = change
    return out, changes


def summarise(columns, rows, profile):
    """What silver changes in one table: rows left out, and per column each kind of change with how many values
    and a few examples. rows: the raw values in row order (identity numbers already masked)."""
    steps = plan(profile)
    dropped = _later_copies(rows, profile.get("key"), columns)
    counts = {}
    for position, values in enumerate(rows):
        if position in dropped:
            continue
        cleaned, changes = clean_row(values, columns, steps)
        for i, change in changes.items():
            entry = counts.setdefault(columns[i], {}).setdefault(change, {"count": 0, "examples": []})
            entry["count"] += 1
            if len(entry["examples"]) < KEEP_EXAMPLES:
                entry["examples"].append({"before": values[i], "after": cleaned[i]})
    out_columns = [
        {"name": name, "changes": [{"key": k, "label": LABELS[k], **v} for k, v in
                                   sorted(found.items(), key=lambda kv: -kv[1]["count"])]}
        for name in columns if (found := counts.get(name))
    ]
    return {
        "rows_in": len(rows), "rows_out": len(rows) - len(dropped), "dropped": sorted(dropped),
        "changed_cells": sum(ch["count"] for c in out_columns for ch in c["changes"]),
        "emptied": sum(ch["count"] for c in out_columns for ch in c["changes"]
                       if ch["key"] in ("bad_date", "bad_email", "bad_phone", "bad_pincode", "excel", "blank")),
        "columns": out_columns, "steps": {k: sorted(v) for k, v in steps.items()},
    }


def _later_copies(rows, key, columns):
    """Positions of rows that are exact copies of an earlier row, apart from their own ID column."""
    skip_first = bool(key) and columns and columns[0] == key
    seen, later = set(), set()
    for position, values in enumerate(rows):
        body = tuple(str(v) for v in (values[1:] if skip_first else values))
        if body in seen:
            later.add(position)
        seen.add(body)
    return later


def steps_from(summary):
    return {k: set(v) for k, v in (summary.get("steps") or {}).items()}

