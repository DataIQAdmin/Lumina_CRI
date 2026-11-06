"""Bronze counts, regex rules with preview, the silver layer they build, the regex tester and the clean start."""

import pytest
from django.contrib.auth.models import Group, User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from rest_framework.test import APIClient

from ingestion.bronze import profile_column
from ingestion.clean_start import clean_start
from ingestion.fake_people import fake_table
from ingestion.models import ColumnRule, RawRow, RawTable
from ingestion.rules import RuleError, compile_rule
from sources.models import Source

CSV = (b"CustomerID,CustomerName,Phone,EmailAddress,PAN\n"
       b"C1,Asha Rao,9876543210,asha@bank.in,ABCDE1234F\n"
       b"C2,Vikram,987654321,vikram@bank.in,abcde1234f\n"
       b"C3,Meera,9876543,,\n")
TABLE = "customer_master"


def client(username, superuser=False, group=None):
    user = User.objects.create_user(username, password="Strong-pass-123", is_superuser=superuser)
    if group:
        user.groups.add(Group.objects.get(name=group))
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def admin(db):
    return client("rule.admin", superuser=True)


@pytest.fixture
def code(admin):
    """A CSV connector with its one table profiled."""
    made = admin.post("/api/connectors/", {"name": "Branch files", "connector_type": "file_upload", "trust": 40},
                      format="json").json()["code"]
    admin.post(f"/api/connectors/{made}/upload/", {"files": [SimpleUploadedFile(f"{TABLE}.csv", CSV)]},
               format="multipart")
    assert admin.post(f"/api/raw/{made}/read/", {"table": TABLE}, format="json").status_code == 200
    return made


def rule(admin, code, column, pattern):
    return admin.post(f"/api/rules/{code}/", {"table": TABLE, "column": column, "pattern": pattern}, format="json")


def test_only_the_chosen_table_is_profiled(admin, code):
    assert admin.post(f"/api/raw/{code}/discover/").json()["tables"] == [TABLE]
    assert RawTable.objects.filter(source__code=code).count() == 1
    assert admin.get(f"/api/raw/{code}/profile/", {"table": "other"}).status_code == 404


def test_counts_per_column(admin, code):
    columns = {c["name"]: c for c in admin.get(f"/api/raw/{code}/profile/", {"table": TABLE}).json()
               ["profile"]["columns"]}
    assert columns["Phone"]["counts"] == [{"label": "10 digits", "count": 1}, {"label": "9 digits", "count": 1},
                                          {"label": "7 digits", "count": 1}]
    assert columns["CustomerName"]["counts"] == []  # a name can be any length
    assert columns["EmailAddress"]["filled"] == 2 and columns["EmailAddress"]["empty"] == 1
    assert columns["EmailAddress"]["counts"] == [{"label": "Up to 50 characters", "count": 2},
                                                 {"label": "Over 50 characters", "count": 0}]
    assert columns["PAN"]["counts"] == [{"label": "10 characters", "count": 2}]  # counted on the real value
    assert columns["PAN"]["unique"] == 2


def test_column_named_for_a_number_but_holding_something_else_has_no_length_count():
    assert profile_column("PhoneType", ["Office", "Home"])["counts"] == []
    assert profile_column("Pincode", ["560001", "5600"])["counts"] == [{"label": "6 digits", "count": 1},
                                                                       {"label": "4 digits", "count": 1}]


def test_regex_check_says_if_it_is_proper(admin, db):
    assert admin.post("/api/regex/check/", {"pattern": r"^\d{10}$"}, format="json").json()["valid"] is True
    bad = admin.post("/api/regex/check/", {"pattern": "([0-9"}, format="json").json()
    assert bad["valid"] is False and "Not a valid regular expression" in bad["error"]
    assert admin.post("/api/regex/check/", {"pattern": "  "}, format="json").json()["valid"] is False
    with pytest.raises(RuleError):
        compile_rule("a" * 301)


def test_preview_changes_nothing_and_shows_pass_and_fail(admin, code):
    body = admin.post(f"/api/rules/{code}/preview/", {"table": TABLE, "column": "Phone", "pattern": r"\d{10}"},
                      format="json").json()
    assert (body["total"], body["passed"], body["failed"]) == (3, 1, 2)  # the whole value must match
    assert [(s["value"], s["passed"]) for s in body["sample"]] == [
        ("9876543210", True), ("987654321", False), ("9876543", False)]
    assert not ColumnRule.objects.exists()


def test_preview_checks_the_real_identity_number_but_shows_it_masked(admin, code):
    body = admin.post(f"/api/rules/{code}/preview/", {"table": TABLE, "column": "PAN",
                                                      "pattern": r"[A-Z]{5}\d{4}[A-Z]"}, format="json").json()
    assert [(s["value"], s["passed"]) for s in body["sample"]] == [
        ("XXXXXX234F", True), ("XXXXXX234f", False), ("", False)]
    stored = str(list(RawRow.objects.values_list("values", "protected")))
    assert "ABCDE1234F" not in stored and "abcde1234f" not in stored


def test_silver_is_empty_until_a_rule_is_applied(admin, code):
    assert admin.get(f"/api/silver/{code}/").json()["tables"][0]["passed"] == 0
    assert admin.get(f"/api/silver/{code}/rows/", {"table": TABLE}).json()["results"] == []


def test_only_rows_passing_every_rule_reach_silver(admin, code):
    assert rule(admin, code, "Phone", r"\d{9,10}").json() == {"passed": 2, "failed": 1, "total": 3}
    assert rule(admin, code, "PAN", r"[A-Z]{5}\d{4}[A-Z]").status_code == 200
    listed = admin.get(f"/api/silver/{code}/").json()["tables"][0]
    assert (listed["rules"], listed["passed"], listed["rejected"]) == (2, 1, 2)
    good = admin.get(f"/api/silver/{code}/rows/", {"table": TABLE}).json()
    assert [r["values"][0] for r in good["results"]] == ["C1"]
    bad = admin.get(f"/api/silver/{code}/rows/", {"table": TABLE, "show": "rejected"}).json()["results"]
    assert [(r["values"][0], sorted(r["failed"])) for r in bad] == [("C2", ["PAN"]), ("C3", ["PAN", "Phone"])]


def test_a_rule_survives_reading_again_and_can_be_removed(admin, code):
    rule(admin, code, "Phone", r"\d{10}")
    admin.post(f"/api/raw/{code}/read/", {"table": TABLE}, format="json")
    columns = admin.get(f"/api/rules/{code}/", {"table": TABLE}).json()["columns"]
    assert next(c for c in columns if c["name"] == "Phone")["pattern"] == r"\d{10}"
    assert admin.post(f"/api/rules/{code}/remove/", {"table": TABLE, "column": "Phone"},
                      format="json").json()["removed"] == 1
    assert admin.get(f"/api/silver/{code}/").json()["tables"][0]["rules"] == 0


def test_a_bad_regex_is_not_applied(admin, code):
    assert rule(admin, code, "Phone", "([0-9").status_code == 400
    assert rule(admin, code, "Nope", r"\d+").status_code == 400
    assert not ColumnRule.objects.exists()


def test_a_regex_that_runs_forever_is_stopped(admin, code, monkeypatch):
    monkeypatch.setattr("ingestion.rules.TIME_LIMIT", 0)
    response = rule(admin, code, "Phone", r"\d+")
    assert response.status_code == 400 and "too long" in response.json()["detail"]


def test_library_and_tester_show_where_a_regex_fits(admin, code):
    rule(admin, code, "Phone", r"\d{10}")
    library = admin.get("/api/regex/library/").json()
    assert library["patterns"][0]["pattern"] == r"\d{10}"
    assert library["patterns"][0]["used"][0]["column"] == "Phone"
    assert library["tables"][0]["table"] == TABLE
    found = admin.post("/api/regex/test/", {"code": code, "table": TABLE, "pattern": r"\d+"},
                       format="json").json()["columns"]
    assert found[0] == {"column": "Phone", "matched": 3, "filled": 3}
    assert found[-1]["matched"] == 0


def test_roles(admin, code):
    agent = client("rule.agent", group="Contact centre agent")
    body = {"table": TABLE, "column": "Phone", "pattern": r"\d+"}
    assert agent.post(f"/api/rules/{code}/", body, format="json").status_code == 403
    assert agent.post(f"/api/rules/{code}/preview/", body, format="json").status_code == 403
    assert agent.get(f"/api/silver/{code}/rows/", {"table": TABLE}).status_code == 403
    assert agent.get("/api/regex/library/").status_code == 403
    steward = client("rule.steward", group="Data steward")
    assert steward.post(f"/api/rules/{code}/", body, format="json").status_code == 200


def test_clean_start_keeps_logins_and_connections_and_stops_schedules(admin, code):
    rule(admin, code, "Phone", r"\d+")
    Source.objects.filter(code=code).update(sync_every_hours=6, mapping={"object": "x"})
    users = User.objects.count()
    clean_start()
    source = Source.objects.get(code=code)
    assert source.sync_every_hours == 0 and source.mapping == {}
    assert not RawTable.objects.exists() and not ColumnRule.objects.exists() and not source.uploads.exists()
    assert User.objects.count() == users


def test_clean_command_dry_run_removes_nothing(code, capsys):
    call_command("clear_connector_data", "--dry-run")
    assert RawTable.objects.count() == 1


def test_fake_people_are_stable_and_some_are_wrong_on_purpose():
    header = ["CustomerID", "CustomerName", "PhoneNumber", "PAN", "AadhaarReferenceNumber", "Mail", "City"]
    rows = [[f"C{i}", "Old Name", "1", "x", "y", "old@mail.in", "Pune"] for i in range(400)]
    _, once = fake_table(header, rows)
    _, again = fake_table(header, rows)
    assert once == again  # the same customer is the same in every connector
    assert all(r[1] != "Old Name" and r[6] == "Pune" for r in once)
    phones = {len(r[2]) for r in once}
    assert {10, 9, 7} <= phones
    pans = [r[3] for r in once if r[3]]
    assert sum(p.isupper() and len(p) == 10 and p[3] == "P" for p in pans) > len(pans) * 0.8
    assert any("@" not in r[5] for r in once) and any(len(r[5]) > 50 for r in once)
