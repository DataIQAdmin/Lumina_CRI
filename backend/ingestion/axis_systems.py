"""Axis Bank demo data: three systems that look and behave like a real bank's, built from one set of people.

  FLEXCUBE  core banking (PostgreSQL, schema fcubs)   customers, KYC, savings and current accounts, balances,
                                                      nominees and recent transactions
  FINONE    loans (PostgreSQL, schema finnone)        loan customers, addresses, applications, loan accounts,
                                                      repayment schedules and collateral
  VX        credit cards (MongoDB)                    cardholders, card accounts, cards and statements

Every value follows the real Indian format and the systems agree with each other the way real ones do:
  - PAN: 5 letters, 4 digits, 1 letter; the 4th letter is P (a person), the 5th the first letter of the surname.
  - Aadhaar: 12 digits, first 2-9, last a Verhoeff check digit. Mobiles: 10 digits starting 6-9.
  - Pincodes, cities and states belong together; each city has its Axis branch and IFSC (UTIB0 + 6 digits).
  - Account numbers are 15 digits; card numbers pass the Luhn check and are stored masked, as card systems do.
  - Dates follow each other: born, then the customer is created (18 or older), then accounts open, loans are
    applied for, sanctioned and disbursed, and EMIs fall due monthly. EMIs use the standard reducing-balance formula.
  - Income fits the occupation; credit limits and loan amounts fit the income.

People overlap across systems: 500 FLEXCUBE customers; 180 of them also have a loan in FINONE and 150 a credit card
in VX; FINONE also has 40 and VX 50 people who are new to the bank. Loan and card systems often lack the CIF number,
so matching must also use PAN, mobile and name with date of birth.

Real data problems are added on purpose, at fixed rates, and listed in the answer key (ISSUES): duplicate CIFs,
missing or broken emails, mobiles with a leading 0, placeholder dates of birth, PAN typos, names written differently
in each system, changed mobiles and addresses, mixed date formats in VX, and two people whose PAN or date of birth
differs between systems.

answer_key() says which records are the same person. It is kept outside the systems and never loaded into Lumina.
Everything is invented: no real person, account or card.
"""

import random
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

TODAY = date(2026, 11, 20)  # fixed, so the same data comes out every time
SEED = "axis-systems-v1"

FLEXCUBE_CUSTOMERS = 500
FINONE_SHARED, FINONE_NEW = 180, 40
VX_SHARED, VX_NEW = 150, 50

# ---------------------------------------------------------------- people

MALE = ["Aarav", "Aditya", "Ajay", "Akash", "Amit", "Anand", "Anil", "Arjun", "Arun", "Ashok", "Deepak", "Dinesh",
        "Ganesh", "Gaurav", "Harish", "Imran", "Karan", "Karthik", "Kiran", "Krishna", "Mahesh", "Manoj", "Mohammed",
        "Naveen", "Nikhil", "Pankaj", "Pradeep", "Prakash", "Rahul", "Rajesh", "Rakesh", "Ramesh", "Ravi", "Rohan",
        "Sachin", "Sandeep", "Sanjay", "Santosh", "Saurabh", "Siddharth", "Sunil", "Suresh", "Tarun", "Varun",
        "Venkatesh", "Vijay", "Vikram", "Vinod", "Vishal", "Yash", "Farhan", "Joseph", "Thomas", "Gurpreet", "Harpreet"]
FEMALE = ["Aishwarya", "Anjali", "Ananya", "Anita", "Aparna", "Asha", "Bhavana", "Deepa", "Divya", "Fatima", "Geeta",
          "Harini", "Jyoti", "Kavita", "Kavya", "Lakshmi", "Madhuri", "Meena", "Meera", "Neha", "Nisha", "Pallavi",
          "Pooja", "Preeti", "Priya", "Radha", "Rekha", "Ritu", "Sakshi", "Sangeeta", "Shalini", "Shweta", "Simran",
          "Sneha", "Sonal", "Sunita", "Swati", "Uma", "Vandana", "Varsha", "Ayesha", "Mary", "Sushma", "Revathi"]
# Surnames by region, so people mostly live where their names are common.
SURNAMES = {
    "west": ["Patil", "Kulkarni", "Deshpande", "Joshi", "Shah", "Patel", "Mehta", "Desai", "Jadhav", "Pawar", "Shinde"],
    "south": ["Iyer", "Nair", "Menon", "Pillai", "Reddy", "Rao", "Naidu", "Krishnan", "Subramanian", "Hegde", "Gowda"],
    "north": ["Sharma", "Verma", "Gupta", "Singh", "Agarwal", "Mishra", "Yadav", "Chauhan", "Kapoor", "Malhotra", "Saxena"],
    "east": ["Das", "Bose", "Banerjee", "Chatterjee", "Mukherjee", "Ghosh", "Sen", "Dutta"],
    "any": ["Khan", "Sheikh", "Fernandes", "D'Souza", "Kaur", "Thomas", "Ali"],
}
MIDDLE_NORTH = ["Kumar", "Prasad", "Chandra", "Nath", "Lal"]

# City, state, region, Axis branch code, and real localities with their pincodes.
CITIES = [
    ("Mumbai", "Maharashtra", "west", "004", [("Andheri West", "400058"), ("Powai", "400076"), ("Bandra West", "400050"), ("Borivali West", "400092")]),
    ("Pune", "Maharashtra", "west", "015", [("Kothrud", "411038"), ("Hinjewadi", "411057"), ("Viman Nagar", "411014")]),
    ("Ahmedabad", "Gujarat", "west", "003", [("Navrangpura", "380009"), ("Satellite", "380015"), ("Bopal", "380058")]),
    ("Indore", "Madhya Pradesh", "west", "045", [("Vijay Nagar", "452010"), ("Palasia", "452001")]),
    ("Bengaluru", "Karnataka", "south", "009", [("Koramangala", "560034"), ("Indiranagar", "560038"), ("Whitefield", "560066"), ("Jayanagar", "560041")]),
    ("Chennai", "Tamil Nadu", "south", "006", [("Adyar", "600020"), ("T Nagar", "600017"), ("Velachery", "600042"), ("Anna Nagar", "600040")]),
    ("Hyderabad", "Telangana", "south", "008", [("Banjara Hills", "500034"), ("Madhapur", "500081"), ("Kukatpally", "500072")]),
    ("Kochi", "Kerala", "south", "112", [("Kakkanad", "682030"), ("Edappally", "682024")]),
    ("New Delhi", "Delhi", "north", "001", [("Saket", "110017"), ("Dwarka", "110075"), ("Rohini", "110085"), ("Lajpat Nagar", "110024")]),
    ("Gurugram", "Haryana", "north", "056", [("DLF Phase 2", "122002"), ("Sector 56", "122011")]),
    ("Noida", "Uttar Pradesh", "north", "062", [("Sector 62", "201309"), ("Sector 18", "201301")]),
    ("Jaipur", "Rajasthan", "north", "022", [("Malviya Nagar", "302017"), ("Vaishali Nagar", "302021")]),
    ("Lucknow", "Uttar Pradesh", "north", "037", [("Gomti Nagar", "226010"), ("Hazratganj", "226001")]),
    ("Chandigarh", "Chandigarh", "north", "027", [("Sector 17", "160017"), ("Sector 35", "160022")]),
    ("Kolkata", "West Bengal", "east", "005", [("Salt Lake", "700091"), ("Ballygunge", "700019"), ("New Town", "700156")]),
]
VEHICLE_STATE = {"Maharashtra": "MH", "Gujarat": "GJ", "Madhya Pradesh": "MP", "Karnataka": "KA", "Tamil Nadu": "TN",
                 "Telangana": "TS", "Kerala": "KL", "Delhi": "DL", "Haryana": "HR", "Uttar Pradesh": "UP",
                 "Rajasthan": "RJ", "Chandigarh": "CH", "West Bengal": "WB"}
BUILDINGS = ["Sai Krupa Apartments", "Green Park Residency", "Lakeview Towers", "Shanti Niketan CHS", "Royal Enclave",
             "Silver Oak Heights", "Gulmohar Society", "Sunrise Residency", "Prestige Meadows", "Ashirwad Apartments",
             "Kalpataru Enclave", "Brigade Gardens", "Vasant Vihar Society", "Orchid Residency", "Nandanvan Complex"]
STREETS = ["MG Road", "Station Road", "Main Road", "Ring Road", "Link Road", "Church Street", "Temple Street",
           "1st Cross", "2nd Main", "Gandhi Nagar", "Nehru Marg", "Park Street", "College Road", "Lake Road"]
EMPLOYERS = ["Infosys Ltd", "Tata Consultancy Services", "Wipro Ltd", "HCL Technologies", "Accenture Solutions",
             "Larsen & Toubro", "Reliance Retail", "Mahindra & Mahindra", "Asian Paints", "Hindustan Unilever",
             "Bajaj Auto", "Sun Pharma", "Apollo Hospitals", "State Government of Maharashtra", "Indian Railways",
             "Cognizant Technology Solutions", "Tech Mahindra", "Bharti Airtel", "Maruti Suzuki India", "ITC Ltd"]
BUSINESSES = ["Shree Ganesh Traders", "Balaji Enterprises", "New India Hardware", "Om Sai Medicals", "Royal Textiles",
              "Sri Lakshmi Agencies", "Classic Furniture", "City Auto Spares", "Fresh Mart Provisions", "Star Electricals"]
PROFESSIONS = ["Doctor", "Chartered Accountant", "Architect", "Lawyer", "Consultant", "Dentist"]
DOMAINS = [("gmail.com", 55), ("yahoo.co.in", 12), ("outlook.com", 10), ("rediffmail.com", 6), ("hotmail.com", 5)]


@dataclass
class Person:
    pid: str
    gender: str  # M or F
    first: str
    middle: str
    last: str
    dob: date
    pan: str
    aadhaar: str
    mobile: str
    email: str
    city: tuple
    locality: tuple
    address1: str
    address2: str
    occupation: str  # SALARIED, SELF_EMPLOYED_BUSINESS, SELF_EMPLOYED_PROFESSIONAL, RETIRED, HOMEMAKER, STUDENT
    employer: str
    income: int  # rupees a year
    marital: str  # S, M, W, D
    father: str
    spouse: str = ""
    ckyc: str = ""
    ids: dict = field(default_factory=dict)  # system -> [record IDs]

    @property
    def name(self):
        return " ".join(x for x in (self.first, self.middle, self.last) if x)

    @property
    def title(self):
        return "MR" if self.gender == "M" else ("MRS" if self.marital in ("M", "W") else "MS")


def _weighted(rng, pairs):
    total = sum(w for _, w in pairs)
    x = rng.uniform(0, total)
    for value, weight in pairs:
        x -= weight
        if x <= 0:
            return value
    return pairs[-1][0]


# Verhoeff check digit, as Aadhaar numbers use.
_D = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
      [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
      [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
      [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
_P = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
      [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
      [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]]
_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]


def verhoeff_digit(number):
    c = 0
    for i, d in enumerate(reversed(number)):
        c = _D[c][_P[(i + 1) % 8][int(d)]]
    return str(_INV[c])


def verhoeff_valid(number):
    c = 0
    for i, d in enumerate(reversed(number)):
        c = _D[c][_P[i % 8][int(d)]]
    return c == 0


def luhn_digit(number):
    total = 0
    for i, d in enumerate(reversed(number)):
        n = int(d)
        if i % 2 == 0:
            n *= 2
            n = n - 9 if n > 9 else n
        total += n
    return str((10 - total % 10) % 10)


def luhn_valid(number):
    return luhn_digit(number[:-1]) == number[-1]


def _pan(rng, last):
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    return ("".join(rng.choice(letters) for _ in range(3)) + "P" + last[0].upper()
            + f"{rng.randint(1, 9999):04d}" + rng.choice(letters))


def _aadhaar(rng):
    body = str(rng.randint(2, 9)) + "".join(str(rng.randint(0, 9)) for _ in range(10))
    return body + verhoeff_digit(body)


def _mobile(rng):
    return str(rng.choice("6789")) + "".join(str(rng.randint(0, 9)) for _ in range(9))


def _email(rng, first, last, dob, occupation, employer):
    f, l = first.lower(), last.lower().replace("'", "")
    if occupation == "SALARIED" and rng.random() < 0.15:
        company = employer.split()[0].lower().replace("&", "")
        return f"{f}.{l}@{company}.com"
    domain = _weighted(rng, DOMAINS)
    style = rng.randint(0, 4)
    local = [f"{f}.{l}", f"{f}{l}{dob.year % 100:02d}", f"{f}_{l}", f"{f[0]}{l}{rng.randint(1, 99)}", f"{f}.{l}{dob.day}"][style]
    return f"{local}@{domain}"


def _occupation(rng, age):
    if age >= 61:
        return _weighted(rng, [("RETIRED", 70), ("SELF_EMPLOYED_BUSINESS", 20), ("SELF_EMPLOYED_PROFESSIONAL", 10)])
    if age <= 23:
        return _weighted(rng, [("STUDENT", 40), ("SALARIED", 60)])
    return _weighted(rng, [("SALARIED", 58), ("SELF_EMPLOYED_BUSINESS", 20), ("SELF_EMPLOYED_PROFESSIONAL", 9),
                           ("HOMEMAKER", 8), ("RETIRED", 0), ("STUDENT", 0)] + [("SALARIED", 5)])


def _income(rng, occupation, age):
    base = {"SALARIED": (350_000, 3_000_000), "SELF_EMPLOYED_BUSINESS": (500_000, 6_000_000),
            "SELF_EMPLOYED_PROFESSIONAL": (900_000, 5_000_000), "RETIRED": (240_000, 900_000),
            "HOMEMAKER": (0, 0), "STUDENT": (0, 0)}[occupation]
    if base[1] == 0:
        return 0
    lo, hi = base
    seniority = min(max((age - 22) / 25, 0), 1)
    x = lo + (hi - lo) * (seniority * 0.6 + rng.random() * 0.4) ** 1.6
    return int(round(x / 10_000) * 10_000)


def _person(rng, n, region=None):
    gender = rng.choice("MF")
    city = rng.choice([c for c in CITIES if c[2] == region]) if region else rng.choice(CITIES)
    pool = SURNAMES[city[2]] if rng.random() < 0.75 else SURNAMES[rng.choice(list(SURNAMES))]
    last = rng.choice(pool)
    if last == "Kaur":
        gender = "F"
    first = rng.choice(MALE if gender == "M" else FEMALE)
    middle = ""
    if city[2] == "west" and rng.random() < 0.55:
        middle = rng.choice(MALE)  # father's name, as is usual in Maharashtra and Gujarat
    elif city[2] == "north" and gender == "M" and rng.random() < 0.25:
        middle = rng.choice(MIDDLE_NORTH)
    age = int(min(max(rng.gauss(40, 12.5), 21), 75))
    dob = TODAY - timedelta(days=age * 365 + rng.randint(0, 364))
    occupation = _occupation(rng, age)
    employer = (rng.choice(EMPLOYERS) if occupation == "SALARIED" else rng.choice(BUSINESSES)
                if occupation == "SELF_EMPLOYED_BUSINESS" else rng.choice(PROFESSIONS)
                if occupation == "SELF_EMPLOYED_PROFESSIONAL" else "")
    married = age > 27 and rng.random() < 0.78
    marital = "M" if married else ("W" if age > 60 and rng.random() < 0.15 else "S")
    locality = rng.choice(city[4])
    flat = rng.choice([f"Flat {rng.randint(1, 15)}0{rng.randint(1, 8)}", f"House No {rng.randint(1, 420)}",
                       f"Plot {rng.randint(1, 160)}", f"B-{rng.randint(1, 30)}{rng.randint(0, 9)}"])
    address1 = f"{flat}, {rng.choice(BUILDINGS)}" if flat.startswith(("Flat", "B-")) else f"{flat}, {rng.choice(STREETS)}"
    address2 = f"{rng.choice(STREETS)}, {locality[0]}"
    spouse = ""
    if married:
        spouse = rng.choice(FEMALE if gender == "M" else MALE) + " " + last
    p = Person(pid=f"P{n:04d}", gender=gender, first=first, middle=middle, last=last, dob=dob, pan=_pan(rng, last),
               aadhaar=_aadhaar(rng), mobile=_mobile(rng), email="", city=city, locality=locality, address1=address1,
               address2=address2, occupation=occupation, employer=employer, income=_income(rng, occupation, age),
               marital=marital, father=f"{rng.choice(MALE)} {last}", spouse=spouse,
               ckyc="".join(str(rng.randint(0, 9)) for _ in range(14)))
    p.email = _email(rng, first, last, dob, occupation, employer)
    return p


def _day(rng, start, end):
    """A random date from start to end (both included)."""
    if end <= start:
        return start
    return start + timedelta(days=rng.randint(0, (end - start).days))


def _stamp(rng, day):
    return datetime(day.year, day.month, day.day, rng.randint(9, 19), rng.randint(0, 59), rng.randint(0, 59))


def _years(d, years):
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # 29 February
        return d.replace(year=d.year + years, day=28)


def _months(d, months):
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(d.day, 28))


def ifsc(city):
    return f"UTIB0000{city[3]}"


def emi(principal, annual_rate, months):
    r = annual_rate / 1200
    if r == 0:
        return round(principal / months, 2)
    return round(principal * r * (1 + r) ** months / ((1 + r) ** months - 1), 2)


# ---------------------------------------------------------------- the three systems

@dataclass
class Table:
    columns: list  # [(name, SQL type)]
    rows: list = field(default_factory=list)

    @property
    def names(self):
        return [c for c, _ in self.columns]


class AxisBank:
    """Builds all three systems at once, so they agree with each other; build() returns them with the answer key."""

    def __init__(self, seed=SEED):
        self.rng = random.Random(seed)
        self.issues = {}
        self.conflicts = {}  # person id -> "pan" or "dob"
        self.people = []
        self.flexcube = {}
        self.finone = {}
        self.vx = {}

    def note(self, issue, count=1):
        self.issues[issue] = self.issues.get(issue, 0) + count

    def build(self):
        rng = self.rng
        self.people = [_person(rng, i + 1) for i in range(FLEXCUBE_CUSTOMERS)]
        self._flexcube()
        bank_people = list(self.people)
        borrowers = [p for p in bank_people if p.occupation in ("SALARIED", "SELF_EMPLOYED_BUSINESS",
                                                                  "SELF_EMPLOYED_PROFESSIONAL") and 23 <= self._age(p) <= 60]
        rng.shuffle(borrowers)
        loan_new = [_person(rng, FLEXCUBE_CUSTOMERS + i + 1) for i in range(FINONE_NEW)]
        for p in loan_new:
            if p.occupation not in ("SALARIED", "SELF_EMPLOYED_BUSINESS", "SELF_EMPLOYED_PROFESSIONAL"):
                p.occupation, p.employer = "SALARIED", rng.choice(EMPLOYERS)
                p.income = _income(rng, "SALARIED", self._age(p))
        self.people += loan_new
        self._finone(borrowers[:FINONE_SHARED], loan_new)
        earners = [p for p in bank_people if p.income >= 300_000]
        rng.shuffle(earners)
        card_new = [_person(rng, FLEXCUBE_CUSTOMERS + FINONE_NEW + i + 1) for i in range(VX_NEW)]
        for p in card_new:
            if p.income < 300_000:
                p.occupation, p.employer = "SALARIED", rng.choice(EMPLOYERS)
                p.income = max(_income(rng, "SALARIED", self._age(p)), 400_000)
        self.people += card_new
        self._vx(earners[:VX_SHARED], card_new)
        return self.flexcube, self.finone, self.vx

    @staticmethod
    def _age(p):
        return (TODAY - p.dob).days // 365

    # ------------------------------------------------ FLEXCUBE

    def _flexcube(self):
        rng = self.rng
        T = {
            "sttm_customer": Table([
                ("customer_no", "varchar(9) PRIMARY KEY"), ("customer_type", "char(1)"), ("customer_name1", "varchar(105)"),
                ("short_name", "varchar(20)"), ("address_line1", "varchar(105)"), ("address_line2", "varchar(105)"),
                ("address_line3", "varchar(105)"), ("address_line4", "varchar(105)"), ("pincode", "varchar(10)"),
                ("country", "char(2)"), ("nationality", "char(2)"), ("language", "char(3)"), ("local_branch", "char(3)"),
                ("customer_category", "varchar(10)"), ("unique_id_name", "varchar(20)"), ("unique_id_value", "varchar(20)"),
                ("frozen", "char(1)"), ("deceased", "char(1)"), ("whereabouts_unknown", "char(1)"),
                ("cif_creation_date", "date"), ("record_stat", "char(1)"), ("auth_stat", "char(1)"), ("mod_no", "integer"),
                ("maker_id", "varchar(12)"), ("maker_dt_stamp", "timestamp"), ("checker_id", "varchar(12)"),
                ("checker_dt_stamp", "timestamp")]),
            "sttm_cust_personal": Table([
                ("customer_no", "varchar(9) PRIMARY KEY"), ("customer_prefix", "varchar(5)"), ("first_name", "varchar(35)"),
                ("middle_name", "varchar(35)"), ("last_name", "varchar(35)"), ("date_of_birth", "date"), ("sex", "char(1)"),
                ("marital_status", "char(1)"), ("fathers_name", "varchar(70)"), ("spouse_name", "varchar(70)"),
                ("mobile_isd_code", "varchar(5)"), ("mobile_number", "varchar(15)"), ("telephone", "varchar(15)"),
                ("e_mail", "varchar(100)"), ("resident_status", "char(1)"), ("passport_no", "varchar(15)"),
                ("occupation", "varchar(30)"), ("employer_name", "varchar(70)"), ("annual_income", "numeric(15,2)")]),
            "sttm_cust_kyc": Table([
                ("customer_no", "varchar(9)"), ("document_type", "varchar(10)"), ("document_no", "varchar(20)"),
                ("verified", "char(1)"), ("verified_date", "date"), ("ckyc_number", "varchar(14)"),
                ("risk_category", "varchar(6)"), ("next_review_date", "date")]),
            "sttm_cust_account": Table([
                ("cust_ac_no", "varchar(15) PRIMARY KEY"), ("branch_code", "char(3)"), ("cust_no", "varchar(9)"),
                ("ccy", "char(3)"), ("account_class", "varchar(6)"), ("ac_desc", "varchar(60)"), ("ac_open_date", "date"),
                ("mode_of_operation", "varchar(25)"), ("joint_holder_cif", "varchar(9)"), ("ifsc_code", "char(11)"),
                ("ac_stat_dormant", "char(1)"), ("ac_stat_frozen", "char(1)"), ("ac_stat_no_dr", "char(1)"),
                ("nominee_available", "char(1)"), ("cheque_book_facility", "char(1)"), ("atm_facility", "char(1)"),
                ("date_last_cr_activity", "date"), ("date_last_dr_activity", "date"), ("record_stat", "char(1)"),
                ("auth_stat", "char(1)")]),
            "actb_accbal": Table([
                ("cust_ac_no", "varchar(15) PRIMARY KEY"), ("branch_code", "char(3)"), ("acy_curr_balance", "numeric(18,2)"),
                ("acy_avl_bal", "numeric(18,2)"), ("acy_blocked_amount", "numeric(18,2)"), ("acy_uncollected", "numeric(18,2)"),
                ("acy_accrued_cr_ic", "numeric(18,2)"), ("balance_as_of", "date")]),
            "sttm_ac_nominee": Table([
                ("cust_ac_no", "varchar(15)"), ("nominee_no", "integer"), ("nominee_name", "varchar(70)"),
                ("relationship", "varchar(15)"), ("nominee_dob", "date"), ("share_pct", "numeric(5,2)"), ("minor", "char(1)")]),
            "actb_history": Table([
                ("trn_ref_no", "varchar(16)"), ("ac_no", "varchar(15)"), ("ac_branch", "char(3)"), ("trn_dt", "date"),
                ("value_dt", "date"), ("drcr_ind", "char(1)"), ("trn_code", "char(3)"), ("lcy_amount", "numeric(18,2)"),
                ("narration", "varchar(105)"), ("user_id", "varchar(12)")]),
        }
        self.flexcube = T
        used = set()

        def new_cif():
            while True:
                cif = f"{rng.randint(10_000_000, 99_999_999)}"
                cif = str(rng.choice([1, 2, 9])) + cif
                if cif not in used:
                    used.add(cif)
                    return cif

        n = len(self.people)
        # Fixed rates of real-life problems, chosen once.
        pick = lambda k: set(rng.sample(range(n), k))  # noqa: E731
        no_email, bad_email = pick(round(n * 0.05)), pick(round(n * 0.01))
        zero_mobile, placeholder_dob = pick(round(n * 0.015)), pick(round(n * 0.01))
        pan_typo, unauthorised = pick(round(n * 0.01)), pick(round(n * 0.01))
        duplicate = pick(4)

        acct_seq = 0
        for i, p in enumerate(self.people):
            copies = 2 if i in duplicate else 1
            for copy in range(copies):
                cif = new_cif()
                p.ids.setdefault("flexcube", []).append(cif)
                age18 = _years(p.dob, 18)
                created = _day(rng, max(age18, date(2008, 4, 1)), TODAY - timedelta(days=200))
                if copy == 1:
                    created = _day(rng, created, TODAY - timedelta(days=30))
                    self.note("FLEXCUBE: same person created twice under two CIFs")
                branch_city = p.city if copy == 0 else rng.choice(CITIES)
                maker = f"BR{branch_city[3]}MK{rng.randint(1, 2)}"
                made = _stamp(rng, created)
                pan = p.pan
                if i in pan_typo and copy == 0:
                    pan = pan[:5] + pan[5:9].replace("0", "O", 1).replace("1", "I", 1) + pan[9]
                    if pan == p.pan:
                        pan = pan[:9] + "0"
                    self.note("FLEXCUBE: PAN typed wrongly (letter for digit or digit for letter)")
                mobile = p.mobile
                if i in zero_mobile and copy == 0:
                    mobile = "0" + mobile
                    self.note("FLEXCUBE: mobile with a leading 0 (11 digits)")
                email = p.email
                if i in no_email and copy == 0:
                    email = None
                    self.note("FLEXCUBE: email missing")
                elif i in bad_email and copy == 0:
                    email = email.replace("@", "", 1) if rng.random() < 0.5 else email.replace(".", ",", 1)
                    self.note("FLEXCUBE: email badly formed")
                dob = p.dob
                if i in placeholder_dob and copy == 0:
                    dob = date(1900, 1, 1)
                    self.note("FLEXCUBE: placeholder date of birth 1900-01-01")
                senior = self._age(p) >= 60
                category = "SENIOR" if senior else "INDIVIDUAL"
                if p.occupation in ("SELF_EMPLOYED_BUSINESS",) and rng.random() < 0.15:
                    category = "PRIORITY"
                auth = "U" if i in unauthorised and copy == 0 else "A"
                if auth == "U":
                    self.note("FLEXCUBE: customer created but not yet authorised (auth_stat U)")
                short = (p.first[0] + " " + p.last).upper()[:20]
                T["sttm_customer"].rows.append([
                    cif, "I", p.name.upper(), short, p.address1, p.address2, p.locality[0], f"{p.city[0]}, {p.city[1]}",
                    p.locality[1], "IN", "IN", "ENG", branch_city[3], category, "PAN", pan, "N", "N", "N", created, "O", auth,
                    rng.randint(1, 6), maker, made, None if auth == "U" else maker.replace("MK", "CK"),
                    None if auth == "U" else made + timedelta(minutes=rng.randint(5, 240))])
                T["sttm_cust_personal"].rows.append([
                    cif, p.title, p.first, p.middle or None, p.last, dob, p.gender, p.marital, p.father, p.spouse or None,
                    "+91", mobile, None if rng.random() < 0.85 else f"0{rng.randint(20, 80)}{rng.randint(2_000_000, 8_999_999)}",
                    email, "R", (f"{rng.choice('JKLMNPRSTUVWZ')}{rng.randint(1_000_000, 9_999_999)}" if rng.random() < 0.12 else None),
                    p.occupation, p.employer or None, p.income])
                verified = created + timedelta(days=rng.randint(0, 3))
                risk = _weighted(rng, [("LOW", 78), ("MEDIUM", 18), ("HIGH", 4)])
                review = _years(verified, {"LOW": 10, "MEDIUM": 8, "HIGH": 2}[risk])
                T["sttm_cust_kyc"].rows += [
                    [cif, "PAN", pan, "Y", verified, p.ckyc, risk, review],
                    [cif, "AADHAAR", p.aadhaar, "Y", verified, p.ckyc, risk, review],
                ]
                if copy == 1:
                    continue  # the second CIF has KYC but its accounts were never opened
                # Accounts: a savings account for nearly everyone, a current account for businesses.
                classes = []
                if p.occupation == "SELF_EMPLOYED_BUSINESS":
                    classes.append(("CAREG", "Current Account - Business"))
                    if rng.random() < 0.6:
                        classes.append(("SBREG", "Savings Account - Regular"))
                else:
                    if p.occupation == "SALARIED" and rng.random() < 0.55:
                        classes.append(("SBSAL", "Savings Account - Salary"))
                    elif senior:
                        classes.append(("SBSNR", "Savings Account - Senior Citizen"))
                    else:
                        classes.append(("SBREG", "Savings Account - Regular"))
                    if p.income > 1_500_000 and rng.random() < 0.25:
                        classes.append(("SBPRI", "Savings Account - Priority"))
                for code, desc in classes:
                    acct_seq += 1
                    opened = _day(rng, created, min(created + timedelta(days=900), TODAY - timedelta(days=60)))
                    number = f"9{opened.year % 100:02d}{'020' if code.startswith('CA') else '010'}{rng.randint(100_000_000, 999_999_999)}"
                    p.ids.setdefault("accounts", []).append(number)
                    dormant = rng.random() < 0.07 and opened < TODAY - timedelta(days=900)
                    last_cr = _day(rng, TODAY - timedelta(days=1100), TODAY - timedelta(days=740)) if dormant else _day(rng, TODAY - timedelta(days=40), TODAY)
                    last_dr = last_cr - timedelta(days=rng.randint(0, 20)) if dormant else _day(rng, TODAY - timedelta(days=20), TODAY)
                    joint = None
                    mode = "SINGLE"
                    if p.marital == "M" and code.startswith("SB") and rng.random() < 0.12:
                        mode = "EITHER OR SURVIVOR"
                    nominee = "Y" if code.startswith("SB") and rng.random() < 0.8 else "N"
                    T["sttm_cust_account"].rows.append([
                        number, p.city[3], cif, "INR", code, desc, opened, mode, joint, ifsc(p.city),
                        "Y" if dormant else "N", "Y" if rng.random() < 0.005 else "N", "N", nominee,
                        "Y" if code.startswith("CA") or rng.random() < 0.7 else "N", "Y", last_cr, last_dr, "O", "A"])
                    if code.startswith("CA"):
                        balance = round(rng.lognormvariate(12.6, 1.0), 2)
                    elif dormant:
                        balance = round(rng.uniform(150, 4500), 2)
                    else:
                        balance = round(min(rng.lognormvariate(11.0, 1.1) * (1 + p.income / 2_000_000), 4_500_000), 2)
                    blocked = round(rng.choice([0, 0, 0, 0, 0, 0, 0, 2500, 10000]) * 1.0, 2)
                    uncollected = round(rng.choice([0] * 12 + [rng.uniform(1000, 50000)]), 2)
                    accrued = round(balance * 0.03 * rng.randint(1, 80) / 365, 2) if code.startswith("SB") else 0
                    T["actb_accbal"].rows.append([number, p.city[3], balance, round(balance - blocked - uncollected, 2),
                                                  blocked, uncollected, accrued, TODAY])
                    if nominee == "Y":
                        rel, name, ndob = self._nominee(p)
                        T["sttm_ac_nominee"].rows.append([number, 1, name, rel, ndob, 100.00,
                                                          "Y" if (TODAY - ndob).days < 18 * 365 else "N"])
                    if not dormant:
                        self._transactions(T["actb_history"], p, number, code)

    def _nominee(self, p):
        rng = self.rng
        if p.spouse and rng.random() < 0.7:
            gap = rng.randint(-6, 3) if p.gender == "F" else rng.randint(-3, 6)
            return ("SPOUSE", p.spouse, p.dob + timedelta(days=gap * 365 + rng.randint(0, 200)))
        age = self._age(p)
        if age > 45 and rng.random() < 0.7:
            child = rng.choice(MALE + FEMALE)
            return ("SON" if child in MALE else "DAUGHTER", f"{child} {p.last}",
                    _day(rng, p.dob + timedelta(days=24 * 365), p.dob + timedelta(days=36 * 365)))
        parent = rng.choice(["FATHER", "MOTHER"])
        name = p.father if parent == "FATHER" else f"{rng.choice(FEMALE)} {p.last}"
        return (parent, name, p.dob - timedelta(days=rng.randint(23, 34) * 365))

    def _transactions(self, table, p, number, code):
        rng = self.rng
        merchants = ["SWIGGY", "ZOMATO", "AMAZON PAY", "BIGBASKET", "RELIANCE SMART", "DMART", "UBER INDIA", "IRCTC",
                     "BHARAT PETROLEUM", "APOLLO PHARMACY", "AIRTEL PAYMENTS", "TATA PLAY"]
        days = sorted(_day(rng, TODAY - timedelta(days=90), TODAY) for _ in range(rng.randint(6, 12)))
        for k, d in enumerate(days):
            ref = f"{p.city[3]}{d:%y%j}{rng.randint(10_000_000, 99_999_999)}"[:16]
            kind = rng.random()
            if code == "SBSAL" and d.day <= 2 and kind < 0.9:
                row = ("C", "SAL", round(p.income / 12 * rng.uniform(0.92, 1.0), 2), f"NEFT-SALARY-{p.employer.upper()[:40]}")
            elif kind < 0.45:
                m = rng.choice(merchants)
                row = ("D", "UPI", round(rng.uniform(80, 4500), 2), f"UPI/P2M/{rng.randint(10**11, 10**12 - 1)}/{m}")
            elif kind < 0.6:
                row = ("D", "ATM", float(rng.choice([500, 1000, 2000, 5000, 10000])), f"ATM-WDL/{p.city[0].upper()}/{p.locality[0].upper()}")
            elif kind < 0.72:
                row = ("C", "IMP", round(rng.uniform(500, 25000), 2), f"IMPS/P2A/{rng.randint(10**11, 10**12 - 1)}/{rng.choice(MALE + FEMALE).upper()}")
            elif kind < 0.82:
                row = ("D", "POS", round(rng.uniform(300, 15000), 2), f"POS/{rng.choice(merchants)}/{p.city[0].upper()}")
            elif kind < 0.9 and code.startswith("CA"):
                row = ("C", "CHQ", round(rng.uniform(5000, 250000), 2), f"CLG/CHQ {rng.randint(100000, 999999)}/{rng.choice(BUSINESSES).upper()}")
            elif kind < 0.95:
                row = ("D", "BIL", round(rng.uniform(300, 6000), 2), f"BILLPAY/{rng.choice(['BESCOM', 'MSEDCL', 'TATA POWER', 'ADANI ELEC', 'BSNL'])}")
            else:
                row = ("C", "INT", round(rng.uniform(20, 900), 2), "INT.PD:01-07-2026 TO 30-09-2026")
            table.rows.append([ref, number, p.city[3], d, d, row[0], row[1], row[2], row[3], "SYSTEM" if row[1] in ("INT", "SAL") else "ONLINE"])

    # ------------------------------------------------ FINONE

    def _finone(self, shared, new):
        rng = self.rng
        T = {
            "los_customer": Table([
                ("customer_id", "varchar(12) PRIMARY KEY"), ("cif_no", "varchar(9)"), ("salutation", "varchar(5)"),
                ("first_name", "varchar(40)"), ("middle_name", "varchar(40)"), ("last_name", "varchar(40)"),
                ("date_of_birth", "date"), ("gender", "varchar(6)"), ("marital_status", "varchar(10)"),
                ("pan_no", "varchar(10)"), ("aadhaar_ref", "varchar(12)"), ("mobile_no", "varchar(13)"),
                ("email_id", "varchar(100)"), ("qualification", "varchar(20)"), ("occupation_type", "varchar(30)"),
                ("employer_name", "varchar(80)"), ("monthly_income", "numeric(12,2)"), ("cibil_score", "integer"),
                ("customer_category", "varchar(10)"), ("created_date", "timestamp"), ("last_modified_date", "timestamp")]),
            "los_address": Table([
                ("customer_id", "varchar(12)"), ("address_type", "varchar(10)"), ("address_line1", "varchar(120)"),
                ("address_line2", "varchar(120)"), ("landmark", "varchar(60)"), ("city", "varchar(40)"),
                ("state", "varchar(40)"), ("pincode", "char(6)"), ("years_at_address", "integer"), ("is_mailing", "char(1)")]),
            "los_application": Table([
                ("application_id", "varchar(16) PRIMARY KEY"), ("customer_id", "varchar(12)"), ("product_code", "varchar(4)"),
                ("scheme_name", "varchar(60)"), ("loan_amount_requested", "numeric(14,2)"), ("tenure_requested", "integer"),
                ("application_date", "date"), ("sourcing_channel", "varchar(10)"), ("branch_code", "char(3)"),
                ("stage", "varchar(12)"), ("sanction_amount", "numeric(14,2)"), ("sanction_date", "date"),
                ("rejection_reason", "varchar(60)"), ("co_applicant_id", "varchar(12)")]),
            "lms_loan_account": Table([
                ("loan_account_no", "varchar(16) PRIMARY KEY"), ("application_id", "varchar(16)"), ("customer_id", "varchar(12)"),
                ("product_code", "varchar(4)"), ("disbursal_amount", "numeric(14,2)"), ("disbursal_date", "date"),
                ("interest_rate", "numeric(5,2)"), ("tenure_months", "integer"), ("emi_amount", "numeric(12,2)"),
                ("first_emi_date", "date"), ("maturity_date", "date"), ("principal_outstanding", "numeric(14,2)"),
                ("overdue_amount", "numeric(12,2)"), ("dpd", "integer"), ("asset_classification", "varchar(8)"),
                ("loan_status", "varchar(8)"), ("repayment_mode", "varchar(5)"), ("repayment_account_no", "varchar(15)"),
                ("repayment_ifsc", "char(11)")]),
            "lms_repayment_schedule": Table([
                ("loan_account_no", "varchar(16)"), ("instalment_no", "integer"), ("due_date", "date"),
                ("emi_amount", "numeric(12,2)"), ("principal_component", "numeric(12,2)"), ("interest_component", "numeric(12,2)"),
                ("opening_principal", "numeric(14,2)"), ("paid_date", "date"), ("paid_amount", "numeric(12,2)"),
                ("status", "varchar(8)")]),
            "los_collateral": Table([
                ("collateral_id", "varchar(14) PRIMARY KEY"), ("application_id", "varchar(16)"), ("collateral_type", "varchar(10)"),
                ("description", "varchar(160)"), ("market_value", "numeric(14,2)"), ("ltv_pct", "numeric(5,2)"),
                ("registration_no", "varchar(20)"), ("valuation_date", "date")]),
        }
        self.finone = T
        PRODUCTS = [("HL", "Home Loan", 28, (1_500_000, 12_000_000), (180, 300), (8.6, 9.6)),
                    ("PL", "Personal Loan", 30, (50_000, 1_500_000), (12, 60), (10.5, 16.0)),
                    ("AL", "Auto Loan - New Car", 20, (400_000, 2_000_000), (36, 84), (8.9, 11.0)),
                    ("LAP", "Loan Against Property", 8, (1_000_000, 8_000_000), (84, 180), (9.5, 11.5)),
                    ("EDU", "Education Loan", 6, (300_000, 2_500_000), (60, 120), (9.0, 12.5)),
                    ("TW", "Two Wheeler Loan", 8, (60_000, 200_000), (12, 36), (11.0, 16.0))]
        CARS = ["Maruti Suzuki Swift VXI", "Hyundai Creta SX", "Tata Nexon XZ+", "Mahindra XUV700 AX5", "Honda City V",
                "Kia Seltos HTK", "Toyota Innova Crysta GX", "Maruti Suzuki Baleno Zeta", "Tata Punch Adventure"]
        BIKES = ["Honda Activa 6G", "Hero Splendor Plus", "TVS Jupiter", "Bajaj Pulsar 150", "Royal Enfield Classic 350"]
        everyone = [(p, True) for p in shared] + [(p, False) for p in new]
        rng.shuffle(everyone)
        n = len(everyone)
        pick = lambda k: set(rng.sample(range(n), k))  # noqa: E731
        no_cif = pick(round(FINONE_SHARED * 0.2))
        short_name, initials = pick(round(n * 0.25)), pick(round(n * 0.05))
        new_mobile, new_email, moved = pick(round(n * 0.12)), pick(round(n * 0.10)), pick(round(n * 0.18))
        no_pan = pick(round(n * 0.04))
        conflict_dob = {rng.choice([k for k, (_, b) in enumerate(everyone) if b])}  # a bank customer
        seq = 0
        for i, (p, bank) in enumerate(everyone):
            seq += 1
            cid = f"FN{30_000_000 + seq * 97 + rng.randint(0, 96)}"
            p.ids.setdefault("finone", []).append(cid)
            cif = p.ids["flexcube"][0] if bank and i not in no_cif else None
            if bank and i in no_cif:
                self.note("FINONE: existing bank customer without the CIF number")
            first, middle, last = p.first, p.middle, p.last
            if i in short_name and middle:
                middle = ""
                self.note("FINONE: middle name left out")
            if i in initials:
                first = p.first[0] + "."
                self.note("FINONE: first name written as an initial")
            mobile = p.mobile
            if i in new_mobile:
                mobile = _mobile(rng)
                self.note("FINONE: newer mobile than in FLEXCUBE")
            email = p.email
            if i in new_email:
                email = _email(rng, p.first, p.last, p.dob, p.occupation, p.employer)
                self.note("FINONE: different email than in FLEXCUBE")
            dob = p.dob
            if i in conflict_dob and bank:
                dob = p.dob.replace(year=p.dob.year + 1)
                self.conflicts[p.pid] = "dob"
                self.note("FINONE: date of birth differs from FLEXCUBE (one year apart)")
            pan = None if i in no_pan else p.pan
            if pan is None:
                self.note("FINONE: PAN not captured")
            cibil = int(min(max(rng.gauss(752, 45), 610), 880))
            created = _stamp(rng, _day(rng, TODAY - timedelta(days=2400), TODAY - timedelta(days=45)))
            modified = created + timedelta(days=rng.randint(0, (TODAY - created.date()).days))
            T["los_customer"].rows.append([
                cid, cif, p.title, first, middle or None, last, dob, {"M": "MALE", "F": "FEMALE"}[p.gender],
                {"M": "MARRIED", "S": "SINGLE", "W": "WIDOWED", "D": "DIVORCED"}[p.marital], pan,
                "XXXXXXXX" + p.aadhaar[-4:], "+91" + mobile if rng.random() < 0.35 else mobile, email,
                rng.choice(["GRADUATE", "POST_GRADUATE", "PROFESSIONAL", "DIPLOMA"]), p.occupation, p.employer or None,
                round(p.income / 12, 2), cibil, "ETB" if bank else "NTB", created, modified])
            # Addresses: current (moved for some), permanent, and office for the salaried.
            city, locality, a1, a2 = p.city, p.locality, p.address1, p.address2
            if i in moved:
                locality = rng.choice([x for x in city[4] if x != p.locality] or city[4])
                a1 = f"Flat {rng.randint(1, 20)}0{rng.randint(1, 6)}, {rng.choice(BUILDINGS)}"
                a2 = f"{rng.choice(STREETS)}, {locality[0]}"
                self.note("FINONE: current address newer than in FLEXCUBE")
            T["los_address"].rows.append([cid, "CURRENT", a1, a2, None, city[0], city[1], locality[1],
                                          rng.randint(1, 12), "Y"])
            home = rng.choice(CITIES) if rng.random() < 0.35 else city
            home_loc = rng.choice(home[4])
            T["los_address"].rows.append([cid, "PERMANENT", f"House No {rng.randint(1, 300)}, {rng.choice(STREETS)}",
                                          home_loc[0], None, home[0], home[1], home_loc[1], rng.randint(10, 40), "N"])
            if p.occupation == "SALARIED":
                office = rng.choice(city[4])
                T["los_address"].rows.append([cid, "OFFICE", f"{p.employer}, {rng.choice(['Tower A', 'Block B', 'IT Park', 'Business Bay'])}",
                                              office[0], None, city[0], city[1], office[1], None, "N"])
            # One application, sometimes an older one too.
            apps = 2 if rng.random() < 0.22 else 1
            for a in range(apps):
                code, scheme, _, (lo, hi), (t_lo, t_hi), (r_lo, r_hi) = _weighted(rng, [(x, x[2]) for x in PRODUCTS])
                if code == "EDU" and self._age(p) > 35:
                    code, scheme, _, (lo, hi), (t_lo, t_hi), (r_lo, r_hi) = PRODUCTS[1]
                cap = p.income * {"HL": 6, "LAP": 5, "PL": 1.2, "AL": 1.5, "EDU": 3, "TW": 1}[code]
                amount = round(min(rng.uniform(lo, hi), max(cap, lo)) / 1000) * 1000
                tenure = rng.randrange(t_lo, t_hi + 1, 12) if t_hi - t_lo >= 12 else t_lo
                applied = _day(rng, max(created.date(), TODAY - timedelta(days=2300)), TODAY - timedelta(days=15))
                if a == 1:
                    applied = _day(rng, created.date(), applied)
                stage = _weighted(rng, [("DISBURSED", 84), ("REJECTED", 8), ("SANCTIONED", 4), ("CANCELLED", 4)])
                if applied > TODAY - timedelta(days=40) and stage == "DISBURSED":
                    stage = "SANCTIONED"
                app_id = f"APP{applied:%Y%m%d}{seq:04d}{a}"
                reason = None
                sanction = sanction_date = None
                if stage == "REJECTED":
                    reason = rng.choice(["CIBIL BELOW POLICY", "INCOME NOT ELIGIBLE", "FOIR EXCEEDED", "DOCUMENTS INCOMPLETE"])
                elif stage in ("SANCTIONED", "DISBURSED", "CANCELLED"):
                    sanction = round(amount * rng.choice([1, 1, 1, 0.9, 0.8]) / 1000) * 1000
                    sanction_date = applied + timedelta(days=rng.randint(2, 12))
                co = None
                T["los_application"].rows.append([
                    app_id, cid, code, scheme, amount, tenure, applied, _weighted(rng, [("BRANCH", 45), ("DSA", 30), ("DIGITAL", 25)]),
                    city[3], stage, sanction, sanction_date, reason, co])
                if code in ("HL", "LAP", "AL", "TW") and stage != "REJECTED":
                    cid_no = f"COL{applied:%y%m}{seq:05d}{a}"
                    if code in ("HL", "LAP"):
                        loc = rng.choice(city[4])
                        value = round((sanction or amount) / rng.uniform(0.6, 0.8) / 10000) * 10000
                        desc = f"Residential flat, {rng.randint(650, 1800)} sq ft, {rng.choice(BUILDINGS)}, {loc[0]}, {city[0]} {loc[1]}"
                        reg = f"{VEHICLE_STATE[city[1]]}/SRO/{rng.randint(1000, 9999)}/{applied.year}"
                    else:
                        model = rng.choice(CARS if code == "AL" else BIKES)
                        value = round((sanction or amount) / rng.uniform(0.8, 0.9) / 1000) * 1000
                        desc = model
                        reg = f"{VEHICLE_STATE[city[1]]}{rng.randint(1, 50):02d}{rng.choice('ABCDEFGHJKLMNPRSTUVWXYZ')}{rng.choice('ABCDEFGHJKLMNPRSTUVWXYZ')}{rng.randint(1, 9999):04d}"
                    T["los_collateral"].rows.append([cid_no, app_id, "PROPERTY" if code in ("HL", "LAP") else "VEHICLE",
                                                     desc, value, round(100 * (sanction or amount) / value, 2), reg,
                                                     (sanction_date or applied)])
                if stage != "DISBURSED":
                    continue
                rate = round(rng.uniform(r_lo, r_hi), 2)
                disbursed = sanction_date + timedelta(days=rng.randint(1, 20))
                first_emi = _months(disbursed.replace(day=5) if disbursed.day < 20 else disbursed, 1).replace(day=5)
                instalment = emi(sanction, rate, tenure)
                maturity = _months(first_emi, tenure - 1)
                number = f"{code}{city[3]}{disbursed:%y}{rng.randint(10_000_000, 99_999_999)}"[:16]
                p.ids.setdefault("loans", []).append(number)
                due_so_far = sum(1 for k in range(tenure) if _months(first_emi, k) <= TODAY)
                dpd = _weighted(rng, [(0, 88), (rng.randint(1, 30), 6), (rng.randint(31, 60), 3), (rng.randint(61, 90), 2), (rng.randint(91, 200), 1)])
                closed = due_so_far >= tenure
                if closed:
                    dpd = 0
                missed = 0 if dpd == 0 else min(due_so_far, (dpd + 29) // 30)
                principal = sanction
                schedule = []
                r = rate / 1200
                for k in range(min(due_so_far + 3, tenure)):
                    interest = round(principal * r, 2)
                    part = round(min(instalment - interest, principal), 2)
                    due = _months(first_emi, k)
                    paid = k < due_so_far - missed
                    schedule.append([number, k + 1, due, instalment, part, interest, round(principal, 2),
                                     due + timedelta(days=rng.choice([0, 0, 0, 1, 2])) if paid else None,
                                     instalment if paid else None,
                                     "PAID" if paid else ("OVERDUE" if due <= TODAY else "DUE")])
                    principal = max(principal - part, 0)
                unpaid = due_so_far - missed  # the first instalment not yet paid
                outstanding = 0 if closed else (schedule[unpaid][6] if unpaid < len(schedule) else round(principal, 2))
                # keep the last 12 instalments that fell due, and the next 3
                T["lms_repayment_schedule"].rows += schedule[max(0, due_so_far - 12):]
                bucket = ("STANDARD" if dpd == 0 else "SMA-0" if dpd <= 30 else "SMA-1" if dpd <= 60
                          else "SMA-2" if dpd <= 90 else "NPA")
                if bucket != "STANDARD":
                    self.note(f"FINONE: loan {bucket} (days past due)")
                repay_account = p.ids.get("accounts", [None])[0] if bank else None
                T["lms_loan_account"].rows.append([
                    number, app_id, cid, code, sanction, disbursed, rate, tenure, instalment, first_emi, maturity,
                    outstanding, round(missed * instalment, 2), dpd, bucket, "CLOSED" if closed else "ACTIVE",
                    "NACH" if repay_account or rng.random() < 0.6 else "SI", repay_account,
                    ifsc(p.city) if repay_account else f"{rng.choice(['HDFC', 'ICIC', 'SBIN', 'KKBK'])}0{rng.randint(1000, 9999):06d}"])

    # ------------------------------------------------ VX (credit cards)

    def _vx(self, shared, new):
        rng = self.rng
        cardholders, accounts, cards, statements = [], [], [], []
        self.vx = {"cardholders": cardholders, "card_accounts": accounts, "cards": cards, "statements": statements}
        PRODUCTS = [("PLATINUM", 50_000, 250_000, 499), ("REWARDS", 75_000, 400_000, 999), ("CASHBACK", 40_000, 300_000, 499),
                    ("SIGNATURE", 300_000, 1_000_000, 2999), ("TRAVEL", 200_000, 800_000, 1999), ("PRIVILEGE", 500_000, 1_500_000, 4999)]
        everyone = [(p, True) for p in shared] + [(p, False) for p in new]
        rng.shuffle(everyone)
        n = len(everyone)
        pick = lambda k: set(rng.sample(range(n), k))  # noqa: E731
        no_rel = pick(round(VX_SHARED * 0.3))
        dmy, dmonth = pick(round(n * 0.3)), pick(round(n * 0.1))
        upper_email, plus_mobile, dash_mobile = pick(round(n * 0.05)), pick(round(n * 0.4)), pick(round(n * 0.15))
        no_pan, reapplied = pick(round(n * 0.02)), pick(4)
        conflict_pan = {rng.choice([k for k, (_, b) in enumerate(everyone) if b and k not in no_pan])}
        ch_seq = 0
        for i, (p, bank) in enumerate(everyone):
            for copy in range(2 if i in reapplied else 1):
                ch_seq += 1
                ch = f"CH{4_100_000_000 + ch_seq * 7919 + rng.randint(0, 999)}"
                p.ids.setdefault("vx", []).append(ch)
                if copy == 1:
                    self.note("VX: same person set up twice as a cardholder (re-applied)")
                if bank and i in no_rel:
                    self.note("VX: bank customer without the relationship (CIF) number")
                dob = p.dob
                if i in dmy:
                    dob_text = dob.strftime("%d/%m/%Y")
                elif i in dmonth:
                    dob_text = dob.strftime("%d-%b-%Y").upper()
                else:
                    dob_text = dob.isoformat()
                mobile = p.mobile
                if i in plus_mobile:
                    mobile = "+91 " + mobile
                elif i in dash_mobile:
                    mobile = f"+91-{mobile[:5]}-{mobile[5:]}"
                email = p.email.upper() if i in upper_email else p.email
                pan = p.pan
                if i in no_pan:
                    pan = None
                    self.note("VX: PAN missing")
                elif i in conflict_pan and bank:
                    pan = _pan(rng, p.last)
                    self.conflicts[p.pid] = "pan"
                    self.note("VX: PAN differs from FLEXCUBE")
                emboss = f"{p.first} {p.last}".upper()
                if len(emboss) > 21:
                    emboss = emboss[:21]
                    self.note("VX: embossed name cut at 21 characters")
                opened = _day(rng, max(_years(p.dob, 21), TODAY - timedelta(days=2600)), TODAY - timedelta(days=60))
                created = _stamp(rng, opened - timedelta(days=rng.randint(3, 15)))
                cardholders.append({
                    "chId": ch, "relationshipNo": p.ids["flexcube"][0] if bank and i not in no_rel else None,
                    "name": {"title": p.title, "first": p.first, "middle": p.middle or None, "last": p.last},
                    "embossName": emboss, "dob": dob_text, "gender": p.gender, "pan": pan, "mobile": mobile,
                    "email": email,
                    "billingAddress": {"line1": p.address1, "line2": p.address2, "city": p.city[0], "state": p.city[1],
                                       "pin": p.locality[1], "country": "IN"},
                    "employment": {"type": p.occupation, "employer": p.employer or None, "annualIncome": p.income},
                    "kyc": {"status": "VERIFIED" if pan else "PENDING", "ckycNo": p.ckyc if bank else None,
                            "verifiedOn": opened.isoformat() if pan else None},
                    "createdAt": created, "updatedAt": _stamp(rng, _day(rng, opened, TODAY))})
                if copy == 1:
                    continue
                for k in range(2 if rng.random() < 0.08 else 1):
                    product = rng.choice([x for x in PRODUCTS if x[1] <= p.income * 0.4] or PRODUCTS[:1])
                    name, lo, hi, fee = product
                    limit = round(min(max(p.income * rng.uniform(0.15, 0.4), lo), hi) / 5000) * 5000
                    account = "0001" + f"{rng.randint(10**11, 10**12 - 1)}"
                    p.ids.setdefault("cards", []).append(account)
                    status = _weighted(rng, [("ACTIVE", 92), ("BLOCKED", 3), ("CLOSED", 5)])
                    bucket = _weighted(rng, [("CURRENT", 90), ("30+", 5), ("60+", 3), ("90+", 2)]) if status == "ACTIVE" else "CURRENT"
                    if bucket != "CURRENT":
                        self.note(f"VX: card account {bucket} days delinquent")
                    balance = round(limit * rng.uniform(0.0, 0.7), 2) if status == "ACTIVE" else 0.0
                    cycle = rng.choice([3, 8, 13, 18, 23, 28])
                    autopay = bank and rng.random() < 0.55 and p.ids.get("accounts")
                    accounts.append({
                        "accountNo": account, "chId": ch, "product": name, "annualFee": fee, "creditLimit": limit,
                        "cashLimit": round(limit * 0.3 / 1000) * 1000, "currentBalance": balance,
                        "availableLimit": round(limit - balance, 2), "status": status, "delinquencyBucket": bucket,
                        "billingCycleDay": cycle, "openedOn": opened.isoformat(),
                        "autopay": {"enabled": bool(autopay), "debitAccountNo": p.ids["accounts"][0] if autopay else None,
                                    "mode": rng.choice(["MINIMUM_DUE", "TOTAL_DUE"]) if autopay else None},
                        "updatedAt": _stamp(rng, _day(rng, TODAY - timedelta(days=30), TODAY))})
                    holders = [("PRIMARY", p.first + " " + p.last)]
                    if p.spouse and rng.random() < 0.2:
                        holders.append(("ADDON", p.spouse))
                    for kind, holder in holders:
                        network, bin_ = rng.choice([("VISA", "4" + f"{rng.randint(10_000, 99_999)}"),
                                                    ("MASTERCARD", "5" + f"{rng.randint(10_000, 99_999)}"),
                                                    ("RUPAY", "6083" + f"{rng.randint(10, 99)}")])
                        body = bin_ + "".join(str(rng.randint(0, 9)) for _ in range(9))
                        number = body + luhn_digit(body)
                        issued = _day(rng, opened, min(opened + timedelta(days=30), TODAY))
                        reissued = issued if (TODAY - issued).days < 5 * 365 else _years(issued, 5)
                        cards.append({
                            "cardRef": f"TKN{rng.randint(10**12, 10**13 - 1)}", "accountNo": account, "chId": ch,
                            "cardNumberMasked": number[:6] + "******" + number[-4:], "network": network, "cardType": kind,
                            "embossName": holder.upper()[:21], "issuedOn": reissued.isoformat(),
                            "expiry": _years(reissued, 5).strftime("%m/%y"),
                            "status": "ACTIVE" if status == "ACTIVE" else ("HOTLISTED" if status == "BLOCKED" else "CLOSED"),
                            "contactless": True})
                    if status == "CLOSED":
                        continue
                    stmt_day = date(TODAY.year, TODAY.month, cycle)
                    if stmt_day > TODAY:
                        stmt_day = _months(stmt_day, -1)
                    opening = round(balance * rng.uniform(0.6, 1.1), 2)
                    for m in range(6, 0, -1):
                        day = _months(stmt_day, -(m - 1))
                        if day < opened:
                            continue
                        purchases = round(limit * rng.uniform(0.02, 0.35), 2)
                        payments = round(opening * rng.choice([1, 1, 1, 0.5, 0.05]), 2)
                        interest = round(max(opening - payments, 0) * 0.0375, 2)
                        fees = float(fee) if day.month == int(opened.month) else 0.0
                        closing = round(opening - payments + purchases + interest + fees, 2)
                        statements.append({
                            "accountNo": account, "statementDate": day.isoformat(), "openingBalance": opening,
                            "payments": payments, "purchases": purchases, "interest": interest, "fees": fees,
                            "closingBalance": closing, "minimumDue": round(max(closing * 0.05, min(closing, 200)), 2),
                            "paymentDueDate": (day + timedelta(days=18)).isoformat()})
                        opening = closing

    # ------------------------------------------------ answer key

    def answer_key(self):
        """{people: [{person, flexcube, finone, vx, conflict}], issues: {problem: count}}: kept outside Lumina."""
        people = []
        for p in self.people:
            people.append({"person": p.pid, "name": p.name, "flexcube": p.ids.get("flexcube", []),
                           "finone": p.ids.get("finone", []), "vx": p.ids.get("vx", []),
                           "conflict": self.conflicts.get(p.pid)})
        return {"people": people, "issues": dict(sorted(self.issues.items()))}


def build(seed=SEED):
    """(flexcube tables, finone tables, vx collections, answer key)"""
    bank = AxisBank(seed)
    flexcube, finone, vx = bank.build()
    return flexcube, finone, vx, bank.answer_key()
