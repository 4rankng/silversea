#!/usr/bin/env python3
"""E2E Test Suite 09: System Configuration"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *

def test_config(ctx: NepoTestContext, results: TestResults):
    api = ApiClient()
    api.login('admin', 'Abc123')

    def items_from(response):
        data = response.get('data', {})
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            items = data.get('items', data.get('data', []))
            return items if isinstance(items, list) else []
        return []

    # TC-0901: Config hub page loads
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/config')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/config' in page.url:
        results.pass_('TC-0901', 'Config hub page loads')
    else:
        results.fail('TC-0901', 'Config page', f'URL: {page.url}')
    ctx.screenshot(page, 'TC-0901_config')
    page.close()

    # TC-0902: Routes config page
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/config/routes')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/config/routes' in page.url:
        results.pass_('TC-0902', 'Routes config page loads')
    else:
        results.fail('TC-0902', 'Routes config', f'URL: {page.url}')
    page.close()

    # TC-0903: Fuel config page
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/config/fuel')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/config/fuel' in page.url:
        results.pass_('TC-0903', 'Fuel config page loads')
    else:
        results.fail('TC-0903', 'Fuel config', f'URL: {page.url}')
    page.close()

    # TC-0904: Catalogs bootstrap API
    resp = api.get('/api/catalogs/bootstrap')
    if resp.get('status') == 200:
        results.pass_('TC-0904', 'Catalogs bootstrap API works')
    else:
        results.fail('TC-0904', 'Catalogs bootstrap', f'Status: {resp.get("status")}')

    # TC-0905: Routes API
    resp = api.get('/api/routes')
    if resp.get('status') == 200:
        results.pass_('TC-0905', 'Routes API works')
    else:
        results.fail('TC-0905', 'Routes API', f'Status: {resp.get("status")}')

    # TC-0906: Cargo types API
    resp = api.get('/api/cargo-types')
    if resp.get('status') == 200:
        results.pass_('TC-0906', 'Cargo types API works')
    else:
        results.fail('TC-0906', 'Cargo types API', f'Status: {resp.get("status")}')

    # TC-0907: Pricing tables API
    resp = api.get('/api/pricing-tables')
    if resp.get('status') == 200:
        results.pass_('TC-0907', 'Pricing tables API works')
    else:
        results.fail('TC-0907', 'Pricing tables', f'Status: {resp.get("status")}')

    # TC-0908: Road allowances API
    resp = api.get('/api/road-allowances')
    if resp.get('status') == 200:
        results.pass_('TC-0908', 'Road allowances API works')
    else:
        results.fail('TC-0908', 'Road allowances', f'Status: {resp.get("status")}')

    # TC-0909: Fuel config API
    resp = api.get('/api/fuel-config')
    if resp.get('status') == 200:
        results.pass_('TC-0909', 'Fuel config API works')
    else:
        results.fail('TC-0909', 'Fuel config API', f'Status: {resp.get("status")}')

    # TC-0910: Penalty reasons API
    resp = api.get('/api/penalty-reasons')
    if resp.get('status') == 200:
        results.pass_('TC-0910', 'Penalty reasons API works')
    else:
        results.fail('TC-0910', 'Penalty reasons', f'Status: {resp.get("status")}')

    # TC-0911: Salary periods API
    resp = api.get('/api/salary-periods')
    if resp.get('status') == 200:
        results.pass_('TC-0911', 'Salary periods API works')
    else:
        results.fail('TC-0911', 'Salary periods', f'Status: {resp.get("status")}')

    # TC-0912: DRIVER cannot access config
    api_driver = ApiClient()
    api_driver.login('laixe', 'Abc123')
    resp = api_driver.get('/api/routes')
    if resp.get('status') == 403:
        results.pass_('TC-0912', 'DRIVER cannot access config APIs → 403')
    else:
        results.fail('TC-0912', 'DRIVER config', f'Expected 403, got {resp.get("status")}')

    # TC-0913: O2C lift matrix resolves through the forwarder-scoped endpoint
    matrix_rows = items_from(api.get('/api/lift-pricing'))
    if matrix_rows:
        row = matrix_rows[0]
        expected_source = 'MATRIX'
    else:
        catalogs = api.get('/api/catalogs/bootstrap').get('data', {})
        ports = catalogs.get('ports', []) if isinstance(catalogs, dict) else []
        container_types = catalogs.get('containerTypes', []) if isinstance(catalogs, dict) else []
        if not ports or not container_types:
            results.fail('TC-0913', 'Forwarder lift-price lookup', 'Missing port/container catalogs')
            row = None
        else:
            row = {
                'portId': ports[0]['id'],
                'containerTypeId': container_types[0]['id'],
                'direction': 'LIFT_UP',
                'loadState': 'LOADED',
                'effectiveDate': '2026-08-02',
            }
            expected_source = 'MANUAL'

    if row:
        api_fwd = ApiClient()
        api_fwd.login('giaonhan', 'Abc123')
        query = (
            f"/api/forwarder/me/lift-pricing/resolve?portId={row['portId']}"
            f"&containerTypeId={row['containerTypeId']}"
            f"&direction={row['direction']}"
            f"&loadState={row.get('loadState', 'LOADED')}"
            f"&date={str(row['effectiveDate'])[:10]}"
        )
        resolved = api_fwd.get(query)
        payload = resolved.get('data', {})
        if resolved.get('status') == 200 and payload.get('source') == expected_source:
            results.pass_('TC-0913', f'Forwarder receives scoped lift-price result ({expected_source})')
        else:
            results.fail('TC-0913', 'Forwarder lift-price lookup', f'Got: {resolved}')

    # TC-0914/15: reconciliation queues are live and financial-RBAC gated
    api_acct = ApiClient()
    api_acct.login('ketoan', 'Abc123')
    snapshot_paths = (
        '/api/finance/snapshots/ar/dirty',
        '/api/finance/snapshots/ap/dirty',
        '/api/finance/snapshots/fuel-surcharge/dirty',
    )
    snapshot_statuses = [api_acct.get(path).get('status') for path in snapshot_paths]
    if snapshot_statuses == [200, 200, 200]:
        results.pass_('TC-0914', 'Accountant can access AR/AP/fuel reconciliation queues')
    else:
        results.fail('TC-0914', 'Accountant reconciliation queues', f'Statuses: {snapshot_statuses}')

    api_clerk = ApiClient()
    api_clerk.login('cus', 'Abc123')
    denied_statuses = [api_clerk.get(path).get('status') for path in snapshot_paths]
    if all(status in (401, 403) for status in denied_statuses):
        results.pass_('TC-0915', 'Clerk cannot access financial reconciliation queues')
    else:
        results.fail('TC-0915', 'Reconciliation queue RBAC', f'Statuses: {denied_statuses}')

if __name__ == '__main__':
    sys.exit(run_suite('09-system-config', test_config))
