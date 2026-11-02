"""Data profiling of raw tables: types, empties, patterns, rules, drill-down and links between tables."""

import pytest
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from ingestion.raw import protect
from ingestion.table_profile import date_format, kind, pattern, profile_table, relationships


def profiled(columns, rows, identity=()):
    safe = [protect(columns, r) for r in rows]
    return profile_table(columns, [v for v, _ in safe], [p for _, p in safe], set(identity))


def column(profile, name):
    return next(c for c in profile["columns"] if c["name"] == name)


def rule(col, key):
    return next(r for r in col["rules"] if r["key"] == key)


def test_value_types_and_patterns():
    assert [kind(v) for v in ["42", "4.5", "11.08%", "4.05E+11", "12-12-1946", "2024-05-11 14:20:02.04",
                              "a@b.in", "True", "7676fa73-b087-4f2c-a995-bce13aa4c324", "Pune"]] == [
        "integer", "decimal", "percent", "scientific", "date", "date", "email", "boolean", "uuid", "text"]
    assert date_format("31-02-2020") == ("DD-MM-YYYY", None)  # looks like a date, is not one
    assert pattern("ABCDE1234F") == "AAAAA9999A" and pattern("100000000000") == "9×12"


def test_columns_rules_and_drill_down_positions():
    columns = ["CustomerID", "CustomerName", "DateOfBirth", "PAN", "AadhaarReferenceNumber", "EmailAddress",
               "PhoneNumber", "Pincode", "Line3"]
    rows = [
        ["C1", "Asha Rao", "12-12-1980", "ABCDE1234F", "4.05259E+11", "asha@mail.in", "+919812345678", "560001", ""],
        ["C2", " Vikram  ", "1990-01-31", "ABCDE1234F", "123456789012", "vikram@", "12345", "56001", ""],
        ["C2", "Meera", "05-04-2015", "abcde9999f", "", "", "9812345670", "110001", ""],
    ]
    p = profiled(columns, rows, identity=["PAN", "AadhaarReferenceNumber"])
    assert p["rows"] == 3 and p["key"] == "CustomerID"
    assert rule(column(p, "CustomerID"), "unique")["positions"] == [1, 2]  # C2 twice
    assert rule(column(p, "CustomerName"), "spaces")["positions"] == [1]
    dob = column(p, "DateOfBirth")
    assert dob["type"] == "date" and {f["format"] for f in dob["date_formats"]} == {"DD-MM-YYYY", "YYYY-MM-DD"}
    assert rule(dob, "formats")["positions"] == [1] and rule(dob, "age")["positions"] == [2]  # born 2015
    pan = column(p, "PAN")
    assert pan["top"] == [] and pan["patterns"][0] == {"value": "AAAAA9999A", "count": 2}  # never the number
    assert rule(pan, "pan")["positions"] == [2] and rule(pan, "once")["positions"] == [0, 1]
    aadhaar = column(p, "AadhaarReferenceNumber")
    assert aadhaar["empty"] == 1 and rule(aadhaar, "aadhaar_excel")["positions"] == [0]
    assert rule(column(p, "EmailAddress"), "email")["positions"] == [1]
    assert rule(column(p, "PhoneNumber"), "phone")["positions"] == [1]
    assert rule(column(p, "Pincode"), "pincode")["positions"] == [1]
    assert rule(column(p, "Line3"), "filled")["failed"] == 3
    assert "ABCDE1234F" not in str(p)
    assert 0 < p["score"] < 100


def test_exact_copies_and_numbers():
    p = profiled(["RowID", "Amount"], [["R1", "10"], ["R2", "10"], ["R3", "7.5"], ["R4", "x"]])
    assert p["duplicate_rows"] == 2 and p["duplicate_positions"] == [0, 1]  # same apart from their own ID
    amount = column(p, "Amount")
    assert amount["type"] == "decimal" and amount["min"] == 7.5 and amount["max"] == 10
    assert rule(amount, "type")["positions"] == [3]


def test_relationships_find_ids_missing_from_the_linked_table():
    tables = {
        "customer_master": (["CustomerID", "Name"], [["C1", "A"], ["C2", "B"]]),
        "customer_email": (["EmailID", "CustomerID"], [["E1", "C1"], ["E2", "C9"]]),
        "account_master": (["AccountID", "CustomerID"], [["A1", "X1"]]),
    }
    found = {(r["table"], r["column"]): r for r in relationships(tables)}
    assert found[("customer_email", "CustomerID")]["share"] == 50.0
    assert found[("account_master", "CustomerID")]["missing"] == 1
    assert len(found) == 2  # a table's own ID column is not a link


@pytest.fixture
def files(db):
    admin = APIClient()
    admin.force_authenticate(User.objects.create_user("prof.admin", password="Strong-pass-123", is_superuser=True))
    code = admin.post("/api/connectors/", {"name": "Files", "connector_type": "file_upload", "trust": 40},
                      format="json").json()["code"]
    uploads = [SimpleUploadedFile("customer_master.csv", b"CustomerID,Name,EmailAddress\nC1,Asha,a@b.in\nC2,Ravi,bad\n"),
               SimpleUploadedFile("customer_email.csv", b"EmailID,CustomerID\nE1,C1\nE2,C9\nE3,C8\n")]
    admin.post(f"/api/connectors/{code}/upload/", {"files": uploads}, format="multipart")
    for name in admin.post(f"/api/raw/{code}/discover/").json()["tables"]:
        admin.post(f"/api/raw/{code}/read/", {"table": name}, format="json")
    return admin, code


def test_profile_and_drill_down_api(files):
    admin, code = files
    listed = admin.get(f"/api/raw/{code}/").json()["tables"]
    assert {t["name"]: t["issues"] for t in listed} == {"customer_email": 0, "customer_master": 1}
    body = admin.get(f"/api/raw/{code}/profile/", {"table": "customer_master"}).json()
    email = next(c for c in body["profile"]["columns"] if c["name"] == "EmailAddress")
    assert rule(email, "email")["failed"] == 1 and "positions" not in rule(email, "email")
    bad = admin.get(f"/api/raw/{code}/rows/", {"table": "customer_master", "column": "EmailAddress",
                                               "rule": "email"}).json()
    assert bad["count"] == 1 and bad["results"] == [["C2", "Ravi", "bad"]]
    links = admin.get(f"/api/raw/{code}/relationships/").json()["relationships"]
    assert links == [{"table": "customer_email", "column": "CustomerID", "to_table": "customer_master",
                      "to_column": "CustomerID", "checked": 3, "matched": 1, "missing": 2, "share": 33.3}]
    orphans = admin.get(f"/api/raw/{code}/rows/", {"table": "customer_email", "column": "CustomerID",
                                                   "rule": "link"}).json()
    assert orphans["results"] == [["E2", "C9"], ["E3", "C8"]]


def test_a_table_read_before_profiling_sends_no_profile(files):
    from ingestion.models import RawTable

    admin, code = files
    RawTable.objects.filter(name="customer_master").update(profile={})
    body = admin.get(f"/api/raw/{code}/profile/", {"table": "customer_master"}).json()
    assert body["profile"] == {} and body["score"] is None  # the screen asks for the table to be read again
