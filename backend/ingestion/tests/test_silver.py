"""The silver layer: raw tables cleaned the same simple way, raw rows never changed."""

import pytest
from django.contrib.auth.models import Group, User
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from ingestion.models import RawRow
from ingestion.raw import protect
from ingestion.silver import clean_value, summarise
from ingestion.table_profile import profile_table

CSV = (
    "CustomerID,Name,DateOfBirth,Active,EmailAddress,PhoneNumber,Pincode,Rate,AadhaarReferenceNumber,Seen\n"
    "C1, Asha  Rao ,12-12-1980,TRUE,Asha@Mail.in,+919812345678,560001,11.5%,4.05259E+11,2024-05-11 14:20:02.045\n"
    "C2,Ravi,31-02-1990,FALSE,ravi@,12345,56001,3%,123456789012,2024-05-12 09:00:00\n"
    "C3,Ravi,31-02-1990,FALSE,ravi@,12345,56001,3%,123456789012,2024-05-12 09:00:00\n"
)


def test_clean_value_steps():
    assert clean_value(" Asha  Rao ", {"text"}) == ("Asha Rao", "spaces")
    assert clean_value("TRUE", {"text", "boolean"}) == ("true", "boolean")
    assert clean_value("12-12-1980", {"text", "date"}) == ("1980-12-12", "date")
    assert clean_value("31-02-1990", {"text", "date"}) == (None, "bad_date")
    assert clean_value("2024-05-11 14:20:02.045", {"text", "date"}) == ("2024-05-11 14:20:02", "datetime")
    assert clean_value("Asha@Mail.in", {"text", "email"}) == ("asha@mail.in", "email_case")
    assert clean_value("+919812345678", {"text", "phone"}) == ("9812345678", "phone")
    assert clean_value("12345", {"text", "phone"}) == (None, "bad_phone")
    assert clean_value("XXXXXXXE+11", {"excel"}) == (None, "excel")
    assert clean_value("XXXXXXXX9012", {"excel"}) == ("XXXXXXXX9012", None)
    assert clean_value("Pune", {"text"}) == ("Pune", None)


def test_summary_counts_changes_and_leaves_out_exact_copies():
    rows = [r.split(",") for r in CSV.strip().splitlines()]
    columns, data = rows[0], rows[1:]
    safe = [protect(columns, r) for r in data]
    values = [v for v, _ in safe]
    profile = profile_table(columns, values, [p for _, p in safe], {"AadhaarReferenceNumber"})
    s = summarise(columns, values, profile)
    assert s["rows_in"] == 3 and s["rows_out"] == 2 and s["dropped"] == [2]  # C3 copies C2 apart from its ID
    changes = {c["name"]: {ch["key"]: ch["count"] for ch in c["changes"]} for c in s["columns"]}
    assert changes["Name"] == {"spaces": 1}
    assert changes["DateOfBirth"] == {"date": 1, "bad_date": 1}
    assert changes["Pincode"] == {"bad_pincode": 1}
    assert changes["Rate"] == {"percent": 2}
    assert changes["AadhaarReferenceNumber"] == {"excel": 1}
    assert s["emptied"] == 1 + 1 + 1 + 1 + 1  # bad date, email, phone, PIN code, Excel Aadhaar


@pytest.fixture
def connector(db):
    admin = APIClient()
    admin.force_authenticate(User.objects.create_user("silver.admin", password="Strong-pass-123", is_superuser=True))
    code = admin.post("/api/connectors/", {"name": "Files", "connector_type": "file_upload", "trust": 40},
                      format="json").json()["code"]
    admin.post(f"/api/connectors/{code}/upload/", {"files": [SimpleUploadedFile("customers.csv", CSV.encode())]},
               format="multipart")
    admin.post(f"/api/raw/{code}/read/", {"table": "customers"}, format="json")
    return admin, code


def test_silver_api_and_raw_untouched(connector):
    admin, code = connector
    listed = admin.get(f"/api/silver/{code}/").json()["tables"]
    assert listed[0]["rows_in"] == 3 and listed[0]["rows_out"] == 2 and listed[0]["emptied"] == 5
    detail = admin.get(f"/api/silver/{code}/table/", {"table": "customers"}).json()
    phone = next(c for c in detail["changes"] if c["name"] == "PhoneNumber")
    assert {ch["key"] for ch in phone["changes"]} == {"phone", "bad_phone"}
    assert phone["changes"][0]["examples"]
    rows = admin.get(f"/api/silver/{code}/rows/", {"table": "customers"}).json()
    assert rows["count"] == 2 and [r["position"] for r in rows["results"]] == [0, 1]
    first = rows["results"][0]
    assert first["values"][:6] == ["C1", "Asha Rao", "1980-12-12", "true", "asha@mail.in", "9812345678"]
    assert first["changed"]["1"] == {"was": " Asha  Rao ", "why": "Extra spaces removed"}
    # Raw rows are never changed.
    assert RawRow.objects.get(table__name="customers", position=0).values[1] == " Asha  Rao "


def test_silver_is_for_stewards_and_admins(connector):
    _, code = connector
    agent = APIClient()
    user = User.objects.create_user("silver.agent", password="Strong-pass-123")
    user.groups.add(Group.objects.get(name="Contact centre agent"))
    agent.force_authenticate(user)
    assert agent.get(f"/api/silver/{code}/").status_code == 403
    steward = APIClient()
    user = User.objects.create_user("silver.steward", password="Strong-pass-123")
    user.groups.add(Group.objects.get(name="Data steward"))
    steward.force_authenticate(user)
    assert steward.get(f"/api/silver/{code}/rows/", {"table": "customers"}).status_code == 200
