"""Rules, the regex library and the silver layer API (ingestion/rules.py).

Rules: type or pick a regex for a column, preview it on 10 rows, then apply it. Silver: the rows that pass every
applied rule of their table; the others stay in rejected. Regex library: ready-made and saved regexes to pick on
Rules, and a tester that tries one on every column so people can see where it fits. Stewards and admins only; rows
also need view_pii.
"""

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.response import Response

from audit.models import AuditEvent
from audit.services import record
from ingestion.models import ColumnRule, RawTable, SavedRegex
from ingestion.regex_ai import AiError
from ingestion.regex_ai import suggest as ai_suggest
from ingestion.regex_library import READY_REGEXES
from ingestion.rules import RuleError, compile_rule, split, table_rules
from ingestion.rules import preview as preview_rule
from ingestion.rules import test_table as test_rule
from sources.models import Source

from .permissions import HasRole, requires
from .throttles import AiThrottle
from .raw_views import PAGE_SIZE

RULES = [HasRole, requires("manage_sources")]
ROWS = [HasRole, requires("manage_sources"), requires("view_pii")]


def _bad(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({"detail": message}, status=code)


def _table_from(code, name):
    """(table, error response) for a connector code and a table name."""
    table = RawTable.objects.filter(source__code=code, name=name or "").select_related("source").first()
    if table is None:
        return None, _bad("Profile this table first.", status.HTTP_404_NOT_FOUND)
    return table, None


def _column_from(request):
    """(table name, column, pattern) of a rule request."""
    data = request.data
    return str(data.get("table") or "").strip(), str(data.get("column") or ""), str(data.get("pattern") or "")


@api_view(["GET", "POST"])
@permission_classes(RULES)
def rules(request, code):
    """GET /api/rules/<code>/?table=<name>  The columns of a table with their applied rules.
    POST {table, column, pattern}  Apply a regex to a column, replacing the one it had."""
    if request.method == "GET":
        table, error = _table_from(code, request.query_params.get("table"))
        if error:
            return error
        applied = table_rules(table)
        return Response({"name": table.name, "rows": table.rows,
                         "columns": [{"name": c, "pattern": applied.get(c, "")} for c in table.columns]})
    name, column, pattern = _column_from(request)
    table, error = _table_from(code, name)
    if error:
        return error
    if column not in table.columns:
        return _bad("This table has no such column.")
    try:
        result = preview_rule(table, column, pattern)  # also proves it runs on the whole column in time
    except RuleError as exc:
        return _bad(str(exc))
    ColumnRule.objects.update_or_create(source=table.source, table=table.name, column=column,
                                        defaults={"pattern": pattern, "applied_by": request.user.username})
    record(request, AuditEvent.CONNECTOR_CHANGED, target=f"source {code}", rule=f"{table.name}.{column}")
    return Response({"passed": result["passed"], "failed": result["failed"], "total": result["total"]})


@api_view(["POST"])
@permission_classes(RULES)
def remove(request, code):
    """POST /api/rules/<code>/remove/  {table, column}  Take a rule off a column."""
    name, column, _ = _column_from(request)
    gone, _ = ColumnRule.objects.filter(source__code=code, table=name, column=column).delete()
    if gone:
        record(request, AuditEvent.CONNECTOR_CHANGED, target=f"source {code}", rule_removed=f"{name}.{column}")
    return Response({"removed": gone})


@api_view(["POST"])
@permission_classes(RULES)
@throttle_classes([AiThrottle])
def suggest(request, code):
    """POST /api/rules/<code>/suggest/  {table, column, wish?}  Ask the AI helper for a regex. It comes back already
    checked and tested on the column; nothing is applied. Only value shapes are sent to the AI, never values."""
    name, column, _ = _column_from(request)
    table, error = _table_from(code, name)
    if error:
        return error
    if column not in table.columns:
        return _bad("This table has no such column.")
    try:
        return Response(ai_suggest(table, column, str(request.data.get("wish") or "")))
    except AiError as exc:
        return _bad(str(exc))  # not 503: the screen reads 502-504 as "the server is waking up" and waits


@api_view(["POST"])
@permission_classes(ROWS)
def preview(request, code):
    """POST /api/rules/<code>/preview/  {table, column, pattern}  Try a regex without applying it."""
    name, column, pattern = _column_from(request)
    table, error = _table_from(code, name)
    if error:
        return error
    if column not in table.columns:
        return _bad("This table has no such column.")
    try:
        return Response(preview_rule(table, column, pattern))
    except RuleError as exc:
        return _bad(str(exc))


@api_view(["POST"])
@permission_classes(RULES)
def check(request):
    """POST /api/regex/check/  {pattern}  Is this a proper regular expression?"""
    try:
        compile_rule(str(request.data.get("pattern") or ""))
    except RuleError as exc:
        return Response({"valid": False, "error": str(exc)})
    return Response({"valid": True, "error": ""})


def _saved_json(r):
    return {"id": r.id, "name": r.name, "pattern": r.pattern}


@api_view(["GET", "POST"])
@permission_classes(RULES)
def library(request):
    """GET /api/regex/library/  Ready-made and saved regexes, every regex in use with where it is used, and every
    profiled table to test on.
    POST {name, pattern}  Keep a regex in the library. Saving the same regex again renames it."""
    if request.method == "POST":
        name = str(request.data.get("name") or "").strip()[:80]
        pattern = str(request.data.get("pattern") or "")
        if not name:
            return _bad("Give this regex a name.")
        try:
            compile_rule(pattern)
        except RuleError as exc:
            return _bad(str(exc))
        saved, _ = SavedRegex.objects.update_or_create(pattern=pattern, defaults={
            "name": name, "saved_by": request.user.username})
        return Response(_saved_json(saved), status=status.HTTP_201_CREATED)
    patterns = {}
    for r in ColumnRule.objects.select_related("source"):
        patterns.setdefault(r.pattern, []).append({"code": r.source.code, "source": r.source.name, "table": r.table,
                                                   "column": r.column})
    tables = [{"code": t.source.code, "source": t.source.name, "table": t.name}
              for t in RawTable.objects.select_related("source").order_by("source__name", "name")]
    return Response({"ready": READY_REGEXES, "saved": [_saved_json(r) for r in SavedRegex.objects.all()],
                     "patterns": [{"pattern": p, "used": used} for p, used in patterns.items()], "tables": tables})


@api_view(["DELETE"])
@permission_classes(RULES)
def library_item(request, pk):
    """DELETE /api/regex/library/<id>/  Remove a saved regex. Rules already using it stay as they are."""
    SavedRegex.objects.filter(pk=pk).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
@permission_classes(RULES)
def test(request):
    """POST /api/regex/test/  {code, table, pattern}  How well a regex fits each column of one table. The screen
    asks table by table, so each request stays short."""
    table, error = _table_from(str(request.data.get("code") or ""), str(request.data.get("table") or ""))
    if error:
        return error
    try:
        return Response({"columns": test_rule(table, str(request.data.get("pattern") or ""))})
    except RuleError as exc:
        return _bad(str(exc))


def _silver_json(table):
    passed, rejected = split(table)
    return {"name": table.name, "rows": table.rows, "rules": len(table_rules(table)), "passed": len(passed),
            "rejected": len(rejected), "read_at": table.read_at.isoformat()}


@api_view(["GET"])
@permission_classes(RULES)
def silver_tables(request, code):
    """GET /api/silver/<code>/  Every profiled table with how many rows passed its rules."""
    source = Source.objects.filter(code=code).first()
    if source is None:
        return _bad("No such connector.", status.HTTP_404_NOT_FOUND)
    try:
        return Response({"code": source.code, "name": source.name,
                         "tables": [_silver_json(t) for t in source.raw_tables.all()]})
    except RuleError as exc:
        return _bad(str(exc))


@api_view(["GET"])
@permission_classes(ROWS)
def silver_rows(request, code):
    """GET /api/silver/<code>/rows/?table=<name>&page=1&show=passed|rejected  Rows, 50 at a time. Rejected rows
    also say which columns failed."""
    table, error = _table_from(code, request.query_params.get("table"))
    if error:
        return error
    try:
        page = max(int(request.query_params.get("page", 1)), 1)
    except ValueError:
        page = 1
    try:
        passed, rejected = split(table)
    except RuleError as exc:
        return _bad(str(exc))
    if request.query_params.get("show") == "rejected":
        chosen = [{"position": p, "values": v, "failed": broken} for p, v, broken in rejected]
    else:
        chosen = [{"position": p, "values": v, "failed": []} for p, v in passed]
    start = (page - 1) * PAGE_SIZE
    return Response({"column_names": table.columns, "rules": table_rules(table), "page": page,
                     "page_size": PAGE_SIZE, "count": len(chosen), "passed": len(passed), "rejected": len(rejected),
                     "results": chosen[start:start + PAGE_SIZE]})
