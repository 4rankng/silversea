#!/usr/bin/env python3
"""E2E Test Suite 05: Profit Distribution"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *

def test_profit(ctx: NepoTestContext, results: TestResults):
    api = ApiClient()
    api.login('admin', 'admin123')

    # TC-0501: Profit page loads
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/profit')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/profit' in page.url:
        results.pass_('TC-0501', 'Profit page loads')
    else:
        results.fail(('TC-0501', 'Profit page', f'URL: {page.url}')
    ctx.screenshot(page, 'TC-0501_profit')
    page.close()

    # TC-0502: Cap table API
    resp = api.get('/api/cap-table')
    if resp.get('status') == 200:
        items = resp.get('data', {}).get('items', resp.get('data', []))
        if isinstance(items, list):
            results.pass_('TC-0502', f'Cap table API returns {len(items)} entries')
        else:
            results.pass_('TC-0502', 'Cap table API responds')
    else:
        results.fail(('TC-0502', 'Cap table API', f'Status: {resp.get("status")}')

    # TC-0503: Distribution API
    resp = api.get('/api/distributions')
    if resp.get('status') == 200:
        results.pass_('TC-0503', 'Distribution API works')
    else:
        results.fail(('TC-0503', 'Distribution API', f'Status: {resp.get("status")}')

    # TC-0504: ACCOUNTANT views profit page
    page = ctx.new_page()
    ctx.login_as('accountant', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/profit')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/profit' in page.url:
        results.pass_('TC-0504', 'ACCOUNTANT views profit page')
    else:
        results.fail(('TC-0504', 'ACCOUNTANT profit', f'URL: {page.url}')
    page.close()

    # TC-0505: DRIVER cannot access profit
    api_driver = ApiClient()
    api_driver.login('laixe', 'admin123')
    resp = api_driver.get('/api/cap-table')
    if resp.get('status') == 403:
        results.pass_('TC-0505', 'DRIVER cannot access cap table → 403')
    else:
        results.fail(('TC-0505', 'DRIVER cap table', f'Expected 403, got {resp.get("status")}')

if __name__ == '__main__':
    sys.exit(run_suite('05-profit-distribution', test_profit))
