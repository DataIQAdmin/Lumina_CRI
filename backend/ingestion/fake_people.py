"""Fake people for the demo tables: Indian names, phones, emails, PAN and Aadhaar. All invented, none real.

Each value depends only on the row's first ID and the column, so the same customer looks the same in every
connector. About one value in ten is wrong on purpose (short phone, damaged Aadhaar, email without @...).
Passport, voter ID and driving licence numbers follow the real Indian formats, so standard regexes work on them.
"""

import random
import string

FIRST = ["Aarav", "Vivaan", "Aditya", "Arjun", "Rohan", "Karan", "Rahul", "Vikram", "Sanjay", "Nikhil", "Imran",
         "Farhan", "Joseph", "Thomas", "Gurpreet", "Ananya", "Diya", "Priya", "Sneha", "Meera", "Kavya", "Pooja",
         "Lakshmi", "Divya", "Neha", "Fatima", "Ayesha", "Mary", "Simran", "Harini"]
LAST = ["Sharma", "Verma", "Gupta", "Iyer", "Nair", "Reddy", "Rao", "Patel", "Shah", "Mehta", "Joshi", "Kulkarni",
        "Khan", "Sheikh", "Singh", "Kaur", "Das", "Bose", "Menon", "Pillai", "Fernandes", "Mishra", "Yadav", "Naidu"]
DOMAINS = ["gmail.com", "yahoo.co.in", "outlook.com", "rediffmail.com"]

FULL_NAMES = {"CustomerName", "MotherName", "FatherName", "SpouseName", "ApplicantMaidenFullName"}
SHORT_NAMES = {"CustomerShortName"}
PHONES = {"PhoneNumber", "AlternatePhoneNumber", "AlternateBusinessPhoneNumber", "EmergencyContactNumber",
          "WorkplacePhoneNumber"}
PANS = {"PAN"}
AADHAARS = {"AadhaarReferenceNumber"}
PASSPORTS = {"PassportNumber"}
VOTER_IDS = {"VoterID"}
LICENCES = {"DrivingLicense"}
STATES = ["KA", "MH", "TN", "DL", "TS", "WB", "GJ", "RJ", "UP", "KL"]


def _digits(rng, count):
    return "".join(rng.choices(string.digits, k=count))


def _phone(rng):
    roll = rng.random()
    if roll < 0.05:
        return ""
    number = rng.choice("6789") + _digits(rng, 9)
    if roll < 0.13:
        return number[:9]
    if roll < 0.18:
        return number[:7]
    return number


def _pan(rng):
    letters = "".join(rng.choices(string.ascii_uppercase, k=3)) + "P" + rng.choice(string.ascii_uppercase)
    pan = letters + _digits(rng, 4) + rng.choice(string.ascii_uppercase)
    roll = rng.random()
    if roll < 0.04:
        return ""
    if roll < 0.08:
        return pan.lower()
    if roll < 0.12:
        return pan[:9]
    return pan


def _aadhaar(rng):
    number = rng.choice("23456789") + _digits(rng, 11)
    roll = rng.random()
    if roll < 0.04:
        return ""
    if roll < 0.08:
        return f"{number[0]}.{number[1:6]}E+11"  # what Excel does to a long number
    if roll < 0.12:
        return number[:11]
    return number


def _passport(rng):
    """One capital letter and 7 digits, like P1234567."""
    number = rng.choice("ABCDEFGHJKLMNPRSTUVWY") + _digits(rng, 7)
    roll = rng.random()
    if roll < 0.04:
        return ""
    if roll < 0.08:
        return number + rng.choice(string.digits)  # one digit too many
    return number


def _voter_id(rng):
    """Three capital letters and 7 digits, like ABC1234567."""
    number = "".join(rng.choices(string.ascii_uppercase, k=3)) + _digits(rng, 7)
    roll = rng.random()
    if roll < 0.04:
        return ""
    if roll < 0.08:
        return number.lower()
    return number


def _licence(rng):
    """State code, RTO number, year issued and 7 digits, like KA0120190012345."""
    number = rng.choice(STATES) + f"{rng.randint(1, 99):02d}" + str(rng.randint(1990, 2024)) + _digits(rng, 7)
    roll = rng.random()
    if roll < 0.04:
        return ""
    if roll < 0.08:
        return f"{number[:4]} {number[4:8]} {number[8:]}"  # typed with spaces
    return number


def _name(rng):
    return f"{rng.choice(FIRST)} {rng.choice(LAST)}"


def _short_name(rng):
    return rng.choice(FIRST)


def _email(rng):
    user = f"{rng.choice(FIRST)}.{rng.choice(LAST)}{rng.randint(1, 999)}".lower()
    roll = rng.random()
    if roll < 0.05:
        return f"{user}{rng.choice(DOMAINS)}"  # no @
    if roll < 0.08:
        return f"{user}.{user}.{user}@{rng.choice(DOMAINS)}"  # far too long
    return f"{user}@{rng.choice(DOMAINS)}"


def _is_email_column(rows, i):
    filled = [r[i] for r in rows[:50] if i < len(r) and r[i]]
    return bool(filled) and sum("@" in v for v in filled) * 2 >= len(filled)


def fake_table(header, rows):
    """(header, rows) with every person's details replaced. The rows' IDs and everything else stay as they are."""
    makers = {}
    for i, column in enumerate(header):
        if column in FULL_NAMES:
            makers[i] = _name
        elif column in SHORT_NAMES:
            makers[i] = _short_name
        elif column in PHONES:
            makers[i] = _phone
        elif column in PANS:
            makers[i] = _pan
        elif column in AADHAARS:
            makers[i] = _aadhaar
        elif column in PASSPORTS:
            makers[i] = _passport
        elif column in VOTER_IDS:
            makers[i] = _voter_id
        elif column in LICENCES:
            makers[i] = _licence
        elif _is_email_column(rows, i):
            makers[i] = _email
    out = []
    for row in rows:
        row = row + [""] * (len(header) - len(row))
        out.append([makers[i](random.Random(f"{row[0]}|{header[i]}")) if i in makers else value
                    for i, value in enumerate(row)])
    return header, out
