#!/usr/bin/env python3
"""E2E Test Suite 07: Fleet & Dispatch"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *

def test_fleet(ctx: NepoTestContext, results: TestResults):
    api = ApiClient()
    api.login('admin', 'Abc123')

    # TC-0701: Dispatch page loads
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/dispatch')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/dispatch' in page.url:
        results.pass_('TC-0701', 'Dispatch page loads')
    else:
        results.fail('TC-0701', 'Dispatch page', f'URL: {page.url}')
    ctx.screenshot(page, 'TC-0701_dispatch')
    page.close()

    # TC-0702: Fleet page loads
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/fleet')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/fleet' in page.url:
        results.pass_('TC-0702', 'Fleet page loads')
    else:
        results.fail('TC-0702', 'Fleet page', f'URL: {page.url}')
    ctx.screenshot(page, 'TC-0702_fleet')
    page.close()

    # TC-0703: Trucks API
    resp = api.get('/api/trucks')
    if resp.get('status') == 200:
        items = resp.get('data', {}).get('items', [])
        results.pass_('TC-0703', f'Trucks API returns {len(items)} trucks')
    else:
        results.fail('TC-0703', 'Trucks API', f'Status: {resp.get("status")}')

    # TC-0704: Drivers API
    resp = api.get('/api/drivers')
    if resp.get('status') == 200:
        items = resp.get('data', {}).get('items', [])
        results.pass_('TC-0704', f'Drivers API returns {len(items)} drivers')
    else:
        results.fail('TC-0704', 'Drivers API', f'Status: {resp.get("status")}')

    # TC-0705: Trailers API
    resp = api.get('/api/trailers')
    if resp.get('status') == 200:
        results.pass_('TC-0705', 'Trailers API works')
    else:
        results.fail('TC-0705', 'Trailers API', f'Status: {resp.get("status")}')

    # TC-0706: Create truck via API
    import time
    plate = f'E2E-{int(time.time())}'
    resp = api.post('/api/trucks', {'licensePlate': plate, 'status': 'ACTIVE'})
    if resp.get('status') in (200, 201) or resp.get('data', {}).get('id'):
        results.pass_('TC-0706', f'Create truck {plate}')
    else:
        results.fail('TC-0706', 'Create truck', f'Status: {resp.get("status")}')

if __name__ == '__main__':
    sys.exit(run_suite('07-fleet-dispatch', test_fleet))
