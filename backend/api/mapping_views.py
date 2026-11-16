"""Field mapping API: for one source, which table and column holds each standard customer field
(ingestion/fields.py), and how each table it uses joins to a customer.

Mapped once per source: "Mobile comes from customer_phone.PhoneNumber". Each table that gives a field also says
its Customer ID column (and its Last updated column), so its rows can be joined to one customer. Everyone with a
role sees the mapping; stewards and admins change it. Sample values need view_pii; identity numbers stay masked.
"""

from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from accounts.roles import can
from audit.models import AuditEvent
from audit.services import record
from ingestion.fields import FIELDS, KEYS, suggest
from ingestion.models import FieldMap, RawRow, RawTable

from .permissions import HasRole

SAMPLES = 3
PER_TABLE = ["customer_id", "updated_at"]  # said once for every table used
SOURCE_FIELDS = [k for k in KEYS if k not in PER_TABLE]  # said once for the whole source
LABELS = {f["key"]: f["label"] for f in FIELDS}


def _bad(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({"detail": message}, status=code)


def _samples(table):
    """{column: up to SAMPLES different non-empty values} from the first rows, as the screen shows them."""
    out = {c: [] for c in table.columns}
    for values in RawRow.objects.filter(table=table).order_by("position").values_list("values", flat=True)[:100]:
        for column, value in zip(table.columns, values):
            text = "" if value is None else str(value).strip()
            if text and len(out[column]) < SAMPLES and text not in out[column]:
                out[column].append(text)
    return out


def suggest_source(tables):
    """First guesses for a whole source from {table: columns}: ({field: {table, column}}, {table: {link: column}}).
    Tables with more customer fields come first, so the name comes from the master table, not a side table."""
    guesses = {name: suggest(columns) for name, columns in tables.items()}
    ranked = sorted(tables, key=lambda t: (-sum(1 for f in guesses[t] if f in SOURCE_FIELDS), t))
    fields = {}
    for field in SOURCE_FIELDS:
        table = next((t for t in ranked if field in guesses[t]), None)
        if table:
            fields[field] = {"table": table, "column": guesses[table][field]}
    links = {t: {k: guesses[t][k] for k in PER_TABLE if k in guesses[t]} for t in tables}
    return fields, links


@api_view(["GET", "PUT"])
@permission_classes([HasRole])
def mapping(request, code):
    """GET /api/mapping/<code>/  The source's profiled tables with their columns, the saved mapping and first
    guesses. PUT {fields: {field: {table, column}}, links: {table: {customer_id, updated_at}}}  Replace it."""
    if request.method == "PUT":
        return _save(request, code)
    tables = list(RawTable.objects.filter(source__code=code))
    saved = list(FieldMap.objects.filter(source__code=code))
    pii = can(request.user, "view_pii")
    fields, links = {}, {}
    for m in saved:
        if m.field in PER_TABLE:
            links.setdefault(m.table, {})[m.field] = m.column
        else:
            fields[m.field] = {"table": m.table, "column": m.column}
    guess_fields, guess_links = suggest_source({t.name: t.columns for t in tables})
    return Response({
        "fields": FIELDS,
        "per_table": PER_TABLE,
        "tables": [{"name": t.name, "rows": t.rows, "columns": [
            {"name": c, "samples": s} for c, s in (_samples(t) if pii else {c: [] for c in t.columns}).items()]}
            for t in tables],
        "mapped": {"fields": fields, "links": links},
        "suggested": {"fields": guess_fields, "links": guess_links},
        "saved_by": max(saved, key=lambda m: m.mapped_at).mapped_by if saved else "",
        "saved_at": max(m.mapped_at for m in saved) if saved else None,
        "can_edit": can(request.user, "manage_sources"),
    })


def _save(request, code):
    if not can(request.user, "manage_sources"):
        return _bad("Only data stewards and administrators change the mapping.", status.HTTP_403_FORBIDDEN)
    fields, links = request.data.get("fields"), request.data.get("links")
    if not isinstance(fields, dict) or not isinstance(links, dict):
        return _bad("Send fields as {field: {table, column}} and links as {table: {customer_id, updated_at}}.")
    tables = {t.name: t for t in RawTable.objects.filter(source__code=code)}
    if not tables:
        return _bad("Profile a table of this source first.", status.HTTP_404_NOT_FOUND)
    rows = []  # (table, field, column)
    for field, place in fields.items():
        if not place:
            continue
        if field not in SOURCE_FIELDS:
            return _bad(f"There is no customer field called {field}.")
        table, column = str(place.get("table") or ""), str(place.get("column") or "")
        if table not in tables or column not in tables[table].columns:
            return _bad(f"{LABELS[field]}: {table} has no column {column}.")
        rows.append((table, field, column))
    used = {t for t, _, _ in rows}
    for table, chosen in links.items():
        if table not in tables or not isinstance(chosen, dict):
            continue
        for key in PER_TABLE:
            column = str(chosen.get(key) or "")
            if column:
                if column not in tables[table].columns:
                    return _bad(f"{table} has no column {column}.")
                if table in used:
                    rows.append((table, key, column))
    for table in sorted(used):
        if not any(t == table and f == "customer_id" for t, f, _ in rows):
            return _bad(f"Choose the Customer ID column of {table}: it joins its rows to one customer.")
    seen = {}
    for table, field, column in rows:
        other = seen.setdefault((table, column), field)
        if other != field:
            return _bad(f"{table}.{column} is chosen for both {LABELS[other]} and {LABELS[field]}. Pick one.")
    source = next(iter(tables.values())).source
    with transaction.atomic():
        FieldMap.objects.filter(source=source).delete()
        FieldMap.objects.bulk_create([FieldMap(source=source, table=t, field=f, column=c,
                                               mapped_by=request.user.username) for t, f, c in rows])
    record(request, AuditEvent.CONNECTOR_CHANGED, target=f"source {code}",
           mapping={f"{t}.{c}": f for t, f, c in rows})
    return Response({"saved": len(rows)})
