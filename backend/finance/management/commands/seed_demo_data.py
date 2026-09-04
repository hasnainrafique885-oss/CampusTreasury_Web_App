"""
Seeds the database with the same demo dataset the frontend (script.js)
ships with by default — Superior College's sample students, employees,
fees, salaries, expenses, budget, fines and transport routes — so the
API and the existing UI show identical data on first run.

Usage:
    python manage.py seed_demo_data
"""
from datetime import date

from django.core.management.base import BaseCommand
from django.db import transaction

from academics.models import AcademicYear, SchoolClass, Student
from accounts.models import User
from finance.models import (
    Budget, Expense, ExpenseCategory, Fee, Fine, InstitutionSettings,
    Route, Salary, TransportFee,
)
from hr.models import Employee


class Command(BaseCommand):
    help = "Seed demo data matching the original frontend's default dataset."

    @transaction.atomic
    def handle(self, *args, **options):
        year, _ = AcademicYear.objects.get_or_create(label='2024-25', defaults={'is_active': True})
        AcademicYear.objects.get_or_create(label='2025-26')

        self._seed_users()
        self._seed_settings()
        classes = self._seed_classes()
        students = self._seed_students(classes, year)
        self._seed_fees(students, year)
        employees = self._seed_employees()
        self._seed_salaries(employees)
        self._seed_fines(students)
        routes = self._seed_routes()
        self._seed_transport_fees(students, routes, year)
        categories = self._seed_expense_categories()
        self._seed_expenses(categories, year)
        self._seed_budget(categories, year)

        self.stdout.write(self.style.SUCCESS('Demo data seeded successfully.'))

    def _seed_users(self):
        defaults = [
            ('admin', 'admin123', 'admin', 'Principal Admin'),
            ('accountant', 'acc123', 'accountant', 'Razia Sultana'),
            ('viewer', 'view123', 'viewer', 'Zubair Ahmed'),
        ]
        for username, password, role, full_name in defaults:
            user, created = User.objects.get_or_create(
                username=username, defaults={'role': role, 'full_name': full_name, 'is_staff': True}
            )
            if created:
                user.set_password(password)
                user.save()
                self.stdout.write(f'  user {username} / {password} ({role})')

    def _seed_settings(self):
        s = InstitutionSettings.load()
        s.inst_name = 'Superior College'
        s.city = 'Lahore'
        s.academic_year_label = '2024–25'
        s.admin_email = 'admin@superiorcollege.edu.pk'
        s.contact = '+92-300-0000000'
        s.address = 'Main Campus, Lahore, Pakistan'
        s.late_fee_pct = 5
        s.fee_due_day = 25
        s.session_timeout_min = 15
        s.bank_name = 'MCB Bank Ltd'
        s.bank_branch = 'Johar Town'
        s.bank_account_title = 'Superior College'
        s.bank_account_no = '0123456789'
        s.bank_iban = 'PK00MCB0000000123456789'
        s.bank_jazzcash = '0300-8001234'
        s.bank_easypaisa = '0321-7001234'
        s.accounts_phone = '042-35761234'
        s.office_hours = '9am–3pm (Mon–Sat)'
        s.customer_code = 'SC'
        s.voucher_prefix = 'FEE'
        s.voucher_instructions = [
            'Fee must be deposited on or before the due date.',
            'Only the amount specified on the fee voucher is acceptable.',
            'Fee once paid is non-refundable and non-transferable, subject to institution policy.',
            'Students must retain the paid voucher/receipt for their records.',
            'For fee-related queries, contact the Accounts/Finance Office.',
            'Late payment may be subject to applicable late fees or institution policy.',
        ]
        s.save()

    def _seed_classes(self):
        rows = [
            ('ICS', 'Inter-ICS', 'Boys', 15000, ['A', 'B', 'C']),
            ('ICS', 'Inter-ICS', 'Girls', 15000, ['A', 'B']),
            ('FSc Pre-Medical', 'Inter-FSc-Pre-Med', 'Boys', 14000, ['A', 'B', 'C']),
            ('FSc Pre-Medical', 'Inter-FSc-Pre-Med', 'Girls', 14000, ['A', 'B']),
            ('FSc Pre-Engineering', 'Inter-FSc-Pre-Eng', 'Boys', 14000, ['A', 'B']),
            ('FSc Pre-Engineering', 'Inter-FSc-Pre-Eng', 'Girls', 14000, ['A']),
            ('ICom', 'Inter-ICom', 'Boys', 13000, ['A', 'B']),
            ('ICom', 'Inter-ICom', 'Girls', 13000, ['A']),
            ('FA', 'Inter-FA', 'Boys', 12000, ['A']),
            ('FA', 'Inter-FA', 'Girls', 12000, ['A']),
        ]
        classes = {}
        for name, code, gender, fee, sections in rows:
            cls, _ = SchoolClass.objects.get_or_create(
                code=code, gender=gender, defaults={'name': name, 'default_fee': fee}
            )
            from academics.models import Section
            for sec in sections:
                Section.objects.get_or_create(school_class=cls, name=sec)
            classes[code] = cls
        return classes

    def _seed_students(self, classes, year):
        rows = [
            dict(id='STU-2024-010', name='Noman Arshad', father='Arshad Mehmood', roll='B-ICS-2024-01', gender='Male', dept='ICS (Boys)', cls='Inter-ICS', section='A', sem='1st Year', fee=15000, status='Pending', contact='0300-9999222', address='Township, Lahore'),
            dict(id='STU-2024-012', name='Kamran Ali', father='Ali Raza', roll='B-FSE-2024-01', gender='Male', dept='FSc Pre-Engineering (Boys)', cls='Inter-FSc-Pre-Eng', section='A', sem='2nd Year', fee=14000, status='Overdue', contact='0300-9999444', address='Faisal Town, Lahore'),
            dict(id='STU-2024-014', name='Shahid Hussain', father='Hussain Bakhsh', roll='B-FA-2024-01', gender='Male', dept='FA (Boys)', cls='Inter-FA', section='A', sem='2nd Year', fee=12000, status='Pending', contact='0300-9999666', address='Sant Nagar, Lahore'),
            dict(id='STU-2024-016', name='Asad Rehman', father='Abdul Rehman', roll='B-FSC-2024-01', gender='Male', dept='FSc Pre-Medical (Boys)', cls='Inter-FSc-Pre-Med', section='B', sem='1st Year', fee=14000, status='Paid', contact='0300-9991111', address='Gulshan Ravi, Lahore'),
            dict(id='STU-2024-009', name='Hina Bashir', father='Bashir Ahmed', roll='G-ICS-2024-01', gender='Female', dept='ICS (Girls)', cls='Inter-ICS', section='A', sem='1st Year', fee=15000, status='Paid', contact='0300-9999111', address='Ichhra, Lahore'),
            dict(id='STU-2024-011', name='Sana Tariq', father='Tariq Butt', roll='G-FSC-2024-01', gender='Female', dept='FSc Pre-Medical (Girls)', cls='Inter-FSc-Pre-Med', section='A', sem='1st Year', fee=14000, status='Paid', contact='0300-9999333', address='Shadman, Lahore'),
            dict(id='STU-2024-013', name='Rabia Malik', father='Malik Nawaz', roll='G-ICM-2024-01', gender='Female', dept='ICom (Girls)', cls='Inter-ICom', section='A', sem='1st Year', fee=13000, status='Paid', contact='0300-9999555', address='Cavalry Ground, Lahore'),
            dict(id='STU-2024-015', name='Nadia Khalid', father='Khalid Mehmood', roll='G-FA-2024-01', gender='Female', dept='FA (Girls)', cls='Inter-FA', section='B', sem='2nd Year', fee=12000, status='Overdue', contact='0300-9992222', address='Saggian, Lahore'),
        ]
        students = {}
        for r in rows:
            gender_key = 'Boys' if r['gender'] == 'Male' else 'Girls'
            cls = SchoolClass.objects.filter(code=r['cls'], gender=gender_key).first()
            stu, _ = Student.objects.get_or_create(
                roll_no=r['roll'],
                defaults=dict(
                    student_id=r['id'], name=r['name'], father_name=r['father'], gender=r['gender'],
                    department=r['dept'], school_class=cls, section=r['section'], semester=r['sem'],
                    default_fee=r['fee'], status=r['status'], contact=r['contact'], address=r['address'],
                    academic_year=year,
                ),
            )
            students[r['name']] = stu
        return students

    def _seed_fees(self, students, year):
        rows = [
            ('Noman Arshad', '1st Year', 15000, None, '', '', 'Pending', date(2025, 2, 15), 'Tuition'),
            ('Kamran Ali', '2nd Year', 14000, None, '', '', 'Overdue', date(2025, 1, 5), 'Tuition'),
            ('Shahid Hussain', '2nd Year', 12000, None, '', '', 'Pending', date(2025, 2, 20), 'Tuition'),
            ('Asad Rehman', '1st Year', 14000, date(2025, 1, 5), 'Cash', 'REC-1006', 'Paid', date(2025, 1, 10), 'Tuition'),
            ('Hina Bashir', '1st Year', 15000, date(2025, 1, 3), 'Cash', 'REC-1007', 'Paid', date(2025, 1, 10), 'Tuition'),
            ('Sana Tariq', '1st Year', 14000, date(2025, 1, 7), 'Online', 'REC-1008', 'Paid', date(2025, 1, 15), 'Tuition'),
            ('Rabia Malik', '1st Year', 13000, date(2025, 1, 9), 'Cash', 'REC-1009', 'Paid', date(2025, 1, 15), 'Tuition'),
            ('Nadia Khalid', '2nd Year', 12000, None, '', '', 'Overdue', date(2025, 1, 8), 'Tuition'),
            ('Noman Arshad', '1st Year', 5000, date(2025, 1, 2), 'Cash', 'REC-1010', 'Paid', date(2025, 1, 5), 'Admission'),
            ('Kamran Ali', '2nd Year', 3000, None, '', '', 'Overdue', date(2025, 1, 5), 'Transport'),
        ]
        for name, sem, amt, paid_date, method, receipt, status, due, category in rows:
            stu = students.get(name)
            if not stu:
                continue
            from finance.services import next_id
            fee_id = next_id(Fee.objects.all(), 'fee_id', 'F', pad=3)
            Fee.objects.get_or_create(
                student=stu, semester=sem, amount=amt, category=category, due_date=due,
                defaults=dict(
                    fee_id=fee_id, paid_amount=amt if status == 'Paid' else 0, method=method,
                    receipt_no=receipt, status=status, paid_date=paid_date, academic_year=year,
                ),
            )

    def _seed_employees(self):
        rows = [
            ('EMP-2024-001', 'Dr. Tariq Ahmed', 'Professor', 'Computer Science', 120000, 20000, '0321-1111111', 'tariq@gct.edu.pk', 'DHA, Lahore'),
            ('EMP-2024-002', 'Ms. Hina Batool', 'Lecturer', 'Mathematics', 80000, 12000, '0321-2222222', 'hina@gct.edu.pk', 'Gulberg, Lahore'),
            ('EMP-2024-003', 'Mr. Kashif Raza', 'Demonstrator', 'Physics', 55000, 8000, '0321-3333333', 'kashif@gct.edu.pk', 'Model Town, Lahore'),
            ('EMP-2024-004', 'Dr. Samina Akhtar', 'HOD', 'Commerce', 140000, 25000, '0321-4444444', 'samina@gct.edu.pk', 'Johar Town, Lahore'),
            ('EMP-2024-005', 'Mr. Adeel Hussain', 'Admin Officer', 'Administration', 65000, 10000, '0321-5555555', 'adeel@gct.edu.pk', 'Allama Iqbal Town, Lahore'),
        ]
        employees = {}
        for emp_id, name, desig, dept, sal, allow, contact, email, addr in rows:
            emp, _ = Employee.objects.get_or_create(
                employee_id=emp_id,
                defaults=dict(name=name, designation=desig, department=dept, salary=sal,
                               allowance=allow, contact=contact, email=email, address=addr, status='Active'),
            )
            employees[name] = emp
        return employees

    def _seed_salaries(self, employees):
        for name, emp in employees.items():
            status = 'Pending' if emp.designation == 'HOD' else 'Paid'
            from finance.services import next_id
            sal_id = next_id(Salary.objects.all(), 'sal_id', 'SAL', pad=3)
            Salary.objects.get_or_create(
                employee=emp, month='March 2025',
                defaults=dict(sal_id=sal_id, basic=emp.salary, allowance=emp.allowance,
                               deduction=0, status=status,
                               paid_date=date(2025, 3, 1) if status == 'Paid' else None),
            )

    def _seed_fines(self, students):
        rows = [
            ('Kamran Ali', 'Uniform Violation', 500, date(2025, 1, 12), 'Pending'),
            ('Nadia Khalid', 'Late Attendance', 300, date(2025, 1, 8), 'Paid'),
        ]
        for name, reason, amt, dt, status in rows:
            stu = students.get(name)
            if not stu:
                continue
            from finance.services import next_id
            fine_id = next_id(Fine.objects.all(), 'fine_id', 'FIN')
            Fine.objects.get_or_create(
                student=stu, reason=reason, date=dt,
                defaults=dict(fine_id=fine_id, amount=amt, status=status),
            )

    def _seed_routes(self):
        rows = [
            ('Model Town → Campus', 'LES-4521', 'Ahmed Khan', '0300-1234567', 40, 2500, date(2026, 11, 15), date(2026, 9, 20)),
            ('Johar Town → Campus', 'LEB-7788', 'Bilal Ahmed', '0301-9876543', 35, 2500, date(2027, 2, 1), date(2026, 12, 10)),
        ]
        routes = {}
        for name, veh, driver, phone, cap, fee, fitness, insurance in rows:
            from finance.services import next_id
            route_id = next_id(Route.objects.all(), 'route_id', 'RT')
            r, _ = Route.objects.get_or_create(
                name=name,
                defaults=dict(route_id=route_id, vehicle_no=veh, driver_name=driver, driver_phone=phone,
                               capacity=cap, monthly_fee=fee, status='Active',
                               fitness_expiry=fitness, insurance_expiry=insurance),
            )
            routes[name] = r
        return routes

    def _seed_transport_fees(self, students, routes, year):
        rows = [
            ('Kamran Ali', 'Model Town → Campus', 2500, None, '', '', 'Overdue', date(2025, 1, 5)),
            ('Hina Bashir', 'Johar Town → Campus', 2500, date(2025, 1, 3), 'Cash', 'TFR-2001', 'Paid', date(2025, 1, 10)),
        ]
        for name, route_name, amt, paid_date, method, receipt, status, due in rows:
            stu = students.get(name)
            route = routes.get(route_name)
            if not stu or not route:
                continue
            from finance.services import next_id
            tf_id = next_id(TransportFee.objects.all(), 'tf_id', 'TF')
            TransportFee.objects.get_or_create(
                student=stu, route=route, due_date=due,
                defaults=dict(tf_id=tf_id, amount=amt, paid_amount=amt if status == 'Paid' else 0,
                               method=method, receipt_no=receipt, status=status,
                               paid_date=paid_date, academic_year=year),
            )

    def _seed_expense_categories(self):
        rows = [
            ('IT & Labs', '🖥️', '#20954a', 150000),
            ('Utilities', '🏢', '#f59e0b', 100000),
            ('Library', '📚', '#3b82f6', 80000),
            ('Maintenance', '🧹', '#ef4444', 60000),
            ('Stationery', '✏️', '#8b5cf6', 30000),
            ('Transport', '🚌', '#06b6d4', 40000),
            ('Events', '🎉', '#ec4899', 50000),
            ('Other', '📦', '#6b7280', 20000),
        ]
        cats = {}
        for name, icon, color, budget in rows:
            cat, _ = ExpenseCategory.objects.get_or_create(name=name, defaults=dict(icon=icon, color=color, budget=budget))
            cats[name] = cat
        return cats

    def _seed_expenses(self, cats, year):
        rows = [
            ('Lab Equipment Purchase', 'IT & Labs', 42000, date(2025, 1, 5), 'Agha Steel', 'Principal'),
            ('Electricity Bill', 'Utilities', 18000, date(2025, 1, 8), 'LESCO', 'Admin'),
            ('Library Books', 'Library', 15000, date(2025, 1, 10), 'Ali Books', 'Principal'),
            ('Building Maintenance', 'Maintenance', 12000, date(2025, 1, 12), 'Noor Const.', 'Admin'),
            ('Office Stationery', 'Stationery', 5000, date(2025, 1, 15), 'Pak Traders', 'Admin'),
            ('Internet Connection', 'Utilities', 8000, date(2025, 1, 18), 'StormFiber', 'IT Dept'),
            ('Projector Repair', 'IT & Labs', 7500, date(2025, 1, 20), 'Tech Zone', 'HOD'),
            ('Sports Equipment', 'Other', 10000, date(2025, 1, 22), 'Sports World', 'Principal'),
            ('Annual Day Event', 'Events', 35000, date(2025, 2, 3), 'Event Co.', 'Principal'),
            ('Bus Fuel & Maintenance', 'Transport', 22000, date(2025, 2, 10), 'Shell', 'Admin'),
        ]
        for desc, cat_name, amt, dt, vendor, approver in rows:
            Expense.objects.get_or_create(
                description=desc, date=dt,
                defaults=dict(category=cats[cat_name], amount=amt, vendor=vendor,
                               approver=approver, status='Approved', academic_year=year),
            )

    def _seed_budget(self, cats, year):
        rows = [
            ('ICS', 120000, ['IT & Labs']),
            ('FSc Pre-Med', 110000, ['Maintenance']),
            ('FSc Pre-Eng', 110000, []),
            ('ICom', 80000, ['Stationery']),
            ('FA', 70000, ['Events']),
            ('Administration', 120000, ['Utilities', 'Transport', 'Other']),
            ('Library', 80000, ['Library']),
        ]
        for dept, allocated, cat_names in rows:
            b, _ = Budget.objects.get_or_create(department=dept, academic_year=year, defaults={'allocated': allocated})
            b.expense_categories.set([cats[c] for c in cat_names if c in cats])
