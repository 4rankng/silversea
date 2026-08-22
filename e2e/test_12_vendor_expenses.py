#!/usr/bin/env python3
"""E2E Test Suite 12: Vendor Expenses & Payables"""
import sys, os, time
from uuid import uuid4
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *

def test_vendor_expenses(ctx: SilverseaTestContext, results: TestResults):
    run_suffix = uuid4().hex[:10]
    supplier_name = f'E2E Supplier TC1201 {run_suffix}'
    api = ApiClient()
    api.login('admin', 'Abc123')
    checker_api = ApiClient()
    checker_api.login('ketoan', 'Abc123')
    approver_api = ApiClient()
    approver_api.login('giamdoc', 'Abc123')

    def advance_governance(action):
        checked = checker_api.post(
            f'/api/governance-actions/{action["id"]}/check',
            {'expectedVersion': action['version']},
        )
        if checked.get('status') != 200:
            return {'status': checked.get('status'), 'error': checked.get('error')}
        return approver_api.post(
            f'/api/governance-actions/{action["id"]}/approve',
            {'expectedVersion': checked['data']['version']},
        )

    def materialized_id(response):
        data = response.get('data', {})
        if data.get('status') != 'PENDING_CHECK':
            return data.get('id'), response
        approved = advance_governance(data)
        application = approved.get('data', {}).get('applicationResult') or {}
        return application.get('subjectId'), approved

    def create_governed_expense(payload):
        response = api.post('/api/expenses', {
            **payload,
            'reason': 'Kiểm thử E2E quy trình chi phí có phê duyệt',
        })
        if response.get('status') not in (200, 201):
            return None, None, response
        expense_id, approved = materialized_id(response)
        if approved.get('status') != 200 or not expense_id:
            return None, None, approved
        expense = api.get(f'/api/expenses/{expense_id}')
        return expense_id, expense.get('data', {}).get('updatedAt'), expense

    supplier_id = None
    category_id = None
    recurring_category_id = None
    expense_unpaid_id = None
    expense_paid_id = None
    expense_with_truck_id = None
    expense_with_trailer_id = None
    expense_no_vehicle_id = None
    expense_to_delete_id = None
    expense_paid_for_delete_id = None
    expense_unpaid_updated_at = None
    expense_to_delete_updated_at = None
    expense_paid_for_delete_updated_at = None
    truck_id = None
    trailer_id = None

    # ── Pre-fetch a truck and trailer for later tests ──
    trucks_resp = api.get('/api/trucks')
    truck_items = trucks_resp.get('data', {}).get('items', [])
    active_truck = next((truck for truck in truck_items if truck.get('status') == 'ACTIVE'), None)
    if active_truck:
        truck_id = active_truck['id']

    trailers_resp = api.get('/api/trailers')
    trailer_items = trailers_resp.get('data', {}).get('items', [])
    if trailer_items:
        trailer_id = trailer_items[0]['id']

    # ══════════════════════════════════════════════════════════════════
    # Supplier CRUD (TC-1201 to TC-1203)
    # ══════════════════════════════════════════════════════════════════

    # TC-1201: Create supplier
    resp = api.post('/api/suppliers', {
        'name': supplier_name,
        'phone': '0909123456',
        'note': 'E2E test supplier',
    })
    if resp.get('status') in (200, 201) and resp.get('data', {}).get('id'):
        supplier_id, resp = materialized_id(resp)
    if supplier_id:
        results.pass_('TC-1201', 'Create supplier via API', f'ID={supplier_id}')
    else:
        results.fail('TC-1201', 'Create supplier', f'Status={resp.get("status")} body={resp.get("error")}')

    # TC-1202: List suppliers
    resp = api.get('/api/suppliers')
    if resp.get('status') == 200:
        items = resp.get('data', {}).get('items', [])
        found = supplier_id and any(i.get('id') == supplier_id for i in items)
        if found:
            results.pass_('TC-1202', 'List suppliers includes created')
        else:
            results.pass_('TC-1202', 'List suppliers returns 200', 'Created supplier not in page')
    else:
        results.fail('TC-1202', 'List suppliers', f'Status={resp.get("status")}')

    # TC-1203: Duplicate supplier name
    resp = api.post('/api/suppliers', {
        'name': supplier_name,
        'phone': '0909999999',
    })
    if resp.get('status') in (409, 400):
        results.pass_('TC-1203', 'Duplicate supplier name rejected', f'Status={resp.get("status")}')
    elif resp.get('status') in (200, 201):
        results.pass_('TC-1203', 'Duplicate supplier name accepted (no unique constraint)')
    else:
        results.fail('TC-1203', 'Duplicate supplier', f'Status={resp.get("status")}')

    # ══════════════════════════════════════════════════════════════════
    # Expense Category Tests (TC-1204 to TC-1206)
    # ══════════════════════════════════════════════════════════════════

    # TC-1204: Create expense category
    resp = api.post('/api/expense-categories', {
        'name': f'E2E Category TC1204 {run_suffix}',
        'status': 'ACTIVE',
    })
    if resp.get('status') in (200, 201) and resp.get('data', {}).get('id'):
        category_id, resp = materialized_id(resp)
    if category_id:
        results.pass_('TC-1204', 'Create expense category', f'ID={category_id}')
    else:
        results.fail('TC-1204', 'Create expense category', f'Status={resp.get("status")} body={resp.get("error")}')

    # TC-1205: List expense categories
    resp = api.get('/api/expense-categories')
    if resp.get('status') == 200:
        results.pass_('TC-1205', 'List expense categories returns 200')
    else:
        results.fail('TC-1205', 'List expense categories', f'Status={resp.get("status")}')

    # TC-1206: Create recurring category
    resp = api.post('/api/expense-categories', {
        'name': f'E2E Recurring Category TC1206 {run_suffix}',
        'isRenewable': True,
        'reminderLeadDays': 15,
        'status': 'ACTIVE',
    })
    if resp.get('status') in (200, 201) and resp.get('data', {}).get('id'):
        recurring_category_id, resp = materialized_id(resp)
    if recurring_category_id:
        results.pass_('TC-1206', 'Create recurring expense category', f'ID={recurring_category_id}')
    else:
        results.fail('TC-1206', 'Create recurring category', f'Status={resp.get("status")} body={resp.get("error")}')

    # ══════════════════════════════════════════════════════════════════
    # Expense CRUD (TC-1210 to TC-1218)
    # ══════════════════════════════════════════════════════════════════

    if not supplier_id or not category_id:
        results.skip('TC-1210', 'Create UNPAID expense', 'No supplier_id or category_id')
        results.skip('TC-1211', 'Create PAID expense', 'Prerequisite failed')
        results.skip('TC-1212', 'Create expense with truck', 'Prerequisite failed')
        results.skip('TC-1213', 'Create expense with trailer', 'Prerequisite failed')
        results.skip('TC-1214', 'Create expense without truck', 'Prerequisite failed')
        results.skip('TC-1215', 'List expenses', 'Prerequisite failed')
        results.skip('TC-1216', 'Edit UNPAID expense', 'Prerequisite failed')
        results.skip('TC-1217', 'Delete UNPAID expense', 'Prerequisite failed')
        results.skip('TC-1218', 'Delete PAID expense', 'Prerequisite failed')
    else:
        # TC-1210: Create UNPAID expense
        expense_unpaid_id, expense_unpaid_updated_at, resp = create_governed_expense({
            'supplierId': supplier_id,
            'categoryId': category_id,
            'amount': 500000,
            'expenseDate': '2026-06-01',
            'paymentStatus': 'UNPAID',
            'vehicleComponent': 'TRUCK',
        })
        if expense_unpaid_id:
            results.pass_('TC-1210', 'Create UNPAID expense', f'ID={expense_unpaid_id}')
        else:
            results.fail('TC-1210', 'Create UNPAID expense', f'Status={resp.get("status")} body={resp.get("error")}')

        # TC-1211: Create PAID expense
        expense_paid_id, _, resp = create_governed_expense({
            'supplierId': supplier_id,
            'categoryId': category_id,
            'amount': 300000,
            'expenseDate': '2026-06-01',
            'paymentStatus': 'PAID',
            'vehicleComponent': 'TRUCK',
        })
        if expense_paid_id:
            results.pass_('TC-1211', 'Create PAID expense', f'ID={expense_paid_id}')
        else:
            results.fail('TC-1211', 'Create PAID expense', f'Status={resp.get("status")} body={resp.get("error")}')

        # TC-1212: Create expense with truck
        if truck_id:
            expense_with_truck_id, _, resp = create_governed_expense({
                'supplierId': supplier_id,
                'categoryId': category_id,
                'amount': 200000,
                'expenseDate': '2026-06-01',
                'paymentStatus': 'UNPAID',
                'vehicleComponent': 'TRUCK',
                'truckId': truck_id,
            })
            if expense_with_truck_id:
                results.pass_('TC-1212', 'Create expense with truck', f'ID={expense_with_truck_id}')
            else:
                results.fail('TC-1212', 'Create expense with truck', f'Status={resp.get("status")} body={resp.get("error")}')
        else:
            results.skip('TC-1212', 'Create expense with truck', 'No truck in system')

        # TC-1213: Create expense with trailer
        if trailer_id:
            expense_with_trailer_id, _, resp = create_governed_expense({
                'supplierId': supplier_id,
                'categoryId': category_id,
                'amount': 150000,
                'expenseDate': '2026-06-01',
                'paymentStatus': 'UNPAID',
                'vehicleComponent': 'TRAILER',
                'truckId': trailer_id,
            })
            if expense_with_trailer_id:
                results.pass_('TC-1213', 'Create expense with trailer', f'ID={expense_with_trailer_id}')
            else:
                results.fail('TC-1213', 'Create expense with trailer', f'Status={resp.get("status")} body={resp.get("error")}')
        else:
            results.skip('TC-1213', 'Create expense with trailer', 'No trailer in system')

        # TC-1214: Create expense without truck/trailer
        expense_no_vehicle_id, _, resp = create_governed_expense({
            'supplierId': supplier_id,
            'categoryId': category_id,
            'amount': 100000,
            'expenseDate': '2026-06-01',
            'paymentStatus': 'UNPAID',
            'vehicleComponent': 'TRUCK',
        })
        if expense_no_vehicle_id:
            results.pass_('TC-1214', 'Create expense without truckId', f'ID={expense_no_vehicle_id}')
        else:
            results.fail('TC-1214', 'Create expense without truck', f'Status={resp.get("status")} body={resp.get("error")}')

        # TC-1215: List expenses
        resp = api.get('/api/expenses')
        if resp.get('status') == 200:
            items = resp.get('data', {}).get('items', [])
            results.pass_('TC-1215', f'List expenses returns array ({len(items)} items)')
        else:
            results.fail('TC-1215', 'List expenses', f'Status={resp.get("status")}')

        # TC-1216: Edit UNPAID expense
        if expense_unpaid_id:
            resp = api.put(f'/api/expenses/{expense_unpaid_id}', {
                'amount': 750000,
                'note': 'Updated by E2E TC-1216',
                'reason': 'Kiểm thử E2E cập nhật chi phí',
            }, {'If-Unmodified-Since': expense_unpaid_updated_at})
            if resp.get('status') in (200, 201):
                _, resp = materialized_id(resp)
            if resp.get('status') == 200:
                results.pass_('TC-1216', 'Edit UNPAID expense')
            else:
                results.fail('TC-1216', 'Edit UNPAID expense', f'Status={resp.get("status")} body={resp.get("error")}')
        else:
            results.skip('TC-1216', 'Edit UNPAID expense', 'No unpaid expense ID')

        # Create a fresh UNPAID expense specifically for deletion tests
        expense_to_delete_id, expense_to_delete_updated_at, _ = create_governed_expense({
            'supplierId': supplier_id,
            'categoryId': category_id,
            'amount': 250000,
            'expenseDate': '2026-06-01',
            'paymentStatus': 'UNPAID',
            'vehicleComponent': 'TRUCK',
        })
        # Create a fresh PAID expense for TC-1218
        expense_paid_for_delete_id, expense_paid_for_delete_updated_at, _ = create_governed_expense({
            'supplierId': supplier_id,
            'categoryId': category_id,
            'amount': 400000,
            'expenseDate': '2026-06-01',
            'paymentStatus': 'PAID',
            'vehicleComponent': 'TRUCK',
        })
        # TC-1217: Delete UNPAID expense
        if expense_to_delete_id:
            resp = api.delete(
                f'/api/expenses/{expense_to_delete_id}',
                {'If-Unmodified-Since': expense_to_delete_updated_at},
                {'reason': 'Kiểm thử E2E xóa chi phí chưa thanh toán'},
            )
            if resp.get('status') in (200, 201):
                _, resp = materialized_id(resp)
            if resp.get('status') == 200:
                results.pass_('TC-1217', 'Delete UNPAID expense')
            else:
                results.fail('TC-1217', 'Delete UNPAID expense', f'Status={resp.get("status")} body={resp.get("error")}')
        else:
            results.skip('TC-1217', 'Delete UNPAID expense', 'No expense to delete')

        # TC-1218: Delete PAID expense — expect error or soft-delete
        if expense_paid_for_delete_id:
            resp = api.delete(
                f'/api/expenses/{expense_paid_for_delete_id}',
                {'If-Unmodified-Since': expense_paid_for_delete_updated_at},
                {'reason': 'Kiểm thử E2E xóa chi phí đã thanh toán'},
            )
            if resp.get('status') in (200, 201):
                _, resp = materialized_id(resp)
            if resp.get('status') in (200, 201):
                results.pass_('TC-1218', 'Delete PAID expense accepted (soft-delete with ledger adjustment)')
            elif resp.get('status') in (400, 403, 409):
                results.pass_('TC-1218', 'Delete PAID expense rejected', f'Status={resp.get("status")}')
            else:
                results.fail('TC-1218', 'Delete PAID expense', f'Unexpected status={resp.get("status")}')
        else:
            results.skip('TC-1218', 'Delete PAID expense', 'No paid expense to test')

    # ══════════════════════════════════════════════════════════════════
    # Validation Tests (TC-1220 to TC-1225)
    # ══════════════════════════════════════════════════════════════════

    # TC-1220: Missing supplierId
    resp = api.post('/api/expenses', {
        'categoryId': category_id or 1,
        'amount': 100000,
        'expenseDate': '2026-06-01',
        'paymentStatus': 'UNPAID',
        'vehicleComponent': 'TRUCK',
    })
    if resp.get('status') == 400:
        results.pass_('TC-1220', 'Missing supplierId → 400')
    else:
        results.fail('TC-1220', 'Missing supplier validation', f'Expected 400, got {resp.get("status")}')

    # TC-1221: Missing categoryId and amount
    resp = api.post('/api/expenses', {
        'supplierId': supplier_id or 1,
        'expenseDate': '2026-06-01',
        'paymentStatus': 'UNPAID',
    })
    if resp.get('status') == 400:
        results.pass_('TC-1221', 'Missing categoryId/amount → 400')
    else:
        results.fail('TC-1221', 'Missing category/amount validation', f'Expected 400, got {resp.get("status")}')

    # TC-1222: vehicleComponent=TRUCK without truckId
    if supplier_id and category_id:
        resp = api.post('/api/expenses', {
            'supplierId': supplier_id,
            'categoryId': category_id,
            'amount': 100000,
            'expenseDate': '2026-06-01',
            'paymentStatus': 'UNPAID',
            'vehicleComponent': 'TRUCK',
        })
        if resp.get('status') in (200, 201):
            _, resp = materialized_id(resp)
        if resp.get('status') == 200:
            results.pass_('TC-1222', 'Expense without truckId accepted (nullable truck)')
        elif resp.get('status') == 400:
            results.pass_('TC-1222', 'Expense without truckId rejected → 400')
        else:
            results.fail('TC-1222', 'vehicleComponent without truck', f'Status={resp.get("status")}')
    else:
        results.skip('TC-1222', 'vehicleComponent without truck', 'No supplier/category')

    # TC-1223: Amount <= 0
    if supplier_id and category_id:
        resp = api.post('/api/expenses', {
            'supplierId': supplier_id,
            'categoryId': category_id,
            'amount': 0,
            'expenseDate': '2026-06-01',
            'paymentStatus': 'UNPAID',
            'vehicleComponent': 'TRUCK',
        })
        if resp.get('status') == 400:
            results.pass_('TC-1223', 'Amount 0 → 400')
        else:
            resp2 = api.post('/api/expenses', {
                'supplierId': supplier_id,
                'categoryId': category_id,
                'amount': -100,
                'expenseDate': '2026-06-01',
                'paymentStatus': 'UNPAID',
                'vehicleComponent': 'TRUCK',
            })
            if resp2.get('status') == 400:
                results.pass_('TC-1223', 'Negative amount → 400')
            else:
                results.fail('TC-1223', 'Amount validation', f'Zero→{resp.get("status")} Negative→{resp2.get("status")}')
    else:
        results.skip('TC-1223', 'Amount <= 0 validation', 'No supplier/category')

    # TC-1224: Missing date
    if supplier_id and category_id:
        resp = api.post('/api/expenses', {
            'supplierId': supplier_id,
            'categoryId': category_id,
            'amount': 100000,
            'paymentStatus': 'UNPAID',
            'vehicleComponent': 'TRUCK',
        })
        if resp.get('status') == 400:
            results.pass_('TC-1224', 'Missing date → 400')
        else:
            results.fail('TC-1224', 'Missing date validation', f'Expected 400, got {resp.get("status")}')
    else:
        results.skip('TC-1224', 'Missing date validation', 'No supplier/category')

    # TC-1225: Invalid supplierId
    resp = api.post('/api/expenses', {
        'supplierId': 999999,
        'categoryId': category_id or 1,
        'amount': 100000,
        'expenseDate': '2026-06-01',
        'paymentStatus': 'UNPAID',
        'vehicleComponent': 'TRUCK',
    })
    if resp.get('status') in (400, 404):
        results.pass_('TC-1225', 'Invalid supplierId returns error', f'Status={resp.get("status")}')
    else:
        results.fail('TC-1225', 'Invalid supplier', f'Expected 400/404, got {resp.get("status")}')

    # ══════════════════════════════════════════════════════════════════
    # Payment Tests (TC-1230 to TC-1232)
    # ══════════════════════════════════════════════════════════════════

    if supplier_id:
        # TC-1230: Pay vendor
        resp = api.post('/api/payments/vendor', {
            'supplierId': supplier_id,
            'amount': 100000,
            'date': '2026-06-01',
            'receiptId': f'E2E-RCPT-1230-{run_suffix}',
        })
        if resp.get('status') in (200, 201):
            _, resp = materialized_id(resp)
        if resp.get('status') == 200:
            results.pass_('TC-1230', 'Pay vendor via API')
        else:
            results.fail('TC-1230', 'Pay vendor', f'Status={resp.get("status")} body={resp.get("error")}')

        # TC-1231: Payment creates ledger entry — check supplier statement
        resp = api.get(
            f'/api/ledger/suppliers/{supplier_id}/statement'
            '?dateFrom=2026-01-01&dateTo=2026-12-31'
        )
        if resp.get('status') == 200:
            data = resp.get('data', {})
            entries = data.get('ledgerRows', [])
            if entries:
                results.pass_('TC-1231', f'Supplier statement returns {len(entries)} entries')
            else:
                results.fail('TC-1231', 'Supplier statement after payment', 'No June ledger entries found')
        else:
            results.fail('TC-1231', 'Supplier statement after payment', f'Status={resp.get("status")}')

        # TC-1232: Pay more than owed
        resp = api.post('/api/payments/vendor', {
            'supplierId': supplier_id,
            'amount': 999999999,
            'date': '2026-06-01',
            'receiptId': f'E2E-RCPT-1232-{run_suffix}',
        })
        if resp.get('status') in (200, 201):
            action = resp.get('data', {})
            checked = checker_api.post(
                f'/api/governance-actions/{action["id"]}/check',
                {'expectedVersion': action['version']},
            )
            if checked.get('status') == 200:
                resp = approver_api.post(
                    f'/api/governance-actions/{action["id"]}/approve',
                    {'expectedVersion': checked['data']['version']},
                )
        if resp.get('status') in (400, 409, 422):
            results.pass_('TC-1232', 'Overpayment rejected', f'Status={resp.get("status")}')
        else:
            results.fail('TC-1232', 'Pay more than owed', f'Expected rejection, got {resp.get("status")} body={resp.get("error")}')
    else:
        results.skip('TC-1230', 'Pay vendor', 'No supplier_id')
        results.skip('TC-1231', 'Payment ledger entry', 'No supplier_id')
        results.skip('TC-1232', 'Overpayment', 'No supplier_id')

    # ══════════════════════════════════════════════════════════════════
    # RBAC Tests (TC-1240 to TC-1245)
    # ══════════════════════════════════════════════════════════════════

    driver_api = ApiClient()
    driver_api.login('laixe', 'Abc123')

    # TC-1240: DRIVER blocked from /expenses page
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/expenses')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    ctx.screenshot(page, 'TC-1240_driver_expenses')
    if '/expenses' not in page.url:
        results.pass_('TC-1240', 'DRIVER redirected away from /expenses', f'URL={page.url}')
    else:
        results.fail('TC-1240', 'DRIVER expenses page', f'DRIVER can see /expenses: {page.url}')
    page.close()

    # TC-1241: DRIVER blocked from /payables page
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/payables')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    ctx.screenshot(page, 'TC-1241_driver_payables')
    if '/payables' not in page.url:
        results.pass_('TC-1241', 'DRIVER redirected away from /payables', f'URL={page.url}')
    else:
        results.fail('TC-1241', 'DRIVER payables page', f'DRIVER can see /payables: {page.url}')
    page.close()

    # TC-1242: DRIVER blocked from expense API (POST)
    resp = driver_api.post('/api/expenses', {
        'supplierId': 1,
        'categoryId': 1,
        'amount': 100000,
        'expenseDate': '2026-06-01',
        'paymentStatus': 'UNPAID',
        'vehicleComponent': 'TRUCK',
    })
    if resp.get('status') == 403:
        results.pass_('TC-1242', 'DRIVER POST /api/expenses → 403')
    else:
        results.fail('TC-1242', 'DRIVER expense API', f'Expected 403, got {resp.get("status")}')

    # TC-1243: ACCOUNTANT allowed
    acct_api = ApiClient()
    acct_api.login('ketoan', 'Abc123')
    resp = acct_api.get('/api/expenses')
    if resp.get('status') == 200:
        results.pass_('TC-1243', 'ACCOUNTANT can GET /api/expenses')
    else:
        results.fail('TC-1243', 'ACCOUNTANT expense access', f'Status={resp.get("status")}')

    # TC-1244: MANAGER allowed
    mgr_api = ApiClient()
    mgr_api.login('giamdoc', 'Abc123')
    resp = mgr_api.get('/api/expenses')
    if resp.get('status') == 200:
        results.pass_('TC-1244', 'MANAGER can GET /api/expenses')
    else:
        results.fail('TC-1244', 'MANAGER expense access', f'Status={resp.get("status")}')

    # TC-1245: DRIVER blocked from suppliers API
    resp = driver_api.get('/api/suppliers')
    if resp.get('status') == 403:
        results.pass_('TC-1245', 'DRIVER GET /api/suppliers → 403')
    else:
        results.fail('TC-1245', 'DRIVER suppliers API', f'Expected 403, got {resp.get("status")}')

    # ══════════════════════════════════════════════════════════════════
    # Payables & Reports (TC-1250 to TC-1255)
    # ══════════════════════════════════════════════════════════════════

    # TC-1250: Payables summary
    resp = api.get('/api/reports/payables-summary')
    if resp.get('status') == 200:
        results.pass_('TC-1250', 'Payables summary API returns 200')
    else:
        results.fail('TC-1250', 'Payables summary', f'Status={resp.get("status")}')

    # TC-1251: Supplier statement
    if supplier_id:
        resp = api.get(
            f'/api/ledger/suppliers/{supplier_id}/statement'
            '?dateFrom=2026-06-01&dateTo=2026-06-30'
        )
        if resp.get('status') == 200:
            results.pass_('TC-1251', 'Supplier statement API returns 200')
        else:
            results.fail('TC-1251', 'Supplier statement', f'Status={resp.get("status")}')
    else:
        results.skip('TC-1251', 'Supplier statement', 'No supplier_id')

    # TC-1252: Renewals report
    resp = api.get('/api/expenses/reports/renewals')
    if resp.get('status') == 200:
        results.pass_('TC-1252', 'Renewals report returns 200')
    else:
        results.fail('TC-1252', 'Renewals report', f'Status={resp.get("status")}')

    # TC-1253: Ledger immutable — PUT should fail
    resp = api.put('/api/ledger/1', {'note': 'tamper attempt'})
    if resp.get('status') in (404, 405):
        results.pass_('TC-1253', 'Ledger PUT rejected (immutable)', f'Status={resp.get("status")}')
    elif resp.get('status') in (400, 403):
        results.pass_('TC-1253', 'Ledger PUT rejected', f'Status={resp.get("status")}')
    else:
        results.fail('TC-1253', 'Ledger immutability', f'Expected error, got {resp.get("status")}')

    # TC-1254: Expense in P&L
    resp = api.get('/api/reports/pnl?month=6&year=2026')
    if resp.get('status') == 200:
        results.pass_('TC-1254', 'P&L report returns 200')
    else:
        results.fail('TC-1254', 'P&L report', f'Status={resp.get("status")}')

    # TC-1255: Delete expense creates ledger adjustment (UNPAID delete from TC-1217)
    if supplier_id:
        deadline = time.time() + 5
        resp = {}
        entries = []
        has_adjustment = False
        while time.time() < deadline and not has_adjustment:
            resp = api.get(
                f'/api/ledger/suppliers/{supplier_id}/statement'
                '?dateFrom=2026-01-01&dateTo=2026-12-31'
            )
            if resp.get('status') != 200:
                break
            entries = resp.get('data', {}).get('ledgerRows', [])
            has_adjustment = any(
                str(e.get('txnId')) == str(expense_to_delete_id)
                and e.get('txnType') == 'ADJUSTMENT'
                and 'Hủy chi phí' in str(e.get('note', ''))
                for e in entries
            )
            if not has_adjustment:
                time.sleep(0.25)
        if resp.get('status') == 200:
            if has_adjustment:
                results.pass_('TC-1255', 'Ledger shows adjustment after expense delete')
            else:
                results.fail(
                    'TC-1255',
                    'Ledger adjustment after expense delete',
                    (
                        f'Expected txnId={expense_to_delete_id}; rows='
                        f'{[(e.get("txnId"), e.get("txnType"), e.get("note")) for e in entries]}'
                    ),
                )
        else:
            results.fail('TC-1255', 'Ledger adjustment check', f'Status={resp.get("status")}')
    else:
        results.skip('TC-1255', 'Ledger adjustment', 'No supplier_id')

    # ══════════════════════════════════════════════════════════════════
    # Browser UI Tests (TC-1260 to TC-1264)
    # ══════════════════════════════════════════════════════════════════

    # TC-1260: Accountant opens the authoritative expense review workspace
    page = ctx.new_page()
    ctx.login_as('accountant', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/expenses')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    ctx.screenshot(page, 'TC-1260_expenses_page')
    if '/expenses' in page.url and page.get_by_role('heading', name='Chi phí phát sinh', exact=True).count() == 1:
        results.pass_('TC-1260', 'Expenses route opens the authoritative expense workspace')
    else:
        results.fail('TC-1260', 'Expenses page', f'URL={page.url}')
    page.close()

    # TC-1261: Accountant opens the authoritative payable review workspace
    page = ctx.new_page()
    ctx.login_as('accountant', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/payables')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    ctx.screenshot(page, 'TC-1261_payables_page')
    if '/payables' in page.url and page.get_by_role('heading', name='Công nợ phải trả', exact=True).count() == 1:
        results.pass_('TC-1261', 'Payables route opens the authoritative payable workspace')
    else:
        results.fail('TC-1261', 'Payables page', f'URL={page.url}')
    page.close()

    # TC-1262: Legacy suppliers route converges on the unified accounting workspace
    page = ctx.new_page()
    ctx.login_as('accountant', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/suppliers')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    ctx.screenshot(page, 'TC-1262_suppliers_page')
    if '/accounting' in page.url and page.get_by_role('heading', name='Công việc kế toán', exact=True).count() == 1:
        results.pass_('TC-1262', 'Suppliers route returns Accountant to the work inbox')
    else:
        results.fail('TC-1262', 'Suppliers page', f'URL={page.url}')
    page.close()

    # TC-1263: Mobile expense list
    page = ctx.new_page(viewport={'width': 375, 'height': 812})
    ctx.login_as('accountant', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/expenses')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    ctx.screenshot(page, 'TC-1263_mobile_expenses')
    mobile_expense_fits = page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
    if '/expenses' in page.url and mobile_expense_fits:
        results.pass_('TC-1263', 'Mobile expense workspace renders without document overflow')
    else:
        results.fail('TC-1263', 'Mobile expenses', f'URL={page.url}')
    page.close()

    # TC-1264: Mobile payables
    page = ctx.new_page(viewport={'width': 375, 'height': 812})
    ctx.login_as('accountant', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/payables')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    ctx.screenshot(page, 'TC-1264_mobile_payables')
    mobile_payables_fits = page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
    if '/payables' in page.url and mobile_payables_fits:
        results.pass_('TC-1264', 'Mobile payable workspace renders without document overflow')
    else:
        results.fail('TC-1264', 'Mobile payables', f'URL={page.url}')
    page.close()


if __name__ == '__main__':
    sys.exit(run_suite('12-vendor-expenses', test_vendor_expenses))
