"""The raw layer: every table of a connector read whole for data profiling, identity numbers never readable."""

import uuid

import psycopg
import pytest
from django.conf import settings as django_settings
from django.contrib.auth.models import Group, User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from rest_framework.test import APIClient

from ingestion.models import RawRow, RawTable
from ingestion.raw import is_identity, mask, shape


def client(username, superuser=False, group=None):
    user = User.objects.create_user(username, password="Strong-pass-123", is_superuser=superuser)
    if group:
        user.groups.add(Group.objects.get(name=group))
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def admin(db):
    return client("raw.admin", superuser=True)


@pytest.fixture
def bank_db(db, settings):
    """A schema with two tables: customers (with a PAN column) and their addresses."""
    settings.CONNECTORS_ALLOW_PRIVATE_HOSTS = True
    cfg = django_settings.DATABASES["default"]
    schema = f"raw_{uuid.uuid4().hex[:8]}"
    params = dict(host=cfg["HOST"], port=cfg["PORT"], dbname=connection.settings_dict["NAME"], user=cfg["USER"],
                  password=cfg["PASSWORD"], autocommit=True)
    with psycopg.connect(**params) as conn:
        conn.execute(f'CREATE SCHEMA "{schema}"')
        conn.execute(f'CREATE TABLE "{schema}".customer_master ("CustomerID" text, "CustomerName" text, '
                     '"PAN" text, "DateOfBirth" date)')
        conn.execute(f"INSERT INTO \"{schema}\".customer_master VALUES ('C1', 'Asha Rao', 'ABCDE1234F', "
                     "'1990-05-01'), ('C2', 'Vikram', NULL, NULL), ('C3', 'Meera', 'abcde1234f', NULL)")
        conn.execute(f'CREATE TABLE "{schema}".customer_address ("AddressID" text, "CustomerID" text, "City" text)')
        conn.execute(f"INSERT INTO \"{schema}\".customer_address VALUES ('A1', 'C1', 'Pune')")
    yield schema, cfg, params
    with psycopg.connect(**params) as conn:
        conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')


@pytest.fixture
def connector(admin, bank_db):
    schema, cfg, params = bank_db
    code = admin.post("/api/connectors/", {
        "name": "Core banking", "connector_type": "postgresql", "trust": 85,
        "settings": {"host": cfg["HOST"], "port": str(cfg["PORT"]), "database": connection.settings_dict["NAME"],
                     "username": cfg["USER"], "password": cfg["PASSWORD"], "sslmode": "prefer"},
    }, format="json").json()["code"]
    return code, schema, params


def test_identity_columns_found_by_name():
    for column in ["PAN", "pan_no", "AadhaarReferenceNumber", "PassportNumber", "VoterID", "DrivingLicense"]:
        assert is_identity(column), column
    for column in ["CompanyTenure", "Pincode", "CustomerName", "AccountNumber", "Japan"]:
        assert not is_identity(column), column
    assert shape("ABCDE1234F") == "AAAAA9999A" and shape("1.23E+11") == "9.99A+99" and shape("abcDE") == "aaaAA"
    assert mask("ABCDE1234F") == "XXXXXX234F"


def test_every_table_is_read_whole_with_pan_masked(admin, connector):
    code, schema, _ = connector
    found = admin.post(f"/api/raw/{code}/discover/").json()["tables"]
    assert {f"{schema}.customer_master", f"{schema}.customer_address"} <= set(found)

    read = admin.post(f"/api/raw/{code}/read/", {"table": f"{schema}.customer_master"}, format="json")
    assert read.status_code == 200, read.json()
    assert read.json()["rows"] == 3 and read.json()["columns"] == 4 and read.json()["sensitive"] == ["PAN"]
    assert admin.post(f"/api/raw/{code}/read/", {"table": f"{schema}.customer_address"},
                      format="json").json()["rows"] == 1

    page = admin.get(f"/api/raw/{code}/rows/", {"table": f"{schema}.customer_master"}).json()
    assert page["column_names"] == ["CustomerID", "CustomerName", "PAN", "DateOfBirth"]
    assert page["results"][0] == ["C1", "Asha Rao", "XXXXXX234F", "1990-05-01"]
    assert page["results"][1] == ["C2", "Vikram", None, None]  # empty stays empty
    # The readable PAN is nowhere in the stored rows; shape, fingerprint and the encrypted value are kept for rules.
    stored = list(RawRow.objects.filter(table__name=f"{schema}.customer_master").order_by("position"))
    assert "ABCDE1234F" not in str([(r.values, r.protected) for r in stored])
    assert stored[0].protected["PAN"][0] == "AAAAA9999A" and stored[2].protected["PAN"][0] == "aaaaa9999a"
    assert stored[0].protected["PAN"][1] != stored[2].protected["PAN"][1]  # different values, different fingerprints


def test_reading_again_replaces_and_vanished_tables_are_dropped(admin, connector):
    code, schema, params = connector
    table = f"{schema}.customer_address"
    admin.post(f"/api/raw/{code}/read/", {"table": table}, format="json")
    admin.post(f"/api/raw/{code}/read/", {"table": table}, format="json")
    assert RawRow.objects.filter(table__name=table).count() == 1  # replaced, not added twice
    with psycopg.connect(**params) as conn:
        conn.execute(f'DROP TABLE "{schema}".customer_address')
    assert admin.post(f"/api/raw/{code}/discover/").json()["dropped"] == 1
    assert not RawTable.objects.filter(name=table).exists()


def test_a_table_bigger_than_the_limit_is_marked_incomplete(admin, connector, settings):
    code, schema, _ = connector
    settings.CONNECTOR_MAX_ROWS = 2
    body = admin.post(f"/api/raw/{code}/read/", {"table": f"{schema}.customer_master"}, format="json").json()
    assert body["rows"] == 2 and body["complete"] is False


def test_each_uploaded_csv_is_its_own_table(admin):
    code = admin.post("/api/connectors/", {"name": "Branch files", "connector_type": "file_upload", "trust": 40},
                      format="json").json()["code"]
    files = [SimpleUploadedFile("customer_master.csv", b"CustomerID,PAN\nC1,ABCDE1234F\nC2,\n"),
             SimpleUploadedFile("customer_email.csv", b"EmailID,CustomerID,EmailAddress\nE1,C1,a@b.in\n")]
    assert admin.post(f"/api/connectors/{code}/upload/", {"files": files}, format="multipart").status_code == 200
    assert admin.post(f"/api/raw/{code}/discover/").json()["tables"] == ["customer_email", "customer_master"]
    master = admin.post(f"/api/raw/{code}/read/", {"table": "customer_master"}, format="json").json()
    assert master["rows"] == 2 and master["sensitive"] == ["PAN"]
    rows = admin.get(f"/api/raw/{code}/rows/", {"table": "customer_master"}).json()["results"]
    assert rows == [["C1", "XXXXXX234F"], ["C2", ""]]
    listed = admin.get("/api/raw/").json()["sources"]
    assert next(s for s in listed if s["code"] == code)["tables"] == 1


def test_roles(admin, connector):
    code, schema, _ = connector
    admin.post(f"/api/raw/{code}/read/", {"table": f"{schema}.customer_address"}, format="json")
    agent = client("raw.agent", group="Contact centre agent")
    assert agent.get(f"/api/raw/{code}/").status_code == 200  # sizes: everyone with a role
    assert agent.get(f"/api/raw/{code}/rows/", {"table": f"{schema}.customer_address"}).status_code == 403
    assert agent.post(f"/api/raw/{code}/read/", {"table": f"{schema}.customer_address"},
                      format="json").status_code == 403
    steward = client("raw.steward", group="Data steward")
    assert steward.get(f"/api/raw/{code}/rows/", {"table": f"{schema}.customer_address"}).status_code == 200
