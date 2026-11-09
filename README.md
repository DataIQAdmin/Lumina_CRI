# Lumina CRI

Bank customer data platform. Lumina reads customer data from several bank systems, cleans it, works out which records belong to the same person, builds one **golden record** per customer, and gives each customer a **trust score** from 0 to 100.

Live demo: https://lumina-cri-flame.vercel.app (see [Hosted demo](#hosted-demo)).

Team rules (branches, pull requests, migrations, secrets) are in [CONTRIBUTING.md](CONTRIBUTING.md). Read it before your first change.

## Stack

| Part | Tech | Folder |
|---|---|---|
| Frontend | React + TypeScript, built with Vite | `frontend/` |
| Backend | Django + Django REST Framework | `backend/` |
| Database | PostgreSQL 16 in Docker | `docker-compose.yml` |

## Folder layout

```
LUMINA CRI/
├── backend/
│   ├── config/        Settings and URLs (urls.py inside an organization, urls_public.py outside)
│   ├── tenants/       Organizations (banks), each with its own database schema
│   ├── sources/       The bank systems we read from, and how much we trust each one
│   ├── ingestion/     Connectors: read each system, keep the raw copy, save a cleaned copy
│   ├── mdm/           Matching, golden record and trust score
│   ├── stewardship/   Corrections with evidence and second-person approval
│   ├── compliance/    KYC, AML risk, PEP, sanctions and consent
│   ├── accounts/      Roles and masking of personal data
│   ├── audit/         Append-only log of who did what
│   └── api/           REST endpoints the React app calls
├── frontend/src/
│   ├── api/           API client and TypeScript types
│   ├── auth/          Sign-in state and role checks
│   ├── components/    Reusable pieces (charts, badges, layout, logo and loaders)
│   ├── pages/         One file per screen
│   └── styles/        Design tokens and CSS
├── fake_sources/      Synthetic data per organization: axis/ and hdfc/ (core banking, Salesforce, branch CSV, compliance)
├── docker/postgres/init/   Creates the fake FLEXCUBE database on first start
├── docs/design/       Design references, Stitch prompts and loaders-preview.html
├── docs/prototypes/   The original HTML prototypes this app was built from
├── docker-compose.yml
├── render.yaml        Hosted demo backend (Render)
└── .env.example       Template for your own .env
```

## First-time setup

You need Git, Docker Desktop, Python 3.10 or newer, and Node 20 or newer.

**1. Get the code**

```
git clone https://github.com/DataIQAdmin/Lumina_CRI.git
cd Lumina_CRI
```

**2. Create your `.env`.** Copy `.env.example` to `.env`, then replace `change-me-locally` (both places) with a password of your choice, and `DJANGO_SECRET_KEY` with a random string. To make one:

```
python -c "import secrets; print(secrets.token_urlsafe(50))"
```

`.env` stays on your machine. Never commit it and never paste it into chat.

`FIELD_ENCRYPTION_KEY` encrypts PAN and CKYC numbers. In development you can leave it empty (a key is derived from your secret key). Any shared or production server must set its own:

```
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

If this key is lost, encrypted numbers cannot be read again. Changing it means re-syncing every source.

**3. Start the database.** Open Docker Desktop and wait until it is running, then:

```
docker compose up -d
```

Postgres runs on port **5433**, so it does not clash with a PostgreSQL installed directly on your computer.

**4. Set up the backend.**

Windows (PowerShell):
```
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate_schemas --shared
```

Mac or Linux: the same, but activate with `source .venv/bin/activate`.

**5. Create the organizations and load their data.** Lumina serves many organizations (banks); each has its own
database schema, so one bank can never see another's data. This creates the two demo banks, Axis Bank (`axis`) and
HDFC Bank (`hdfc`), and loads each one's synthetic data from `fake_sources/<code>/`:

```
python manage.py setup_tenants
```

**6. Create logins**, once per organization:

```
python manage.py tenant_command seed_demo_users --schema=axis
python manage.py tenant_command seed_demo_users --schema=hdfc
```

`seed_demo_users` creates one login per role (relationship manager, contact centre agent, data steward, compliance officer) in that organization and prints their passwords once. Run it again to reset them. The same username in two banks is two different people with different passwords.

**7. Start the backend.** Keep this terminal open.

```
python manage.py runserver
```

**8. Start the frontend** in a second terminal.

```
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, type the organization code (`axis` or `hdfc`), then sign in. Each organization's pages
live under `/t/<code>/`, for example http://localhost:5173/t/axis/.

Security rules (sign-in lockout after 5 wrong passwords, sign-out after 30 idle minutes, encryption, connector
safety, audit) are summarised in [SECURITY.md](SECURITY.md).

## Organization administration

Each organization has its own administrators (role "Organization admin"). Signed in as one, the sidebar shows
**Administration**:

- **Users and roles**: add staff (they get a temporary password, shown once, and must choose their own at first
  sign-in), change roles, deactivate, reset passwords. An admin cannot deactivate themselves or remove the last admin.
- **Settings**: the organization's logo (PNG, JPEG or WebP up to 256 KB; shown only on its sign-in page and top bar),
  how much it trusts each source system, and how many points each field adds to the trust score (must total 100).
  Saving recalculates every customer's golden record and score.

Every change is written to that organization's audit log. To make the first admin locally:

```
python manage.py tenant_command createsuperuser --schema=axis
```

## Connectors

Each organization connects its own systems under **Connectors > Add connector** (organization admins). Every
organization sees the same catalog: **PostgreSQL, MySQL, MongoDB, REST API, CSV file upload, Lumina push API,
Snowflake, Databricks, ServiceNow, Salesforce and Cloudera**.
Setup has three steps:

1. **Connection**: the system's address and a read-only login. Passwords, tokens and connection strings are stored
   encrypted and never shown again; leave the box empty to keep the stored one. **Test connection** checks it.
2. **What to read**: **Discover** lists tables, views or collections; pick one and Lumina shows its columns and
   suggests which column feeds which field. Only the mapped columns are ever read.
3. **Accounts and products (optional)**: if the same system keeps accounts, deposits, loans or cards, pick that table
   and map its account number, customer ID, product type or name, status, opening date and balance. Lumina recognises
   common bank codes (SB, CA, FD, HL, PL, CC, NPA...) and keeps only the last four characters of each account number
   (plus a keyed fingerprint to follow it between syncs). Products then appear on the customer's **Products** tab.
   Balances are shown to relationship managers, contact centre agents, compliance and admins; data stewards see the
   products without amounts.
4. **Sync**: reads the rows, then matches and scores customers as usual. Every attempt is in the sync history.

**Scheduled sync**: on the Sync step choose every 6, 12 or 24 hours. Once an hour the scheduler
(`.github/workflows/scheduled-sync.yml`, or `python manage.py run_due_syncs` locally) syncs whatever is due in every
organization. On the hosted demo it needs the same `SYNC_RUNNER_TOKEN` value in Render and in the GitHub repository
secrets.

**Enterprise platforms** (`ingestion/connectors/enterprise.py`): Snowflake through its SQL API with key-pair sign-in
(password-only sign-in is being retired by Snowflake), Databricks through the SQL Statement Execution API and an
access token, ServiceNow through the Table API, Salesforce through its REST API with a connected app (client
credentials), and Cloudera Hive or Impala through HiveServer2 (impyla). `seed_cloud_source snowflake|databricks|
servicenow|salesforce --bank axis` fills free trial accounts with the synthetic customers; keys it creates are kept
in `~/.lumina`, never in the project. Cloudera has no free cloud account, so it is tested against a fake driver.

**Deleting a connector**: at the bottom of its setup page (organization admins). It shows what goes first, offers
Disconnect instead (which can be undone: customers only that system knew are hidden, then come back with the same
IDs), and needs the connector's name typed to confirm.

**Push API**: choose **Lumina push API** in the catalog when the bank's own system should send customers to Lumina
instead. Create an API key (shown once) and the setup page shows a ready-to-copy example request.

Safety rules: connectors may only reach public internet addresses (private and internal addresses are refused, except
in local development where `CONNECTORS_ALLOW_PRIVATE_HOSTS` is on), sessions are read-only, queries time out after
`CONNECTOR_TIMEOUT_SECONDS` (30) and read at most `CONNECTOR_MAX_ROWS` (50,000) rows. The three demo connectors keep
reading the sample data in `fake_sources/` (locally; the hosted demo removes them, see below).

**Real cloud sources for the demo**: `python manage.py seed_cloud_source postgres|mysql|mongodb --bank axis|hdfc`
fills a free cloud database with synthetic customers (`ingestion/cloud_demo_data.py`), plus an accounts table for
PostgreSQL (`core.accounts`) and MySQL (`loan_accounts`), and creates a read-only login.
It asks for the admin connection details with hidden typing and prints the read-only login once. Running it again
resets the rows and keeps the login, so the connector keeps working (`--new-password` changes it). The data is built
to exercise matching: shared people across systems, a typo duplicate and a person without a PAN (both go to match
review), a family member sharing a phone (never merged) and a newer address in one system.

## Before you speak and conversations

A customer's profile opens on **Before you speak**: what to know in the ten seconds before a call or a meeting.
Warnings come first, each with what to do: open complaints, missed follow-ups, overdue or dormant products, re-KYC due,
missing PAN, a possible duplicate under review, fields the systems disagree on, and withdrawn marketing consent.
Talking points list what the customer holds, and suggest offers only when they agreed to cross-sell. Data stewards see
no amounts; AML risk, politically exposed person and sanctions flags appear only for compliance roles, marked internal.

**Conversations** holds every call, branch visit, email, WhatsApp, chat and SMS that staff logged, with an outcome.
Complaints and anything not resolved stay open (and in the briefing) until someone marks them done with a note. Card,
account, Aadhaar and PAN numbers typed into a note are masked before saving. Logging and closing go to the audit log
(without the note itself), and conversations follow the customer through merges.

## Platform console

The Lumina platform team works at **/platform** (not linked from the landing page). Platform logins live in the shared
schema and are separate from every bank's logins: bank staff cannot sign in there, and platform admins cannot open a
bank's data.

- **Organizations**: one health card per bank (users, customer count, sources live, waiting reviews, last sync, last
  activity; never customer details). **Add organization** creates its own schema and its first admin, whose temporary
  password is shown once. **Edit** changes name and badge colour. **Suspend** closes the bank to everyone at once,
  even people already signed in; **Resume** opens it again.
- **Activity**: the platform team's own log (sign-ins, organizations added, changed, suspended, resumed).

Create a platform login locally (runs in the shared schema):

```
python manage.py createsuperuser
```

On the hosted demo it is the `DJANGO_SUPERUSER_USERNAME` login. One browser holds one sign-in at a time: signing in to
the platform signs that browser out of a bank, and the other way round.

## Every day

```
docker compose up -d                 # from the project folder, Docker Desktop running
cd backend && .venv\Scripts\activate && python manage.py runserver
cd frontend && npm run dev           # second terminal
```

Commands that work on customer data run inside one organization. Wrap them in `tenant_command ... --schema=<code>`.
After a pull that changed the fake data in `fake_sources/<code>/`, reload that organization:

```
python manage.py tenant_command load_fake_flexcube --schema=axis
python manage.py tenant_command sync flexcube --schema=axis
python manage.py tenant_command sync salesforce --schema=axis
python manage.py tenant_command sync branch_csv --schema=axis
python manage.py tenant_command build_customers --schema=axis
python manage.py tenant_command sync_compliance --schema=axis
```

After every `git pull`, also run:

```
cd backend
pip install -r requirements.txt
python manage.py migrate_schemas
cd ../frontend
npm install
```

## Hosted demo

A shared demo runs on free hosting. Only fake data goes there.

| Part | Host | Config in repo |
|---|---|---|
| React frontend | Vercel (root directory `frontend`) | `frontend/vercel.json` forwards `/api` to Render |
| Django API | Render (web service from `render.yaml`) | `render.yaml` |
| Database | Neon Postgres: `neondb` for Lumina, `src_flexcube` for fake FLEXCUBE | none, connection string lives in Render |

Render environment values (set in the Render dashboard, never in the repo):

| Name | Value |
|---|---|
| `DATABASE_URL` | Neon connection string for `neondb`, pooling off. FLEXCUBE uses the same server's `src_flexcube`. |
| `FIELD_ENCRYPTION_KEY` | A new Fernet key (command in setup step 2). Not the one on your computer. |
| `CSRF_TRUSTED_ORIGINS` | The Vercel address, e.g. `https://lumina-cri.vercel.app` |
| `DEMO_PASSWORD` | Password for `rm.demo`, `agent.demo`, `steward.demo`, `compliance.demo` |
| `DJANGO_SUPERUSER_USERNAME`, `DJANGO_SUPERUSER_PASSWORD` | Admin login |
| `DEMO_SOURCES` | `off`: banks read only their real cloud connectors. Start-up removes the built-in demo sources, their records and the customers only they described (cannot be undone). The compliance feed stays. |

On every start Render runs `migrate_schemas` and `bootstrap_demo`. That command creates the demo organizations, loads each one's data once (only when it has no customers) and sets the logins from the values above in every organization. It also re-reads each organization's compliance feed,
and with `DEMO_SOURCES=off` removes the built-in demo sources (also from organizations created later). The same admin name and password are also the platform login. The free plan sleeps when idle, so the first request after a pause takes up to a minute.

Two things soften that:

- **Keep demo awake** (`.github/workflows/keep-awake.yml`) pings the API every 10 minutes. Turn it on or off under GitHub > Actions > Keep demo awake > `...` > Enable / Disable workflow. It is free only while the repository is public, and GitHub switches it off after 60 days without a push.
- If the server is still asleep, the website shows "The server is starting" and retries on its own for up to 90 seconds.

## Useful commands

| Command (inside `backend/`) | What it does |
|---|---|
| `python manage.py setup_tenants` | Create the demo organizations and load data into any that has none |
| `python manage.py migrate_schemas` | Apply migrations to the shared schema and every organization |
| `python manage.py tenant_command <command> --schema=<code>` | Run any command below inside one organization |
| `load_fake_flexcube` | Re-create that organization's fake core banking table from `fake_sources/<code>/flexcube.sql` |
| `sync <source>` | Read one source: `flexcube`, `salesforce` or `branch_csv` |
| `build_customers` | Re-run matching, golden records and trust scores |
| `sync_compliance` | Import KYC, AML and consent from `fake_sources/<code>/compliance/kyc_aml.csv` |
| `seed_demo_users` | Create or reset one demo login per role |
| `pytest` | Run all backend tests (they include checks that organizations cannot see each other's data) |

| Command (inside `frontend/`) | What it does |
|---|---|
| `npm run dev` | Start the app at http://localhost:5173 |
| `npm run build` | Type-check and build; must pass before a pull request |
| `npm run lint` | Check code style |

## Look at the database

Connect pgAdmin or DBeaver to host `localhost`, port `5433`, database `lumina`, user `lumina`, and the password from your `.env`. Each organization is a schema (`axis`, `hdfc`); the list of organizations is in `public`. The fake core banking systems are the `axis` and `hdfc` schemas of the `src_flexcube` database on the same server. Use these tools to look, not to edit: changes made by hand skip score recalculation and the audit log.

## Reset your local data

```
docker compose down -v      # deletes your local database
docker compose up -d
```

Then repeat steps 4 (migrate) to 6. This only affects your own machine.

If your database was created before organizations existed, start fresh this way once.
