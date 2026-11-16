"""Matching API (matching/service.py): run matching, see the summary and the pairs, decide the uncertain ones.

Stewards, compliance and admins see matches; stewards and admins run matching and decide.
"""

from django.db.models import Q
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from accounts.roles import can
from audit.models import AuditEvent
from audit.services import record
from matching import service
from matching.models import MatchPair, MatchRun
from matching.score import AUTO, POINTS, REVIEW

from .permissions import HasRole, requires

PAGE = 20
VIEW = [HasRole, requires("view_matches")]


def _side(p):
    return {"id": p.id, "source": p.source.name, "source_code": p.source.code, "key": p.key,
            "name": p.values.get("name", ""), "person": p.person}


def _pair(p, full=False):
    out = {"id": p.id, "score": p.score, "status": p.status, "conflicts": p.conflicts, "a": _side(p.a), "b": _side(p.b),
           "same": [r["label"] for r in p.points if r["result"] == "same"], "decided_by": p.decided_by,
           "decided_at": p.decided_at}
    if full:
        out["points"] = p.points
        out["a"]["updated_at"] = p.a.updated_at
        out["b"]["updated_at"] = p.b.updated_at
    return out


@api_view(["GET"])
@permission_classes(VIEW)
def summary(request):
    """GET /api/match/  What the last matching run found, and the scoring rules."""
    last = MatchRun.objects.first()
    return Response({"summary": service.summarize(), "ran_at": last.ran_at if last else None,
                     "ran_by": last.ran_by if last else "", "points": POINTS, "auto": AUTO, "review": REVIEW,
                     "can_run": can(request.user, "manage_sources"), "can_decide": can(request.user, "decide_matches")})


@api_view(["POST"])
@permission_classes([HasRole, requires("manage_sources")])
def run(request):
    """POST /api/match/run/  Rebuild profiles from every source's clean rows and match them again."""
    result = service.run(request.user.username)
    record(request, AuditEvent.SYNC_SOURCE, target="matching", **{k: v for k, v in result.items() if k != "per_source"})
    return Response(result)


@api_view(["GET"])
@permission_classes(VIEW)
def pairs(request):
    """GET /api/match/pairs/?show=matched|review|conflicts|rejected&q=&page=1  Pairs, highest score first."""
    show = request.query_params.get("show", "review")
    found = MatchPair.objects.select_related("a__source", "b__source")
    if show == "matched":
        found = found.filter(status__in=[MatchPair.MATCHED, MatchPair.CONFIRMED])
    elif show == "conflicts":
        found = found.filter(status=MatchPair.REVIEW).exclude(conflicts=[])
    elif show == "rejected":
        found = found.filter(status=MatchPair.REJECTED)
    else:
        found = found.filter(status=MatchPair.REVIEW, conflicts=[])
    q = request.query_params.get("q", "").strip()
    if q:
        found = found.filter(Q(a__key__icontains=q) | Q(b__key__icontains=q) | Q(a__values__name__icontains=q)
                             | Q(b__values__name__icontains=q))
    try:
        page = max(int(request.query_params.get("page", 1)), 1)
    except ValueError:
        page = 1
    total = found.count()
    return Response({"count": total, "page": page, "page_size": PAGE,
                     "results": [_pair(p) for p in found[(page - 1) * PAGE: page * PAGE]]})


@api_view(["GET"])
@permission_classes(VIEW)
def pair(request, pk):
    """GET /api/match/pairs/<id>/  One pair with every field side by side and the points behind its score."""
    found = MatchPair.objects.select_related("a__source", "b__source").filter(pk=pk).first()
    if found is None:
        return Response({"detail": "No such pair."}, status=status.HTTP_404_NOT_FOUND)
    return Response(_pair(found, full=True))


@api_view(["POST"])
@permission_classes([HasRole, requires("decide_matches")])
def decide(request, pk):
    """POST /api/match/pairs/<id>/decide/  {same: true|false}  A person's decision; kept across runs."""
    found = MatchPair.objects.select_related("a__source", "b__source").filter(pk=pk).first()
    if found is None:
        return Response({"detail": "No such pair."}, status=status.HTTP_404_NOT_FOUND)
    same = request.data.get("same")
    if not isinstance(same, bool):
        return Response({"detail": "Say whether they are the same person."}, status=status.HTTP_400_BAD_REQUEST)
    service.decide(found, same, request.user.username)
    record(request, AuditEvent.MERGE if same else AuditEvent.KEEP_APART, target=f"match {found.id}",
           a=str(found.a), b=str(found.b), score=found.score)
    return Response(_pair(found, full=True))
