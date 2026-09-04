# CampusTreasury — Full-Stack Setup Guide

CampusTreasury is a college fee/accounts management app. It has two parts:

- **`frontend/`** — the existing `index.html` / `style.css` / `script.js` UI (unchanged look and feel), plus a new `api.js` that connects it to the backend.
- **`backend/`** — a Django + Django REST Framework API, backed by **MySQL**, with JWT login and role-based permissions (Admin / Accountant / Viewer).

This guide assumes **no prior Django/MySQL experience**. Follow it top to bottom.

---

## 0. What's actually connected right now (read this first)

Being connected to a real database is not all-or-nothing — it's being rolled out **module by module**, each one fully wired and tested before moving to the next, so nothing half-works silently.

### ✅ Module 1 — done, tested against a real MySQL database
- **Login / Logout** — real JWT tokens issued by Django, not a hard-coded check
- **Roles & permissions** (Admin / Accountant / Viewer) — enforced **on the server**, not just hidden buttons. A Viewer's browser can be tampered with all it wants; the API still returns `403 Forbidden` on any write.
- **Users page** — Add / Edit / Delete / Activate / Deactivate / Unlock a user all read and write the real `users` table
- **Change Password** — validated and saved server-side
- **Audit Log** — every login, logout, and user-management action is recorded in the database and shown on the Audit Log page (visible to Admin/Accountant only, exactly like before)
- **Initial data load** — the moment you log in, Students, Fees, Employees, Salaries, Expenses, Budget, Fines, Transport Fees, Routes, Classes and Settings are all pulled from the **real database** instead of the old hard-coded demo arrays, so the Dashboard and every page shows real numbers on load

This was verified with an automated end-to-end test (`e2e/test_module1.js`) that drives the actual `index.html` + `script.js` + `api.js` against a running Django server on a real MySQL database — not a mock. See §8 "Testing" to run it yourself.

### ⏳ Not yet connected — still local/in-memory only
Add / Edit / Delete on these pages currently only changes what you see in the browser tab; **refreshing the page reloads the real database and discards the change**, the same way the old localStorage version reset if you cleared your browser data:

- Students, Fees (incl. partial payments & instalment plans), Transport Fee, Disciplinary Fines, Salaries, Expenses, Budget

**Why these are separate, larger pieces of work:** they're not simple CRUD — e.g. adding a Student also auto-creates a Fee record with scholarship/discount math and optional instalment plans, all in one client-side function. Wiring these up properly (without silently dropping the scholarship/instalment feature) needs a few backend model fields added first. This is the planned next phase.

**What this means for you today:** you can demo login, roles, user management, and a dashboard/reports view of real seeded data end-to-end. Don't rely on Add/Edit/Delete on the modules listed above surviving a page refresh yet.

---

## 1. Requirements

- **Python 3.10+**
- **MySQL 8.0.x – 8.3.x, or MariaDB 10.5+** — see the important version note below
- **Node.js is NOT required** to run the app — it's only used for the optional automated test suite in `e2e/`
- A modern browser

> ⚠️ **Important — Django/MySQL version compatibility:** `requirements.txt` pins `Django>=5.0,<5.3`. Django 6.0 and later require **MySQL 8.4+**, which most local/XAMPP/WAMP MySQL installs (still commonly 8.0.x) do not meet, and installing a newer Django there will crash with `NotSupportedError: MySQL 8.4 or later is required`. Do not loosen this pin unless you know your MySQL/MariaDB version supports it. (This was an actual bug found and fixed while verifying this project — the original pin allowed Django 6.x.)

---

## 2. Project layout

```
campustreasury/
├── backend/
│   ├── campustreasury/     # Django project settings, root urls
│   ├── accounts/           # User model, roles, JWT auth, audit log
│   ├── academics/          # Students, Classes, Sections, Academic Years
│   ├── hr/                 # Employees, Increments, Leaves
│   ├── finance/            # Fees, Transport, Fines, Salaries, Expenses,
│   │                       # Budget, Settings, Ledger/Dashboard services
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── script.js           # original UI logic (unchanged)
│   └── api.js               # connects script.js to the Django API
└── e2e/                     # optional automated integration test (Node.js)
```

---

## 3. Install MySQL

Skip this section if you already have a MySQL or MariaDB server running.

### Windows
1. Download **MySQL Community Server** from https://dev.mysql.com/downloads/mysql/ (pick a *8.0.x* or *8.1–8.3.x* installer, not 8.4+ — see the compatibility note above).
2. Run the installer → choose **"Developer Default"** or **"Server only"** → set a root password when prompted → finish setup. Note the root password, you'll need it below.
3. Confirm it's running: open **"MySQL 8.0 Command Line Client"** from the Start Menu, enter the root password — if you get a `mysql>` prompt, it's working.

### macOS
```bash
brew install mysql@8.0
brew services start mysql@8.0
mysql_secure_installation   # set a root password when prompted
```

### Linux (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install mysql-server libmysqlclient-dev
sudo service mysql start
sudo mysql_secure_installation
```

### Create the database and a dedicated user
Open a MySQL prompt (`mysql -u root -p`) and run:

```sql
CREATE DATABASE campustreasury CHARACTER SET utf8mb4;
CREATE USER 'ctuser'@'localhost' IDENTIFIED BY 'ChangeThisPassword123!';
GRANT ALL PRIVILEGES ON campustreasury.* TO 'ctuser'@'localhost';
FLUSH PRIVILEGES;
```

(This exact database + user setup is what this whole guide was tested against.)

---

## 4. Backend setup

```bash
cd backend

# 1. Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate        # Windows (Command Prompt): venv\Scripts\activate.bat
                                 # Windows (PowerShell):    venv\Scripts\Activate.ps1

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment variables
cp .env.example .env            # Windows: copy .env.example .env
# then open .env in a text editor and set:
#   DB_USER=ctuser
#   DB_PASSWORD=ChangeThisPassword123!     (whatever you set in step 3 above)
#   DJANGO_SECRET_KEY=<any long random string>

# 4. Create the database tables
python manage.py migrate

# 5. (Optional but recommended) seed demo data — same students/employees/
#    fees the original frontend shipped with, so the app isn't empty
python manage.py seed_demo_data

# 6. (Optional) create your own Django superuser for the /admin/ site
python manage.py createsuperuser

# 7. Run the server
python manage.py runserver
```

The API is now live at `http://127.0.0.1:8000/api/`, and the Django admin at `http://127.0.0.1:8000/admin/`. Leave this running in its own terminal.

### Demo login accounts (from `seed_demo_data`)

| Role       | Username     | Password   |
|------------|--------------|------------|
| Admin      | `admin`      | `admin123` |
| Accountant | `accountant` | `acc123`   |
| Viewer     | `viewer`     | `view123`  |

Same credentials the original frontend's login screen showed — nothing changes from the user's point of view.

---

## 5. Frontend setup

The frontend is plain HTML/CSS/JS — no build step. It just needs to be served over `http://`, not opened directly as a `file://` path, or the browser's CORS rules will block API calls.

Open a **second terminal** (leave the backend running in the first):

```bash
cd frontend
python3 -m http.server 5500        # Windows: py -m http.server 5500
```

Then open **http://127.0.0.1:5500** in your browser.

> If your backend is running on a different host/port than `http://127.0.0.1:8000`, add this line **before** the `<script src="script.js">` tag in `index.html`:
> ```html
> <script>window.CT_API_BASE = 'http://YOUR-HOST:PORT/api';</script>
> ```

### CORS
`backend/.env`'s `CORS_ALLOWED_ORIGINS` already includes `http://localhost:5500` and `http://127.0.0.1:5500` by default (see `.env.example`), matching the `http.server 5500` command above. If you serve the frontend from a different port, add it to that comma-separated list and restart the backend.

---

## 6. Log in and try it

1. Go to `http://127.0.0.1:5500`
2. Log in as `admin` / `admin123`
3. You should see the Dashboard populated with the seeded demo data (8 students, 5 employees, etc.) — pulled live from MySQL.
4. Go to **Users** → Add a new user, log out, log back in as that user. This round-trips through the real API.
5. Check `backend`'s terminal — you'll see each request logged (e.g. `POST /api/auth/login/ 200`).
6. Open MySQL and run `SELECT * FROM accounts_user;` — your new user is really there.

---

## 7. API reference

All endpoints are under `/api/` and require a JWT (`Authorization: Bearer <token>`) unless noted. List endpoints support `?search=`, pagination, and `?ordering=`.

### Auth & Users
```
POST  /api/auth/login/              { username, password } → { access, refresh, user }
POST  /api/auth/refresh/            { refresh } → { access }
POST  /api/auth/logout/             { refresh } — blacklists the refresh token
GET   /api/auth/me/                 current user + role + permission flags
POST  /api/auth/change-password/    { old_password, new_password }

GET/POST              /api/users/                (admin only)
GET/PUT/PATCH/DELETE  /api/users/{id}/            (admin only)
POST                   /api/users/{id}/unlock/    (admin only)
GET                    /api/audit-log/            (admin + accountant)
```

### Academics
```
/api/academics/academic-years/
/api/academics/departments/
/api/academics/classes/                     (nested `sections`)
/api/academics/sections/
/api/academics/students/                    ?status=&gender=&school_class=&search=
/api/academics/transport-status/
```

### HR
```
/api/hr/employees/          ?status=&department=&search=
/api/hr/increments/
/api/hr/leaves/
```

### Finance
```
/api/finance/fees/                          ?status=&category=&student=&academic_year=
/api/finance/fees/{id}/record-payment/      POST {amount, date, method, receipt_no}

/api/finance/routes/
/api/finance/transport-fees/                ?status=&student=&route=
/api/finance/transport-fees/{id}/record-payment/

/api/finance/fines/                         ?status=&student=
/api/finance/salaries/                      ?status=&employee=&month=
/api/finance/salaries/{id}/mark-paid/       POST {paid_date}

/api/finance/expense-categories/
/api/finance/expenses/                      ?category=&status=&academic_year=
/api/finance/budgets/                       ?academic_year=
/api/finance/manual-transactions/           ?type=

/api/finance/settings/                      GET/PATCH — singleton institution settings
/api/finance/transactions/                  GET — unified ledger, computed on the fly
/api/finance/dashboard/                     GET — authoritative totals for the Dashboard
/api/finance/overdue-check/                 POST — runs the overdue-status sweep on demand
```

### Roles & permissions (server-authoritative)

| Role       | Read | Create/Edit | Delete | Manage Users | View Audit Log |
|------------|------|--------------|--------|---------------|-----------------|
| admin      | ✅   | ✅           | ✅     | ✅            | ✅              |
| accountant | ✅   | ✅           | ❌     | ❌            | ✅              |
| viewer     | ✅   | ❌           | ❌     | ❌            | ❌              |

Every write request is checked against these flags **on the server** (`accounts/permissions.py`) — a Viewer token gets `403 Forbidden` on any POST/PUT/PATCH/DELETE, not just a hidden button.

---

## 8. Testing

### Manual smoke test (2 minutes)
1. Start backend (`python manage.py runserver`) and frontend (`python3 -m http.server 5500`)
2. Log in as each of the 3 demo accounts, confirm the sidebar/menu options differ per role
3. As Viewer, try clicking anything that edits data — should show a "🔒 permission" toast, and the network tab (F12) should show `403` if it ever reaches the server
4. Add a user as Admin, log out, log in as that user

### Automated end-to-end test
`e2e/test_module1.js` drives the **real** `index.html`/`script.js`/`api.js` (via [jsdom](https://github.com/jsdom/jsdom)) against a **running Django server**, and checks the results both in the simulated browser AND by querying the database fresh — so it can't be fooled by stale in-memory state.

```bash
# Terminal 1 — backend must be running on port 8020 for this test
cd backend
python manage.py runserver 127.0.0.1:8020

# Terminal 2
cd e2e
npm install       # first time only — installs jsdom
node test_module1.js
```

Expected output ends with `FAIL: 0`. This test is safe to run repeatedly against the same database (it cleans up the test user it creates).

**Last verified run (real MySQL 8.0.46, Django 5.2, fresh + repeated runs):** `PASS: 32, FAIL: 0`, twice in a row against the same persistent database.

---

## 9. Troubleshooting

**`django.db.utils.NotSupportedError: MySQL 8.4 or later is required`**
Your installed Django is 6.0+. Run `pip install "Django>=5.0,<5.3"` inside your venv, matching `requirements.txt`.

**`django.db.utils.OperationalError: (2002, "Can't connect to MySQL server...")`**
MySQL isn't running, or `DB_HOST`/`DB_PORT` in `.env` don't match. Confirm with `mysqladmin ping` (or check the MySQL service is started).

**`Access denied for user 'ctuser'@'localhost'`**
The `.env` password doesn't match what you set in the `CREATE USER` step, or you skipped `FLUSH PRIVILEGES;`.

**`mysqlclient` fails to build on Windows**
Make sure you're using a 64-bit Python matching a pre-built wheel (Python 3.10–3.12 on 64-bit Windows all have wheels on PyPI — this should just work with a plain `pip install`). If it still fails, install the "MySQL Connector C" from the MySQL installer and retry.

**Frontend loads but login always fails with a network error**
Almost always CORS or a wrong `API_BASE`. Confirm: (1) you're opening the frontend via `http://127.0.0.1:5500`, not `file://...index.html`; (2) `backend/.env`'s `CORS_ALLOWED_ORIGINS` includes that origin; (3) the backend server is actually running.

**Browser shows `403 Forbidden` for a logged-in Admin**
Check your JWT hasn't expired (`JWT_ACCESS_MIN` in `.env`, default 60 minutes) — log out and back in.

---

## 10. `requirements.txt` / `.env.example`

Both are kept up to date with what this guide actually uses — MySQL driver, JWT, CORS, filtering, and `python-dotenv` so `.env` is picked up automatically. If you add a new Python package while extending the backend, remember to `pip freeze` (or manually add) it to `requirements.txt` so the next fresh install stays reproducible.
