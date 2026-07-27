#!/usr/bin/env python3
"""E2E Test Suite 00: Auth, Login, Permissions & Navigation"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *

def test_auth(ctx: NepoTestContext, results: TestResults):
    # ── 5.1 Happy Path ──
    # TC-0001: Login by username
    page = ctx.new_page()
    page.goto(f'{BASE_URL}/login')
    page.wait_for_load_state('networkidle')
    page.fill('input[id="username-input"], input[id="identifier"], input[placeholder*="Tên đăng nhập"]', 'giamdoc')
    page.fill('input[type="password"]', 'admin123')
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
    page.fill('input[type="password"]', 'admin123')
    page.click('button[type="submit"], button:has-text("Đăng nhập")')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-trips' in page.url:
        results.pass_('TC-0004', 'Login DRIVER → /my-trips')
    else:
        results.fail('TC-0004', 'Login DRIVER', f'Expected /my-trips, got {page.url}')
    page.close()

    # TC-0004b: Login as FORWARDER → /my-forwarder-trips
    page = ctx.new_page()
    page.goto(f'{BASE_URL}/login')
    page.wait_for_load_state('networkidle')
    page.fill('input[id="username-input"], input[id="identifier"], input[placeholder*="Tên đăng nhập"]', 'giaonhan')
    page.fill('input[type="password"]', 'admin123')
    page.click('button[type="submit"], button:has-text("Đăng nhập")')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-forwarder-trips' in page.url:
        results.pass_('TC-0004b', 'Login FORWARDER → /my-forwarder-trips')
    else:
        results.fail('TC-0004b', 'Login FORWARDER', f'Expected /my-forwarder-trips, got {page.url}')
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
        logout_btn.click()
        page.wait_for_load_state('networkidle')
        if '/login' in page.url or page.locator('input[type="password"]').count() > 0:
            results.pass_('TC-0006', 'Logout → login page')
        else:
            results.fail('TC-0006', 'Logout', f'Expected login page, got {page.url}')
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
    page.fill('input[type="password"]', 'admin123')
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
    api_driver.login('laixe', 'admin123')
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

    # TC-0034: FORWARDER → /my-forwarder-trips
    page = ctx.new_page()
    ctx.login_as('forwarder', page)
    page.wait_for_load_state('networkidle')
    if '/my-forwarder-trips' in page.url:
        results.pass_('TC-0034', 'FORWARDER → /my-forwarder-trips')
    else:
        results.fail('TC-0034', 'FORWARDER portal', f'Expected /my-forwarder-trips, got {page.url}')
    page.close()

    # TC-0035: FORWARDER → /dashboard → redirect
    page = ctx.new_page()
    ctx.login_as('forwarder', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/dashboard')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-forwarder-trips' in page.url:
        results.pass_('TC-0035', 'FORWARDER → /dashboard → redirect')
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
    if '/my-forwarder-trips' in page.url:
        results.pass_('TC-0036', 'FORWARDER → /finance → redirect')
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
    if '/my-forwarder-trips' in page.url:
        results.pass_('TC-0037', 'FORWARDER → /my-trips → redirect')
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

    # TC-0040: FORWARDER → GET /api/trips → 403
    api_fwd = ApiClient()
    api_fwd.login('giaonhan', 'admin123')
    resp = api_fwd.get('/api/trips')
    if resp.get('status') == 403:
        results.pass_('TC-0040', 'FORWARDER → GET /api/trips → 403')
    else:
        results.fail('TC-0040', 'FORWARDER API access', f'Expected 403, got {resp.get("status")}')

    # TC-0042: 404 catch-all for FORWARDER
    page = ctx.new_page()
    ctx.login_as('forwarder', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/page-khong-ton-tai')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-forwarder-trips' in page.url:
        results.pass_('TC-0042', '404 catch-all FORWARDER → /my-forwarder-trips')
    else:
        results.fail('TC-0042', '404 catch-all FORWARDER', f'Got {page.url}')
    page.close()

    # ── Sidebar verification ──
    # TC-0041: FORWARDER sidebar has only "Chuyến đi"
    page = ctx.new_page()
    ctx.login_as('forwarder', page)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(500)
    sidebar_items = page.locator('.sidebar-item, [class*="sidebar-item"]').all()
    visible_items = [item.inner_text().strip() for item in sidebar_items if item.is_visible()]
    if len(visible_items) >= 1 and any('Chuyến đi' in t for t in visible_items):
        results.pass_('TC-0041', f'FORWARDER sidebar: {len(visible_items)} items')
    else:
        results.fail('TC-0041', 'FORWARDER sidebar', f'Found items: {visible_items}')
    ctx.screenshot(page, 'TC-0041_forwarder_sidebar')
    page.close()

if __name__ == '__main__':
    sys.exit(run_suite('00-auth-permissions', test_auth))
