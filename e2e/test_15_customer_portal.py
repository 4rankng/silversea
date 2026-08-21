#!/usr/bin/env python3
"""E2E Test Suite 15: CUSTOMER portal routing, isolation, and responsive UI."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from helpers import *


def _login_customer(page):
    ensure_customer_test_account()
    account = DEMO_ACCOUNTS['customer']
    page.goto(BASE_URL)
    page.fill('#username-input', account['identifier'])
    page.fill('#password-input', account['password'])
    page.click('button[type="submit"]')
    page.wait_for_url('**/portal/shipments', timeout=8_000)
    page.wait_for_selector('h1')


def _no_horizontal_overflow(page):
    return page.evaluate(
        'document.documentElement.scrollWidth <= document.documentElement.clientWidth'
    )


def test_customer_portal(ctx: SilverseaTestContext, results: TestResults):
    customer_api = ApiClient()
    login = ensure_customer_test_account()
    customer_api.token = login.get('token')
    if login.get('user', {}).get('role') == 'CUSTOMER':
        results.pass_('TC-1501', 'Dedicated CUSTOMER fixture authenticates with CUSTOMER role')
    else:
        results.fail('TC-1501', 'Dedicated CUSTOMER fixture', str(login.get('error', login)))

    shipments = customer_api.get('/api/portal/shipments?limit=100')
    if shipments.get('status') == 200:
        results.pass_('TC-1502', 'Customer-scoped shipment list returns 200')
    else:
        results.fail('TC-1502', 'Customer-scoped shipment list', str(shipments))

    office = customer_api.get('/api/shipments?limit=1')
    if office.get('status') == 403:
        results.pass_('TC-1503', 'CUSTOMER remains blocked from operator shipment API')
    else:
        results.fail('TC-1503', 'Operator shipment API denial', f"status={office.get('status')}")

    admin_api = ApiClient()
    admin_api.login('admin', 'Abc123')
    admin_shipments = admin_api.get('/api/shipments?limit=100')
    own_ids = {
        row['id'] for row in shipments.get('data', {}).get('items', [])
    } if shipments.get('status') == 200 else set()
    all_rows = admin_shipments.get('data', {}).get('items', []) if admin_shipments.get('status') == 200 else []
    foreign = next((row for row in all_rows if row.get('id') not in own_ids), None)
    if foreign:
        denied = customer_api.get(f"/api/portal/shipments/{foreign['id']}")
        if denied.get('status') == 404:
            results.pass_('TC-1504', 'Foreign shipment direct ID returns 404')
        else:
            results.fail('TC-1504', 'Foreign shipment direct ID isolation', f"status={denied.get('status')}")
    else:
        results.fail('TC-1504', 'Foreign shipment direct ID isolation', 'Required foreign fixture is missing')

    for label, path in (
        ('Debit-note list', '/api/portal/debit-notes'),
        ('Customer statement', '/api/portal/statement'),
    ):
        response = customer_api.get(path)
        tc_id = 'TC-1505' if 'debit' in path else 'TC-1506'
        if response.get('status') == 200:
            results.pass_(tc_id, f'{label} returns 200')
        else:
            results.fail(tc_id, label, f"status={response.get('status')}")

    desktop = ctx.new_page({'width': 1280, 'height': 900})
    _login_customer(desktop)
    nav_labels = desktop.locator('.customer-shell__nav-item').all_inner_texts()
    office_links = desktop.locator('a[href="/dashboard"], a[href="/trips"], a[href="/finance"], a[href="/fleet"]').count()
    if nav_labels == ['Lô hàng của tôi', 'Giấy báo nợ', 'Sao kê công nợ'] and office_links == 0:
        results.pass_('TC-1510', 'Desktop navigation is customer-only and decision-focused')
    else:
        results.fail('TC-1510', 'Desktop customer navigation', f'nav={nav_labels}, office={office_links}')
    if _no_horizontal_overflow(desktop):
        results.pass_('TC-1511', 'Desktop portal has no horizontal overflow')
    else:
        results.fail('TC-1511', 'Desktop horizontal overflow')
    ctx.screenshot(desktop, 'TC-1511_customer_portal_desktop')

    desktop.goto(f'{BASE_URL}/dashboard')
    desktop.wait_for_url('**/portal/shipments', timeout=5_000)
    if '/portal/shipments' in desktop.url and desktop.locator('text=Báo cáo lãi lỗ').count() == 0:
        results.pass_('TC-1512', 'CUSTOMER /dashboard redirects to portal without office content')
    else:
        results.fail('TC-1512', 'CUSTOMER dashboard redirect', desktop.url)
    desktop.close()

    mobile = ctx.new_page({'width': 375, 'height': 812})
    _login_customer(mobile)
    mobile_nav = mobile.locator('.customer-shell__bottom-nav a').all_inner_texts()
    min_target = mobile.locator('.customer-shell__bottom-nav a').evaluate_all(
        '(els) => Math.min(...els.map((el) => el.getBoundingClientRect().height))'
    )
    if mobile_nav == ['Lô hàng của tôi', 'Giấy báo nợ', 'Sao kê công nợ'] and min_target >= 44:
        results.pass_('TC-1520', 'Mobile bottom navigation has three usable customer actions')
    else:
        results.fail('TC-1520', 'Mobile navigation', f'nav={mobile_nav}, minHeight={min_target}')

    for path, heading in (
        ('/portal/shipments', 'Lô hàng của tôi'),
        ('/portal/debit-notes', 'Giấy báo nợ'),
        ('/portal/statement', 'Sao kê công nợ'),
    ):
        mobile.goto(f'{BASE_URL}{path}')
        mobile.wait_for_selector(f'h1:has-text("{heading}")')
        if _no_horizontal_overflow(mobile):
            results.pass_(f'TC-152{1 + ["/portal/shipments", "/portal/debit-notes", "/portal/statement"].index(path)}', f'{heading} fits 375px viewport')
        else:
            results.fail('TC-1529', f'{heading} horizontal overflow')
    ctx.screenshot(mobile, 'TC-1523_customer_portal_mobile')
    mobile.close()


if __name__ == '__main__':
    sys.exit(run_suite('15_customer_portal', test_customer_portal))
