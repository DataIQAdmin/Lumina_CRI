"""The demo source data for data profiling: 11 related tables of synthetic bank data (customers, their addresses,
emails, phones, employers and AML checks; accounts and products with their own contact details).

The full files (100,000 rows each) live outside the project, in the folder given to the seed command. Each demo
connector gets a sample: by default 5,000 customers with every row linked to them. Within one bank, 70% of the
customers are the same in every connector and 30% are its own, so the systems overlap the way real ones do.
Axis and HDFC draw from different halves of the files. Rows are copied exactly as they are in the files, problems
included (mixed date formats, damaged Aadhaar numbers, accounts whose customer ID matches no customer): those are
what data profiling is meant to find.
"""

import csv
from pathlib import Path

# (table name in the source systems, file, column it is linked by, the table and column it links to)
TABLES = [
    ("customer_master", "customer_master_final.csv", "CustomerID", None),
    ("customer_address", "Customer_Address_Test_Data.csv", "CustomerID", ("customer_master", "CustomerID")),
    ("customer_email", "Customer_Email_Test_Data.csv", "CustomerID", ("customer_master", "CustomerID")),
    ("customer_phone", "Customer_Phone_Test_Data.csv", "CustomerID", ("customer_master", "CustomerID")),
    ("customer_employer", "Customer_Employer_Test_Data.csv", "CustomerID", ("customer_master", "CustomerID")),
    ("customer_aml", "AML_Test_Data.csv", "CustomerID", ("customer_master", "CustomerID")),
    ("account_master", "account_master_final_combined_1M.csv", "AccountID", None),
    ("product_account", "Product_Account_Test_Data.csv", "AccountID", ("account_master", "AccountID")),
    ("product_account_address", "Product_Account_Address_Test_Data.csv", "ProductAccountID",
     ("product_account", "ProductAccountID")),
    ("product_account_email", "Product_Account_Email_Test_Data.csv", "ProductAccountID",
     ("product_account", "ProductAccountID")),
    ("product_account_phone", "Product_Account_Phone_Test_Data.csv", "ProductAccountID",
     ("product_account", "ProductAccountID")),
]
SHARED = 0.7  # share of customers every connector of a bank has in common
BANK_HALF = {"axis": 0, "hdfc": 1}  # Axis uses the first half of the files, HDFC the second


def read_table(folder, file):
    """(header, rows) of one CSV, values exactly as written."""
    path = Path(folder) / file
    if not path.exists():
        raise FileNotFoundError(f"{file} is not in {folder}.")
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            with open(path, encoding=encoding, newline="") as handle:
                reader = csv.reader(handle)
                header = [h.strip() for h in next(reader)]
                return header, [row for row in reader if any(row)]
        except UnicodeDecodeError:
            continue
    raise ValueError(f"{file} is neither UTF-8 nor Windows text.")


def customer_positions(total, bank, slot, customers):
    """Row positions in customer_master for one connector: the bank's shared customers, then this connector's own."""
    half = total // 2
    start = BANK_HALF[bank] * half
    shared = int(customers * SHARED)
    own = customers - shared
    first_own = start + shared + (slot - 1) * own
    if first_own + own > start + half:
        raise ValueError(f"Not enough customers in the files for {customers} per connector.")
    return list(range(start, start + shared)) + list(range(first_own, first_own + own))


def sample(folder, bank, slot, customers=5000):
    """{table: (header, rows)} for one connector. slot: 1, 2, 3... one per connector of the bank."""
    out = {}
    header, rows = read_table(folder, "customer_master_final.csv")
    positions = customer_positions(len(rows), bank, slot, customers)
    out["customer_master"] = (header, [rows[i] for i in positions])
    chosen = {"customer_master": {r[header.index("CustomerID")] for r in out["customer_master"][1]}}

    for name, file, key, link in TABLES[1:]:
        header, rows = read_table(folder, file)
        if name == "account_master":
            # Account IDs in the files do not point at any customer, so take the accounts in the same row
            # positions as the chosen customers; profiling reports the broken link.
            picked = [rows[i] for i in positions if i < len(rows)]
        else:
            parent, parent_key = link
            wanted = chosen[parent]
            i = header.index(key)
            picked = [r for r in rows if len(r) > i and r[i] in wanted]
        out[name] = (header, picked)
        if name in ("account_master", "product_account"):
            id_column = "AccountID" if name == "account_master" else "ProductAccountID"
            chosen[name] = {r[header.index(id_column)] for r in picked}
    return out


def write_csv_folder(tables, folder):
    """The sample as one CSV per table, for the CSV connector."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for name, (header, rows) in tables.items():
        with open(folder / f"{name}.csv", "w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(header)
            writer.writerows(rows)
    return folder
