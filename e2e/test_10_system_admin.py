#!/usr/bin/env python3
"""E2E Test Suite 10: System Administration (Users & Audit Logs)"""
import sys, os
from uuid import uuid4
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *

TEST_USER = {
    'username': f'test_e2e_admin_10_{uuid4().hex[:8]}',
    'password': 'test123456',
    'role': 'ACCOUNTANT',
    'status': 'ACTIVE',
}

def version_headers(user: dict) -> dict:
    """Send the exact version returned by the API for optimistic locking."""
    return {'If-Unmodified-Since': user['updatedAt']}

def test_system_admin(ctx: NepoTestContext, results: TestResults):
    api = ApiClient()
    api.login('admin', 'Abc123')

    # ── Users Page Tests (TC-1001 to TC-1017) ──

    # TC-1001: Users page loads
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.goto(f'{BASE_URL}/users')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/users' in page.url:
        results.pass_('TC-1001', 'Users page loads for ADMIN')
    else:
        results.fail('TC-1001', 'Users page loads', f'URL: {page.url}')
    ctx.screenshot(page, 'TC-1001_users_page')
    page.close()

    # TC-1002: KPI cards accurate
    resp = api.get('/api/auth/users')
    if resp.get('status') == 200:
        user_count = resp['data'].get('total', 0)
        page = ctx.new_page()
        ctx.login_as('admin', page)
        page.goto(f'{BASE_URL}/users')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        kpi_text = page.locator('.kpi-grid').first.inner_text()
        if str(user_count) in kpi_text:
            results.pass_('TC-1002', f'KPI cards match API count ({user_count})')
        else:
            results.fail('TC-1002', 'KPI cards', f'API total={user_count}, KPI text missing count')
        page.close()
    else:
        results.fail('TC-1002', 'KPI cards', f'API status: {resp.get("status")}')

    # TC-1003: Role pill filters visible
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.goto(f'{BASE_URL}/users')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    pills = page.locator('.filter-pill').all()
    pill_labels = []
    for p in pills:
        try:
            pill_labels.append(p.inner_text().strip())
        except:
            pass
    expected_roles = [
        'Quản trị viên',
        'Quản lý',
        'Kế toán',
        'Lái xe',
        'Giao nhận',
        'Khách hàng',
        'Nhân viên chứng từ',
    ]
    found = all(any(role in label for label in pill_labels) for role in expected_roles)
    if found:
        results.pass_('TC-1003', f'Role filter pills visible ({len(pill_labels)} pills)')
    else:
        results.fail('TC-1003', 'Role filter pills', f'Found labels: {pill_labels}')
    ctx.screenshot(page, 'TC-1003_role_pills')
    page.close()

    # TC-1004: User search input exists
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.goto(f'{BASE_URL}/users')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if assert_element_visible(page, '.toolbar__search input', timeout=3000):
        results.pass_('TC-1004', 'User search input exists')
    else:
        results.fail('TC-1004', 'User search input', 'Search input not found')
    page.close()

    # TC-1005: Create user via API
    resp = api.post('/api/auth/users', TEST_USER)
    created_user = None
    if resp.get('status') in (200, 201):
        created_user = resp.get('data', {})
        results.pass_('TC-1005', f'Create user via API (id={created_user.get("id")})')
    else:
        results.fail('TC-1005', 'Create user via API', f'Status: {resp.get("status")}, body: {resp.get("error")}')

    # TC-1006: Create user missing password
    resp = api.post('/api/auth/users', {'username': 'no_pwd_user', 'role': 'DRIVER'})
    if resp.get('status') in (400, 422):
        results.pass_('TC-1006', 'Create user missing password → validation error')
    else:
        results.fail('TC-1006', 'Create user missing password', f'Expected 400, got {resp.get("status")}')

    # TC-1007: Create user short password
    resp = api.post('/api/auth/users', {'username': 'short_pwd', 'password': 'abc', 'role': 'DRIVER'})
    if resp.get('status') in (400, 422):
        results.pass_('TC-1007', 'Create user short password → validation error')
    else:
        results.fail('TC-1007', 'Create user short password', f'Expected 400, got {resp.get("status")}')

    # TC-1008: Edit user change role
    if created_user and created_user.get('id'):
        uid = created_user['id']
        resp = api.patch(
            f'/api/auth/users/{uid}',
            {'role': 'MANAGER'},
            version_headers(created_user),
        )
        if resp.get('status') == 200:
            created_user = resp['data']
            results.pass_('TC-1008', 'Edit user change role → MANAGER')
        else:
            results.fail('TC-1008', 'Edit user role', f'Status: {resp.get("status")}')
    else:
        results.skip('TC-1008', 'Edit user role', 'No test user created from TC-1005')

    # TC-1009: Edit user change status
    if created_user and created_user.get('id'):
        uid = created_user['id']
        resp = api.patch(
            f'/api/auth/users/{uid}',
            {'status': 'INACTIVE'},
            version_headers(created_user),
        )
        if resp.get('status') == 200:
            created_user = resp['data']
            results.pass_('TC-1009', 'Edit user change status → INACTIVE')
        else:
            results.fail('TC-1009', 'Edit user status', f'Status: {resp.get("status")}')
    else:
        results.skip('TC-1009', 'Edit user status', 'No test user created from TC-1005')

    # TC-1010: Delete user via API (the one from TC-1005)
    if created_user and created_user.get('id'):
        uid = created_user['id']
        resp = api.delete(f'/api/auth/users/{uid}', version_headers(created_user))
        if resp.get('status') == 200:
            results.pass_('TC-1010', f'Delete user via API (id={uid})')
        else:
            results.fail('TC-1010', 'Delete user', f'Status: {resp.get("status")}')
    else:
        results.skip('TC-1010', 'Delete user', 'No test user created from TC-1005')

    # TC-1011: Cannot delete self
    me_resp = api.get('/api/auth/me')
    if me_resp.get('status') == 200:
        my_id = me_resp['data'].get('userId') or me_resp['data'].get('id')
        if my_id:
            resp = api.delete(
                f'/api/auth/users/{my_id}',
                version_headers(me_resp['data']),
            )
            if resp.get('status') in (400, 403):
                results.pass_('TC-1011', 'Cannot delete self → blocked')
            else:
                results.fail('TC-1011', 'Cannot delete self', f'Expected 400, got {resp.get("status")}')
        else:
            results.skip('TC-1011', 'Cannot delete self', 'Could not determine current user ID')
    else:
        results.skip('TC-1011', 'Cannot delete self', f'/api/auth/me returned {me_resp.get("status")}')

    # TC-1012: Role pill colors on users page
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.goto(f'{BASE_URL}/users')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    colored_pills = page.locator('.pill, [class*="filter-pill--"]').all()
    if len(colored_pills) > 0:
        results.pass_('TC-1012', f'Role pill colors visible ({len(colored_pills)} colored pills)')
    else:
        results.fail('TC-1012', 'Role pill colors', 'No colored role pills found')
    ctx.screenshot(page, 'TC-1012_role_pill_colors')
    page.close()

    # TC-1013: MANAGER can access users
    api_mgr = ApiClient()
    api_mgr.login('giamdoc', 'Abc123')
    resp = api_mgr.get('/api/auth/users')
    page = ctx.new_page()
    ctx.login_as('manager', page)
    page.goto(f'{BASE_URL}/users')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/users' in page.url and resp.get('status') == 200:
        results.pass_('TC-1013', 'MANAGER can view /users')
    else:
        results.fail('TC-1013', 'MANAGER users access', f'URL: {page.url}, API status: {resp.get("status")}')
    ctx.screenshot(page, 'TC-1013_manager_users')
    page.close()

    # TC-1014: ACCOUNTANT users access
    api_acc = ApiClient()
    api_acc.login('ketoan', 'Abc123')
    resp = api_acc.get('/api/auth/users')
    page = ctx.new_page()
    ctx.login_as('accountant', page)
    page.goto(f'{BASE_URL}/users')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if resp.get('status') == 403:
        results.pass_('TC-1014', 'ACCOUNTANT blocked from /api/auth/users → 403')
    elif '/users' in page.url:
        results.pass_('TC-1014', 'ACCOUNTANT can view /users page')
    else:
        results.fail('TC-1014', 'ACCOUNTANT users', f'API: {resp.get("status")}, URL: {page.url}')
    page.close()

    # TC-1015: DRIVER blocked from /users
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.goto(f'{BASE_URL}/users')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-trips' in page.url:
        results.pass_('TC-1015', 'DRIVER → /users → redirect /my-trips')
    else:
        results.fail('TC-1015', 'DRIVER blocked from /users', f'Expected /my-trips, got {page.url}')
    page.close()

    # TC-1016: Mobile card view
    page = ctx.new_page(viewport={'width': 375, 'height': 812})
    ctx.login_as('admin', page)
    page.goto(f'{BASE_URL}/users')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    mobile_cards = page.locator('.mobile-only, .m-card').all()
    no_overflow = page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    if '/users' in page.url and len(mobile_cards) > 0 and no_overflow:
        ctx.screenshot(page, 'TC-1016_mobile_users')
        results.pass_('TC-1016', f'Mobile users page renders without overflow ({len(mobile_cards)} mobile elements)')
    else:
        results.fail('TC-1016', 'Mobile card view', f'URL={page.url}, cards={len(mobile_cards)}, noOverflow={no_overflow}')
    page.close()

    # TC-1017: Duplicate user error
    dup_user = {
        'username': f'test_dup_e2e_10_{uuid4().hex[:8]}',
        'password': 'test123456',
        'role': 'DRIVER',
    }
    resp1 = api.post('/api/auth/users', dup_user)
    if resp1.get('status') in (200, 201):
        dup_user_created = resp1.get('data', {})
        dup_id = dup_user_created.get('id')
        resp2 = api.post('/api/auth/users', dup_user)
        if resp2.get('status') == 409:
            results.pass_('TC-1017', 'Duplicate username → 409')
        else:
            results.fail('TC-1017', 'Duplicate username', f'Expected 409, got {resp2.get("status")}')
        if dup_id:
            api.delete(f'/api/auth/users/{dup_id}', version_headers(dup_user_created))
    else:
        results.skip('TC-1017', 'Duplicate user error', f'First create failed: {resp1.get("status")}')

    # ── Audit Logs Tests (TC-1020 to TC-1031) ──

    # TC-1020: Audit logs page loads
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.goto(f'{BASE_URL}/audit-logs')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/audit-logs' in page.url:
        results.pass_('TC-1020', 'Audit logs page loads for ADMIN')
    else:
        results.fail('TC-1020', 'Audit logs page', f'URL: {page.url}')
    ctx.screenshot(page, 'TC-1020_audit_logs')
    page.close()

    # TC-1021: Audit log API returns data
    resp = api.get('/api/audit-logs')
    if resp.get('status') == 200:
        total = resp.get('data', {}).get('total', 0)
        results.pass_('TC-1021', f'Audit log API returns 200 ({total} entries)')
    else:
        results.fail('TC-1021', 'Audit log API', f'Status: {resp.get("status")}')

    # TC-1022: Filter audit by category
    resp = api.get('/api/audit-logs?category=trip')
    if resp.get('status') == 200:
        results.pass_('TC-1022', 'Filter audit by category=trip returns 200')
    else:
        results.fail('TC-1022', 'Filter audit category', f'Status: {resp.get("status")}')

    # TC-1023: Search audit log
    resp = api.get('/api/audit-logs?search=login')
    if resp.get('status') == 200:
        results.pass_('TC-1023', 'Search audit logs (search=login) returns 200')
    else:
        results.fail('TC-1023', 'Search audit log', f'Status: {resp.get("status")}')

    # TC-1024: Audit pagination
    resp = api.get('/api/audit-logs?page=1&limit=10')
    if resp.get('status') == 200:
        data = resp.get('data', {})
        items = data.get('items', [])
        results.pass_('TC-1024', f'Audit pagination returns 200 ({len(items)} items)')
    else:
        results.fail('TC-1024', 'Audit pagination', f'Status: {resp.get("status")}')

    # TC-1025: Vietnamese action labels
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.goto(f'{BASE_URL}/audit-logs')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    vietnamese_keywords = ['Đăng nhập', 'Tạo chuyến', 'Cập nhật', 'Hoàn thành', 'Xóa']
    found_vi = any(assert_text_visible(page, kw, timeout=3000) for kw in vietnamese_keywords)
    if found_vi:
        results.pass_('TC-1025', 'Vietnamese action labels visible in audit entries')
    elif page.locator('.table-hover tbody tr').count() == 0:
        results.skip('TC-1025', 'Vietnamese action labels', 'No audit entries in current view')
    else:
        results.fail('TC-1025', 'Vietnamese action labels', 'Audit entries exist but no expected Vietnamese action label was found')
    ctx.screenshot(page, 'TC-1025_vietnamese_labels')
    page.close()

    # TC-1026: MANAGER view audit logs
    api_mgr = ApiClient()
    api_mgr.login('giamdoc', 'Abc123')
    resp = api_mgr.get('/api/audit-logs')
    page = ctx.new_page()
    ctx.login_as('manager', page)
    page.goto(f'{BASE_URL}/audit-logs')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/audit-logs' in page.url and resp.get('status') == 200:
        results.pass_('TC-1026', 'MANAGER can view audit logs')
    else:
        results.fail('TC-1026', 'MANAGER audit logs', f'URL: {page.url}, API: {resp.get("status")}')
    page.close()

    # TC-1027: ACCOUNTANT view audit logs
    api_acc = ApiClient()
    api_acc.login('ketoan', 'Abc123')
    resp = api_acc.get('/api/audit-logs')
    page = ctx.new_page()
    ctx.login_as('accountant', page)
    page.goto(f'{BASE_URL}/audit-logs')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/audit-logs' in page.url and resp.get('status') == 200:
        results.pass_('TC-1027', 'ACCOUNTANT can view audit logs')
    else:
        results.fail('TC-1027', 'ACCOUNTANT audit logs', f'URL: {page.url}, API: {resp.get("status")}')
    page.close()

    # TC-1028: Audit sorted newest first
    resp = api.get('/api/audit-logs?page=1&limit=10')
    if resp.get('status') == 200:
        items = resp.get('data', {}).get('items', [])
        if len(items) >= 2:
            ts_first = items[0].get('timestamp', '')
            ts_second = items[1].get('timestamp', '')
            if ts_first >= ts_second:
                results.pass_('TC-1028', 'Audit logs sorted newest first')
            else:
                results.fail('TC-1028', 'Audit sort order', f'{ts_first} < {ts_second}')
        else:
            results.skip('TC-1028', 'Audit sort order', f'Only {len(items)} entries, need >=2')
    else:
        results.fail('TC-1028', 'Audit sort order', f'API status: {resp.get("status")}')

    # TC-1029: DRIVER blocked from audit logs
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.goto(f'{BASE_URL}/audit-logs')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-trips' in page.url:
        results.pass_('TC-1029', 'DRIVER → /audit-logs → redirect /my-trips')
    else:
        results.fail('TC-1029', 'DRIVER audit logs', f'Expected /my-trips, got {page.url}')
    page.close()

    # TC-1030: Audit log user column shows avatar/name
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.goto(f'{BASE_URL}/audit-logs')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    avatars = page.locator('.avatar-ring').all()
    table_rows = page.locator('.table-hover tbody tr').all()
    if len(table_rows) > 0 and len(avatars) > 0:
        results.pass_('TC-1030', f'Audit user column with avatars ({len(avatars)} found)')
    elif len(table_rows) == 0:
        results.skip('TC-1030', 'Audit user column', 'No entries in current view')
    else:
        results.fail('TC-1030', 'Audit user column', f'{len(table_rows)} rows but no avatars')
    ctx.screenshot(page, 'TC-1030_audit_user_column')
    page.close()

    # TC-1031: Empty audit filter returns empty state
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.goto(f'{BASE_URL}/audit-logs')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    search_input = page.locator('input[name="auditSearch"], input[aria-label="Tìm trong nhật ký người dùng"]').first
    if search_input.is_visible():
        search_input.fill('zzzzz_nonexistent_query_xyz')
        page.wait_for_timeout(1500)
        ctx.screenshot(page, 'TC-1031_empty_filter')
        if assert_text_visible(page, 'Không tìm thấy bản ghi', timeout=3000):
            results.pass_('TC-1031', 'Empty audit filter shows empty state')
        else:
            results.fail('TC-1031', 'Empty audit filter', 'Expected empty-state message was not found')
    else:
        results.skip('TC-1031', 'Empty audit filter', 'Search input not found')
    page.close()

if __name__ == '__main__':
    sys.exit(run_suite('10-system-admin', test_system_admin))
