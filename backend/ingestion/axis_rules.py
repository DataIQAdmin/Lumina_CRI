"""Recommended format rules for Axis Bank's demo systems (ingestion/axis_systems.py): a regex for every column of
FLEXCUBE, FINONE and VX, so nobody has to type them one by one. Applied from the Rules page ("Apply recommended
rules"); each one can be changed or removed afterwards like any other rule.

The rules describe what a correct value looks like, not what the demo data happens to hold, so the data problems
put in on purpose (a missing email, a PAN typed wrongly, a placeholder date of birth, a date written DD/MM/YYYY...)
break them and those rows are held back from silver. Optional columns accept an empty value.

Tables are found by their own name, whatever schema they sit in ("fcubs.sttm_customer" and "sttm_customer" both
match). Columns a table does not have are skipped.
"""

DATE = r"(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])"
STAMP = DATE + r"[T ]([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?"
DOB = r"(19[3-9]\d|200\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])"  # born 1930-2009: no placeholder 1900-01-01
AMOUNT = r"\d{1,13}(\.\d{1,2})?"
WHOLE = r"\d{1,9}"
PAN = r"[A-Z]{3}P[A-Z]\d{4}[A-Z]"
AADHAAR = r"[2-9]\d{11}"
MOBILE = r"[6-9]\d{9}"
EMAIL = r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"
NAME = r"[A-Za-z][A-Za-z .'-]{0,69}"
UPPER_NAME = r"[A-Z][A-Z .'-]{0,104}"
TEXT = r"[A-Za-z0-9][A-Za-z0-9 ,./#&()'+-]{1,159}"
CIF = r"[129]\d{8}"
ACCOUNT = r"9\d{14}"
BRANCH = r"\d{3}"
PIN = r"[1-9]\d{5}"
YN = r"[YN]"
FN = r"FN\d{8}"
APP = r"APP\d{13}"
LOAN = r"(HL|PL|AL|LAP|EDU|TW)\d{8,13}"
CH = r"CH\d{10}"
CARD_ACCOUNT = r"0001\d{12}"
TRUE_FALSE = r"True|False"


def optional(pattern):
    return f"({pattern})?"


def one_of(*values):
    return "|".join(v.replace("+", r"\+") for v in values)


OCCUPATIONS = one_of("SALARIED", "SELF_EMPLOYED_BUSINESS", "SELF_EMPLOYED_PROFESSIONAL", "RETIRED", "HOMEMAKER", "STUDENT")

PRESET = {
    # ---------------- FLEXCUBE (core banking)
    "sttm_customer": {
        "customer_no": CIF, "customer_type": one_of("I", "C"), "customer_name1": UPPER_NAME,
        "short_name": r"[A-Z][A-Z .'-]{0,19}", "address_line1": TEXT, "address_line2": TEXT, "address_line3": TEXT,
        "address_line4": r"[A-Za-z .]+, [A-Za-z .]+", "pincode": PIN, "country": "IN", "nationality": "IN",
        "language": "ENG", "local_branch": BRANCH, "customer_category": one_of("INDIVIDUAL", "SENIOR", "PRIORITY", "STAFF", "NRI"),
        "pan_no": PAN, "frozen": YN, "deceased": YN, "whereabouts_unknown": YN, "cif_creation_date": DATE,
        "record_stat": one_of("O", "C"), "auth_stat": "A", "mod_no": WHOLE, "maker_id": r"BR\d{3}MK\d",
        "maker_dt_stamp": STAMP, "checker_id": optional(r"BR\d{3}CK\d"), "checker_dt_stamp": optional(STAMP),
    },
    "sttm_cust_personal": {
        "customer_no": CIF, "customer_prefix": one_of("MR", "MRS", "MS", "DR"), "first_name": NAME,
        "middle_name": optional(NAME), "last_name": NAME, "date_of_birth": DOB, "sex": one_of("M", "F", "O"),
        "marital_status": one_of("S", "M", "W", "D"), "fathers_name": NAME, "spouse_name": optional(NAME),
        "mobile_isd_code": r"\+91", "mobile_number": MOBILE, "telephone": optional(r"0\d{9,10}"), "e_mail": EMAIL,
        "resident_status": one_of("R", "N"), "passport_no": optional(r"[A-Z]\d{7}"), "occupation": OCCUPATIONS,
        "employer_name": optional(TEXT), "annual_income": AMOUNT,
    },
    "sttm_cust_kyc": {
        "customer_no": CIF, "pan_no": PAN, "pan_verified": YN, "aadhaar_no": AADHAAR, "aadhaar_verified": YN,
        "ckyc_number": r"\d{14}", "kyc_mode": one_of("OFFLINE", "EKYC", "VIDEO_KYC"), "kyc_verified_date": DATE,
        "risk_category": one_of("LOW", "MEDIUM", "HIGH"), "next_review_date": DATE,
    },
    "sttm_cust_account": {
        "cust_ac_no": ACCOUNT, "branch_code": BRANCH, "cust_no": CIF, "ccy": "INR",
        "account_class": one_of("SBREG", "SBSAL", "SBSNR", "SBPRI", "CAREG", "CAPRM"), "ac_desc": TEXT,
        "ac_open_date": DATE, "mode_of_operation": one_of("SINGLE", "EITHER OR SURVIVOR", "FORMER OR SURVIVOR", "JOINT"),
        "joint_holder_cif": optional(CIF), "ifsc_code": r"UTIB0\d{6}", "ac_stat_dormant": YN, "ac_stat_frozen": YN,
        "ac_stat_no_dr": YN, "nominee_available": YN, "cheque_book_facility": YN, "atm_facility": YN,
        "date_last_cr_activity": DATE, "date_last_dr_activity": DATE, "record_stat": one_of("O", "C"), "auth_stat": "A",
    },
    "actb_accbal": {
        "cust_ac_no": ACCOUNT, "branch_code": BRANCH, "acy_curr_balance": AMOUNT, "acy_avl_bal": r"-?" + AMOUNT,
        "acy_blocked_amount": AMOUNT, "acy_uncollected": AMOUNT, "acy_accrued_cr_ic": AMOUNT, "balance_as_of": DATE,
    },
    "sttm_ac_nominee": {
        "cust_ac_no": ACCOUNT, "nominee_no": WHOLE, "nominee_name": NAME,
        "relationship": one_of("SPOUSE", "SON", "DAUGHTER", "FATHER", "MOTHER", "BROTHER", "SISTER"),
        "nominee_dob": DATE, "share_pct": r"\d{1,3}(\.\d{1,2})?", "minor": YN,
    },
    "actb_history": {
        "trn_ref_no": r"\d{16}", "ac_no": ACCOUNT, "ac_branch": BRANCH, "trn_dt": DATE, "value_dt": DATE,
        "drcr_ind": one_of("D", "C"), "trn_code": one_of("UPI", "ATM", "IMP", "POS", "CHQ", "BIL", "INT", "SAL", "NFT"),
        "lcy_amount": AMOUNT, "narration": r"[A-Z0-9][A-Z0-9 ./:&,'()-]{1,104}", "user_id": r"[A-Z0-9_]{3,12}",
    },
    # ---------------- FINONE (loans)
    "los_customer": {
        "customer_id": FN, "cif_no": optional(CIF), "salutation": one_of("MR", "MRS", "MS", "DR"),
        "first_name": NAME, "middle_name": optional(NAME), "last_name": NAME, "date_of_birth": DOB,
        "gender": one_of("MALE", "FEMALE", "OTHER"), "marital_status": one_of("SINGLE", "MARRIED", "WIDOWED", "DIVORCED"),
        "pan_no": PAN, "aadhaar_ref": r"X{8}\d{4}", "mobile_no": r"(\+91)?" + MOBILE, "email_id": EMAIL,
        "qualification": one_of("GRADUATE", "POST_GRADUATE", "PROFESSIONAL", "DIPLOMA", "UNDER_GRADUATE"),
        "occupation_type": OCCUPATIONS, "employer_name": optional(TEXT), "monthly_income": AMOUNT,
        "cibil_score": r"[3-8]\d{2}|900", "customer_category": one_of("ETB", "NTB"), "created_date": STAMP,
        "last_modified_date": STAMP,
    },
    "los_address": {
        "customer_id": FN, "address_type": one_of("CURRENT", "PERMANENT", "OFFICE"), "address_line1": TEXT,
        "address_line2": TEXT, "landmark": optional(TEXT), "city": r"[A-Za-z .]{2,40}", "state": r"[A-Za-z .]{2,40}",
        "pincode": PIN, "years_at_address": optional(r"\d{1,2}"), "is_mailing": YN,
    },
    "los_application": {
        "application_id": APP, "customer_id": FN, "product_code": one_of("HL", "PL", "AL", "LAP", "EDU", "TW"),
        "scheme_name": TEXT, "loan_amount_requested": AMOUNT, "tenure_requested": r"\d{1,3}", "application_date": DATE,
        "sourcing_channel": one_of("BRANCH", "DSA", "DIGITAL"), "branch_code": BRANCH,
        "stage": one_of("DISBURSED", "SANCTIONED", "REJECTED", "CANCELLED"), "sanction_amount": optional(AMOUNT),
        "sanction_date": optional(DATE), "rejection_reason": optional(TEXT), "co_applicant_id": optional(FN),
    },
    "lms_loan_account": {
        "loan_account_no": LOAN, "application_id": APP, "customer_id": FN,
        "product_code": one_of("HL", "PL", "AL", "LAP", "EDU", "TW"), "disbursal_amount": AMOUNT,
        "disbursal_date": DATE, "interest_rate": r"\d{1,2}(\.\d{1,2})?", "tenure_months": r"\d{1,3}",
        "emi_amount": AMOUNT, "first_emi_date": DATE, "maturity_date": DATE, "principal_outstanding": AMOUNT,
        "overdue_amount": AMOUNT, "dpd": r"\d{1,4}", "asset_classification": one_of("STANDARD", "SMA-0", "SMA-1", "SMA-2", "NPA"),
        "loan_status": one_of("ACTIVE", "CLOSED"), "repayment_mode": one_of("NACH", "SI", "PDC"),
        "repayment_account_no": optional(r"\d{9,18}"), "repayment_ifsc": r"[A-Z]{4}0[A-Z0-9]{6}",
    },
    "lms_repayment_schedule": {
        "loan_account_no": LOAN, "instalment_no": r"\d{1,3}", "due_date": DATE, "emi_amount": AMOUNT,
        "principal_component": AMOUNT, "interest_component": AMOUNT, "opening_principal": AMOUNT,
        "paid_date": optional(DATE), "paid_amount": optional(AMOUNT), "status": one_of("PAID", "DUE", "OVERDUE"),
    },
    "los_collateral": {
        "collateral_id": r"COL\d{10}", "application_id": APP, "collateral_type": one_of("PROPERTY", "VEHICLE", "FD", "GOLD"),
        "description": TEXT, "market_value": AMOUNT, "ltv_pct": r"\d{1,3}(\.\d{1,2})?",
        "registration_no": r"[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}|[A-Z]{2}/SRO/\d{4}/\d{4}", "valuation_date": DATE,
    },
    # ---------------- VX (credit cards, MongoDB)
    "cardholders": {
        "chId": CH, "relationshipNo": optional(CIF), "name.title": one_of("MR", "MRS", "MS", "DR"),
        "name.first": NAME, "name.middle": optional(NAME), "name.last": NAME, "embossName": r"[A-Z][A-Z .'-]{0,20}",
        "dob": DOB, "gender": one_of("M", "F", "O"), "pan": PAN, "mobile": r"(\+91[ -]?)?[6-9]\d{4}-?\d{5}",
        "email": EMAIL, "billingAddress.line1": TEXT, "billingAddress.line2": TEXT,
        "billingAddress.city": r"[A-Za-z .]{2,40}", "billingAddress.state": r"[A-Za-z .]{2,40}", "billingAddress.pin": PIN,
        "billingAddress.country": "IN", "employment.type": OCCUPATIONS, "employment.employer": optional(TEXT),
        "employment.annualIncome": AMOUNT, "kyc.status": one_of("VERIFIED", "PENDING", "REJECTED"),
        "kyc.ckycNo": optional(r"\d{14}"), "kyc.verifiedOn": optional(DATE), "createdAt": STAMP, "updatedAt": STAMP,
    },
    "card_accounts": {
        "accountNo": CARD_ACCOUNT, "chId": CH,
        "product": one_of("PLATINUM", "REWARDS", "CASHBACK", "SIGNATURE", "TRAVEL", "PRIVILEGE"),
        "annualFee": AMOUNT, "creditLimit": AMOUNT, "cashLimit": AMOUNT, "currentBalance": AMOUNT,
        "availableLimit": r"-?" + AMOUNT, "status": one_of("ACTIVE", "BLOCKED", "CLOSED"),
        "delinquencyBucket": one_of("CURRENT", "30+", "60+", "90+"), "billingCycleDay": r"[1-9]|[12]\d|3[01]",
        "openedOn": DATE, "autopay.enabled": TRUE_FALSE, "autopay.debitAccountNo": optional(ACCOUNT),
        "autopay.mode": optional(one_of("MINIMUM_DUE", "TOTAL_DUE")), "updatedAt": STAMP,
    },
    "cards": {
        "cardRef": r"TKN\d{13}", "accountNo": CARD_ACCOUNT, "chId": CH, "cardNumberMasked": r"[456]\d{5}\*{6}\d{4}",
        "network": one_of("VISA", "MASTERCARD", "RUPAY"), "cardType": one_of("PRIMARY", "ADDON"),
        "embossName": r"[A-Z][A-Z .'-]{0,20}", "issuedOn": DATE, "expiry": r"(0[1-9]|1[0-2])/\d{2}",
        "status": one_of("ACTIVE", "HOTLISTED", "CLOSED", "BLOCKED"), "contactless": TRUE_FALSE,
    },
    "statements": {
        "accountNo": CARD_ACCOUNT, "statementDate": DATE, "openingBalance": AMOUNT, "payments": AMOUNT,
        "purchases": AMOUNT, "interest": AMOUNT, "fees": AMOUNT, "closingBalance": AMOUNT, "minimumDue": AMOUNT,
        "paymentDueDate": DATE,
    },
}


def base_name(table):
    """"fcubs.sttm_customer" -> "sttm_customer"."""
    return table.rsplit(".", 1)[-1]


def recommended(tables):
    """[(table, {column: pattern})] for the given RawTables that have a preset, only for columns they have."""
    out = []
    for table in tables:
        preset = PRESET.get(base_name(table.name))
        if not preset:
            continue
        rules = {c: p for c, p in preset.items() if c in (table.columns or [])}
        if rules:
            out.append((table, rules))
    return out
