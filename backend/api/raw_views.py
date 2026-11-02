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
from sources.models import Source

from .permissions import HasRole, requires

PAGE_SIZE = 50


def _source(code):
    source = Source.objects.filter(code=code).first()
    if source is None:
        return None, Response({"detail": "No such connector."}, status=status.HTTP_404_NOT_FOUND)
    return source, None


def _table_json(t):
    return {"name": t.name, "columns": len(t.columns), "rows": t.rows, "complete": t.complete,
            "sensitive": t.sensitive, "read_at": t.read_at.isoformat()}


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


@api_view(["GET"])
@permission_classes([HasRole, requires("view_pii")])
def rows(request, code):
    """GET /api/raw/<code>/rows/?table=<name>&page=1  The rows of one table, 50 at a time."""
    source, error = _source(code)
    if error:
        return error
    table = RawTable.objects.filter(source=source, name=request.query_params.get("table", "")).first()
    if table is None:
        return Response({"detail": "That table has not been read yet."}, status=status.HTTP_404_NOT_FOUND)
    try:
        page = max(int(request.query_params.get("page", 1)), 1)
    except ValueError:
        page = 1
    found = RawRow.objects.filter(table=table).order_by("position")[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
    return Response({**_table_json(table), "column_names": table.columns, "page": page, "page_size": PAGE_SIZE,
                     "results": [r.values for r in found]})
