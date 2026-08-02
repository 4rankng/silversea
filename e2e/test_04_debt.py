#!/usr/bin/env python3
"""E2E Test Suite 04: Debt & Payments"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *

def test_debt(ctx: NepoTestContext, results: TestResults):
    api = ApiClient()
    api.login('admin', 'Abc123')

    # TC-0401: Debt list page loads
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/debt')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/debt' in page.url:
        results.pass_('TC-0401', 'Debt list page loads')
    else:
        results.fail('TC-0401', 'Debt list', f'URL: {page.url}')
    ctx.screenshot(page, 'TC-0401_debt_list')
    page.close()

    # TC-0402: Receivables summary API
    resp = api.get('/api/reports/receivables-summary')
    if resp.get('status') == 200:
        results.pass_('TC-0402', 'Receivables summary API works')
    else:
        results.fail('TC-0402', 'Receivables API', f'Status: {resp.get("status")}')

    # TC-0403: Ledger API
    resp = api.get('/api/ledger')
    if resp.get('status') == 200:
        data = resp.get('data', {})
        items = data.get('items', [])
        results.pass_('TC-0403', f'Ledger API returns {len(items)} entries')
    else:
        results.fail('TC-0403', 'Ledger API', f'Status: {resp.get("status")}')

    # TC-0404: Customer statement API (get first customer)
    cust_resp = api.get('/api/customers')
    cust_items = cust_resp.get('data', {}).get('items', [])
    if cust_items:
        cust_id = cust_items[0]['id']
        stmt_resp = api.get(f'/api/ledger/customers/{cust_id}/statement')
        if stmt_resp.get('status') == 200:
            results.pass_('TC-0404', 'Customer statement API works')
        else:
            results.fail('TC-0404', 'Customer statement', f'Status: {stmt_resp.get("status")}')
    else:
        results.skip('TC-0404', 'Customer statement', 'No customers in system')

    # TC-0405: DRIVER cannot access debt
    api_driver = ApiClient()
    api_driver.login('laixe', 'Abc123')
    resp = api_driver.get('/api/ledger')
    if resp.get('status') == 403:
        results.pass_('TC-0405', 'DRIVER cannot access ledger → 403')
    else:
        results.fail('TC-0405', 'DRIVER ledger access', f'Expected 403, got {resp.get("status")}')

if __name__ == '__main__':
    sys.exit(run_suite('04-debt-payments', test_debt))
