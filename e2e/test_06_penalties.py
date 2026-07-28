#!/usr/bin/env python3
"""E2E Test Suite 06: Penalties & Discipline"""
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *

def test_penalties(ctx: NepoTestContext, results: TestResults):
    api = ApiClient()
    api.login('admin', 'admin123')

    # TC-0601: Penalties page loads
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/penalties')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/penalties' in page.url:
        results.pass_('TC-0601', 'Penalties page loads')
    else:
        results.fail('TC-0601', 'Penalties page', f'URL: {page.url}')
    ctx.screenshot(page, 'TC-0601_penalties')
    page.close()

    # TC-0602: Penalties list API
    resp = api.get('/api/penalties')
    if resp.get('status') == 200:
        results.pass_('TC-0602', 'Penalties list API works')
    else:
        results.fail('TC-0602', 'Penalties API', f'Status: {resp.get("status")}')

    # TC-0603: Penalty reasons API
    resp = api.get('/api/penalty-reasons')
    if resp.get('status') == 200:
        results.pass_('TC-0603', 'Penalty reasons API works')
    else:
        results.fail('TC-0603', 'Penalty reasons', f'Status: {resp.get("status")}')

    # TC-0604: Create penalty via API
    drivers_resp = api.get('/api/drivers')
    driver_items = drivers_resp.get('data', {}).get('items', [])
    trips_resp = api.get('/api/trips')
    trip_items = trips_resp.get('data', {}).get('items', [])
    if driver_items:
        unique_amount = 100000 + (time.time_ns() % 900000)
        penalty_payload = {
            'driverId': driver_items[0]['id'],
            'amount': unique_amount,
            'date': '2026-06-01',
            'customReason': f'E2E test penalty {time.time_ns()}',
        }
        resp = api.post('/api/penalties', penalty_payload)
        if resp.get('status') in (200, 201) or (resp.get('data') and resp.get('data', {}).get('id')):
            results.pass_('TC-0604', 'Create penalty via API')
        else:
            results.fail('TC-0604', 'Create penalty', f'Status: {resp.get("status")}, Body: {resp}')
    else:
        results.skip('TC-0604', 'Create penalty', 'No drivers in system')

    # TC-0605: DRIVER cannot create penalty
    api_driver = ApiClient()
    api_driver.login('laixe', 'admin123')
    if driver_items:
        resp = api_driver.post('/api/penalties', {
            'driverId': driver_items[0]['id'],
            'amount': 50000,
            'date': '2026-06-01',
            'customReason': 'Unauthorized',
        })
        if resp.get('status') in (403, 401):
            results.pass_('TC-0605', 'DRIVER cannot create penalty → 403')
        else:
            results.fail('TC-0605', 'DRIVER penalty create', f'Expected 403, got {resp.get("status")}')
    else:
        results.skip('TC-0605', 'DRIVER penalty create', 'No drivers')

if __name__ == '__main__':
    sys.exit(run_suite('06-penalties-discipline', test_penalties))
