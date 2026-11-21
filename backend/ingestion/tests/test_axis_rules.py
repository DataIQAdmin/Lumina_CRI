"""Recommended rules for Axis Bank's demo systems: found per table, applied in one go, and every column of the
generated data passes them except the problems put in on purpose."""

from datetime import date, datetime

import pytest
import regex
from django.contrib.auth.models import Group, User
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from ingestion import axis_systems
from ingestion.axis_rules import PRESET
from ingestion.models import ColumnRule


def text(value, kind=""):
    if value is None:
        return ""
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if kind.startswith("numeric"):
        return f"{float(value):.{int(kind.split(',')[1].rstrip(')'))}f}"
    return str(value)


def test_every_column_has_a_rule_and_only_planted_problems_break_them():
    flexcube, finone, _, key = axis_systems.build()
    failing = {}
    for name, table in {**flexcube, **finone}.items():
        assert set(table.names) == set(PRESET[name]), name
        kinds = dict(table.columns)
        for column, pattern in PRESET[name].items():
            i, rule = table.names.index(column), regex.compile(pattern)
            bad = sum(1 for row in table.rows if not rule.fullmatch(text(row[i], kinds[column])))
            if bad:
                failing[f"{name}.{column}"] = bad
    issues = key["issues"]
    assert failing["sttm_cust_personal.date_of_birth"] == issues["FLEXCUBE: placeholder date of birth 1900-01-01"]
    assert failing["sttm_cust_personal.mobile_number"] == issues["FLEXCUBE: mobile with a leading 0 (11 digits)"]
    assert failing["sttm_customer.auth_stat"] == issues["FLEXCUBE: customer created but not yet authorised (auth_stat U)"]
    assert set(failing) == {"sttm_customer.pan_no", "sttm_customer.auth_stat", "sttm_cust_personal.date_of_birth",
                            "sttm_cust_personal.mobile_number", "sttm_cust_personal.e_mail", "sttm_cust_kyc.pan_no",
                            "los_customer.pan_no"}


@pytest.fixture
def admin(db):
    user = User.objects.create_user("rules.admin", password="Strong-pass-123", is_superuser=True)
    c = APIClient()
    c.force_authenticate(user)
    return c


def test_recommended_rules_are_listed_and_applied_in_one_go(admin):
    code = admin.post("/api/connectors/", {"name": "FINONE", "connector_type": "file_upload", "trust": 50},
                      format="json").json()["code"]
    data = (b"collateral_id,application_id,collateral_type,description,market_value,ltv_pct,registration_no,valuation_date\n"
            b"COL2507000010,APP2025071100010,VEHICLE,Hyundai Creta SX,830000,87.59,MH35KS0919,2025-07-16\n")
    admin.post(f"/api/connectors/{code}/upload/", {"files": [SimpleUploadedFile("los_collateral.csv", data)]}, format="multipart")
    assert admin.post(f"/api/raw/{code}/read/", {"table": "los_collateral"}, format="json").status_code == 200
    got = admin.get(f"/api/rules/{code}/recommended/").json()
    assert got["tables"] == [{"table": "los_collateral", "rules": 8, "already": 0}] and got["total"] == 8
    assert admin.post(f"/api/rules/{code}/recommended/").json() == {"applied": 8, "tables": 1}
    assert ColumnRule.objects.filter(source__code=code).count() == 8
    assert admin.get(f"/api/rules/{code}/recommended/").json()["already"] == 8
    steward = User.objects.create_user("rules.cco", password="Strong-pass-123")
    steward.groups.add(Group.objects.get(name="Compliance officer"))
    other = APIClient()
    other.force_authenticate(steward)
    assert other.post(f"/api/rules/{code}/recommended/").status_code == 403
