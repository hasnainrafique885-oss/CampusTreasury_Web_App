# Automated end-to-end test (Module 1: Login/Roles/Users/Dashboard)

See the main `backend/README.md` §8 "Testing" for full instructions.

Quick version:
```bash
cd ../backend && python manage.py runserver 127.0.0.1:8020   # terminal 1
npm install && node test_module1.js                          # terminal 2
```
Expects the demo seed data (`python manage.py seed_demo_data`) to already be loaded.
