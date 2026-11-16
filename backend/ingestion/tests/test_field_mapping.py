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


def test_source_guesses_take_fields_from_the_right_table():
    from api.mapping_views import suggest_source
    fields, links = suggest_source({
        "customer_master": ["CustomerID", "CustomerName", "DateOfBirth", "PAN", "LastUpdatedTimestamp"],
        "customer_phone": ["PhoneID", "CustomerID", "PhoneNumber", "LastUpdatedTimestamp"],
        "app_addresses": ["addressId", "userId", "line1", "city", "pincode", "updatedAt"]})
    assert fields["name"] == {"table": "customer_master", "column": "CustomerName"}
    assert fields["mobile"] == {"table": "customer_phone", "column": "PhoneNumber"}
    assert fields["city"] == {"table": "app_addresses", "column": "city"}
    assert links["customer_phone"] == {"customer_id": "CustomerID", "updated_at": "LastUpdatedTimestamp"}


def test_the_source_shows_tables_columns_samples_and_guesses(admin, code):
    got = admin.get(f"/api/mapping/{code}/").json()
    assert got["mapped"] == {"fields": {}, "links": {}}
    assert got["suggested"]["fields"]["email"] == {"table": TABLE, "column": "EmailAddress"}
    assert got["suggested"]["links"][TABLE]["customer_id"] == "CustomerID"
    samples = {c["name"]: c["samples"] for c in got["tables"][0]["columns"]}
    assert samples["City"] == ["Pune"]
    assert samples["PAN"] and "ABCDE1234F" not in samples["PAN"]  # identity numbers stay masked
    assert got["can_edit"] is True


def save(admin, code, fields, links):
    return admin.put(f"/api/mapping/{code}/", {"fields": fields, "links": links}, format="json")


def at(column):
    return {"table": TABLE, "column": column}


def test_saving_replaces_the_mapping(admin, code):
    link = {TABLE: {"customer_id": "CustomerID"}}
    assert save(admin, code, {"name": at("CustomerName"), "city": at("City")}, link).status_code == 200
    assert save(admin, code, {"name": at("CustomerName"), "city": None}, link).status_code == 200
    assert dict(FieldMap.objects.values_list("field", "column")) == {"customer_id": "CustomerID",
                                                                     "name": "CustomerName"}
    assert admin.get(f"/api/raw/{code}/").json()["tables"][0]["mapped"] == 2
    got = admin.get(f"/api/mapping/{code}/").json()["mapped"]
    assert got == {"fields": {"name": at("CustomerName")}, "links": {TABLE: {"customer_id": "CustomerID"}}}


def test_bad_mappings_are_refused(admin, code):
    link = {TABLE: {"customer_id": "CustomerID"}}
    assert "Customer ID" in save(admin, code, {"name": at("CustomerName")}, {}).json()["detail"]
    assert "both" in save(admin, code, {"name": at("CustomerID")}, link).json()["detail"]
    assert save(admin, code, {"shoe_size": at("City")}, link).status_code == 400
    assert save(admin, code, {"name": at("Nope")}, link).status_code == 400
    assert save(admin, code, {"name": {"table": "other", "column": "x"}}, link).status_code == 400
    assert not FieldMap.objects.exists()


def test_only_stewards_and_admins_change_it(admin, code):
    viewer = client("map.viewer", group="Relationship manager")
    assert viewer.get(f"/api/mapping/{code}/").json()["can_edit"] is False
    assert save(viewer, code, {}, {}).status_code == 403


def test_examples_to_copy_while_writing_a_rule(admin, code):
    post = lambda **body: admin.post(f"/api/rules/{code}/examples/", {"table": TABLE, "column": "PhoneNumber", **body},
                                     format="json").json()
    shape = post()
    assert shape["mode"] == "shape" and shape["usual"] == "10 digits"
    assert [r["value"] for r in shape["passed"]] == ["9876543210"]
    assert shape["failed"] == [{"row": 2, "value": "987654321", "label": "9 digits"}]
    regex = post(pattern="^[0-9]{9}$")
    assert [r["value"] for r in regex["passed"]] == ["987654321"] and regex["total_failed"] == 1
    assert "valid" in admin.post(f"/api/rules/{code}/examples/", {"table": TABLE, "column": "PhoneNumber",
                                                                  "pattern": "(["}, format="json").json()["detail"]
