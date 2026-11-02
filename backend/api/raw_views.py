"""The raw layer API: every table of a connector, read whole for data profiling (ingestion/raw.py).

Everyone with a role sees which tables were read and their size; stewards and admins read them; the rows
themselves need the view_pii capability. Identity numbers are stored masked, so no role sees them readable here.
"""

from django.db.models import Count, Max
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from accounts.roles import can
from audit.models import AuditEvent
from audit.services import record
from ingestion.connectors.adapters import ConnectorError
from ingestion.connectors.catalog import BY_TYPE
from ingestion.models import RawRow, RawTable
from ingestion.raw import forget_missing, list_tables, read_table
from ingestion.table_profile import key_column, relationships
from sources.models import Source

from .permissions import HasRole, requires

PAGE_SIZE = 50


def _source(code):
    source = Source.objects.filter(code=code).first()
    if source is None:
        return None, Response({"detail": "No such connector."}, status=status.HTTP_404_NOT_FOUND)
    return source, None


def _table_json(t):
    profile = t.profile or {}
    return {"name": t.name, "columns": len(t.columns), "rows": t.rows, "complete": t.complete,
            "sensitive": t.sensitive, "read_at": t.read_at.isoformat(), "score": profile.get("score"),
            "issues": sum(1 for c in profile.get("columns", []) for r in c["rules"] if r["failed"])}


def _without_positions(profile, show_values):
    """The profile for the screen: row positions stay on the server (drill-down asks for them by rule), and the
    most common values (names, emails...) only for roles that see personal details."""
    columns = []
    for c in profile.get("columns", []):
        c = {**c, "rules": [{k: v for k, v in r.items() if k != "positions"} for r in c["rules"]]}
        if not show_values:
            c["top"] = []
        columns.append(c)
    return {**{k: v for k, v in profile.items() if k != "duplicate_positions"}, "columns": columns}


@api_view(["GET"])
@permission_classes([HasRole])
def sources(request):
    """GET /api/raw/  Every connector that can list its tables, with how many were read, and when last.
    Built-in demo connectors are left out: they have no tables to list."""
    readable = [t for t, entry in BY_TYPE.items() if entry["adapter"] is not None]
    out = []
    for s in Source.objects.filter(connector_type__in=readable).annotate(read=Count("raw_tables"), last=Max("raw_tables__read_at")).order_by("name"):
        out.append({"code": s.code, "name": s.name, "connector_type": s.connector_type, "enabled": s.enabled,
                    "tables": s.read, "read_at": s.last})
    return Response({"sources": out, "can_read": can(request.user, "manage_sources"),
                     "can_view_rows": can(request.user, "view_pii")})


@api_view(["GET"])
@permission_classes([HasRole])
def tables(request, code):
    """GET /api/raw/<code>/  The tables read from this connector."""
    source, error = _source(code)
    if error:
        return error
    return Response({"code": source.code, "name": source.name,
                     "tables": [_table_json(t) for t in source.raw_tables.all()]})


@api_view(["POST"])
@permission_classes([HasRole, requires("manage_sources")])
def discover(request, code):
    """POST /api/raw/<code>/discover/  Ask the system which tables it has now. Tables read before that the system
    no longer has are dropped. The screen then reads each table with read/."""
    source, error = _source(code)
    if error:
        return error
    try:
        names = list_tables(source)
    except ConnectorError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    dropped = forget_missing(source, names)
    return Response({"tables": names, "dropped": dropped})


@api_view(["POST"])
@permission_classes([HasRole, requires("manage_sources")])
def read(request, code):
    """POST /api/raw/<code>/read/  {table}  Read one table whole, replacing what was read before."""
    source, error = _source(code)
    if error:
        return error
    name = str(request.data.get("table") or "").strip()
    if not name:
        return Response({"detail": "Say which table to read."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        table = read_table(source, name)
    except ConnectorError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    record(request, AuditEvent.SYNC_SOURCE, target=f"source {source.code}", table=name, rows=table.rows)
    return Response(_table_json(table))


def _table(source, name):
    table = RawTable.objects.filter(source=source, name=name or "").first()
    if table is None:
        return None, Response({"detail": "That table has not been read yet."}, status=status.HTTP_404_NOT_FOUND)
    return table, None


@api_view(["GET"])
@permission_classes([HasRole])
def profile(request, code):
    """GET /api/raw/<code>/profile/?table=<name>  The data profile of one table: every column, its rules and
    how many rows break each."""
    source, error = _source(code)
    if error:
        return error
    table, error = _table(source, request.query_params.get("table"))
    if error:
        return error
    return Response({**_table_json(table), "column_names": table.columns,
                     "profile": _without_positions(table.profile or {}, can(request.user, "view_pii"))})


def _link_rows(source, table, column):
    """Positions of rows whose value in `column` is missing from the table it links to (see relationships)."""
    target = None
    for other in source.raw_tables.exclude(pk=table.pk):
        key = key_column(other.columns)
        if key and key.lower() == column.lower():
            target = other
            break
    if target is None or column not in table.columns:
        return []
    ids = {str(v[0]).strip() for v in RawRow.objects.filter(table=target).values_list("values", flat=True) if v}
    c = table.columns.index(column)
    return [p for p, v in RawRow.objects.filter(table=table).order_by("position").values_list("position", "values")
            if c < len(v) and v[c] not in (None, "") and str(v[c]).strip() not in ids]


@api_view(["GET"])
@permission_classes([HasRole])
def links(request, code):
    """GET /api/raw/<code>/relationships/  How the tables link: for every column named like another table's ID
    column, how many of its values that table has."""
    source, error = _source(code)
    if error:
        return error
    tables = {}
    for t in source.raw_tables.all():
        tables[t.name] = (t.columns, list(RawRow.objects.filter(table=t).order_by("position")
                                          .values_list("values", flat=True)))
    return Response({"relationships": relationships(tables)})


@api_view(["GET"])
@permission_classes([HasRole, requires("view_pii")])
def rows(request, code):
    """GET /api/raw/<code>/rows/?table=<name>&page=1  The rows of one table, 50 at a time.
    Drill-down: &column=<name>&rule=<key> only the rows breaking that rule (rule=link: values missing from the
    linked table); &rule=duplicates (no column) only rows that are exact copies of another row."""
    source, error = _source(code)
    if error:
        return error
    table, error = _table(source, request.query_params.get("table"))
    if error:
        return error
    try:
        page = max(int(request.query_params.get("page", 1)), 1)
    except ValueError:
        page = 1
    found = RawRow.objects.filter(table=table).order_by("position")
    count = total = table.rows
    rule, column = request.query_params.get("rule"), request.query_params.get("column")
    if rule:
        prof = table.profile or {}
        if rule == "duplicates":
            positions = prof.get("duplicate_positions", [])
        elif rule == "link":
            positions = _link_rows(source, table, column or "")
        else:
            col = next((c for c in prof.get("columns", []) if c["name"] == column), None)
            match = next((r for r in col["rules"] if r["key"] == rule), None) if col else None
            if match is None:
                return Response({"detail": "No such rule on that column."}, status=status.HTTP_404_NOT_FOUND)
            positions, total = match["positions"], match["failed"]
        found = found.filter(position__in=positions)
        count = len(positions)
        total = max(total, count) if rule != "link" and rule != "duplicates" else count
    found = found[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
    return Response({**_table_json(table), "column_names": table.columns, "page": page, "page_size": PAGE_SIZE,
                     "count": count, "total": total, "positions": [r.position for r in found], "results": [r.values for r in found]})


# ---------- Silver layer (ingestion/silver.py): the raw tables cleaned, for stewards and admins ----------

SILVER = [HasRole, requires("manage_sources")]


def _silver(table):
    """The table's silver summary, worked out now for tables read before the silver layer existed."""
    from ingestion.silver import summarise

    if not table.silver and (table.profile or {}).get("columns"):
        rows = list(RawRow.objects.filter(table=table).order_by("position").values_list("values", flat=True))
        table.silver = summarise(table.columns, rows, table.profile)
        table.save(update_fields=["silver"])
    return table.silver or {}


def _silver_json(t):
    s = _silver(t)
    return {"name": t.name, "columns": len(t.columns), "rows_in": t.rows, "rows_out": s.get("rows_out"),
            "changed_cells": s.get("changed_cells"), "emptied": s.get("emptied"), "read_at": t.read_at.isoformat()}


@api_view(["GET"])
@permission_classes(SILVER)
def silver_tables(request, code):
    """GET /api/silver/<code>/  Every table of the connector with what its silver version changes."""
    source, error = _source(code)
    if error:
        return error
    return Response({"code": source.code, "name": source.name,
                     "tables": [_silver_json(t) for t in source.raw_tables.all()]})


@api_view(["GET"])
@permission_classes(SILVER)
def silver_table(request, code):
    """GET /api/silver/<code>/table/?table=<name>  What cleaning changed in one table, column by column, with a few
    examples (before and after) for roles that see personal details."""
    source, error = _source(code)
    if error:
        return error
    table, error = _table(source, request.query_params.get("table"))
    if error:
        return error
    summary = _silver(table)
    show = can(request.user, "view_pii")
    columns = [{**c, "changes": [{**ch, "examples": ch["examples"] if show else []} for ch in c["changes"]]}
               for c in summary.get("columns", [])]
    return Response({**_silver_json(table), "dropped": len(summary.get("dropped", [])), "changes": columns})


@api_view(["GET"])
@permission_classes([HasRole, requires("manage_sources"), requires("view_pii")])
def silver_rows(request, code):
    """GET /api/silver/<code>/rows/?table=<name>&page=1  Cleaned rows, 50 at a time, without the exact copies.
    changed: per row, the column positions cleaning changed; raw: what those cells were before."""
    from ingestion.silver import LABELS, clean_row, steps_from

    source, error = _source(code)
    if error:
        return error
    table, error = _table(source, request.query_params.get("table"))
    if error:
        return error
    summary = _silver(table)
    try:
        page = max(int(request.query_params.get("page", 1)), 1)
    except ValueError:
        page = 1
    steps = steps_from(summary)
    found = (RawRow.objects.filter(table=table).exclude(position__in=summary.get("dropped", []))
             .order_by("position")[(page - 1) * PAGE_SIZE: page * PAGE_SIZE])
    results = []
    for r in found:
        cleaned, changes = clean_row(r.values, table.columns, steps)
        results.append({"position": r.position, "values": cleaned,
                        "changed": {str(i): {"was": r.values[i], "why": LABELS[k]} for i, k in changes.items()}})
    return Response({"column_names": table.columns, "page": page, "page_size": PAGE_SIZE,
                     "count": summary.get("rows_out", table.rows), "results": results})
