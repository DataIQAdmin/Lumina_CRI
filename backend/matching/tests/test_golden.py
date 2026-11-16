"""The golden record: each field chosen by source order or by most recent, with why, and why the rest were not."""

from datetime import datetime, timezone
from types import SimpleNamespace

from matching import golden, normalize

CORE = SimpleNamespace(name="Core banking", trust=0.9)
APP = SimpleNamespace(name="Mobile app", trust=0.6)


def record(rid, source, updated, **values):
    keys = {f: normalize.NORMALIZERS[f](v) for f, v in values.items() if f in normalize.NORMALIZERS}
    return SimpleNamespace(id=rid, source=source, source_id=id(source), key=f"K{rid}", values=values, keys=keys,
                           updated_at=datetime(*updated, tzinfo=timezone.utc) if updated else None)


def rows(*records):
    return {r["field"]: r for r in golden.build(list(records))}


def test_identity_comes_from_source_order_and_contact_from_the_newest():
    core = record(1, CORE, (2024, 1, 10), name="Rohan Kumar", dob="12-05-1990", pan="XXXXXX234F",
                  mobile="9876543210", email="rohan@old.in", address="12 MG Road", city="Pune", pincode="411001")
    app = record(2, APP, (2026, 11, 1), name="Rohan K", dob="12/05/1990", pan="XXXXXX234F",
                 mobile="+919123456780", email="rohan@new.in", address="9 Lake View", city="Mumbai")
    app.keys["pan"] = core.keys["pan"]  # the same real PAN
    got = rows(core, app)
    assert got["name"]["value"] == "Rohan Kumar" and got["name"]["why"] == "Core banking comes first in source order"
    assert got["name"]["others"][0]["why"] == "Not chosen: Mobile app comes later in source order"
    assert got["dob"]["others"][0]["why"] == "Same value, written another way" and not got["dob"]["conflict"]
    assert got["mobile"]["value"] == "+919123456780" and got["mobile"]["why"] == "Most recently updated (01 Nov 2026)"
    assert got["mobile"]["others"][0]["why"] == "Not chosen: older (10 Jan 2024)"
    # The address comes whole from the newest record: no pincode from one place and a city from another.
    assert (got["address"]["value"], got["city"]["value"]) == ("9 Lake View", "Mumbai")
    assert got["pincode"]["value"] == "411001" and got["pincode"]["record"] is core
    assert got["aadhaar"]["value"] == "" and got["aadhaar"]["why"] == "Missing in every source"


def test_a_differing_identity_detail_is_a_conflict():
    core = record(1, CORE, (2024, 1, 1), name="Priya Sharma", dob="01-02-1985")
    app = record(2, APP, (2026, 1, 1), name="Priya Sharma", dob="01/02/1986")
    got = rows(core, app)
    assert got["dob"]["conflict"] and got["dob"]["value"] == "01-02-1985"
    assert got["dob"]["others"][0]["why"].startswith("Differs")


def test_one_record_is_its_own_golden_record():
    got = rows(record(1, APP, None, name="Arjun Rao", mobile="9000000001"))
    assert got["name"]["why"] == "Only Mobile app has it" and got["mobile"]["value"] == "9000000001"
    assert golden.fingerprint(golden.build([record(1, APP, None, name="Arjun Rao")])).startswith("name=Arjun Rao")
