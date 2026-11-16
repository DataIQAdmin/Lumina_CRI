"""Load the demo data (ingestion/bank_demo.py) into a bank's two systems, replacing what they held before:

    python manage.py seed_raw_source postgres --bank axis --data "C:\\...\\Lumina Source Data\\Data"   core banking
    python manage.py seed_raw_source mongodb  --bank axis --data "..."                                   mobile app
    python manage.py seed_raw_source mysql    --bank hdfc --data "..."                                   core banking
    python manage.py seed_raw_source mongodb  --bank hdfc --data "..."                                   mobile app
    python manage.py seed_raw_source csv      --bank axis --data "..." --out "C:\\...\\axis-csv"           core as CSV files

Core banking gets the 11 related tables; the mobile app gets its own collections, built from the same customers.
The mobile app run also writes answer_key_<bank>.json next to the data folder: which records are really the same
person, to check Lumina's matching. It stays on this computer.

Admin details are asked with hidden typing, so they never appear on screen, in the shell history or in a chat.
The existing read-only login of each system keeps working (it is given read access to the new tables).
Core banking values are stored as text, as in the files: data profiling looks at the raw values.
"""

import getpass
import json
from pathlib import Path
from urllib.parse import unquote, urlparse

from django.core.management.base import BaseCommand, CommandError

from ingestion.bank_demo import app_collections, core_tables
from ingestion.raw_demo import TABLES, write_csv_folder

KINDS = ["postgres", "mysql", "mongodb", "csv"]
# The old single-table demo data each system held, removed so the new tables replace it.
OLD = {"postgres": ["core.customers", "core.accounts"], "mysql": ["customer_master", "loan_accounts"]}


class Command(BaseCommand):
    help = "Load the demo data into a bank's core banking system or mobile app (replaces what they held)."

    def add_arguments(self, parser):
        parser.add_argument("kind", choices=KINDS)
        parser.add_argument("--bank", choices=["axis", "hdfc"], required=True)
        parser.add_argument("--data", required=True, help="Folder with the CSV files (Lumina Source Data\\Data).")
        parser.add_argument("--customers", type=int, default=100)
        parser.add_argument("--out", help="csv only: folder to write the 11 files to.")

    def handle(self, *args, kind, bank, data, customers, out=None, **options):
        try:
            tables, people = core_tables(data, bank, customers)
        except (FileNotFoundError, ValueError) as exc:
            raise CommandError(str(exc)) from exc
        if kind == "mongodb":
            collections, key = app_collections(bank, people)
            url = getpass.getpass("Paste the mongodb ADMIN connection string (hidden), then press Enter: ").strip()
            if not url:
                raise CommandError("No connection string given.")
            self._mongodb_app(url, collections)
            path = Path(data).resolve().parent / f"answer_key_{bank}.json"
            path.write_text(json.dumps(key, indent=1), encoding="utf-8")
            self.stdout.write(self.style.SUCCESS("Loaded:"))
            for name, docs in collections.items():
                self.stdout.write(f"  {name:<26} {len(docs):>6} documents")
            self.stdout.write(f"Answer key written to {path} (kept on this computer only).")
            return
        rows = sum(len(r) for _, r in tables.values())
        self.stdout.write(f"Core banking for {bank}: {customers} customers, {len(tables)} tables, {rows} rows.")
        if kind == "csv":
            if not out:
                raise CommandError("Give --out, the folder to write the CSV files to.")
            folder = write_csv_folder(tables, out)
            self.stdout.write(self.style.SUCCESS(f"Wrote {len(tables)} CSV files to {folder}."))
            self.stdout.write("Upload all of them to the CSV connector in Lumina (step 1, Files).")
            return
        if kind == "mysql":
            url = self._ask_mysql()
        else:
            url = getpass.getpass(f"Paste the {kind} ADMIN connection string (hidden), then press Enter: ").strip()
        if not url:
            raise CommandError("No connection string given.")
        getattr(self, f"_{kind}")(url, tables, bank)
        self._report(tables)

    def _report(self, tables):
        self.stdout.write(self.style.SUCCESS("Loaded:"))
        for name, (header, rows) in tables.items():
            self.stdout.write(f"  {name:<26} {len(rows):>6} rows  {len(header):>3} columns")
        self.stdout.write("The read-only login is unchanged: the connector in Lumina keeps its password.")

    # ---------- PostgreSQL (Neon) ----------

    def _postgres(self, url, tables, bank):
        import psycopg
        from psycopg import sql

        role = f"lumina_reader_{bank}"
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute("CREATE SCHEMA IF NOT EXISTS core")
            for old in OLD["postgres"]:
                conn.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(sql.Identifier(*old.split("."))))
            for name, (header, rows) in tables.items():
                target = sql.Identifier("core", name)
                conn.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(target))
                conn.execute(sql.SQL("CREATE TABLE {} ({})").format(
                    target, sql.SQL(", ").join(sql.SQL("{} text").format(sql.Identifier(c)) for c in header)))
                with conn.cursor().copy(sql.SQL("COPY {} FROM STDIN").format(target)) as copy:
                    for row in rows:
                        copy.write_row([v if v != "" else None for v in row] + [None] * (len(header) - len(row)))
                self.stdout.write(f"  {name}: {len(rows)} rows")
            if conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", [role]).fetchone():
                conn.execute(sql.SQL("GRANT USAGE ON SCHEMA core TO {}").format(sql.Identifier(role)))
                conn.execute(sql.SQL("GRANT SELECT ON ALL TABLES IN SCHEMA core TO {}").format(sql.Identifier(role)))
            else:
                self.stdout.write(self.style.WARNING(
                    f"No read-only login {role} yet: run seed_cloud_source postgres once to create it."))

    # ---------- MySQL (TiDB Cloud) ----------

    def _ask_mysql(self):
        host = input("Host (e.g. gateway01.ap-southeast-1.prod.aws.tidbcloud.com): ").strip()
        if not host or "." not in host:
            raise CommandError("Type the real host name from the database's Connect screen.")
        port = input("Port [4000]: ").strip() or "4000"
        user = input("User (e.g. 3Abc123.root): ").strip()
        password = getpass.getpass("Password (hidden): ")
        if not user or not password:
            raise CommandError("User and password are needed.")
        from urllib.parse import quote

        return f"mysql://{quote(user, safe='')}:{quote(password, safe='')}@{host}:{int(port)}/lumina_source"

    def _mysql(self, url, tables, bank):
        import ssl

        import pymysql

        parts = urlparse(url)
        database = parts.path.lstrip("/") or "lumina_source"
        admin = unquote(parts.username or "")
        prefix = admin.split(".", 1)[0] + "." if "." in admin else ""
        reader = f"{prefix}lumina_reader"
        conn = pymysql.connect(host=parts.hostname, port=parts.port or 3306, user=admin,
                               password=unquote(parts.password or ""), ssl=ssl.create_default_context(),
                               autocommit=True)

        def q(name):
            return "`" + name.replace("`", "``") + "`"

        try:
            with conn.cursor() as cur:
                cur.execute(f"CREATE DATABASE IF NOT EXISTS {q(database)}")
                cur.execute(f"USE {q(database)}")
                for old in OLD["mysql"]:
                    cur.execute(f"DROP TABLE IF EXISTS {q(old)}")
                for name, (header, rows) in tables.items():
                    cur.execute(f"DROP TABLE IF EXISTS {q(name)}")
                    cur.execute(f"CREATE TABLE {q(name)} ({', '.join(f'{q(c)} TEXT' for c in header)})")
                    insert = f"INSERT INTO {q(name)} VALUES ({', '.join(['%s'] * len(header))})"
                    values = [[v if v != "" else None for v in r] + [None] * (len(header) - len(r)) for r in rows]
                    for start in range(0, len(values), 500):
                        cur.executemany(insert, values[start:start + 500])
                    self.stdout.write(f"  {name}: {len(rows)} rows")
                cur.execute("SELECT COUNT(*) FROM mysql.user WHERE User = %s", [reader])
                if cur.fetchone()[0]:
                    cur.execute(f"GRANT SELECT ON {q(database)}.* TO %s@'%%'", [reader])
                else:
                    self.stdout.write(self.style.WARNING(
                        f"No read-only login {reader} yet: run seed_cloud_source mysql once to create it."))
        finally:
            conn.close()

    # ---------- MongoDB (Atlas) ----------

    def _mongodb_app(self, url, collections):
        import pymongo

        client = pymongo.MongoClient(url, serverSelectionTimeoutMS=10000)
        try:
            db = client["lumina_source"]
            # The earlier demo kept copies of the 11 core tables here; a mobile app does not hold those.
            for old in [t[0] for t in TABLES] + list(collections):
                db[old].drop()
            for name, docs in collections.items():
                db[name].insert_many(docs)
                self.stdout.write(f"  {name}: {len(docs)} documents")
        finally:
            client.close()
