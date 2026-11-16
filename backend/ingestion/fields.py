"""The standard customer fields every source is mapped to, and a first guess of which column holds each.

Each bank system names its columns its own way: core banking has "CustomerName", the mobile app "profile.fullName".
Mapping says which column of a table holds which standard field, so customers from different systems can be
matched, scored and merged field by field. Lumina only suggests; a person confirms.
"""

import re

# key, label, group, what it is for. "needed": counted for completeness in the trust score.
FIELDS = [
    {"key": "customer_id", "label": "Customer ID", "group": "Link", "needed": False,
     "about": "Joins this table's rows to one customer of this system."},
    {"key": "cross_ref", "label": "ID in another system", "group": "Link", "needed": False,
     "about": "The same customer's ID in another system, like a core banking CIF kept by the app."},
    {"key": "updated_at", "label": "Last updated", "group": "Link", "needed": False,
     "about": "When the row last changed. Recent values win for mobile, email and address."},
    {"key": "name", "label": "Name", "group": "Identity", "needed": True, "about": "Full name."},
    {"key": "dob", "label": "Date of birth", "group": "Identity", "needed": True, "about": "Any date format."},
    {"key": "pan", "label": "PAN", "group": "Identity", "needed": True, "about": "Permanent Account Number."},
    {"key": "aadhaar", "label": "Aadhaar", "group": "Identity", "needed": True, "about": "Aadhaar number or reference."},
    {"key": "gender", "label": "Gender", "group": "Identity", "needed": False, "about": ""},
    {"key": "mobile", "label": "Mobile", "group": "Contact", "needed": True, "about": "Main mobile number."},
    {"key": "email", "label": "Email", "group": "Contact", "needed": True, "about": "Main email address."},
    {"key": "address", "label": "Address", "group": "Address", "needed": True, "about": "First line of the address."},
    {"key": "city", "label": "City", "group": "Address", "needed": False, "about": ""},
    {"key": "state", "label": "State", "group": "Address", "needed": False, "about": ""},
    {"key": "pincode", "label": "Pincode", "group": "Address", "needed": False, "about": ""},
]
KEYS = [f["key"] for f in FIELDS]

# Column names (lower case, letters and digits only, last part after a dot) that usually hold each field, best first.
HINTS = {
    "customer_id": ["customerid", "cif", "cifid", "cifnumber", "custid", "customerno", "customernumber", "userid",
                    "clientid"],
    "cross_ref": ["cifref", "coreid", "corecustomerid", "coreref", "externalid"],
    "updated_at": ["lastupdatedtimestamp", "updatedat", "lastupdated", "lastupdatedat", "lastmodified", "modifiedat",
                   "updatedon"],
    "name": ["customername", "fullname", "name", "custname", "clientname"],
    "dob": ["dateofbirth", "dob", "birthdate"],
    "pan": ["pan", "pannumber", "panno"],
    "aadhaar": ["aadhaar", "aadhaarnumber", "aadhaarreferencenumber", "aadhar", "aadharnumber"],
    "gender": ["gender", "sex"],
    "mobile": ["phonenumber", "mobile", "mobilenumber", "mobileno", "phone", "contactnumber"],
    "email": ["emailaddress", "email", "emailaddr", "mail"],
    "address": ["line1", "addressline1", "address", "addressline", "street"],
    "city": ["city", "town"],
    "state": ["state"],
    "pincode": ["pincode", "pin", "zip", "zipcode", "postalcode", "postcode"],
}


def _plain(column):
    return re.sub(r"[^a-z0-9]", "", column.rsplit(".", 1)[-1].lower())


def suggest(columns):
    """{field: column} for the columns whose names look like a standard field. A column is used once."""
    plain = {c: _plain(c) for c in columns}
    used, found = set(), {}
    for field in KEYS:
        best = None
        for column in columns:
            if column in used or plain[column] not in HINTS[field]:
                continue
            rank = HINTS[field].index(plain[column])
            if best is None or rank < best[0]:
                best = (rank, column)
        if best:
            found[field] = best[1]
            used.add(best[1])
    return found
