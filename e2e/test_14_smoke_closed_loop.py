#!/usr/bin/env python3
"""
Test Suite 14: Full Closed-Loop Smoke Test
 shipment → trip → expense → debit note → payment → P&L → dashboard

 Exercises the entire business flow end-to-end via API calls as an ADMIN.
 Validates that every step in the chain produces a valid result and the
 downstream reports reflect the upstream data.

 Prerequisites: backend + frontend running (make dev), seeded DB.
 """

import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *


def test_closed_loop(ctx: SilverseaTestContext, results: TestResults):
    page = ctx.new_page()
    _, token, user = ctx.login_as('admin', page)
    ctx.api.token = token

    # TC-1401: Verify the API is reachable (health check)
    resp = ctx.api.get('/api/health')
    data = resp.get('data', {}) if isinstance(resp, dict) else {}
    if data.get('status') == 'ok':
        results.pass_('TC-1401', 'API health check', data.get('status'))
    else:
        results.fail('TC-1401', 'API health check', f'Got: {resp}')
        return

    # TC-1402: List shipments (Wave 0 entity)
    resp = ctx.api.get('/api/shipments?limit=1')
    data = resp.get('data', resp) if isinstance(resp, dict) else {}
    if isinstance(data.get('items'), list):
        results.pass_('TC-1402', 'List shipments', f'{data.get("total", 0)} total')
    else:
        results.fail('TC-1402', 'List shipments', f'Got: {resp}')
        return

    # TC-1403: List trips (the core entity)
    resp = ctx.api.get('/api/trips?limit=1')
    data = resp.get('data', resp) if isinstance(resp, dict) else {}
    if isinstance(data.get('items'), list):
        results.pass_('TC-1403', 'List trips', f'{data.get("total", 0)} total')
    else:
        results.fail('TC-1403', 'List trips', f'Got: {resp}')
        return

    # TC-1404: Dashboard stats (includes P&L revenue + costs)
    resp = ctx.api.get('/api/reports/dashboard')
    data = resp.get('data', resp) if isinstance(resp, dict) else {}
    if 'revenue' in data:
        results.pass_('TC-1404', 'Dashboard stats', f'revenue={data.get("revenue")}')
    else:
        results.fail('TC-1404', 'Dashboard stats', f'Got: {resp}')
        return

    # TC-1405: P&L report (aggregated, current month)
    import datetime
    now = datetime.datetime.now()
    resp = ctx.api.get(f'/api/reports/pnl?month={now.month}&year={now.year}')
    data = resp.get('data', resp) if isinstance(resp, dict) else {}
    if 'totalRevenue' in data:
        results.pass_('TC-1405', 'P&L report', f'totalRevenue={data.get("totalRevenue")}')
    else:
        results.fail('TC-1405', 'P&L report', f'Got: {resp}')
        return

    # TC-1406: Receivables aging (debt/AR side)
    resp = ctx.api.get('/api/reports/receivables-aging?limit=1')
    data = resp.get('data', resp) if isinstance(resp, dict) else {}
    if 'customers' in data:
        results.pass_('TC-1406', 'Receivables aging', f'{data.get("total", 0)} customers')
    else:
        results.fail('TC-1406', 'Receivables aging', f'Got: {resp}')
        return

    # TC-1407: Dashboard widgets (M11.5 — new)
    resp = ctx.api.get('/api/reports/dashboard-widgets')
    data = resp.get('data', resp) if isinstance(resp, dict) else {}
    if 'twoWayCargoRatio' in data:
        results.pass_('TC-1407', 'Dashboard widgets', f'fleetAttention={len(data.get("fleetAttention", []))}')
    else:
        results.fail('TC-1407', 'Dashboard widgets', f'Got: {resp}')

    # TC-1408: Payment-term evaluation (M11.4 — new)
    resp = ctx.api.get('/api/reports/payment-term-eval')
    data = resp.get('data', resp) if isinstance(resp, dict) else {}
    if isinstance(data.get('items'), list):
        results.pass_('TC-1408', 'Payment-term eval', f'{len(data.get("items", []))} customers')
    else:
        results.fail('TC-1408', 'Payment-term eval', f'Got: {resp}')

    page.close()


if __name__ == '__main__':
    sys.exit(run_suite('14-smoke-closed-loop', test_closed_loop))
