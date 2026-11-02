"""Data profiling of raw tables (ingestion/raw.py): what each column holds and which rules its values break.

A table is profiled when it is read, from the rows already in memory, and the result is kept on the RawTable.
For each column: its type, how many values are empty or distinct, the most common values and patterns, the
smallest and largest value, the date formats used, and the rules that apply to it (worked out from the column's
name and type). Each rule keeps the positions of the first rows that break it, for drill-down.

Identity-number columns are profiled from their shape and fingerprint only (see raw.protect).

Links between tables (relationships) are worked out per connector: a column named like another table's ID
column (customer_address.CustomerID -> customer_master.CustomerID) should only hold IDs that table has.
"""

import re
import string
from collections import Counter
from functools import lru_cache
from datetime import date, datetime

from .raw import _words

KEEP_POSITIONS = 500  # rows kept per broken rule, for drill-down
TOP = 5

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
INTEGER = re.compile(r"^[+-]?\d+$")
DECIMAL = re.compile(r"^[+-]?\d*\.\d+$")
PERCENT = re.compile(r"^[+-]?\d+(\.\d+)?\s?%$")
SCIENTIFIC = re.compile(r"^[+-]?\d+(\.\d+)?[eE][+-]?\d+$")
BOOLEAN = {"true", "false", "yes", "no", "y", "n"}

# (pattern, strptime format of the date part, label people see)
DATE_FORMATS = [
    (re.compile(r"^\d{4}-\d{2}-\d{2}$"), "%Y-%m-%d", "YYYY-MM-DD"),
    (re.compile(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$"), "%Y-%m-%d",
     "YYYY-MM-DD with time"),
    (re.compile(r"^\d{2}-\d{2}-\d{4}$"), "%d-%m-%Y", "DD-MM-YYYY"),
    (re.compile(r"^\d{2}/\d{2}/\d{4}$"), "%d/%m/%Y", "DD/MM/YYYY"),
    (re.compile(r"^\d{4}/\d{2}/\d{2}$"), "%Y/%m/%d", "YYYY/MM/DD"),
    (re.compile(r"^\d{2}-[A-Za-z]{3}-\d{4}$"), "%d-%b-%Y", "DD-Mon-YYYY"),
]

TYPE_LABELS = {"empty": "Empty", "boolean": "Yes / no", "integer": "Whole number", "decimal": "Decimal",
               "percent": "Percentage", "scientific": "Scientific number", "date": "Date", "email": "Email",
               "uuid": "ID (UUID)", "text": "Text"}


def _empty(value):
    return value is None or (isinstance(value, str) and not value.strip())


# Results per distinct value are remembered: most columns repeat a few values thousands of times, and the
# hosted server has little CPU, so each value is worked out once.
CACHE = 20_000  # entries per cache: enough for repeated values, small enough for a 512 MB server


@lru_cache(maxsize=CACHE)
def date_format(text):
    """(label, date) of a date written in one of the known formats, else (None, None). An impossible date
    such as 31-02-2020 gives (label, None)."""
    for pattern, fmt, label in DATE_FORMATS:
        if pattern.match(text):
            part = text[:10] if fmt.startswith("%Y") else text
            try:
                return label, datetime.strptime(part, fmt).date()
            except ValueError:
                return label, None
    return None, None


def kind(value):
    """The type of one non-empty value."""
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "decimal"
    return _kind_text(str(value).strip())


@lru_cache(maxsize=CACHE)
def _kind_text(text):
    if text.lower() in BOOLEAN:
        return "boolean"
    if INTEGER.match(text):
        return "integer"
    if DECIMAL.match(text):
        return "decimal"
    if PERCENT.match(text):
        return "percent"
    if SCIENTIFIC.match(text):
        return "scientific"
    if date_format(text)[0]:
        return "date"
    if EMAIL.match(text):
        return "email"
    if UUID.match(text):
        return "uuid"
    return "text"


SHAPES = str.maketrans(string.ascii_uppercase + string.ascii_lowercase + string.digits,
                       "A" * 26 + "a" * 26 + "9" * 10)


@lru_cache(maxsize=CACHE)
def pattern(text):
    """A short pattern of a value: capitals A, small letters a, digits 9; long runs counted.
    "ABCDE1234F" -> "AAAAA9999A"; "7676fa73-b087-..." -> "9999aa99-a999-..."; "100000000000" -> "9×12"."""
    shaped = text.translate(SHAPES)
    return re.sub(r"(A|a|9)\1{5,}", lambda m: f"{m.group(1)}×{len(m.group(0))}", shaped)[:40]


# ---------- Rules: which apply to a column, from its name and type ----------

def _has(words, *wanted):
    return any(w in wanted for w in words)


def _phone_rule(text):
    digits = re.sub(r"[\s\-()]", "", text)
    if digits.startswith("+91"):
        digits = digits[3:]
    elif digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    return bool(re.fullmatch(r"[6-9]\d{9}", digits))


def rules_for(column, main_type, identity):
    """[(key, label, check)] for one column. check(value, shape) -> True when the value is fine; empty values
    are never checked (they are counted as empty)."""
    words = _words(column)
    last = words[-1] if words else ""
    found = []
    if identity:
        found.append(("once", "Each number on one row only", None))  # checked on fingerprints, in profile_column
        if _has(words, "pan", "pancard"):
            found.append(("pan", "PAN pattern (5 letters, 4 digits, 1 letter)",
                          lambda v, s: s == "AAAAA9999A"))
        elif _has(words, "aadhaar", "aadhar", "uid"):
            found.append(("aadhaar_excel", "Not damaged by Excel (like 4.05E+11)",
                          lambda v, s: not re.fullmatch(r"9+(\.9+)?[Aa][+-]?9+", s)))
            found.append(("aadhaar", "Aadhaar has 12 digits", lambda v, s: re.sub(r"[\s-]", "", s) == "9" * 12))
        return found
    if main_type == "email" or (_has(words, "email") and last in ("email", "address", "mail")):
        found.append(("email", "Valid email address", lambda v, s: bool(EMAIL.match(str(v).strip()))))
    if _has(words, "phone", "mobile", "contact") and last in ("number", "no", "phone", "mobile"):
        found.append(("phone", "Indian mobile number (10 digits, starts 6-9)", lambda v, s: _phone_rule(str(v))))
    if _has(words, "pincode", "pin", "postal", "zip") and not _has(words, "id"):
        found.append(("pincode", "PIN code has 6 digits", lambda v, s: bool(re.fullmatch(r"[1-9]\d{5}", str(v).strip()))))
    if main_type == "date":
        found.append(("date", "Real calendar date", lambda v, s: date_format(str(v).strip())[1] is not None))
        if _has(words, "birth", "dob"):
            def adult(v, s):
                day = date_format(str(v).strip())[1]
                if day is None:
                    return True  # counted by the calendar-date rule
                today = date.today()
                age = today.year - day.year - ((today.month, today.day) < (day.month, day.day))
                return 18 <= age <= 100
            found.append(("age", "Age between 18 and 100", adult))
    if main_type == "text":
        found.append(("spaces", "No extra spaces",
                      lambda v, s: not isinstance(v, str) or (v == v.strip() and "  " not in v)))
    return found


# ---------- Profiling one table ----------

def _number(value):
    try:
        return float(str(value).strip().rstrip("%"))
    except ValueError:
        return None


def profile_column(column, values, protected=None):
    """values: the column's values in row order. protected: for identity-number columns, [shape, fingerprint]
    per row (None where empty)."""
    identity = protected is not None
    rows = len(values)
    filled = [i for i, v in enumerate(values) if not _empty(v)]
    if identity:
        shapes = {i: protected[i][0] for i in filled if protected[i]}
        same = Counter(protected[i][1] for i in filled if protected[i])
        texts = {i: shapes.get(i, "") for i in filled}
    else:
        texts = {i: str(values[i]).strip() for i in filled}
        same = Counter(texts.values())
    kinds = Counter(("text" if identity else kind(values[i])) for i in filled)
    main = kinds.most_common(1)[0][0] if kinds else "empty"
    if kinds.get("integer") and kinds.get("decimal") and main in ("integer", "decimal"):
        main = "decimal"  # 7 and 7.5 in one column are both numbers
    patterns = Counter(texts[i] if identity else pattern(texts[i]) for i in filled)
    lengths = [len(str(values[i]).strip()) for i in filled]

    out = {
        "name": column, "type": main, "type_label": TYPE_LABELS[main], "identity": identity,
        "rows": rows, "empty": rows - len(filled), "distinct": len(same),
        "duplicates": sum(n for n in same.values() if n > 1),  # values that appear more than once, all copies
        "min_length": min(lengths) if lengths else None, "max_length": max(lengths) if lengths else None,
        "patterns": [{"value": p, "count": n} for p, n in patterns.most_common(TOP)],
        "pattern_count": len(patterns),
        "top": [] if identity else [{"value": v[:80], "count": n} for v, n in same.most_common(TOP)],
        "types": [{"type": k, "label": TYPE_LABELS[k], "count": n} for k, n in kinds.most_common()],
    }
    if main in ("integer", "decimal", "percent"):
        numbers = [x for x in (_number(values[i]) for i in filled) if x is not None]
        if numbers:
            out["min"], out["max"] = min(numbers), max(numbers)
    rule_rows = []
    if main == "date":
        formats, days = Counter(), []
        for i in filled:
            label, day = date_format(texts[i])
            if label:
                formats[label] += 1
            if day:
                days.append(day)
        out["date_formats"] = [{"format": f, "count": n} for f, n in formats.most_common()]
        if days:
            out["min"], out["max"] = min(days).isoformat(), max(days).isoformat()
        if len(formats) > 1:
            usual = formats.most_common(1)[0][0]
            rule_rows.append(("formats", f"One date format ({usual})",
                              [i for i in filled if date_format(texts[i])[0] != usual]))
    # Email and date columns have their own rule for values of the wrong kind, so the type rule would count twice.
    if not identity and kinds and main not in ("text", "empty", "email", "date") and len(kinds) > 1:
        allowed = {main} | ({"integer", "decimal"} if main == "decimal" else set())
        rule_rows.append(("type", f"Every value is a {TYPE_LABELS[main].lower()}",
                          [i for i in filled if kind(values[i]) not in allowed]))
    for key, label, check in rules_for(column, main, identity):
        if key == "once":
            fingerprints = {i: protected[i][1] for i in filled if protected[i]}
            bad = [i for i, f in fingerprints.items() if same[f] > 1]
        else:
            seen = {}  # result per distinct value

            def fine(i):
                key = (values[i], texts[i])
                if key not in seen:
                    seen[key] = check(values[i], texts[i])
                return seen[key]

            bad = [i for i in filled if not fine(i)]
        rule_rows.append((key, label, bad))
    if rows and len(filled) == 0:
        rule_rows.append(("filled", "Has values", list(range(rows))))
    out["rules"] = [{"key": k, "label": label, "checked": len(filled) if k != "filled" else rows,
                     "failed": len(bad), "positions": bad[:KEEP_POSITIONS]}
                    for k, label, bad in rule_rows]
    return out


def key_column(columns):
    """The table's own ID column: the first column, when its name ends in ID (CustomerID, AMLID, account_id)."""
    if columns and columns[0].strip().lower().endswith("id"):
        return columns[0]
    return None


def profile_table(columns, rows, protected_rows, identity_columns):
    """The whole profile of one table. rows: lists of values in column order; protected_rows: per row, the
    {column: [shape, fingerprint]} of its identity numbers, which are the identity_columns."""
    total = len(rows)
    result_columns = []
    for c, column in enumerate(columns):
        values = [r[c] if c < len(r) else None for r in rows]
        protected = [p.get(column) for p in protected_rows] if column in identity_columns else None
        result_columns.append(profile_column(column, values, protected))

    key = key_column(columns)
    if key:
        col = result_columns[0]
        values = [str(r[0]).strip() if r and not _empty(r[0]) else "" for r in rows]
        counts = Counter(v for v in values if v)
        bad = [i for i, v in enumerate(values) if not v or counts[v] > 1]
        col["key"] = True
        col["rules"].insert(0, {"key": "unique", "label": "Every row has its own ID", "checked": total,
                                "failed": len(bad), "positions": bad[:KEEP_POSITIONS]})

    bodies = [tuple(str(v) for v in (r[1:] if key else r)) for r in rows]  # an exact copy apart from its own ID
    seen = Counter(bodies)
    duplicate_rows = [i for i, body in enumerate(bodies) if seen[body] > 1]

    checked = sum(rule["checked"] for c in result_columns for rule in c["rules"])
    failed = sum(rule["failed"] for c in result_columns for rule in c["rules"])
    cells = total * len(columns)
    empty = sum(c["empty"] for c in result_columns)
    return {
        "rows": total, "column_count": len(columns), "key": key,
        "complete_rows": sum(1 for r in rows if not any(_empty(v) for v in r)),
        "duplicate_rows": len(duplicate_rows), "duplicate_positions": duplicate_rows[:KEEP_POSITIONS],
        "filled_share": round(100 * (cells - empty) / cells, 1) if cells else 0,
        "rules_checked": checked, "rules_failed": failed,
        "score": round(100 * (checked - failed) / checked, 1) if checked else 100.0,
        "columns": result_columns,
    }


# ---------- Links between the tables of one connector ----------

def relationships(tables):
    """tables: {name: (columns, rows)}. For every column named like another table's ID column, how many of
    its values that table has. Returns [{table, column, to_table, to_column, checked, matched, missing, share}]."""
    keys = {}
    for name, (columns, rows) in tables.items():
        key = key_column(columns)
        if key:
            keys.setdefault(key.lower(), (name, key, {str(r[0]).strip() for r in rows if r and not _empty(r[0])}))
    found = []
    for name, (columns, rows) in tables.items():
        own = key_column(columns)
        for c, column in enumerate(columns):
            target = keys.get(column.lower())
            if target is None or target[0] == name or column == own:
                continue
            to_table, to_column, ids = target
            values = [str(r[c]).strip() for r in rows if c < len(r) and not _empty(r[c])]
            matched = sum(1 for v in values if v in ids)
            found.append({
                "table": name, "column": column, "to_table": to_table, "to_column": to_column,
                "checked": len(values), "matched": matched, "missing": len(values) - matched,
                "share": round(100 * matched / len(values), 1) if values else 0,
            })
    return sorted(found, key=lambda r: (r["to_table"], r["table"]))
