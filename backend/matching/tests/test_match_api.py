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
