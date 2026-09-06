# Automated end-to-end tests

See the main `backend/README.md` §8 "Testing" for full instructions.

Two suites:
- `test_module1.js` — Login / Roles / Users / Audit Log / initial data load
- `test_module2.js` — Students, Fees, scholarships/concessions, instalment
  plans, partial/multiple payments, in-order + overpayment guards, overdue
  statuses, student ledger, cascading delete, and role permissions

Quick version:
```bash
cd ../backend && python manage.py runserver 127.0.0.1:8020   # terminal 1
npm install                                                   # terminal 2, first time only
node test_module1.js
node test_module2.js
```
Both expect the demo seed data (`python manage.py seed_demo_data`) to already
be loaded, and are safe to re-run repeatedly against the same database —
each cleans up the records it creates.

**Last verified run (real MySQL 8.0.46, Django 5.2):** Module 1 32/32 pass,
Module 2 41/41 pass — twice in a row against the same persistent database.
