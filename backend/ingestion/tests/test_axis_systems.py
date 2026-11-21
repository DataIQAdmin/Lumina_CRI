"""Axis Bank's demo systems: real formats, systems that agree with each other, people shared across them, and the
data problems put in on purpose."""

import re
from datetime import date

import pytest

from ingestion import axis_systems as ax


@pytest.fixture(scope="module")
def data():
    return ax.build()


def col(table, name):
    i = table.names.index(name)
    return [r[i] for r in table.rows]


def test_the_same_data_comes_out_every_time(data):
    again = ax.build()
    assert col(data[0]["sttm_customer"], "customer_no") == col(again[0]["sttm_customer"], "customer_no")
    assert data[3]["issues"] == again[3]["issues"]


def test_sizes_and_people_across_systems(data):
    flexcube, finone, vx, key = data
    assert len(flexcube["sttm_customer"].rows) == ax.FLEXCUBE_CUSTOMERS + 4  # 4 people created twice
    assert len(finone["los_customer"].rows) == ax.FINONE_SHARED + ax.FINONE_NEW
    assert len(vx["cardholders"]) == ax.VX_SHARED + ax.VX_NEW + 4  # 4 re-applied
    people = key["people"]
    assert sum(1 for p in people if p["flexcube"] and p["finone"]) == ax.FINONE_SHARED
    assert sum(1 for p in people if p["finone"] and not p["flexcube"]) == ax.FINONE_NEW
    assert sum(1 for p in people if p["vx"] and not p["flexcube"]) == ax.VX_NEW
    assert sorted(p["conflict"] for p in people if p["conflict"]) == ["dob", "pan"]


def test_identity_numbers_follow_the_real_formats(data):
    flexcube = data[0]
    pans = col(flexcube["sttm_customer"], "unique_id_value")
    good = [p for p in pans if re.fullmatch(r"[A-Z]{3}P[A-Z][0-9]{4}[A-Z]", p)]
    assert len(pans) - len(good) == data[3]["issues"]["FLEXCUBE: PAN typed wrongly (letter for digit or digit for letter)"]
    kyc = flexcube["sttm_cust_kyc"]
    aadhaar = [n for t, n in zip(col(kyc, "document_type"), col(kyc, "document_no")) if t == "AADHAAR"]
    assert all(re.fullmatch(r"[2-9][0-9]{11}", a) and ax.verhoeff_valid(a) for a in aadhaar)
    assert all(re.fullmatch(r"9[0-9]{14}", a) for a in col(flexcube["sttm_cust_account"], "cust_ac_no"))
    assert all(re.fullmatch(r"UTIB0[0-9]{6}", i) for i in col(flexcube["sttm_cust_account"], "ifsc_code"))
    masked = [c["cardNumberMasked"] for c in data[2]["cards"]]
    assert all(re.fullmatch(r"[456][0-9]{5}\*{6}[0-9]{4}", m) for m in masked)
    assert ax.luhn_valid("4111111111111111") and not ax.luhn_valid("4111111111111112")


def test_dates_follow_each_other(data):
    flexcube, finone = data[0], data[1]
    born = dict(zip(col(flexcube["sttm_cust_personal"], "customer_no"), col(flexcube["sttm_cust_personal"], "date_of_birth")))
    created = dict(zip(col(flexcube["sttm_customer"], "customer_no"), col(flexcube["sttm_customer"], "cif_creation_date")))
    for cif, made in created.items():
        assert made <= ax.TODAY
        if born[cif] != date(1900, 1, 1):
            assert (made - born[cif]).days >= 18 * 365
    accounts = flexcube["sttm_cust_account"]
    for cif, opened in zip(col(accounts, "cust_no"), col(accounts, "ac_open_date")):
        assert opened >= created[cif]
    loans = finone["lms_loan_account"]
    for row in loans.rows:
        r = dict(zip(loans.names, row))
        assert r["first_emi_date"] > r["disbursal_date"] and r["maturity_date"] > r["first_emi_date"]
        assert 0 <= r["principal_outstanding"] <= r["disbursal_amount"]
        assert r["emi_amount"] == ax.emi(r["disbursal_amount"], float(r["interest_rate"]), r["tenure_months"])
        assert (r["dpd"] == 0) == (r["asset_classification"] == "STANDARD")


def test_systems_point_at_each_other(data):
    flexcube, finone, vx = data[0], data[1], data[2]
    cifs = set(col(flexcube["sttm_customer"], "customer_no"))
    accounts = set(col(flexcube["sttm_cust_account"], "cust_ac_no"))
    assert {c for c in col(finone["los_customer"], "cif_no") if c} <= cifs
    assert {a for a in col(finone["lms_loan_account"], "repayment_account_no") if a} <= accounts
    assert {c["relationshipNo"] for c in vx["cardholders"] if c["relationshipNo"]} <= cifs
    assert {a["autopay"]["debitAccountNo"] for a in vx["card_accounts"] if a["autopay"]["enabled"]} <= accounts
    holders = {c["chId"] for c in vx["cardholders"]}
    assert {a["chId"] for a in vx["card_accounts"]} <= holders
    assert {c["accountNo"] for c in vx["cards"]} <= {a["accountNo"] for a in vx["card_accounts"]}


def test_data_problems_are_there_on_purpose_and_counted(data):
    issues = data[3]["issues"]
    assert issues["FLEXCUBE: same person created twice under two CIFs"] == 4
    assert issues["VX: same person set up twice as a cardholder (re-applied)"] == 4
    emails = col(data[0]["sttm_cust_personal"], "e_mail")
    assert sum(e is None for e in emails) == issues["FLEXCUBE: email missing"]
    assert 20 <= issues["FINONE: existing bank customer without the CIF number"] <= 40
