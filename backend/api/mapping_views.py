"""Field mapping API: which column of each table holds which standard customer field (ingestion/fields.py).

Everyone with a role sees the mapping; stewards and admins change it. Sample values need view_pii, and identity
numbers in them stay masked.
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


def _bad(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({"detail": message}, status=code)


def _mapped(code, table=None):
    found = FieldMap.objects.filter(source__code=code)
    if table is not None:
        found = found.filter(table=table)
    return found


def _samples(table):
    """{column: up to SAMPLES different non-empty values} from the first rows, as the screen shows them."""
    out = {c: [] for c in table.columns}
    for values in RawRow.objects.filter(table=table).order_by("position").values_list("values", flat=True)[:100]:
        for column, value in zip(table.columns, values):
            text = "" if value is None else str(value).strip()
            if text and len(out[column]) < SAMPLES and text not in out[column]:
                out[column].append(text)
    return out


@api_view(["GET", "PUT"])
@permission_classes([HasRole])
def mapping(request, code):
    """GET /api/mapping/<code>/  Every profiled table with its mapped fields.
    GET ?table=<name>  One table: its columns, mapped fields, suggestions and sample values.
    PUT {table, fields: {field: column}}  Replace the table's mapping ("" leaves a field out)."""
    if request.method == "PUT":
        return _save(request, code)
    name = request.query_params.get("table")
    if not name:
        maps = {}
        for m in _mapped(code):
            maps.setdefault(m.table, {})[m.field] = m.column
        tables = RawTable.objects.filter(source__code=code).values_list("name", flat=True)
        return Response({"fields": FIELDS, "tables": [{"name": t, "fields": maps.get(t, {})} for t in tables]})
    table = RawTable.objects.filter(source__code=code, name=name).first()
    if table is None:
        return _bad("Profile this table first.", status.HTTP_404_NOT_FOUND)
    saved = list(_mapped(code, table.name))
    samples = _samples(table) if can(request.user, "view_pii") else {}
    return Response({
        "fields": FIELDS,
        "columns": [{"name": c, "samples": samples.get(c, [])} for c in table.columns],
        "mapped": {m.field: m.column for m in saved if m.column in table.columns},
        "suggested": suggest(table.columns),
        "saved_by": max(saved, key=lambda m: m.mapped_at).mapped_by if saved else "",
        "saved_at": max(m.mapped_at for m in saved) if saved else None,
        "can_edit": can(request.user, "manage_sources"),
    })


def _save(request, code):
    if not can(request.user, "manage_sources"):
        return _bad("Only data stewards and administrators change the mapping.", status.HTTP_403_FORBIDDEN)
    table = RawTable.objects.filter(source__code=code, name=str(request.data.get("table") or "")).first()
    if table is None:
        return _bad("Profile this table first.", status.HTTP_404_NOT_FOUND)
    fields = request.data.get("fields")
    if not isinstance(fields, dict):
        return _bad("Send the fields as {field: column}.")
    chosen = {str(f): str(c or "") for f, c in fields.items() if c}
    for field, column in chosen.items():
        if field not in KEYS:
            return _bad(f"There is no standard field called {field}.")
        if column not in table.columns:
            return _bad(f"{table.name} has no column {column}.")
    labels = {f["key"]: f["label"] for f in FIELDS}
    seen = {}
    for field, column in chosen.items():
        if column in seen:
            return _bad(f"{column} is chosen for both {labels[seen[column]]} and {labels[field]}. Pick one.")
        seen[column] = field
    if chosen and "customer_id" not in chosen:
        return _bad("Choose the Customer ID column too: it joins this table's rows to one customer.")
    with transaction.atomic():
        _mapped(code, table.name).delete()
        FieldMap.objects.bulk_create([FieldMap(source=table.source, table=table.name, field=f, column=c,
                                               mapped_by=request.user.username) for f, c in chosen.items()])
    record(request, AuditEvent.CONNECTOR_CHANGED, target=f"source {code}", mapping=table.name, fields=chosen)
    return Response({"mapped": chosen})
