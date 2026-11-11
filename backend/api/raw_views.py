"""The bronze layer API: pick tables of a connector, read and profile only those (ingestion/raw.py, bronze.py).

Everyone with a role sees which tables were profiled and their counts; stewards and admins choose and read them;
the rows themselves need the view_pii capability. Identity numbers are masked, so no role sees them readable here.
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
from sources.models import Source

from .permissions import HasRole, requires

PAGE_SIZE = 50


def _source(code):
    source = Source.objects.filter(code=code).first()
    if source is None:
        return None, Response({"detail": "No such connector."}, status=status.HTTP_404_NOT_FOUND)
    return source, None


def _table_json(t):
    columns = (t.profile or {}).get("columns", [])
    return {"name": t.name, "columns": len(t.columns), "rows": t.rows, "complete": t.complete,
            "sensitive": t.sensitive, "read_at": t.read_at.isoformat(),
            # how many columns need a look: mixed lengths, or empty values
            "mixed": sum(1 for c in columns if sum(1 for x in c.get("counts", []) if x["count"]) > 1),
            "with_empty": sum(1 for c in columns if c.get("empty"))}


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
    """GET /api/raw/<code>/profile/?table=<name>  The counts of one table, column by column."""
    source, error = _source(code)
    if error:
        return error
    table, error = _table(source, request.query_params.get("table"))
    if error:
        return error
    return Response({**_table_json(table), "profile": table.profile or {}})


PROOF_PAGE = 20


@api_view(["GET"])
@permission_classes([HasRole, requires("view_pii")])
def proof(request, code):
    """GET /api/raw/<code>/proof/?table=<name>&column=<name>&label=<count>&page=1  The rows behind one count of the
    profile ("9 digits", "Empty", "Office"...), so people can see a count is real. 20 rows a page, each with its
    row number, the table's first column (usually its ID) and the value as stored (identity numbers masked)."""
    from ingestion.bronze import label_of
    from ingestion.rules import rows_of

    source, error = _source(code)
    if error:
        return error
    table, error = _table(source, request.query_params.get("table"))
    if error:
        return error
    column, label = request.query_params.get("column", ""), request.query_params.get("label", "")
    profiled = next((c for c in (table.profile or {}).get("columns", []) if c["name"] == column), None)
    if profiled is None or column not in table.columns:
        return Response({"detail": "This table has no such column."}, status=status.HTTP_404_NOT_FOUND)
    try:
        page = max(int(request.query_params.get("page", 1)), 1)
    except ValueError:
        page = 1
    i = table.columns.index(column)
    found = [(position, shown) for position, plain, shown in rows_of(table) if label_of(profiled, plain[i]) == label]
    start = (page - 1) * PROOF_PAGE
    return Response({"column": column, "label": label, "key": table.columns[0], "count": len(found), "page": page,
                     "page_size": PROOF_PAGE, "results": [
                         {"row": position + 1, "key": shown[0], "value": shown[i]}
                         for position, shown in found[start:start + PROOF_PAGE]]})


@api_view(["GET"])
@permission_classes([HasRole, requires("view_pii")])
def rows(request, code):
    """GET /api/raw/<code>/rows/?table=<name>&page=1  The rows of one table, 50 at a time."""
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
    found = RawRow.objects.filter(table=table).order_by("position")[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
    return Response({**_table_json(table), "column_names": table.columns, "page": page, "page_size": PAGE_SIZE,
                     "count": table.rows, "results": [r.values for r in found]})
