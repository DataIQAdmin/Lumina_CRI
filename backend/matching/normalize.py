"""Clean values up so the same thing written two ways compares equal: "12/05/1990" and "12-05-1990",
"+919876543210" and "9876543210", "Mr. ROHAN  Kumar" and "rohan kumar"."""

import re
from datetime import date, datetime

from security import crypto

TITLES = {"mr", "mrs", "ms", "miss", "dr", "shri", "smt", "sri", "kum"}
DATE_FORMATS = ["%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d.%m.%Y", "%d %b %Y", "%d %B %Y", "%b %d, %Y"]


def text(value):
    return "" if value is None else str(value).strip()


def name(value):
    words = re.sub(r"[^a-z ]", " ", text(value).lower()).split()
    return " ".join(w for w in words if w not in TITLES)


def day(value):
    """A date of birth as YYYY-MM-DD, or "" when it is not a date."""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    raw = text(value)
    if not raw:
        return ""
    head = raw[:10] if re.match(r"\d{4}-\d{2}-\d{2}[T ]", raw) else raw
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(head, fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def moment(value):
    """A "last updated" value as a datetime, or None."""
    if isinstance(value, datetime):
        return value
    raw = text(value)
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        found = day(raw)
        return datetime.fromisoformat(found) if found else None


def mobile(value):
    """The last 10 digits: "+91 98765-43210", "09876543210" and "9876543210" are the same number."""
    digits = re.sub(r"\D", "", text(value))
    return digits[-10:] if len(digits) >= 10 else digits


def email(value):
    return text(value).lower()


def identity(value):
    """PAN or Aadhaar: kept only as a fingerprint, so matching never holds the readable number."""
    cleaned = re.sub(r"[^A-Z0-9]", "", text(value).upper())
    return crypto.fingerprint(cleaned)[:24] if cleaned else ""


NORMALIZERS = {"name": name, "dob": day, "mobile": mobile, "email": email, "pan": identity, "aadhaar": identity,
               "cross_ref": text}
