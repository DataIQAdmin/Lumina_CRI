"""The 11-table demo data: which rows each connector gets, and loading them into PostgreSQL."""

import csv
import io
import uuid

import psycopg
import pytest
from django.conf import settings as django_settings
from django.core.management import call_command
from django.db import connection

from ingestion.raw_demo import TABLES, customer_positions, sample, write_csv_folder

N = 100  # customers in the fake files


@pytest.fixture
def folder(tmp_path):
    """Tiny versions of the 11 files: customer C0..C99, account A0..A99 (not linked to customers, like the real
    files), one product per account, one contact row of each kind per customer and per product."""
    def write(name, header, rows):
        with open(tmp_path / name, "w", encoding="utf-8", newline="") as handle:
            w = csv.writer(handle)
            w.writerow(header)
            w.writerows(rows)

    write("customer_master_final.csv", ["CustomerID", "CustomerName", "PAN"],
          [[f"C{i}", f"Person {i}", ""] for i in range(N)])
    for file in ["Customer_Address_Test_Data.csv", "Customer_Email_Test_Data.csv", "Customer_Phone_Test_Data.csv",
                 "Customer_Employer_Test_Data.csv", "AML_Test_Data.csv"]:
        write(file, ["RowID", "CustomerID", "Value"], [[f"R{i}", f"C{i}", f"v{i}"] for i in range(N)])
    write("account_master_final_combined_1M.csv", ["AccountID", "CustomerID"], [[f"A{i}", f"X{i}"] for i in range(N)])
    write("Product_Account_Test_Data.csv", ["ProductAccountID", "AccountID"], [[f"P{i}", f"A{i}"] for i in range(N)])
    for file in ["Product_Account_Address_Test_Data.csv", "Product_Account_Email_Test_Data.csv",
                 "Product_Account_Phone_Test_Data.csv"]:
        write(file, ["RowID", "ProductAccountID"], [[f"Q{i}", f"P{i}"] for i in range(N)])
    return tmp_path


def ids(tables, name="customer_master"):
    return {r[0] for r in tables[name][1]}


def test_every_connector_of_a_bank_shares_70_percent():
    one, two = customer_positions(N, "axis", 1, 10), customer_positions(N, "axis", 2, 10)
    assert len(one) == len(two) == 10
    assert len(set(one) & set(two)) == 7  # 70% the same customers
    assert not set(one) & set(customer_positions(N, "hdfc", 1, 10))  # banks use different halves


def test_sample_keeps_every_linked_row_and_all_11_tables(folder):
    tables = sample(folder, "axis", 1, 10)
    assert set(tables) == {t[0] for t in TABLES}
    customers = ids(tables)
    assert len(customers) == 10
    for name in ["customer_address", "customer_email", "customer_phone", "customer_employer", "customer_aml"]:
        assert {r[1] for r in tables[name][1]} == customers  # only rows of the chosen customers, all of them
    accounts = ids(tables, "account_master")
    assert len(accounts) == 10 and {r[1] for r in tables["product_account"][1]} == accounts
    products = ids(tables, "product_account")
    assert {r[1] for r in tables["product_account_phone"][1]} == products
    assert tables["customer_master"][1][0] == ["C0", "Person 0", ""]  # values exactly as in the file


def test_too_many_customers_is_refused(folder):
    with pytest.raises(ValueError):
        sample(folder, "axis", 3, 40)  # 28 shared + 3 x 12 own does not fit in 50


def test_csv_export(folder, tmp_path):
    out = write_csv_folder(sample(folder, "hdfc", 4, 10), tmp_path / "out")
    assert len(list(out.glob("*.csv"))) == 11


@pytest.fixture
def pg_url(db):
    cfg = django_settings.DATABASES["default"]
    return (f"postgresql://{cfg['USER']}:{cfg['PASSWORD']}@{cfg['HOST']}:{cfg['PORT']}/"
            f"{connection.settings_dict['NAME']}")


def test_postgres_load_replaces_the_old_demo_tables(folder, pg_url, monkeypatch, settings):
    params = dict(conninfo=pg_url, autocommit=True)
    with psycopg.connect(**params) as conn:
        conn.execute("CREATE SCHEMA IF NOT EXISTS core")
        conn.execute("CREATE TABLE IF NOT EXISTS core.customers (id text)")
    monkeypatch.setattr("getpass.getpass", lambda prompt="": pg_url)
    out = io.StringIO()
    call_command("seed_raw_source", "postgres", "--bank", "axis", "--data", str(folder), "--customers", "10", stdout=out)
    with psycopg.connect(**params) as conn:
        tables = {r[0] for r in conn.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'core'").fetchall()}
        assert {t[0] for t in TABLES} <= tables and "customers" not in tables  # old demo table gone
        assert conn.execute('SELECT count(*) FROM core.customer_master').fetchone()[0] == 10
        assert conn.execute('SELECT "PAN" FROM core.customer_master LIMIT 1').fetchone()[0] is None  # empty stays empty
        conn.execute("DROP SCHEMA core CASCADE")
    assert "customer_master" in out.getvalue()
