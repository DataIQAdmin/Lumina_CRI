"""Load Axis Bank's three demo systems (ingestion/axis_systems.py), replacing what they held before:

    python manage.py seed_axis_systems postgres          FLEXCUBE (schema fcubs) and FINONE (schema finnone)
    python manage.py seed_axis_systems mongodb           VX credit cards (database lumina_source)
    python manage.py seed_axis_systems csv --out FOLDER  every table as a CSV file, to look at the data

The admin connection string is asked with hidden typing, so it never appears on screen, in the shell history or in
a chat. Each system gets its own read-only login (lumina_reader_flexcube, lumina_reader_finone) that can see only its
own schema; its password is printed once, when the login is created. Running the command again reloads the data and
keeps the passwords, so the connectors in Lumina keep working. --new-password gives the logins new passwords.

--remove-old also removes Axis's old demo data (the "core" schema in PostgreSQL, the mobile app collections in
MongoDB). It asks before removing anything.

The answer key (which records are the same person, and the data problems put in on purpose) is written to
--key, by default Desktop\\Lumina Source Data\\answer_key_axis.json. It stays on this computer.
"""

import csv
import getpass
import json
import secrets
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlparse

from django.core.management.base import BaseCommand, CommandError

from ingestion.axis_systems import build

SCHEMAS = {"fcubs": ("flexcube", "FLEXCUBE"), "finnone": ("finone", "FINONE")}
OLD_APP = ["app_users", "app_addresses", "app_devices", "app_kyc_uploads"]


def _default_key():
    folder = Path.home() / "OneDrive" / "Desktop" / "Lumina Source Data"
    return folder / "answer_key_axis.json" if folder.exists() else Path("answer_key_axis.json")


def _json(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raise TypeError(type(value))


class Command(BaseCommand):
    help = "Load Axis Bank's demo systems: FLEXCUBE and FINONE (PostgreSQL), VX (MongoDB)."

    def add_arguments(self, parser):
        parser.add_argument("kind", choices=["postgres", "mongodb", "csv"])
        parser.add_argument("--database", default="lumina_source", help="mongodb only: the database to load VX into.")
        parser.add_argument("--out", help="csv only: the folder to write the files to.")
        parser.add_argument("--key", help="Where to write the answer key.")
        parser.add_argument("--remove-old", action="store_true", help="Also remove Axis's old demo data (asks first).")
        parser.add_argument("--new-password", action="store_true", help="Give the read-only logins new passwords.")

    def handle(self, *args, kind, database, out=None, key=None, remove_old=False, new_password=False, **options):
        flexcube, finone, vx, answer = build()
        if kind == "csv":
            if not out:
                raise CommandError("Give --out, the folder to write the files to.")
            self._csv(Path(out), flexcube, finone, vx)
        else:
            url = getpass.getpass(f"Paste the {kind} ADMIN connection string (hidden), then press Enter: ").strip()
            if not url:
                raise CommandError("No connection string given.")
            if kind == "postgres":
                self._postgres(url, {"fcubs": flexcube, "finnone": finone}, remove_old, new_password)
            else:
                self._mongodb(url, database, vx, remove_old)
        path = Path(key) if key else _default_key()
        path.write_text(json.dumps(answer, indent=1, default=_json), encoding="utf-8")
        self.stdout.write(f"Answer key written to {path} (kept on this computer only).")
        self.stdout.write("Data problems put in on purpose:")
        for problem, count in answer["issues"].items():
            self.stdout.write(f"  {count:>4}  {problem}")

    def _confirm(self, what):
        typed = input(f"This permanently removes {what}. Type yes to go on: ").strip().lower()
        if typed != "yes":
            raise CommandError("Nothing was changed.")

    # ---------- PostgreSQL: FLEXCUBE and FINONE ----------

    def _postgres(self, url, systems, remove_old, new_password):
        import psycopg
        from psycopg import sql

        database = urlparse(url).path.lstrip("/")
        logins = []
        with psycopg.connect(url, autocommit=True) as conn:
            if remove_old:
                found = [r[0] for r in conn.execute(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'core' ORDER BY 1").fetchall()]
                if found:
                    self._confirm(f"the old core banking schema 'core' and its {len(found)} tables ({', '.join(found)})")
                    conn.execute("DROP SCHEMA core CASCADE")
                    self.stdout.write("Removed the old schema core.")
                else:
                    self.stdout.write("No old schema core to remove.")
            for schema, tables in systems.items():
                system, label = SCHEMAS[schema]
                conn.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(schema)))
                self.stdout.write(self.style.SUCCESS(f"{label} (schema {schema}):"))
                for name, table in tables.items():
                    target = sql.Identifier(schema, name)
                    conn.execute(sql.SQL("DROP TABLE IF EXISTS {} CASCADE").format(target))
                    conn.execute(sql.SQL("CREATE TABLE {} ({})").format(target, sql.SQL(", ").join(
                        sql.SQL("{} {}").format(sql.Identifier(c), sql.SQL(t)) for c, t in table.columns)))
                    with conn.cursor().copy(sql.SQL("COPY {} ({}) FROM STDIN").format(
                            target, sql.SQL(", ").join(sql.Identifier(c) for c in table.names))) as copy:
                        for row in table.rows:
                            copy.write_row(row)
                    self.stdout.write(f"  {name:<24} {len(table.rows):>6} rows")
                role = f"lumina_reader_{system}"
                password = secrets.token_urlsafe(18)
                if not conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", [role]).fetchone():
                    conn.execute(sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(sql.Identifier(role), sql.Literal(password)))
                elif new_password:
                    conn.execute(sql.SQL("ALTER ROLE {} PASSWORD {}").format(sql.Identifier(role), sql.Literal(password)))
                else:
                    password = None
                conn.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(sql.Identifier(database), sql.Identifier(role)))
                conn.execute(sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(sql.Identifier(schema), sql.Identifier(role)))
                conn.execute(sql.SQL("GRANT SELECT ON ALL TABLES IN SCHEMA {} TO {}").format(sql.Identifier(schema), sql.Identifier(role)))
                logins.append((label, role, password))
        parts = urlparse(url)
        self.stdout.write(self.style.SUCCESS("\nRead-only logins for the connectors in Lumina (PostgreSQL):"))
        self.stdout.write(f"  Server address  {parts.hostname}\n  Port            {parts.port or 5432}\n"
                          f"  Database name   {database}\n  Encryption      Required")
        for label, role, password in logins:
            shown = password if password else "unchanged (use the one you saved; --new-password to change it)"
            self.stdout.write(f"  {label:<9} username {role}   password {shown}")
        if any(p for _, _, p in logins):
            self.stdout.write(self.style.WARNING("Passwords are shown only now. Type them into Lumina; do not paste them in a chat."))

    # ---------- MongoDB: VX ----------

    def _mongodb(self, url, database, collections, remove_old):
        import pymongo

        client = pymongo.MongoClient(url, serverSelectionTimeoutMS=10000)
        try:
            db = client[database]
            if remove_old:
                found = [c for c in OLD_APP if c in db.list_collection_names()]
                if found:
                    self._confirm(f"the old mobile app collections {', '.join(found)} in database {database}. "
                                  "If HDFC's mobile app uses this same database, its connector loses its data too")
                    for name in found:
                        db[name].drop()
                    self.stdout.write(f"Removed {', '.join(found)}.")
            self.stdout.write(self.style.SUCCESS(f"VX (database {database}):"))
            for name, docs in collections.items():
                db[name].drop()
                db[name].insert_many([dict(d) for d in docs])
                self.stdout.write(f"  {name:<24} {len(docs):>6} documents")
        finally:
            client.close()
        self.stdout.write("The connector in Lumina uses the existing read-only MongoDB login with database "
                          f"{database}; give it read access to that database in Atlas if it does not have it.")

    # ---------- CSV, to look at the data ----------

    def _csv(self, folder, flexcube, finone, vx):
        for system, tables in (("flexcube", flexcube), ("finone", finone)):
            target = folder / system
            target.mkdir(parents=True, exist_ok=True)
            for name, table in tables.items():
                with open(target / f"{name}.csv", "w", newline="", encoding="utf-8") as f:
                    writer = csv.writer(f)
                    writer.writerow(table.names)
                    writer.writerows(["" if v is None else v for v in row] for row in table.rows)
        target = folder / "vx"
        target.mkdir(parents=True, exist_ok=True)
        for name, docs in vx.items():
            (target / f"{name}.json").write_text(json.dumps(docs, indent=1, default=_json), encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(f"Wrote FLEXCUBE, FINONE and VX to {folder}."))
