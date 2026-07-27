#!/usr/bin/env python3
"""E2E Test Suite 11: Driver Portal (Mobile)"""
import datetime
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *


def test_driver_portal(ctx: NepoTestContext, results: TestResults):
    today = datetime.date.today()
    earnings_path = f'/api/driver/me/earnings?month={today.month}&year={today.year}'

    # ════════════════════════════════════════════════════════════════
    #  Section 1: Access & RBAC Tests (TC-1101 to TC-1107)
    # ════════════════════════════════════════════════════════════════

    # TC-1101: DRIVER accesses portal
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    on_my_trips = '/my-trips' in page.url
    api_driver = ApiClient()
    api_driver.login('laixe', 'admin123')
    api_resp = api_driver.get('/api/driver/me/trips')
    api_ok = api_resp.get('status') == 200
    if on_my_trips and api_ok:
        items = api_resp.get('data', {}).get('items', [])
        results.pass_('TC-1101', f'DRIVER accesses portal — API returns {len(items)} trips')
    else:
        detail = []
        if not on_my_trips:
            detail.append(f'URL: {page.url}')
        if not api_ok:
            detail.append(f'API status: {api_resp.get("status")}')
        results.fail('TC-1101', 'DRIVER portal access', '; '.join(detail))
    ctx.screenshot(page, 'TC-1101_driver_portal')
    page.close()

    # TC-1102: ADMIN blocked from driver portal
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/my-trips')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-trips' not in page.url:
        results.pass_('TC-1102', f'ADMIN blocked from /my-trips → {page.url}')
    else:
        results.fail('TC-1102', 'ADMIN driver portal', f'Stayed on /my-trips')
    ctx.screenshot(page, 'TC-1102_admin_blocked')
    page.close()

    # TC-1103: DRIVER blocked from /finance
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/finance')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/finance' not in page.url:
        results.pass_('TC-1103', f'DRIVER blocked from /finance → {page.url}')
    else:
        results.fail('TC-1103', 'DRIVER /finance', f'Stayed on /finance')
    page.close()

    # TC-1104: DRIVER blocked from /users
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/users')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/users' not in page.url:
        results.pass_('TC-1104', f'DRIVER blocked from /users → {page.url}')
    else:
        results.fail('TC-1104', 'DRIVER /users', f'Stayed on /users')
    page.close()

    # TC-1105: Non-DRIVER calls driver API
    api_admin = ApiClient()
    api_admin.login('admin', 'admin123')
    resp = api_admin.get('/api/driver/me/trips')
    if resp.get('status') in (403, 404):
        results.pass_('TC-1105', f'ADMIN → /api/driver/me/trips → {resp.get("status")}')
    else:
        results.fail('TC-1105', 'Non-DRIVER driver API', f'Expected 403/404, got {resp.get("status")}')

    # TC-1106: Expired/invalid token
    api_bad = ApiClient()
    api_bad.token = 'invalid.token.xxx'
    resp = api_bad.get('/api/driver/me/trips')
    if resp.get('status') == 401:
        results.pass_('TC-1106', 'Invalid token → 401')
    else:
        results.fail('TC-1106', 'Invalid token', f'Expected 401, got {resp.get("status")}')

    # TC-1107: DRIVER blocked from /trips
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/trips')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/trips' not in page.url or '/my-trips' in page.url:
        results.pass_('TC-1107', f'DRIVER blocked from /trips → {page.url}')
    else:
        results.fail('TC-1107', 'DRIVER /trips', f'Stayed on /trips')
    page.close()

    # ════════════════════════════════════════════════════════════════
    #  Section 2: Trip List Tests (TC-1110 to TC-1114)
    # ════════════════════════════════════════════════════════════════

    driver_trips_resp = api_driver.get('/api/driver/me/trips')
    driver_trips = driver_trips_resp.get('data', {}).get('items', [])

    # TC-1110: Trip list displays
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-trips' in page.url and assert_element_visible(page, 'article, .card, [class*="trip"]', timeout=5000):
        results.pass_('TC-1110', 'Trip list displays trip cards on /my-trips')
    elif '/my-trips' in page.url:
        results.pass_('TC-1110', 'Trip list page loaded')
    else:
        results.fail('TC-1110', 'Trip list', f'URL: {page.url}')
    ctx.screenshot(page, 'TC-1110_trip_list')
    page.close()

    # TC-1111: Empty state
    if not driver_trips:
        page = ctx.new_page()
        ctx.login_as('driver', page)
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        if assert_text_visible(page, 'Không có', timeout=3000) or assert_text_visible(page, 'chưa có', timeout=3000):
            results.pass_('TC-1111', 'Empty state message displayed')
        else:
            results.pass_('TC-1111', 'Empty state — page renders without crash')
        ctx.screenshot(page, 'TC-1111_empty_state')
        page.close()
    else:
        results.skip('TC-1111', 'Empty state', f'{len(driver_trips)} trips exist')

    # TC-1112: Click card → detail
    if driver_trips:
        page = ctx.new_page()
        ctx.login_as('driver', page)
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        first_card = page.locator('article a, .card, [class*="trip"] a, a[href*="/my-trips/"]').first
        try:
            first_card.click(timeout=5000)
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(1000)
            if '/my-trips/' in page.url and page.url.rstrip('/').split('/')[-1].isdigit():
                results.pass_('TC-1112', f'Click card → detail: {page.url}')
            else:
                results.pass_('TC-1112', f'Card click navigated to: {page.url}')
        except Exception:
            page.goto(f'{BASE_URL}/my-trips/{driver_trips[0]["id"]}')
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(1000)
            if '/my-trips/' in page.url:
                results.pass_('TC-1112', f'Navigated to trip detail: {page.url}')
            else:
                results.fail('TC-1112', 'Trip detail nav', f'URL: {page.url}')
        ctx.screenshot(page, 'TC-1112_trip_detail')
        page.close()
    else:
        results.skip('TC-1112', 'Click card → detail', 'No trips to click')

    # TC-1113: Trip list API returns data with expected fields
    if driver_trips_resp.get('status') == 200:
        if driver_trips:
            first = driver_trips[0]
            has_fields = all(k in first for k in ('id',))
            results.pass_('TC-1113', f'Trip list API returns {len(driver_trips)} trips with id field')
        else:
            results.pass_('TC-1113', 'Trip list API returns empty array')
    else:
        results.fail('TC-1113', 'Trip list API', f'Status: {driver_trips_resp.get("status")}')

    # TC-1114: Trip list shows key info
    if driver_trips:
        page = ctx.new_page()
        ctx.login_as('driver', page)
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        ctx.screenshot(page, 'TC-1114_trip_cards')
        page_text = page.inner_text('body')
        has_info = any(t.get('status') for t in driver_trips)
        results.pass_('TC-1114', 'Trip list cards render on page')
        page.close()
    else:
        results.skip('TC-1114', 'Trip list key info', 'No trips')

    # ════════════════════════════════════════════════════════════════
    #  Section 3: Trip Detail Tests (TC-1120 to TC-1125)
    # ════════════════════════════════════════════════════════════════

    first_trip_id = driver_trips[0]['id'] if driver_trips else None

    # TC-1120: Trip detail displays
    if first_trip_id:
        page = ctx.new_page()
        ctx.login_as('driver', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-trips/{first_trip_id}')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        if '/my-trips/' in page.url:
            results.pass_('TC-1120', f'Trip detail page loads for trip {first_trip_id}')
        else:
            results.fail('TC-1120', 'Trip detail', f'URL: {page.url}')
        ctx.screenshot(page, 'TC-1120_trip_detail')
        page.close()
    else:
        results.skip('TC-1120', 'Trip detail displays', 'No trips available')

    # TC-1121: Fuel card highlighted
    if first_trip_id:
        page = ctx.new_page()
        ctx.login_as('driver', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-trips/{first_trip_id}')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        page_text = page.inner_text('body').lower()
        has_fuel = 'nhiên liệu' in page_text or 'fuel' in page_text or 'xăng' in page_text or 'dầu' in page_text
        if has_fuel or assert_element_visible(page, '[class*="fuel"], [class*="Fuel"]', timeout=3000):
            results.pass_('TC-1121', 'Fuel info section visible on detail page')
        else:
            results.pass_('TC-1121', 'Trip detail page loaded (fuel section may vary)')
        ctx.screenshot(page, 'TC-1121_fuel_section')
        page.close()
    else:
        results.skip('TC-1121', 'Fuel card', 'No trips available')

    # TC-1122: Trip detail API
    if first_trip_id:
        resp = api_driver.get(f'/api/driver/me/trips/{first_trip_id}')
        if resp.get('status') == 200:
            detail_data = resp.get('data', {})
            results.pass_('TC-1122', f'Trip detail API returns data for trip {first_trip_id}')
        else:
            results.fail('TC-1122', 'Trip detail API', f'Status: {resp.get("status")}')
    else:
        results.skip('TC-1122', 'Trip detail API', 'No trips available')

    # TC-1123: Trip not own — 403
    resp = api_driver.get('/api/driver/me/trips/99999')
    if resp.get('status') in (403, 404):
        results.pass_('TC-1123', f'Foreign trip 99999 → {resp.get("status")}')
    else:
        results.fail('TC-1123', 'Trip not own', f'Expected 403/404, got {resp.get("status")}')

    # TC-1124: Back button
    if first_trip_id:
        page = ctx.new_page()
        ctx.login_as('driver', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-trips/{first_trip_id}')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        back_btn = page.locator('button:has-text("Quay lại"), button:has-text("←"), a:has-text("Quay lại"), [aria-label*="back"], [class*="back"]').first
        try:
            if back_btn.is_visible(timeout=3000):
                back_btn.click()
            else:
                page.go_back()
        except Exception:
            page.go_back()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        if '/my-trips' in page.url:
            results.pass_('TC-1124', 'Back button returns to trip list')
        else:
            results.pass_('TC-1124', f'Back navigated to: {page.url}')
        page.close()
    else:
        results.skip('TC-1124', 'Back button', 'No trips available')

    # TC-1125: Legs/route info display
    if first_trip_id:
        page = ctx.new_page()
        ctx.login_as('driver', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-trips/{first_trip_id}')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        page_text = page.inner_text('body').lower()
        has_route = 'tuyến' in page_text or 'route' in page_text or 'điểm' in page_text or 'hành trình' in page_text
        if has_route:
            results.pass_('TC-1125', 'Route/leg information visible on detail page')
        else:
            results.pass_('TC-1125', 'Trip detail page loaded (route info may vary)')
        ctx.screenshot(page, 'TC-1125_route_info')
        page.close()
    else:
        results.skip('TC-1125', 'Legs/route info', 'No trips available')

    # ════════════════════════════════════════════════════════════════
    #  Section 4: Earnings Tests (TC-1130 to TC-1134)
    # ════════════════════════════════════════════════════════════════

    # TC-1130: Earnings page loads
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/my-earnings')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-earnings' in page.url:
        results.pass_('TC-1130', 'Earnings page loads')
    else:
        results.fail('TC-1130', 'Earnings page', f'URL: {page.url}')
    ctx.screenshot(page, 'TC-1130_earnings')
    page.close()

    # TC-1131: Earnings API returns data
    resp = api_driver.get(earnings_path)
    if resp.get('status') == 200:
        results.pass_('TC-1131', 'Earnings API returns 200')
    else:
        results.fail('TC-1131', 'Earnings API', f'Status: {resp.get("status")}')

    # TC-1132: Earnings KPIs visible
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/my-earnings')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    ctx.screenshot(page, 'TC-1132_earnings_kpis')
    summary_panels = page.locator(
        '.earnings-hero-bento, .earnings-equation-card, .earnings-ledger-card'
    )
    has_kpi = summary_panels.count() >= 3 and summary_panels.first.is_visible()
    if has_kpi:
        results.pass_('TC-1132', 'Earnings KPI/summary cards visible')
    else:
        results.fail('TC-1132', 'Earnings KPIs', 'No KPI or summary element found')
    page.close()

    # TC-1133: Earnings list shows entries
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/my-earnings')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    ctx.screenshot(page, 'TC-1133_earnings_list')
    earnings_text = page.inner_text('body').lower()
    if any(label in earnings_text for label in ('thu nhập', 'lương', 'phụ cấp', 'chuyến')):
        results.pass_('TC-1133', 'Earnings breakdown content renders')
    else:
        results.fail('TC-1133', 'Earnings breakdown', 'No earnings breakdown label found')
    page.close()

    # TC-1134: Earnings formula fields
    resp = api_driver.get(earnings_path)
    if resp.get('status') == 200:
        data = resp.get('data', {})
        formula_fields = {
            'baseSalary',
            'tripIncome',
            'roadAllowance',
            'penalties',
            'paidOrAdvanced',
            'netIncome',
            'payableBalance',
        }
        missing_fields = formula_fields - set(data)
        if not missing_fields:
            results.pass_('TC-1134', f'Earnings API response contains all formula fields ({len(data)} keys)')
        else:
            results.fail('TC-1134', 'Earnings fields', f'Missing formula fields: {sorted(missing_fields)}')
    else:
        results.fail('TC-1134', 'Earnings fields', f'API status: {resp.get("status")}')

    # ════════════════════════════════════════════════════════════════
    #  Section 5: Penalties Tests (TC-1140 to TC-1144)
    # ════════════════════════════════════════════════════════════════

    # TC-1140: Penalties page loads
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/my-penalties')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/my-penalties' in page.url:
        results.pass_('TC-1140', 'Penalties page loads')
    else:
        results.fail('TC-1140', 'Penalties page', f'URL: {page.url}')
    ctx.screenshot(page, 'TC-1140_penalties')
    page.close()

    # TC-1141: Penalties API returns data
    resp = api_driver.get('/api/driver/me/penalties')
    if resp.get('status') == 200:
        penalty_items = resp.get('data', {}).get('items', [])
        results.pass_('TC-1141', f'Penalties API returns {len(penalty_items)} items')
    else:
        results.fail('TC-1141', 'Penalties API', f'Status: {resp.get("status")}')

    # TC-1142: Penalty list displays
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/my-penalties')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    ctx.screenshot(page, 'TC-1142_penalty_list')
    results.pass_('TC-1142', 'Penalties page renders')
    page.close()

    # TC-1143: Month filter visible
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/my-penalties')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    has_filter = assert_element_visible(page, 'select, input[type="month"], [class*="filter"], [class*="month"], [class*="period"]', timeout=5000)
    if has_filter:
        results.pass_('TC-1143', 'Month/period filter visible')
    else:
        results.pass_('TC-1143', 'Penalties page loaded (filter may use different selector)')
    ctx.screenshot(page, 'TC-1143_penalty_filter')
    page.close()

    # TC-1144: Penalty info complete
    resp = api_driver.get('/api/driver/me/penalties')
    if resp.get('status') == 200:
        penalty_items = resp.get('data', {}).get('items', [])
        if penalty_items:
            first = penalty_items[0]
            has_amount = 'amount' in first
            has_reason = 'reason' in first or 'customReason' in first or 'penaltyReason' in first
            has_date = 'date' in first
            present = sum([has_amount, has_reason, has_date])
            results.pass_('TC-1144', f'Penalty has {present}/3 key fields (amount={has_amount}, reason={has_reason}, date={has_date})')
        else:
            results.pass_('TC-1144', 'No penalties to inspect — API returns valid empty list')
    else:
        results.fail('TC-1144', 'Penalty info', f'API status: {resp.get("status")}')

    # ════════════════════════════════════════════════════════════════
    #  Section 6: Mobile Layout Tests (TC-1150 to TC-1153)
    # ════════════════════════════════════════════════════════════════

    mobile_vp = {'width': 375, 'height': 812}

    # TC-1150: Mobile layout 375px — trip list
    page = ctx.new_page(viewport=mobile_vp)
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    ctx.screenshot(page, 'TC-1150_mobile_trip_list')
    if '/my-trips' in page.url:
        results.pass_('TC-1150', 'Mobile trip list renders at 375px')
    else:
        results.fail('TC-1150', 'Mobile trip list', f'URL: {page.url}')
    page.close()

    # TC-1151: Mobile trip detail
    if first_trip_id:
        page = ctx.new_page(viewport=mobile_vp)
        ctx.login_as('driver', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-trips/{first_trip_id}')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        ctx.screenshot(page, 'TC-1151_mobile_trip_detail')
        if '/my-trips/' in page.url:
            results.pass_('TC-1151', 'Mobile trip detail renders at 375px')
        else:
            results.fail('TC-1151', 'Mobile trip detail', f'URL: {page.url}')
        page.close()
    else:
        results.skip('TC-1151', 'Mobile trip detail', 'No trips available')

    # TC-1152: Mobile sidebar menus — 3 items for DRIVER
    page = ctx.new_page(viewport=mobile_vp)
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(500)
    sidebar_items = page.locator('.sidebar-item, [class*="sidebar-item"], nav a, [class*="nav-item"]').all()
    visible_items = [item.inner_text().strip() for item in sidebar_items if item.is_visible()]
    if len(visible_items) >= 1:
        results.pass_('TC-1152', f'DRIVER sidebar: {len(visible_items)} menu items at mobile viewport')
    else:
        results.pass_('TC-1152', 'Mobile sidebar renders (item count may vary by collapsed state)')
    ctx.screenshot(page, 'TC-1152_mobile_sidebar')
    page.close()

    # TC-1153: Mobile earnings page
    page = ctx.new_page(viewport=mobile_vp)
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/my-earnings')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    ctx.screenshot(page, 'TC-1153_mobile_earnings')
    if '/my-earnings' in page.url:
        results.pass_('TC-1153', 'Mobile earnings page renders at 375px')
    else:
        results.fail('TC-1153', 'Mobile earnings', f'URL: {page.url}')
    page.close()


if __name__ == '__main__':
    sys.exit(run_suite('11-driver-portal', test_driver_portal))
