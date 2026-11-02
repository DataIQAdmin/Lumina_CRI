"""The raw layer: read every table of a connector, whole, exactly as the system holds it, for data profiling.

Each table of a database (each collection of MongoDB, each uploaded CSV file of a file-upload connector) is
stored as a RawTable with its rows. Reading is one table at a time, so a large system never makes one long
request. Up to CONNECTOR_MAX_ROWS rows are read per table; a bigger table is marked incomplete.

Identity numbers (PAN, Aadhaar, passport, voter ID, driving licence, CKYC) are never stored readable: the value
is masked, and only its shape and a keyed fingerprint are kept, enough to check the pattern and find duplicates.
"""

import csv
import io
import re
from datetime import date, datetime

from django.conf import settings
from django.db import transaction

from security import crypto

from .connectors.adapters import ConnectorError
from .connectors.catalog import adapter_for
from .models import RawRow, RawTable

BATCH = 2000
IDENTITY_WORDS = {"pan", "pancard", "aadhaar", "aadhar", "passport", "voter", "voterid", "driving", "licence",
                  "license", "ckyc", "uid"}


def _words(column):
    """"AadhaarReferenceNumber" -> ["aadhaar", "reference", "number"]; "pan_no" -> ["pan", "no"]."""
    return [w.lower() for w in re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+", column)]


def is_identity(column):
    return any(w in IDENTITY_WORDS for w in _words(column))


def shape(text):
    """Capitals become A, small letters a, digits 9, everything else stays: "ABCDe1234F" -> "AAAAa9999A"."""
    return re.sub(r"[0-9]", "9", re.sub(r"[a-z]", "a", re.sub(r"[A-Z]", "A", text)))[:40]


def mask(text):
    """Only the last 4 characters stay readable."""
    return "X" * max(len(text) - 4, 0) + text[-4:] if len(text) > 4 else "X" * len(text)


def _value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def protect(columns, row):
    """(values, protected) for one row: identity-number values masked, their shape and fingerprint set aside."""
    values, protected = [], {}
    for column, value in zip(columns, row):
        value = _value(value)
        if value not in (None, "") and is_identity(column):
            text = str(value).strip()
            protected[column] = [shape(text), crypto.fingerprint(text)[:16]]
            value = mask(text)
        values.append(value)
    return values, protected


def _table_name(file_name):
    return re.sub(r"\.csv$", "", file_name.strip(), flags=re.I) or file_name


def _files(source):
    """{table name: newest active upload} for a file-upload connector: each file is its own table."""
    found = {}
    for upload in source.uploads.filter(status="active"):  # newest first
        found.setdefault(_table_name(upload.name), upload)
    return found


def list_tables(source):
    """Names of every table the connector can read right now."""
    if source.connector_type == "file_upload":
        names = sorted(_files(source))
        if not names:
            raise ConnectorError("Upload the CSV files first: each file becomes one table.")
        return names
    return list(adapter_for(source).list_objects())


def _fetch(source, name, limit):
    """(columns, rows as lists) for one table."""
    if source.connector_type == "file_upload":
        upload = _files(source).get(name)
        if upload is None:
            raise ConnectorError(f"No active file {name}.csv on this connector.")
        reader = csv.reader(io.StringIO(upload.content))
        columns = [h.strip() for h in next(reader, [])]
        rows = []
        for row in reader:
            if not any(cell.strip() for cell in row):
                continue
            rows.append((row + [""] * len(columns))[:len(columns)])
            if len(rows) >= limit:
                break
        return columns, rows
    adapter = adapter_for(source)
    columns = adapter.list_columns(name)
    return columns, [[r.get(c) for c in columns] for r in adapter.fetch(name, columns, limit)]


def read_table(source, name):
    """Read one table whole, profile it and store both, replacing what was read before. Returns the RawTable."""
    from .table_profile import profile_table

    cap = settings.CONNECTOR_MAX_ROWS
    columns, rows = _fetch(source, name, cap + 1)  # one extra row tells whether the table is bigger than the cap
    complete = len(rows) <= cap
    safe = [protect(columns, row) for row in rows[:cap]]  # (values, protected) per row
    sensitive = [c for c in columns if is_identity(c)]
    profile = profile_table(columns, [v for v, _ in safe], [p for _, p in safe], set(sensitive))
    with transaction.atomic():
        table, _ = RawTable.objects.update_or_create(
            source=source, name=name,
            defaults={"columns": columns, "sensitive": sensitive, "rows": len(safe), "complete": complete,
                      "profile": profile},
        )
        table.row_set.all().delete()
        for start in range(0, len(safe), BATCH):
            RawRow.objects.bulk_create(
                RawRow(table=table, position=start + i, values=values, protected=protected)
                for i, (values, protected) in enumerate(safe[start:start + BATCH])
            )
    return table


def forget_missing(source, names):
    """Drop stored tables the system no longer has. Returns how many."""
    gone = RawTable.objects.filter(source=source).exclude(name__in=names)
    count = gone.count()
    gone.delete()
    return count
