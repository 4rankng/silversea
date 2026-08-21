#!/usr/bin/env python3
"""E2E Test Suite 00: Auth, Login, Permissions & Navigation"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *

def test_auth(ctx: SilverseaTestContext, results: TestResults):
    # ── 5.1 Happy Path ──
    # TC-0001: Login by username
    page = ctx.new_page()
    page.goto(f'{BASE_URL}/login')
    page.wait_for_load_state('networkidle')
    page.fill('input[id="username-input"], input[id="identifier"], input[placeholder*="Tên đăng nhập"]', 'giamdoc')
    page.fill('input[type="password"]', 'Abc123')
    page.click('button[type="submit"], button:has-text("Đăng nhập")')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/dashboard' in page.url:
        results.pass_('TC-0001', 'Login by username → /dashboard')
    else:
        results.fail('TC-0001', 'Login by username', f'Expected /dashboard, got {page.url}')
    ctx.screenshot(page, 'TC-0001_login_username')
    page.close()

    # TC-0004: Login as DRIVER → /my-trips
    page = ctx.new_page()
    page.goto(f'{BASE_URL}/login')
    page.wait_for_load_state('networkidle')
    page.fill('input[id="username-input"], input[id="identifier"], input[placeholder*="Tên đăng nhập"]', 'laixe')
    page.fill('input[type="password"]', 'Abc123')
    page.click('button[type="submit"], button:has-text("Đăng nhập")')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-trips' in page.url:
        results.pass_('TC-0004', 'Login DRIVER → /my-trips')
    else:
        results.fail('TC-0004', 'Login DRIVER', f'Expected /my-trips, got {page.url}')
    page.close()

    # TC-0004b: Login as OPS → /my-orders
    page = ctx.new_page()
    page.goto(f'{BASE_URL}/login')
    page.wait_for_load_state('networkidle')
    page.fill('input[id="username-input"], input[id="identifier"], input[placeholder*="Tên đăng nhập"]', 'giaonhan')
    page.fill('input[type="password"]', 'Abc123')
    page.click('button[type="submit"], button:has-text("Đăng nhập")')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-orders' in page.url:
        results.pass_('TC-0004b', 'Login OPS → /my-orders')
    else:
        results.fail('TC-0004b', 'Login OPS', f'Expected /my-orders, got {page.url}')
    page.close()

    # TC-0006: Logout
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    # Click user menu button
    user_btn = page.locator('button.sidebar-user, [class*="sidebar-user"]').first
    if user_btn.is_visible():
        user_btn.click()
        page.wait_for_timeout(300)
    logout_btn = page.locator('button:has-text("Đăng xuất"), button:has-text("logout")').first
    if logout_btn.is_visible():
        try:
            with page.expect_response(
                lambda response: '/api/auth/logout' in response.url
                and response.request.method == 'POST',
                timeout=10000,
            ) as logout_response:
                logout_btn.click()
            response_status = logout_response.value.status
            page.wait_for_url('**/login', timeout=10000)
        except Exception as error:
            response_status = None
            logout_error = str(error)
        if (
            response_status == 200
            and '/login' in page.url
            and page.locator('input[type="password"]').count() > 0
        ):
            results.pass_('TC-0006', 'Logout → login page')
        else:
            detail = (
                f'Expected successful server logout and login page; '
                f'status={response_status}, url={page.url}'
            )
            if 'logout_error' in locals():
                detail += f', error={logout_error}'
            results.fail('TC-0006', 'Logout', detail)
    else:
        results.skip('TC-0006', 'Logout', 'Could not find logout button')
    page.close()

    # ── 5.2 Validation ──
    # TC-0011: Wrong password → 401
    api = ApiClient()
    resp = api.login('giamdoc', 'wrongpassword')
    if resp.get('error') and resp.get('status') == 401:
        results.pass_('TC-0011', 'Wrong password → 401')
    elif resp.get('error'):
        results.pass_('TC-0011', 'Wrong password → auth error')
    else:
        results.fail('TC-0011', 'Wrong password', f'Expected auth error, got {resp}')

    # TC-0009: Empty identifier → validation
    page = ctx.new_page()
    page.goto(f'{BASE_URL}/login')
    page.wait_for_load_state('networkidle')
    page.fill('input[type="password"]', 'Abc123')
    submit = page.locator('button[type="submit"], button:has-text("Đăng nhập")').first
    # The form prevents an invalid submission by disabling its primary action
    # until both required credentials are present.
    if submit.is_disabled() and ('/login' in page.url or page.url == f'{BASE_URL}/'):
        results.pass_('TC-0009', 'Empty identifier → submit disabled')
    else:
        results.fail('TC-0009', 'Empty identifier', f'Expected disabled submit on login page, got {page.url}')
    page.close()

    # ── 5.3 Permission Tests ──
    # TC-0014: DRIVER → /dashboard → redirect /my-trips
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/dashboard')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-trips' in page.url:
        results.pass_('TC-0014', 'DRIVER → /dashboard → redirect /my-trips')
    else:
        results.fail('TC-0014', 'DRIVER redirect', f'Expected /my-trips, got {page.url}')
    page.close()

    # TC-0015: DRIVER → /finance → redirect
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/finance')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-trips' in page.url:
        results.pass_('TC-0015', 'DRIVER → /finance → redirect')
    else:
        results.fail('TC-0015', 'DRIVER → /finance redirect', f'Got {page.url}')
    page.close()

    # TC-0018: DRIVER → GET /api/trips → 403
    api_driver = ApiClient()
    api_driver.login('laixe', 'Abc123')
    resp = api_driver.get('/api/trips')
    if resp.get('status') == 403:
        results.pass_('TC-0018', 'DRIVER → GET /api/trips → 403')
    else:
        results.fail('TC-0018', 'DRIVER API access', f'Expected 403, got {resp.get("status")}')

    # TC-0020: ADMIN → /my-trips → redirect /dashboard
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/my-trips')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/dashboard' in page.url:
        results.pass_('TC-0020', 'ADMIN → /my-trips → redirect /dashboard')
    else:
        results.fail('TC-0020', 'ADMIN driver redirect', f'Expected /dashboard, got {page.url}')
    page.close()

    # TC-0022: 404 catch-all for ADMIN
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/page-khong-ton-tai')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/dashboard' in page.url:
        results.pass_('TC-0022', '404 catch-all ADMIN → /dashboard')
    else:
        results.fail('TC-0022', '404 catch-all', f'Expected /dashboard, got {page.url}')
    page.close()

    # TC-0034: OPS → /my-orders
    page = ctx.new_page()
    ctx.login_as('forwarder', page)
    page.wait_for_load_state('networkidle')
    if '/my-orders' in page.url:
        results.pass_('TC-0034', 'OPS → /my-orders')
    else:
        results.fail('TC-0034', 'OPS portal', f'Expected /my-orders, got {page.url}')
    page.close()

    # TC-0035: FORWARDER → /dashboard → redirect
    page = ctx.new_page()
    ctx.login_as('forwarder', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/dashboard')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-orders' in page.url:
        results.pass_('TC-0035', 'OPS → /dashboard → redirect')
    else:
        results.fail('TC-0035', 'FORWARDER dashboard redirect', f'Got {page.url}')
    page.close()

    # TC-0036: FORWARDER → /finance → redirect
    page = ctx.new_page()
    ctx.login_as('forwarder', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/finance')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-orders' in page.url:
        results.pass_('TC-0036', 'OPS → /finance → redirect')
    else:
        results.fail('TC-0036', 'FORWARDER finance redirect', f'Got {page.url}')
    page.close()

    # TC-0037: FORWARDER → /my-trips → redirect
    page = ctx.new_page()
    ctx.login_as('forwarder', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/my-trips')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-orders' in page.url:
        results.pass_('TC-0037', 'OPS → /my-trips → redirect')
    else:
        results.fail('TC-0037', 'FORWARDER driver redirect', f'Got {page.url}')
    page.close()

    # TC-0038: ADMIN → /my-forwarder-trips → redirect
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/my-forwarder-trips')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/dashboard' in page.url:
        results.pass_('TC-0038', 'ADMIN → /my-forwarder-trips → redirect')
    else:
        results.fail('TC-0038', 'ADMIN forwarder redirect', f'Got {page.url}')
    page.close()

    # TC-0039: DRIVER → /my-forwarder-trips → redirect
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/my-forwarder-trips')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-trips' in page.url:
        results.pass_('TC-0039', 'DRIVER → /my-forwarder-trips → redirect')
    else:
        results.fail('TC-0039', 'DRIVER forwarder redirect', f'Got {page.url}')
    page.close()

    # TC-0040: OPS gets the read-only trip catalog but cannot create trips
    api_fwd = ApiClient()
    api_fwd.login('giaonhan', 'Abc123')
    resp = api_fwd.get('/api/trips')
    create_resp = api_fwd.post('/api/trips', {})
    if resp.get('status') == 200 and create_resp.get('status') == 403:
        results.pass_('TC-0040', 'OPS trip catalog is read-only')
    else:
        results.fail('TC-0040', 'OPS API access', f'GET={resp.get("status")}, POST={create_resp.get("status")}')

    # TC-0042: 404 catch-all for FORWARDER
    page = ctx.new_page()
    ctx.login_as('forwarder', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/page-khong-ton-tai')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-orders' in page.url:
        results.pass_('TC-0042', '404 catch-all OPS → /my-orders')
    else:
        results.fail('TC-0042', '404 catch-all FORWARDER', f'Got {page.url}')
    page.close()

    # ── Sidebar verification ──
    # TC-0041: OPS sidebar exposes only its three operational workflows
    page = ctx.new_page()
    ctx.login_as('forwarder', page)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(500)
    sidebar_items = page.locator('.sidebar-item, [class*="sidebar-item"]').all()
    visible_items = [
        (item.get_attribute('aria-label') or item.inner_text()).strip()
        for item in sidebar_items
        if item.is_visible()
    ]
    expected_ops_items = ('Lệnh giao nhận', 'Yêu cầu Tạm ứng', 'Phiếu thanh toán / Hoàn ứng')
    forbidden_office_items = ('Tài chính', 'Đội xe', 'Cấu hình')
    if all(any(label in item for item in visible_items) for label in expected_ops_items) and not any(
        label in item for item in visible_items for label in forbidden_office_items
    ):
        results.pass_('TC-0041', f'OPS sidebar: {len(visible_items)} rendered items')
    else:
        results.fail('TC-0041', 'FORWARDER sidebar', f'Found items: {visible_items}')
    ctx.screenshot(page, 'TC-0041_forwarder_sidebar')
    page.close()

if __name__ == '__main__':
    sys.exit(run_suite('00-auth-permissions', test_auth))
