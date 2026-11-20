"""Matching end to end: two systems' clean rows and mappings become profiles, pairs, people; decisions stick."""

import pytest
from django.contrib.auth.models import Group, User
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from matching.models import MatchPair, Profile

CORE = (b"CustomerID,CustomerName,DateOfBirth,PAN,PhoneNumber,EmailAddress,LastUpdatedTimestamp\n"
        b"AXC1,Rohan Kumar,12-05-1990,ABCDE1234F,9876543210,rohan@bank.in,2024-01-10 10:00:00\n"
        b"AXC2,Priya Sharma,01-02-1985,PQRST5678K,9123456780,priya@bank.in,2024-02-10 10:00:00\n"
        b"AXC3,Meera Nair,03-03-1979,LMNOP4321Z,9988776655,meera@bank.in,2024-03-10 10:00:00\n")
APP = (b"userId,fullName,dob,pan,mobile,email,cifRef,updatedAt\n"
       b"usr_a,Rohan K,12/05/1990,ABCDE1234F,+919876543210,rohan@bank.in,AXC1,2026-11-01T10:00:00Z\n"
       b"usr_b,Priya Sharma,01/02/1986,PQRST5678K,+919123456780,priya@bank.in,AXC2,2026-11-02T10:00:00Z\n"
       b"usr_c,Arjun Rao,05/06/1992,,+919000000001,arjun@mail.com,,2026-11-03T10:00:00Z\n")


def client(username, superuser=False, group=None):
    user = User.objects.create_user(username, password="Strong-pass-123", is_superuser=superuser)
    if group:
        user.groups.add(Group.objects.get(name=group))
    c = APIClient()
    c.force_authenticate(user)
    return c


def source(admin, name, table, data, rule_column, fields, links):
    code = admin.post("/api/connectors/", {"name": name, "connector_type": "file_upload", "trust": 50},
                      format="json").json()["code"]
    admin.post(f"/api/connectors/{code}/upload/", {"files": [SimpleUploadedFile(f"{table}.csv", data)]},
               format="multipart")
    assert admin.post(f"/api/raw/{code}/read/", {"table": table}, format="json").status_code == 200
    assert admin.post(f"/api/rules/{code}/", {"table": table, "column": rule_column, "pattern": ".+"},
                      format="json").status_code == 200
    put = admin.put(f"/api/mapping/{code}/", {"fields": {f: {"table": table, "column": c} for f, c in fields.items()},
                                              "links": {table: links}}, format="json")
    assert put.status_code == 200, put.json()
    return code


@pytest.fixture
def admin(db):
    c = client("match.admin", superuser=True)
    source(c, "Core banking", "customer_master", CORE, "CustomerID",
           {"name": "CustomerName", "dob": "DateOfBirth", "pan": "PAN", "mobile": "PhoneNumber", "email": "EmailAddress"},
           {"customer_id": "CustomerID", "updated_at": "LastUpdatedTimestamp"})
    source(c, "Mobile app", "app_users", APP, "userId",
           {"name": "fullName", "dob": "dob", "pan": "pan", "mobile": "mobile", "email": "email", "cross_ref": "cifRef"},
           {"customer_id": "userId", "updated_at": "updatedAt"})
    return c


def test_running_matching_links_the_same_people(admin):
    got = admin.post("/api/match/run/").json()
    assert got["profiles"] == 6 and got["per_source"] == {"Core banking": 3, "Mobile app": 3}
    assert got["matched"] == 1  # Rohan: same PAN, mobile, email, date of birth, and the app points to his CIF
    assert got["conflicts"] == 1  # Priya: everything agrees except the year of birth
    assert got["people"] == 5
    rohan = Profile.objects.get(key="usr_a")
    assert rohan.person == Profile.objects.get(key="AXC1").person
    assert rohan.values["pan"] != "ABCDE1234F"  # shown masked
    assert "ABCDE1234F" not in str(rohan.keys)  # compared only as a fingerprint
    assert rohan.updated_at.year == 2026


def test_pairs_explain_their_score_and_decisions_stick(admin):
    admin.post("/api/match/run/")
    listed = admin.get("/api/match/pairs/", {"show": "conflicts"}).json()
    assert listed["count"] == 1
    pair = listed["results"][0]
    assert pair["conflicts"] == ["Date of birth differs"]
    full = admin.get(f"/api/match/pairs/{pair['id']}/").json()
    points = {r["field"]: r for r in full["points"]}
    assert points["dob"]["result"] == "different" and points["pan"]["points"] == 35
    assert sum(r["points"] for r in full["points"]) >= full["score"]

    decided = admin.post(f"/api/match/pairs/{pair['id']}/decide/", {"same": True}, format="json").json()
    assert decided["status"] == "confirmed" and decided["a"]["person"] == decided["b"]["person"]
    again = admin.post("/api/match/run/").json()
    assert again["confirmed"] == 1 and again["conflicts"] == 0 and again["people"] == 4
    assert MatchPair.objects.get(status="confirmed").decided_by == "match.admin"


def test_who_may_see_run_and_decide(admin):
    admin.post("/api/match/run/")
    pk = MatchPair.objects.first().pk
    agent = client("match.agent", group="Contact centre agent")
    assert agent.get("/api/match/").status_code == 403
    compliance = client("match.compliance", group="Compliance officer")
    assert compliance.get("/api/match/").json()["can_decide"] is False
    assert compliance.post("/api/match/run/").status_code == 403
    assert compliance.post(f"/api/match/pairs/{pk}/decide/", {"same": False}, format="json").status_code == 403
    steward = client("match.steward", group="Data steward")
    assert steward.post(f"/api/match/pairs/{pk}/decide/", {"same": False}, format="json").status_code == 200


def test_every_person_gets_a_trust_score_from_the_five_rules(admin):
    admin.post("/api/match/run/")
    everyone = admin.get("/api/people/").json()
    assert everyone["count"] == 5 and sum(everyone["bands"].values()) == 5
    rohan = next(x for x in everyone["results"] if any(s["key"] == "usr_a" for s in x["sources"]))
    assert len(rohan["sources"]) == 2
    detail = admin.get(f"/api/people/{rohan['person']}/").json()
    assert detail["score"] == round(sum(r["trust"] for r in detail["records"]) / 2)
    app = next(r for r in detail["records"] if r["key"] == "usr_a")
    assert set(app["parts"]) == {"uniqueness", "recency", "completeness", "consistency", "accuracy"}
    # Date of birth, PAN, mobile and email agree with core banking; "Rohan K" and "Rohan Kumar" have no majority.
    consistency = app["parts"]["consistency"]
    assert consistency["score"] == 80 and consistency["points"] == 16
    assert [f["field"] for f in consistency["evidence"]["fields"] if not f["agree"]] == ["name"]
    assert app["settings_version"] == 0
    priya = next(x for x in everyone["results"] if any(s["key"] == "usr_b" for s in x["sources"]))
    assert priya["band"] in ("Review", "Low") and "A possible match is waiting for review" in priya["holds"]


def test_golden_record_approve_and_keep_apart(admin):
    admin.post("/api/match/run/")
    rohan = Profile.objects.get(key="usr_a").person
    got = admin.get(f"/api/people/{rohan}/").json()
    fields = {g["field"]: g for g in got["golden"]}
    assert fields["name"]["value"] == "Rohan Kumar" and fields["name"]["record"]["key"] == "AXC1"
    assert fields["name"]["others"][0]["value"] == "Rohan K"
    assert fields["mobile"]["record"]["key"] == "usr_a"  # the app was updated last
    assert got["approval"] is None and got["can_decide"] is True

    assert admin.post(f"/api/people/{rohan}/approve/").json() == {"approved": True}
    assert admin.get(f"/api/people/{rohan}/").json()["approval"]["current"] is True
    listed = admin.get("/api/people/", {"q": "AXC1"}).json()["results"][0]
    assert listed["approved"] is True

    app = Profile.objects.get(key="usr_a")
    moved = admin.post(f"/api/people/{rohan}/keep-apart/", {"record": app.id}, format="json").json()
    assert moved["links"] == 1 and moved["moved_to"] != Profile.objects.get(key="AXC1").person
    assert admin.post("/api/match/run/").json()["rejected"] >= 1  # kept apart on the next run too
    assert Profile.objects.get(key="usr_a").person != Profile.objects.get(key="AXC1").person


def test_a_golden_record_with_a_conflict_cannot_be_approved(admin):
    admin.post("/api/match/run/")
    pair = MatchPair.objects.get(status="review")
    admin.post(f"/api/match/pairs/{pair.id}/decide/", {"same": True}, format="json")
    priya = Profile.objects.get(key="usr_b").person
    assert any(g["conflict"] for g in admin.get(f"/api/people/{priya}/").json()["golden"])
    assert admin.post(f"/api/people/{priya}/approve/").status_code == 400


def settings_body(admin, **change):
    body = admin.get("/api/settings/matching/").json()["settings"]
    for key, value in change.items():
        if isinstance(value, dict):
            body[key] = {**body[key], **value}
        else:
            body[key] = value
    return body


def test_settings_change_scores_and_golden_records(admin):
    admin.post("/api/match/run/")
    got = admin.get("/api/settings/matching/").json()
    assert got["settings"]["weights"] == {r: 20 for r in got["rules"]} and got["can_edit"] is True
    app = next(s["code"] for s in got["sources"] if s["name"] == "Mobile app")

    # The mobile app first in source order: the golden name now comes from the app.
    put = admin.put("/api/settings/matching/", settings_body(admin, source_order=[app]), format="json")
    assert put.status_code == 200, put.json()
    rohan = Profile.objects.get(key="usr_a").person
    name = next(g for g in admin.get(f"/api/people/{rohan}/").json()["golden"] if g["field"] == "name")
    assert name["value"] == "Rohan K" and name["why"] == "Mobile app comes first in source order"
    # Every saved score and golden record says which settings version it was worked out with.
    person = admin.get(f"/api/people/{rohan}/").json()
    assert person["settings_version"] == 1 and {r["settings_version"] for r in person["records"]} == {1}
    assert name["agree"] == [1, 2]

    # No points for PAN or the CIF reference: Rohan's score falls below 80, so a person decides.
    admin.put("/api/settings/matching/", settings_body(admin, points={"pan": 0, "cross_ref": 0}), format="json")
    assert MatchPair.objects.get(a__key__in=["AXC1", "usr_a"], b__key__in=["AXC1", "usr_a"]).status == "review"

    # All the weight on recency: a record updated this month scores 100, one from 2024 scores 20.
    admin.put("/api/settings/matching/", settings_body(admin, weights={"uniqueness": 0, "recency": 100, "completeness": 0,
                                                                       "consistency": 0, "accuracy": 0}), format="json")
    assert Profile.objects.get(key="AXC3").trust == 20


def test_bad_settings_are_refused(admin):
    put = lambda **change: admin.put("/api/settings/matching/", settings_body(admin, **change), format="json")  # noqa: E731
    assert "add up to 100" in put(weights={"recency": 30}).json()["detail"]
    assert "go down" in put(bands={"good": 95}).json()["detail"]
    assert "below the match score" in put(review=90).json()["detail"]
    assert put(source_order=["nope"]).status_code == 400
    assert put(field_rules={"name": "random"}).status_code == 400
    steward = client("set.steward", group="Data steward")
    assert steward.get("/api/settings/matching/").json()["can_edit"] is False
    assert steward.put("/api/settings/matching/", settings_body(admin), format="json").status_code == 403


def test_a_settings_preview_says_what_would_change_and_saves_nothing(admin):
    from matching.models import MatchSettings

    admin.post("/api/match/run/")
    before = {p.key: p.band for p in Profile.objects.all()}
    body = settings_body(admin, weights={"uniqueness": 0, "recency": 100, "completeness": 0, "consistency": 0, "accuracy": 0})
    got = admin.post("/api/settings/matching/preview/", body, format="json")
    assert got.status_code == 200, got.json()
    got = got.json()
    assert got["records"] == 6 and got["band_changes"] > 0 and got["average"]["before"] != got["average"]["after"]
    assert {p.key: p.band for p in Profile.objects.all()} == before  # nothing changed
    assert not MatchSettings.objects.exists()
    steward = client("preview.steward", group="Data steward")
    assert steward.post("/api/settings/matching/preview/", body, format="json").status_code == 403


def test_matching_is_checked_against_an_answer_key_that_is_not_stored(admin):
    admin.post("/api/match/run/")
    key = [{"person": "P1", "core": "AXC1", "app": ["usr_a"], "conflict": None},
           {"person": "P2", "core": "AXC2", "app": ["usr_b"], "conflict": "dob"},
           {"person": "P3", "core": None, "app": ["usr_c"], "conflict": None},
           {"person": "P4", "core": "AXC9", "app": ["usr_z"], "conflict": None}]
    got = admin.post("/api/match/check/", {"key": key}, format="json").json()
    assert got["found"]["shared"] == {"right": 1, "expected": 1}
    assert got["found"]["conflicts"] == {"right": 1, "expected": 1}  # waits for a person, not linked
    assert got["found"]["app_only"] == {"right": 1, "expected": 1}
    assert got["wrong_links"] == 0 and got["missing_count"] == 2 and got["misses"] == []
    assert admin.post("/api/match/check/", {"key": "nope"}, format="json").status_code == 400
