"""Field mapping: first guesses from column names, and the API that keeps what a person chose."""

import pytest
from django.contrib.auth.models import Group, User
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from ingestion.fields import suggest
from ingestion.models import FieldMap

CSV = (b"CustomerID,CustomerName,DateOfBirth,PAN,PhoneNumber,AlternatePhoneNumber,EmailID,EmailAddress,City\n"
       b"C1,Asha Rao,12-05-1990,ABCDE1234F,9876543210,9123456780,E1,asha@bank.in,Pune\n"
       b"C2,Vikram,01-01-1985,,987654321,,E2,vikram@bank.in,Pune\n")
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
    return client("map.admin", superuser=True)


@pytest.fixture
def code(admin):
    made = admin.post("/api/connectors/", {"name": "Branch files", "connector_type": "file_upload", "trust": 40},
                      format="json").json()["code"]
    admin.post(f"/api/connectors/{made}/upload/", {"files": [SimpleUploadedFile(f"{TABLE}.csv", CSV)]},
               format="multipart")
    assert admin.post(f"/api/raw/{made}/read/", {"table": TABLE}, format="json").status_code == 200
    return made


def test_core_banking_columns_are_guessed():
    assert suggest(["CustomerID", "CustomerName", "CustomerShortName", "DateOfBirth", "PAN", "AadhaarReferenceNumber",
                    "Gender", "LastUpdatedTimestamp"]) == {
        "customer_id": "CustomerID", "updated_at": "LastUpdatedTimestamp", "name": "CustomerName",
        "dob": "DateOfBirth", "pan": "PAN", "aadhaar": "AadhaarReferenceNumber", "gender": "Gender"}


def test_app_columns_are_guessed_from_the_last_part():
    found = suggest(["_id", "userId", "profile.fullName", "profile.dob", "contact.mobile", "contact.email",
                     "kyc.pan", "kyc.status", "cifRef", "updatedAt"])
    assert found == {"customer_id": "userId", "cross_ref": "cifRef", "updated_at": "updatedAt",
                     "name": "profile.fullName", "dob": "profile.dob", "pan": "kyc.pan",
                     "mobile": "contact.mobile", "email": "contact.email"}


def test_row_ids_and_other_numbers_are_not_taken():
    found = suggest(["PhoneID", "CustomerID", "AlternatePhoneNumber", "PhoneNumber", "EmailID"])
    assert found == {"customer_id": "CustomerID", "mobile": "PhoneNumber"}


def test_a_table_shows_columns_suggestions_and_samples(admin, code):
    got = admin.get(f"/api/mapping/{code}/", {"table": TABLE}).json()
    assert got["mapped"] == {}
    assert got["suggested"]["email"] == "EmailAddress"
    assert got["suggested"]["mobile"] == "PhoneNumber"
    samples = {c["name"]: c["samples"] for c in got["columns"]}
    assert samples["City"] == ["Pune"]
    assert samples["PAN"] and "ABCDE1234F" not in samples["PAN"]  # identity numbers stay masked
    assert got["can_edit"] is True


def test_saving_replaces_the_mapping(admin, code):
    put = lambda fields: admin.put(f"/api/mapping/{code}/", {"table": TABLE, "fields": fields}, format="json")
    assert put({"customer_id": "CustomerID", "name": "CustomerName", "city": "City"}).status_code == 200
    assert put({"customer_id": "CustomerID", "name": "CustomerName", "city": ""}).status_code == 200
    assert dict(FieldMap.objects.values_list("field", "column")) == {"customer_id": "CustomerID",
                                                                     "name": "CustomerName"}
    assert admin.get(f"/api/raw/{code}/").json()["tables"][0]["mapped"] == 2
    overview = admin.get(f"/api/mapping/{code}/").json()
    assert overview["tables"] == [{"name": TABLE, "fields": {"customer_id": "CustomerID", "name": "CustomerName"}}]


def test_bad_mappings_are_refused(admin, code):
    put = lambda fields: admin.put(f"/api/mapping/{code}/", {"table": TABLE, "fields": fields}, format="json")
    assert "Customer ID" in put({"name": "CustomerName"}).json()["detail"]
    assert "both" in put({"customer_id": "CustomerID", "name": "CustomerID"}).json()["detail"]
    assert put({"customer_id": "CustomerID", "shoe_size": "City"}).status_code == 400
    assert put({"customer_id": "Nope"}).status_code == 400
    assert admin.put(f"/api/mapping/{code}/", {"table": "other", "fields": {}}, format="json").status_code == 404
    assert not FieldMap.objects.exists()


def test_only_stewards_and_admins_change_it(admin, code):
    viewer = client("map.viewer", group="Relationship manager")
    assert viewer.get(f"/api/mapping/{code}/", {"table": TABLE}).json()["can_edit"] is False
    refused = viewer.put(f"/api/mapping/{code}/", {"table": TABLE, "fields": {"customer_id": "CustomerID"}},
                         format="json")
    assert refused.status_code == 403
