#!/usr/bin/env python3
"""E2E Test Suite 03: Dashboard & Financial Reports"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *

def test_dashboard(ctx: NepoTestContext, results: TestResults):
    api = ApiClient()
    api.login('admin', 'admin123')

    # TC-0301: Dashboard page loads
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/dashboard')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    if '/dashboard' in page.url:
        results.pass_('TC-0301', 'Dashboard page loads')
    else:
        results.fail('TC-0301', 'Dashboard page', f'URL: {page.url}')
    ctx.screenshot(page, 'TC-0301_dashboard')
    page.close()

    # TC-0302: Dashboard API returns KPIs
    resp = api.get('/api/reports/dashboard')
    if resp.get('status') == 200:
        data = resp.get('data', {})
        results.pass_('TC-0302', f'Dashboard API returns KPIs (revenue={data.get("revenue")})')
    else:
        results.fail('TC-0302', 'Dashboard API', f'Status: {resp.get("status")}')

    # TC-0303: Finance page loads
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/finance')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    if '/finance' in page.url:
        results.pass_('TC-0303', 'Finance page loads')
    else:
        results.fail('TC-0303', 'Finance page', f'URL: {page.url}')
    ctx.screenshot(page, 'TC-0303_finance')
    page.close()

    # TC-0304: P&L report API
    resp = api.get('/api/reports/pnl?month=6&year=2026')
    if resp.get('status') == 200:
        results.pass_('TC-0304', 'P&L report API works')
    else:
        results.fail('TC-0304', 'P&L API', f'Status: {resp.get("status")}')

    # TC-0305: MANAGER sees dashboard
    page = ctx.new_page()
    ctx.login_as('manager', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/dashboard')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/dashboard' in page.url:
        results.pass_('TC-0305', 'MANAGER sees dashboard')
    else:
        results.fail('TC-0305', 'MANAGER dashboard', f'URL: {page.url}')
    page.close()

if __name__ == '__main__':
    sys.exit(run_suite('03-dashboard-finance', test_dashboard))
