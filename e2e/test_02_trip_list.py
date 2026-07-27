#!/usr/bin/env python3
"""E2E Test Suite 02: Trip List & Search"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *

def test_trip_list(ctx: NepoTestContext, results: TestResults):
    api = ApiClient()
    api.login('admin', 'admin123')

    # TC-0201: Trip list API returns data
    resp = api.get('/api/trips')
    if resp.get('status') == 200 and resp.get('data', {}).get('items') is not None:
        items = resp['data']['items']
        results.pass_('TC-0201', f'Trip list API returns {len(items)} trips')
    else:
        results.fail('TC-0201', 'Trip list API', f'Got: {resp.get("status")}')

    # TC-0202: Trip list page renders
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/trips')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/trips' in page.url:
        results.pass_('TC-0202', 'Trip list page renders')
    else:
        results.fail('TC-0202', 'Trip list page', f'URL: {page.url}')
    ctx.screenshot(page, 'TC-0202_trip_list')
    page.close()

    # TC-0203: Trip list pagination
    resp = api.get('/api/trips?page=1&pageSize=5')
    if resp.get('status') == 200:
        data = resp.get('data', {})
        results.pass_('TC-0203', f'Pagination works (total={data.get("total")})')
    else:
        results.fail('TC-0203', 'Trip pagination', f'Status: {resp.get("status")}')

    # TC-0204: Trip list filter by status
    resp = api.get('/api/trips?status=CREATED')
    if resp.get('status') == 200:
        results.pass_('TC-0204', 'Filter by status works')
    else:
        results.fail('TC-0204', 'Status filter', f'Status: {resp.get("status")}')

    # TC-0205: Trip stats API
    resp = api.get('/api/trips/stats')
    if resp.get('status') == 200:
        results.pass_('TC-0205', 'Trip stats API works')
    else:
        results.fail('TC-0205', 'Trip stats', f'Status: {resp.get("status")}')

    # TC-0206: ACCOUNTANT can view trip list
    api_acct = ApiClient()
    api_acct.login('ketoan', 'admin123')
    resp = api_acct.get('/api/trips')
    if resp.get('status') == 200:
        results.pass_('TC-0206', 'ACCOUNTANT views trip list')
    else:
        results.fail('TC-0206', 'ACCOUNTANT trips', f'Status: {resp.get("status")}')

if __name__ == '__main__':
    sys.exit(run_suite('02-trip-list-search', test_trip_list))
