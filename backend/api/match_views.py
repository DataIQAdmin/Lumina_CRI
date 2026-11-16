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
from matching import golden
from matching.models import GoldenApproval, MatchPair, MatchRun, Profile
from matching.score import AUTO, POINTS, REVIEW
from matching.trust import person_score

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


# ---------------- trust scores of people ----------------

def _people():
    """{person: [profiles]} with their sources."""
    out = {}
    for p in Profile.objects.select_related("source").order_by("person", "-trust"):
        out.setdefault(p.person, []).append(p)
    return out


def _person(person, profiles, pii):
    score, band, holds = person_score(profiles)
    named = next((p.values.get("name") for p in profiles if p.values.get("name")), "")
    return {"person": person, "name": named, "score": score, "band": band, "holds": holds,
            "sources": [{"source": p.source.name, "key": p.key, "score": p.trust, "band": p.band} for p in profiles]}


@api_view(["GET"])
@permission_classes([HasRole])
def people(request):
    """GET /api/people/?band=High|Good|Review|Low&q=&page=1  Every person with their trust score, lowest first."""
    groups = _people()
    everyone = [_person(k, v, True) for k, v in groups.items()]
    approvals = {a.person: a for a in GoldenApproval.objects.filter(person__in=groups)}
    for x in everyone:
        a = approvals.get(x["person"])
        x["approved"] = bool(a) and a.fingerprint == golden.fingerprint(golden.build(groups[x["person"]]))
    bands = {b: sum(1 for x in everyone if x["band"] == b) for b in ("High", "Good", "Review", "Low")}
    band = request.query_params.get("band", "")
    q = request.query_params.get("q", "").strip().lower()
    shown = [x for x in everyone if (not band or x["band"] == band)
             and (not q or q in x["name"].lower() or any(q in s["key"].lower() for s in x["sources"]))]
    shown.sort(key=lambda x: (x["score"] if x["score"] is not None else -1, x["name"]))
    try:
        page = max(int(request.query_params.get("page", 1)), 1)
    except ValueError:
        page = 1
    return Response({"bands": bands, "count": len(shown), "page": page, "page_size": PAGE,
                     "average": round(sum(x["score"] or 0 for x in everyone) / len(everyone)) if everyone else None,
                     "results": shown[(page - 1) * PAGE: page * PAGE]})


def _record(p, pii):
    return {"id": p.id, "source": p.source.name, "key": p.key, "trust": p.trust, "band": p.band, "parts": p.parts,
            "holds": p.holds, "rows": p.rows, "updated_at": p.updated_at,
            "values": p.values if pii else {"name": p.values.get("name", "")}}


def _golden_json(rows, pii):
    hide = lambda field, value: value if pii or field == "name" else "Hidden"  # noqa: E731
    side = lambda r: {"id": r.id, "source": r.source.name, "key": r.key} if r else None  # noqa: E731
    return [{"field": x["field"], "label": x["label"], "rule": x["rule"], "value": hide(x["field"], x["value"]) if x["value"] else "",
             "record": side(x["record"]), "why": x["why"], "conflict": x["conflict"],
             "others": [{"record": side(o["record"]), "value": hide(x["field"], o["value"]), "why": o["why"], "same": o["same"]}
                        for o in x["others"]]} for x in rows]


@api_view(["GET"])
@permission_classes([HasRole])
def person(request, person):
    """GET /api/people/<person>/  One person: the golden record field by field (chosen value, source, why, and the
    values not chosen with why), their trust score, and each record with the five rules."""
    found = list(Profile.objects.select_related("source").filter(person=person).order_by("-trust"))
    if not found:
        return Response({"detail": "No such person."}, status=status.HTTP_404_NOT_FOUND)
    pii = can(request.user, "view_pii")
    rows = golden.build(found)
    approval = GoldenApproval.objects.filter(person=person).first()
    out = _person(person, found, pii)
    out["records"] = [_record(p, pii) for p in found]
    out["golden"] = _golden_json(rows, pii)
    out["approval"] = {"by": approval.approved_by, "at": approval.approved_at,
                       "current": approval.fingerprint == golden.fingerprint(rows)} if approval else None
    out["can_decide"] = can(request.user, "decide_matches")
    return Response(out)


@api_view(["POST"])
@permission_classes([HasRole, requires("decide_matches")])
def approve(request, person):
    """POST /api/people/<person>/approve/  Approve the golden record as it stands now."""
    found = list(Profile.objects.select_related("source").filter(person=person))
    if not found:
        return Response({"detail": "No such person."}, status=status.HTTP_404_NOT_FOUND)
    rows = golden.build(found)
    if any(x["conflict"] for x in rows):
        return Response({"detail": "Some identity details differ between sources. Settle them first: keep a record "
                                   "apart, or fix the value at its source."}, status=status.HTTP_400_BAD_REQUEST)
    GoldenApproval.objects.update_or_create(person=person, defaults={"fingerprint": golden.fingerprint(rows),
                                                                     "approved_by": request.user.username})
    record(request, AuditEvent.MERGE, target=f"golden {person}", approved=True)
    return Response({"approved": True})


@api_view(["POST"])
@permission_classes([HasRole, requires("decide_matches")])
def keep_apart(request, person):
    """POST /api/people/<person>/keep-apart/  {record: id}  Take one record out of this person."""
    found = Profile.objects.filter(person=person, id=request.data.get("record")).first()
    if found is None:
        return Response({"detail": "That record is not part of this person."}, status=status.HTTP_404_NOT_FOUND)
    if not Profile.objects.filter(person=person).exclude(id=found.id).exists():
        return Response({"detail": "This person has only that record."}, status=status.HTTP_400_BAD_REQUEST)
    others = list(Profile.objects.filter(person=person).exclude(id=found.id).values_list("id", flat=True))
    count = service.keep_apart(found, request.user.username)
    record(request, AuditEvent.KEEP_APART, target=f"golden {person}", record=str(found), links=count)
    stays = Profile.objects.filter(id__in=others).values_list("person", flat=True).first()
    return Response({"moved_to": found.person, "stays": stays, "links": count})
