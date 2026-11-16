"""Demo data that behaves like a real bank's two systems, so matching, trust scores and golden records have real work.

Each bank has a core banking system (Axis: PostgreSQL, HDFC: MySQL) and a mobile app (MongoDB):

- Core banking: the 11 related tables, 100 customers. Customers have CIF numbers (AXC0001234), the legal name and
  KYC details, and were last updated one to three years ago.
- Mobile app: its own collections and field names (app_users, app_addresses, app_devices, app_kyc_uploads).
  Users have app IDs (usr_8f2a91c4) and nested profiles. 70 of the core customers also use the app; 85% of those
  carry their CIF number (cifRef), the rest must be matched by PAN, mobile or name and date of birth. 27 app users
  are not in core banking at all, and 3 people registered twice. Details differ the way they do in real life: names
  typed short or in small letters, dates written DD/MM/YYYY, a +91 in front of mobiles, newer mobiles and addresses,
  PAN often missing, and in 2 people a PAN or date of birth that conflicts with core banking.

answer_key() says which records are really the same person. It is kept outside the source systems, to measure how
well Lumina matches; it is never loaded anywhere.
"""

import random
import string
from datetime import date, timedelta

from .fake_people import FIRST, LAST
from .raw_demo import sample

TODAY = date(2026, 11, 16)  # fixed, so the same data comes out every time
PREFIX = {"axis": "AXC", "hdfc": "HDC"}
CITIES = [("Bangalore", "Karnataka", "560001"), ("Mumbai", "Maharashtra", "400001"), ("Chennai", "Tamil Nadu", "600001"),
          ("Hyderabad", "Telangana", "500001"), ("Pune", "Maharashtra", "411001"), ("Delhi", "Delhi", "110001"),
          ("Kolkata", "West Bengal", "700001"), ("Ahmedabad", "Gujarat", "380001"), ("Jaipur", "Rajasthan", "302001"),
          ("Lucknow", "Uttar Pradesh", "226001")]
SHARED = 70  # core customers who also use the app
APP_ONLY = 27  # app users not in core banking
DUPLICATES = 3  # people who registered in the app twice


def _stamp(days_ago, rng):
    when = TODAY - timedelta(days=days_ago)
    return f"{when.isoformat()} {rng.randint(8, 20):02d}:{rng.randint(0, 59):02d}:{rng.randint(0, 59):02d}"


def _col(header, name):
    return header.index(name) if name in header else None


def _cif(bank, n):
    return f"{PREFIX[bank]}{1000000 + n * 37:07d}"


def core_tables(folder, bank, customers=100):
    """(tables, people). tables: {name: (header, rows)} for core banking, customer IDs as CIF numbers and a
    LastUpdatedTimestamp one to three years old on every customer. people: what core banking knows of each
    customer, in order, for building the app."""
    tables = sample(folder, bank, 1, customers)
    header, rows = tables["customer_master"]
    key = _col(header, "CustomerID")
    cif = {row[key]: _cif(bank, i) for i, row in enumerate(rows)}
    # Every table that names a customer uses the CIF number instead.
    for name, (h, rs) in tables.items():
        i = _col(h, "CustomerID")
        if i is None:
            continue
        for r in rs:
            if i < len(r) and r[i] in cif:
                r[i] = cif[r[i]]
    if "LastUpdatedTimestamp" not in header:
        header.append("LastUpdatedTimestamp")
        for r in rows:
            r.append("")
    stamp = header.index("LastUpdatedTimestamp")
    for r in rows:
        r[stamp] = _stamp(random.Random(f"{r[key]}|updated").randint(365, 3 * 365), random.Random(r[key]))

    # Emails follow the customer's own name (a few broken on purpose), so both systems describe the same person.
    names = {r[key]: r[_col(header, "CustomerName")] for r in rows} if _col(header, "CustomerName") is not None else {}
    h, rs = tables.get("customer_email", ([], []))
    k, c = _col(h, "CustomerID"), _col(h, "EmailAddress")
    if k is not None and c is not None:
        for r in rs:
            if r[k] in names and r[c]:
                r[c] = _email_for(names[r[k]], random.Random(f"{r[k]}|email"))

    def first_value(table, column):
        h, rs = tables.get(table, ([], []))
        k, c = _col(h, "CustomerID"), _col(h, column)
        found = {}
        if k is not None and c is not None:
            for r in rs:
                found.setdefault(r[k], r[c])
        return found

    phones = first_value("customer_phone", "PhoneNumber")
    emails = first_value("customer_email", "EmailAddress")
    cities = first_value("customer_address", "City")
    get = lambda r, name: r[_col(header, name)] if _col(header, name) is not None else ""  # noqa: E731
    people = [{"cif": r[key], "name": get(r, "CustomerName"), "dob": get(r, "DateOfBirth"), "pan": get(r, "PAN"),
               "aadhaar": get(r, "AadhaarReferenceNumber"), "gender": get(r, "Gender"),
               "mobile": phones.get(r[key], ""), "email": emails.get(r[key], ""), "city": cities.get(r[key], "")}
              for r in rows]
    return tables, people


def _email_for(name, rng):
    """first.last42@gmail.com from a name; about 1 in 12 broken (no @, or far too long), as real data is."""
    parts = name.lower().split()
    user = f"{parts[0]}.{parts[-1]}{rng.randint(1, 99)}" if parts else f"user{rng.randint(1, 999)}"
    domain = rng.choice(["gmail.com", "yahoo.co.in", "outlook.com", "rediffmail.com"])
    roll = rng.random()
    if roll < 0.05:
        return f"{user}{domain}"
    if roll < 0.08:
        return f"{user}.{user}.{user}@{domain}"
    return f"{user}@{domain}"


def _user_id(rng):
    return "usr_" + "".join(rng.choices("0123456789abcdef", k=8))


def _typed_name(name, rng):
    """How people type their own name into an app."""
    parts = name.split()
    roll = rng.random()
    if len(parts) < 2 or roll < 0.45:
        return name
    if roll < 0.7:
        return name.lower()
    if roll < 0.88:
        return f"{parts[0]} {parts[-1][0]}"
    return name.upper()


def _app_dob(dob):
    """Core writes 12-05-1990; the app writes 12/05/1990."""
    return dob.replace("-", "/")


def _mobile(rng):
    return rng.choice("6789") + "".join(rng.choices(string.digits, k=9))


def _pan(rng):
    return "".join(rng.choices(string.ascii_uppercase, k=3)) + "P" + rng.choice(string.ascii_uppercase) + \
        "".join(rng.choices(string.digits, k=4)) + rng.choice(string.ascii_uppercase)


def _new_person(bank, n):
    """Someone who uses the app but has no core banking account."""
    rng = random.Random(f"{bank}|app-only|{n}")
    first, last = rng.choice(FIRST), rng.choice(LAST)
    born = date(1960, 1, 1) + timedelta(days=rng.randint(0, 40 * 365))
    return {"cif": None, "name": f"{first} {last}", "dob": born.strftime("%d-%m-%Y"), "pan": _pan(rng),
            "aadhaar": "", "gender": rng.choice(["Male", "Female"]), "mobile": _mobile(rng),
            "email": f"{first}.{last}{rng.randint(1, 99)}@gmail.com".lower(), "city": rng.choice(CITIES)[0]}


def app_collections(bank, people):
    """({collection: [documents]}, answer key) for the mobile app, built from what core banking knows."""
    users, addresses, devices, uploads, key = [], [], [], [], []
    conflicts = {SHARED // 10: "pan", SHARED * 6 // 10: "dob"}  # two shared customers whose details clash

    def add_user(person, n, duplicate_of=None):
        rng = random.Random(f"{bank}|app|{n}|{duplicate_of}")
        user = _user_id(rng)
        clash = conflicts.get(n) if duplicate_of is None and person["cif"] else None
        mobile = person["mobile"] if person["mobile"] and rng.random() > 0.2 else _mobile(rng)  # 20% got a new number
        pan = person["pan"] if rng.random() < 0.6 else ""
        if clash == "pan":
            pan = _pan(rng)
        dob = _app_dob(person["dob"])
        if clash == "dob" and dob:
            day, month, year = dob.split("/")
            dob = f"{day}/{month}/{int(year) + 1}"
        moved = person["cif"] and rng.random() < 0.25
        city, state, pin = rng.choice(CITIES) if moved or not person["city"] else \
            next((c for c in CITIES if c[0] == person["city"]), rng.choice(CITIES))
        doc = {"userId": user, "profile": {"fullName": _typed_name(person["name"], rng), "dob": dob, "gender": person["gender"]},
               "contact": {"mobile": "+91" + mobile, "email": person["email"] or f"{user}@mail.com",
                           "emailVerified": rng.random() < 0.7},
               "kyc": {"pan": pan, "status": "Verified" if pan and rng.random() < 0.7 else "Pending"},
               "createdAt": _stamp(rng.randint(200, 900), rng),
               "updatedAt": _stamp(rng.randint(1, 60) if duplicate_of is None else rng.randint(300, 700), rng)}
        if person["cif"] and duplicate_of is None and rng.random() < 0.85:
            doc["cifRef"] = person["cif"]
        users.append(doc)
        addresses.append({"addressId": f"adr_{user[4:]}", "userId": user, "line1": f"{rng.randint(1, 300)} {rng.choice(['MG Road', 'Station Road', 'Lake View', 'Park Street', 'Main Road'])}",
                          "city": city, "state": state, "pincode": pin, "updatedAt": doc["updatedAt"]})
        devices.append({"deviceId": f"dev_{user[4:]}", "userId": user, "platform": rng.choice(["Android", "Android", "iOS"]),
                        "appVersion": f"5.{rng.randint(0, 9)}.{rng.randint(0, 20)}", "lastLoginAt": _stamp(rng.randint(0, 30), rng)})
        if rng.random() < 0.6:
            uploads.append({"uploadId": f"kyc_{user[4:]}", "userId": user, "documentType": rng.choice(["PAN", "Aadhaar", "Passport"]),
                            "status": rng.choice(["Verified", "Verified", "Pending", "Rejected"]), "uploadedAt": _stamp(rng.randint(10, 400), rng)})
        return user, clash

    for n, person in enumerate(people[:SHARED]):
        user, clash = add_user(person, n)
        key.append({"person": person["cif"], "core": person["cif"], "app": [user], "conflict": clash})
    for n in range(APP_ONLY):
        user, _ = add_user(_new_person(bank, n), SHARED + n)
        key.append({"person": f"app-only-{n}", "core": None, "app": [user], "conflict": None})
    for n in range(DUPLICATES):  # the same people again, registered a second time
        at = (n + 1) * SHARED // (DUPLICATES + 1)
        entry, person = key[at], people[at]
        user, _ = add_user(person, at, duplicate_of=entry["app"][0])
        entry["app"].append(user)
    return {"app_users": users, "app_addresses": addresses, "app_devices": devices, "app_kyc_uploads": uploads}, key
