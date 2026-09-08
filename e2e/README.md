# Automated end-to-end tests

See the main `backend/README.md` §8 "Testing" for full instructions.

Four suites:
- `test_module1.js` — Login / Roles / Users / Audit Log / initial data load
- `test_module2.js` — Students, Fees, scholarships/concessions, instalment
  plans, partial/multiple payments, in-order + overpayment guards, overdue
  statuses, student ledger, cascading delete, and role permissions
- `test_module3.js` — Route Master, Transport Fee (assign/partial/full
  payment, the custom-route boundary), Disciplinary Fines, Salaries
  (including duplicate-month rejection), Expense Categories + Expenses,
  Budget (`spent` derived from a real linked Expense), and role permissions
- `test_module4.js` — Manual Transactions (create/delete, ledger merge,
  validation, role permissions)

Quick version:
```bash
cd ../backend && python manage.py runserver 127.0.0.1:8020   # terminal 1
npm install                                                   # terminal 2, first time only
node test_module1.js
node test_module2.js
node test_module3.js
node test_module4.js
```
All four expect the demo seed data (`python manage.py seed_demo_data`) to
already be loaded, and are safe to re-run repeatedly against the same
database — each cleans up the records it creates.

**Last verified run (real MySQL-compatible database, Django 5.2):**
Module 1 32/32 pass, Module 2 41/41 pass, Module 3 53/53 pass,
Module 4 20/20 pass — each twice in a row against the same persistent
database.
