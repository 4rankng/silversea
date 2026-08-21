#!/usr/bin/env python3
"""E2E Test Suite 08: Customers"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *

def test_customers(ctx: SilverseaTestContext, results: TestResults):
    api = ApiClient()
    api.login('admin', 'Abc123')

    # TC-0801: Customers page loads
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/customers')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/customers' in page.url:
        results.pass_('TC-0801', 'Customers page loads')
    else:
        results.fail('TC-0801', 'Customers page', f'URL: {page.url}')
    ctx.screenshot(page, 'TC-0801_customers')
    page.close()

    # TC-0802: Customers API
    resp = api.get('/api/customers')
    if resp.get('status') == 200:
        items = resp.get('data', {}).get('items', [])
        results.pass_('TC-0802', f'Customers API returns {len(items)} customers')
    else:
        results.fail('TC-0802', 'Customers API', f'Status: {resp.get("status")}')

    # TC-0803: Create customer
    import time
    name = f'E2E Customer {int(time.time())}'
    resp = api.post('/api/customers', {'name': name, 'phone': '0900000999'})
    if resp.get('status') in (200, 201) or resp.get('data', {}).get('id'):
        results.pass_('TC-0803', f'Create customer: {name}')
    else:
        results.fail('TC-0803', 'Create customer', f'Status: {resp.get("status")}')

    # TC-0804: ACCOUNTANT views customers
    api_acct = ApiClient()
    api_acct.login('ketoan', 'Abc123')
    resp = api_acct.get('/api/customers')
    if resp.get('status') == 200:
        results.pass_('TC-0804', 'ACCOUNTANT views customers')
    else:
        results.fail('TC-0804', 'ACCOUNTANT customers', f'Status: {resp.get("status")}')

    # TC-0805: DRIVER cannot access customers
    api_driver = ApiClient()
    api_driver.login('laixe', 'Abc123')
    resp = api_driver.get('/api/customers')
    if resp.get('status') == 403:
        results.pass_('TC-0805', 'DRIVER cannot access customers → 403')
    else:
        results.fail('TC-0805', 'DRIVER customers', f'Expected 403, got {resp.get("status")}')

if __name__ == '__main__':
    sys.exit(run_suite('08-customers', test_customers))
