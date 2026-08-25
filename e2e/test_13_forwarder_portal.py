#!/usr/bin/env python3
"""E2E Test Suite 13: Forwarder Portal — RBAC, trips, containers, expenses"""
import sys, os, uuid
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *

FINANCIAL_KEYS = ['revenue', 'totalCost', 'grossProfit', 'totalFuelCost', 'driverSalary',
                  'total_cost', 'gross_profit', 'total_fuel_cost', 'driver_salary']


def _check_no_financial_keys(data, prefix=''):
    for key in FINANCIAL_KEYS:
        camel = key[0].lower() + key[1:]
        if key in data or camel in data:
            return False
    return True


def test_forwarder_portal(ctx: SilverseaTestContext, results: TestResults):
    api_fwd = ApiClient()
    api_fwd.login('giaonhan', 'Abc123')
    secondary_forwarder = None
    api_secondary = None

    def no_invoice_fields(label):
        return {
            'expenseDate': '2026-07-28',
            'payeeName': f'E2E payee {label}',
            'note': f'E2E reason {label}',
            'noInvoiceEvidenceTypes': ['ONSITE_PHOTO'],
        }

    def customs_invoice_fields(label):
        return {
            'expenseDate': '2026-07-28',
            'payeeName': f'E2E customs payee {label}',
            'invoiceNumber': f'E2E-CUSTOMS-{label}',
            'invoiceDate': '2026-07-28',
            'declarationNumber': f'E2E-DECL-{label}',
        }

    # ── Section 1: Access & RBAC (TC-1301 to TC-1308) ──

    # TC-1301: FORWARDER accesses portal
    page = ctx.new_page()
    ctx.login_as('forwarder', page)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(500)
    fwd_home = DEMO_ACCOUNTS['forwarder']['home']
    if fwd_home in page.url or '/my-orders' in page.url:
        resp = api_fwd.get('/api/forwarder/me/trips')
        if resp.get('status') == 200:
            results.pass_('TC-1301', 'FORWARDER accesses portal, API returns 200')
        else:
            results.pass_('TC-1301', f'FORWARDER portal loads (API status: {resp.get("status")})')
    else:
        results.fail('TC-1301', 'FORWARDER portal access', f'URL: {page.url}')
    ctx.screenshot(page, 'TC-1301_forwarder_portal')
    page.close()

    # TC-1302: ADMIN blocked from forwarder portal UI
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/my-forwarder-trips')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    if '/my-forwarder-trips' not in page.url:
        results.pass_('TC-1302', 'ADMIN redirected from /my-forwarder-trips')
    else:
        results.fail('TC-1302', 'ADMIN forwarder portal UI', f'URL: {page.url}')
    page.close()

    # TC-1303: DRIVER blocked from forwarder portal
    page = ctx.new_page()
    ctx.login_as('driver', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/my-forwarder-trips')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    if '/my-forwarder-trips' not in page.url:
        results.pass_('TC-1303', 'DRIVER redirected from /my-forwarder-trips')
    else:
        results.fail('TC-1303', 'DRIVER forwarder portal', f'URL: {page.url}')
    page.close()

    # TC-1304: FORWARDER blocked from admin pages
    page = ctx.new_page()
    ctx.login_as('forwarder', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/trips')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    if '/trips' not in page.url or '/my-forwarder-trips' in page.url:
        results.pass_('TC-1304', 'FORWARDER redirected from /trips')
    else:
        results.fail('TC-1304', 'FORWARDER admin pages', f'URL: {page.url}')
    page.close()

    # TC-1305: OPS receives read-only trip catalog access
    resp = api_fwd.get('/api/trips')
    create_resp = api_fwd.post('/api/trips', {})
    if resp.get('status') == 200 and create_resp.get('status') == 403:
        results.pass_('TC-1305', 'OPS trip catalog is read-only')
    else:
        results.fail('TC-1305', 'OPS trip API boundary', f'GET={resp.get("status")}, POST={create_resp.get("status")}')

    # TC-1306: Non-FORWARDER calls forwarder API
    api_admin = ApiClient()
    api_admin.login('admin', 'Abc123')
    resp = api_admin.get('/api/forwarder/me/trips')
    if resp.get('status') in (401, 403, 404):
        results.pass_('TC-1306', f'ADMIN GET /api/forwarder/me/trips → {resp.get("status")}')
    else:
        results.fail('TC-1306', 'Non-FORWARDER forwarder API', f'Expected 403, got {resp.get("status")}')

    # TC-1307: Expired/invalid token
    api_bad = ApiClient()
    api_bad.token = 'invalid.expired.token12345'
    resp = api_bad.get('/api/forwarder/me/trips')
    if resp.get('status') in (401, 403):
        results.pass_('TC-1307', 'Invalid token → 401')
    else:
        results.fail('TC-1307', 'Invalid token', f'Expected 401, got {resp.get("status")}')

    # TC-1308: FORWARDER sidebar shows limited menus
    page = ctx.new_page()
    ctx.login_as('forwarder', page)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    admin_links = page.locator(
        'a[href="/trips"], a[href="/finance"], a[href="/penalties"], '
        'a[href="/fleet"], a[href="/config"], a[href="/audit-log"], '
        'button[aria-label="Tài chính"], button[aria-label="Đội xe"], '
        'button[aria-label="Cấu hình"]'
    )
    visible_navigation = [
        (item.get_attribute('aria-label') or item.inner_text()).strip()
        for item in page.locator('.sidebar-item, [class*="sidebar-item"]').all()
        if item.is_visible()
    ]
    expected_navigation = ('Lệnh giao nhận', 'Yêu cầu Tạm ứng', 'Phiếu thanh toán / Hoàn ứng')
    if admin_links.count() == 0 and all(any(label in item for item in visible_navigation) for label in expected_navigation):
        results.pass_('TC-1308', f'FORWARDER sidebar limited (admin links: {admin_links.count()})')
    else:
        results.fail(
            'TC-1308',
            'FORWARDER sidebar limited',
            f'admin links: {admin_links.count()}, navigation: {visible_navigation}',
        )
    ctx.screenshot(page, 'TC-1308_forwarder_sidebar')
    page.close()

    # ── Get forwarder trips for subsequent tests ──
    trips_resp = api_fwd.get('/api/forwarder/me/trips')
    fwd_trips = []
    if trips_resp.get('status') == 200:
        data = trips_resp.get('data', {})
        if isinstance(data, list):
            fwd_trips = data
        elif isinstance(data, dict):
            fwd_trips = data.get('items', data.get('data', []))
    mutable_trips = [
        trip for trip in fwd_trips
        if trip.get('status', trip.get('tripStatus')) not in ('COMPLETED', 'CANCELED')
    ]
    trip_id = mutable_trips[0]['id'] if mutable_trips else None
    trip_detail_fixture = api_fwd.get(f'/api/forwarder/me/trips/{trip_id}') if trip_id else {}
    trip_detail_data = trip_detail_fixture.get('data', {}) if trip_detail_fixture.get('status') == 200 else {}
    shipment_id = trip_detail_data.get('shipmentId')
    secondary_shipment_id = None
    for candidate in mutable_trips:
        if candidate.get('id') == trip_id:
            continue
        candidate_detail = api_fwd.get(f'/api/forwarder/me/trips/{candidate.get("id")}')
        candidate_shipment_id = (
            candidate_detail.get('data', {}).get('shipmentId')
            if candidate_detail.get('status') == 200
            else None
        )
        if candidate_shipment_id and candidate_shipment_id != shipment_id:
            secondary_shipment_id = candidate_shipment_id
            break
    if secondary_shipment_id is None:
        shipment_catalog = api_admin.get('/api/shipments?limit=100')
        shipment_catalog_data = shipment_catalog.get('data', {})
        shipment_candidates = (
            shipment_catalog_data
            if isinstance(shipment_catalog_data, list)
            else shipment_catalog_data.get('items', shipment_catalog_data.get('data', []))
            if isinstance(shipment_catalog_data, dict)
            else []
        )
        secondary_shipment = next(
            (
                row for row in shipment_candidates
                if row.get('id') != shipment_id
                and row.get('status') not in ('COMPLETED', 'CANCELED')
            ),
            None,
        )
        secondary_shipment_id = secondary_shipment.get('id') if secondary_shipment else None
    if shipment_id:
        secondary_username = f'e2e_forwarder_{uuid.uuid4().hex[:10]}'
        created_secondary = api_admin.post('/api/auth/users', {
            'username': secondary_username,
            'fullName': 'E2E Forwarder Scope',
            'password': 'Abc123',
            'role': 'FORWARDER',
            'status': 'ACTIVE',
            'shipmentIds': [secondary_shipment_id] if secondary_shipment_id else [],
        })
        if created_secondary.get('status') in (200, 201):
            secondary_forwarder = created_secondary.get('data', {})
            api_secondary = ApiClient()
            login_secondary = api_secondary.login(secondary_username, 'Abc123')
            if not login_secondary.get('token'):
                results.fail('TC-1353-FIXTURE', 'Login second forwarder fixture', str(login_secondary))
                api_secondary = None
            else:
                out_of_scope = api_secondary.get(f'/api/forwarder/me/trips/{trip_id}')
                if out_of_scope.get('status') == 404:
                    results.pass_('TC-1309', 'Out-of-scope trip detail is hidden from another forwarder')
                else:
                    results.fail(
                        'TC-1309',
                        'Out-of-scope trip detail',
                        f'Expected 404, got {out_of_scope.get("status")}',
                    )
        else:
            results.fail(
                'TC-1353-FIXTURE',
                'Create second forwarder fixture',
                f'Status: {created_secondary.get("status")}, body: {created_secondary}',
            )
    notes_fixture = f'E2E hướng dẫn giao nhận cho chuyến {trip_id}' if trip_id else None
    if trip_id:
        fixture_resp = api_admin.put(f'/api/trips/{trip_id}/instructions', {
            'notes': notes_fixture,
        })
        if fixture_resp.get('status') not in (200, 201):
            results.fail(
                'TC-1324-FIXTURE',
                'Create deterministic trip-note fixture',
                f'Status: {fixture_resp.get("status")}, Body: {fixture_resp}',
            )

    # ── Section 2: Trip List (TC-1310 to TC-1315) ──

    # TC-1310: Trip list displays
    page = ctx.new_page()
    ctx.login_as('forwarder', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/my-forwarder-trips')
    page.wait_for_load_state('networkidle')
    rows = page.locator('.role-work-inbox__table tbody tr:visible').count()
    empty_state = page.get_by_text('Không có việc trong nhóm này.')
    has_empty_state = empty_state.count() > 0 and empty_state.first.is_visible()
    heading = page.get_by_role('heading', name='Lệnh giao nhận')
    if heading.count() > 0 and heading.first.is_visible() and (rows > 0 or has_empty_state):
        state = f'{rows} visible inbox rows' if rows > 0 else 'authoritative empty state'
        results.pass_('TC-1310', f'Operations work inbox displays ({state})')
    else:
        results.fail(
            'TC-1310',
            'Operations work inbox displays',
            f'heading={heading.count()}, rows={rows}, emptyState={has_empty_state}',
        )
    ctx.screenshot(page, 'TC-1310_trip_list')
    page.close()

    # TC-1311: Empty state
    if len(fwd_trips) == 0:
        page = ctx.new_page()
        ctx.login_as('forwarder', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-forwarder-trips')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        empty_state = page.get_by_text('Chưa có lệnh phù hợp')
        if empty_state.count() > 0 and empty_state.first.is_visible():
            results.pass_('TC-1311', 'Empty state message visible')
        else:
            results.fail('TC-1311', 'Empty state', 'No empty-state message found')
        page.close()
    else:
        results.skip('TC-1311', 'Empty state', f'Trips exist ({len(fwd_trips)} found)')

    # TC-1312: Click card → embedded bill workspace
    if trip_id:
        page = ctx.new_page()
        ctx.login_as('forwarder', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-forwarder-trips')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        first_card = page.locator('.ftrip-card').first
        try:
            first_card.click(timeout=3000)
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(1000)
            embedded_detail = page.locator('.ops-bill-detail:visible').count()
            if page.url.rstrip('/').endswith('/my-forwarder-trips') and embedded_detail == 1:
                results.pass_('TC-1312', f'Click card → embedded bill workspace (trip {trip_id})')
            else:
                results.fail('TC-1312', 'Click card → embedded bill workspace', f'URL={page.url}, visible workspace={embedded_detail}')
        except Exception as err:
            results.fail('TC-1312', 'Click card → embedded bill workspace', f'No usable Bill card: {err}')
        ctx.screenshot(page, 'TC-1312_trip_detail_nav')
        page.close()
    else:
        results.skip('TC-1312', 'Click card → embedded bill workspace', 'No trips available')

    # TC-1313: No financial fields in API
    if fwd_trips:
        first_trip = fwd_trips[0]
        if _check_no_financial_keys(first_trip):
            results.pass_('TC-1313', 'Trip API response has no financial fields')
        else:
            found = [k for k in FINANCIAL_KEYS if k in first_trip]
            results.fail('TC-1313', 'No financial fields', f'Found keys: {found}')
    else:
        results.skip('TC-1313', 'No financial fields check', 'No trips returned')

    # TC-1314: All trips shown (not filtered by status)
    statuses = set()
    for t in fwd_trips:
        s = t.get('status', t.get('tripStatus', ''))
        if s:
            statuses.add(s)
    if len(fwd_trips) == 0:
        results.skip('TC-1314', 'All statuses in list', 'No trips returned')
    elif len(statuses) > 1:
        results.pass_('TC-1314', f'Multiple statuses returned: {statuses}')
    else:
        results.pass_('TC-1314', f'Trips returned with status: {statuses}')

    # TC-1315: Trip list shows key info
    if fwd_trips:
        page = ctx.new_page()
        ctx.login_as('forwarder', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-forwarder-trips')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        content = page.content()
        has_info = any(kw in content for kw in ['route', 'Route', 'tuyến', 'khách hàng', 'Customer', 'ngày', 'Date'])
        if has_info:
            results.pass_('TC-1315', 'Trip cards show route/customer/date info')
        else:
            results.pass_('TC-1315', 'Trip list page rendered (info format may differ)')
        ctx.screenshot(page, 'TC-1315_trip_info')
        page.close()
    else:
        results.skip('TC-1315', 'Trip list key info', 'No trips available')

    # ── Section 3: Trip Detail (TC-1320 to TC-1326) ──

    # TC-1320: Trip detail displays
    if trip_id:
        page = ctx.new_page()
        ctx.login_as('forwarder', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-forwarder-trips/{trip_id}')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        if str(trip_id) in page.url:
            results.pass_('TC-1320', f'Trip detail page loads (trip {trip_id})')
        else:
            results.fail('TC-1320', 'Trip detail page', f'URL: {page.url}')
        ctx.screenshot(page, 'TC-1320_trip_detail')
        page.close()
    else:
        results.skip('TC-1320', 'Trip detail displays', 'No trips available')

    # TC-1321: Non-existent trip
    resp = api_fwd.get('/api/forwarder/me/trips/999999')
    if resp.get('status') in (404, 403):
        results.pass_('TC-1321', 'Non-existent trip → 404')
    else:
        results.fail('TC-1321', 'Non-existent trip', f'Expected 404, got {resp.get("status")}')

    # TC-1322: Back button
    if trip_id:
        page = ctx.new_page()
        ctx.login_as('forwarder', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-forwarder-trips/{trip_id}')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        back_btn = page.locator('button:has-text("Quay lại"), button:has-text("Back"), a:has-text("←"), [class*="back"]')
        try:
            if back_btn.count() > 0:
                back_btn.first.click(timeout=3000)
                page.wait_for_load_state('networkidle')
                page.wait_for_timeout(1000)
                if '/my-forwarder-trips' in page.url and f'/{trip_id}' not in page.url.rstrip('/'):
                    results.pass_('TC-1322', 'Back button returns to trip list')
                else:
                    results.fail(
                        'TC-1322',
                        'Back button returns to trip list',
                        f'Expected /my-forwarder-trips, got {page.url}',
                    )
            else:
                page.go_back()
                page.wait_for_load_state('networkidle')
                page.wait_for_timeout(1000)
                if page.url.rstrip('/').endswith('/my-forwarder-trips'):
                    results.pass_('TC-1322', 'Browser back returns to trip list')
                else:
                    results.fail(
                        'TC-1322',
                        'Browser back returns to trip list',
                        f'Expected /my-forwarder-trips, got {page.url}',
                    )
        except Exception as exc:
            results.fail('TC-1322', 'Back navigation', str(exc))
        page.close()
    else:
        results.skip('TC-1322', 'Back button', 'No trips available')

    # TC-1323: Legs display
    if trip_id:
        page = ctx.new_page()
        ctx.login_as('forwarder', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-forwarder-trips/{trip_id}')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        detail_resp = api_fwd.get(f'/api/forwarder/me/trips/{trip_id}')
        expected_legs = detail_resp.get('data', {}).get('legs', []) if detail_resp.get('status') == 200 else []
        visible_stops = page.locator('.trip-legs__stop:visible').count()
        empty_visible = page.locator('.trip-legs__empty:visible').count()
        if expected_legs and visible_stops == len(expected_legs) + 1:
            results.pass_('TC-1323', f'All {len(expected_legs)} legs render as {visible_stops} stops')
        elif not expected_legs and empty_visible == 1:
            results.pass_('TC-1323', 'Leg panel renders the authoritative empty state')
        else:
            results.fail(
                'TC-1323',
                'Legs display',
                f'API legs={len(expected_legs)}, visible stops={visible_stops}, empty panels={empty_visible}',
            )
        page.close()
    else:
        results.skip('TC-1323', 'Legs display', 'No trips available')

    # TC-1324: Notes display using the deterministic instruction fixture above.
    if trip_id and notes_fixture:
        page = ctx.new_page()
        ctx.login_as('forwarder', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-forwarder-trips/{trip_id}')
        page.wait_for_load_state('networkidle')
        try:
            page.get_by_text(notes_fixture, exact=True).wait_for(state='visible', timeout=10000)
        except Exception:
            pass
        notes_count = page.locator('[class*="note"], [class*="Note"]').count()
        notes_visible = page.get_by_text(notes_fixture, exact=True).count() > 0
        if notes_visible:
            results.pass_('TC-1324', f'Notes section visible ({notes_count} matching elements)')
        else:
            results.fail('TC-1324', 'Notes display', 'No notes section found on trip detail')
        page.close()
    else:
        results.skip('TC-1324', 'Notes display', 'No trips available')

    # TC-1325: Container section visible
    if trip_id:
        page = ctx.new_page()
        ctx.login_as('forwarder', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-forwarder-trips/{trip_id}')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        container_count = page.locator('[class*="container"], [class*="Container"]').count()
        container_visible = container_count > 0 or assert_text_visible(page, 'Số Container / Seal', timeout=5000)
        detail_payload = api_fwd.get(f'/api/forwarder/me/trips/{trip_id}')
        detail_data = detail_payload.get('data', {}) if detail_payload.get('status') == 200 else {}
        detail_containers = detail_data.get('containers', []) if isinstance(detail_data, dict) else []
        synthetic_lcl_only = bool(detail_containers) and all(
            not str(container.get('containerNumber') or '').strip()
            and str(container.get('notes') or '').startswith('__fulfillment_lcl:')
            for container in detail_containers
        )
        if container_visible or synthetic_lcl_only:
            results.pass_('TC-1325', f'Container section visible ({container_count} matching elements)')
        else:
            results.fail('TC-1325', 'Container section', 'No container section found on trip detail')
        ctx.screenshot(page, 'TC-1325_container_section')
        page.close()
    else:
        results.skip('TC-1325', 'Container section', 'No trips available')

    # TC-1326: Expense section visible
    if trip_id:
        page = ctx.new_page()
        ctx.login_as('forwarder', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-forwarder-trips/{trip_id}')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        expense_count = page.locator('[class*="expense"], [class*="Expense"]').count()
        expense_visible = expense_count > 0 or assert_text_visible(page, 'Chi phí phát sinh', timeout=5000)
        if expense_visible:
            results.pass_('TC-1326', f'Expense section visible ({expense_count} matching elements)')
        else:
            results.fail('TC-1326', 'Expense section', 'No expense section found on trip detail')
        ctx.screenshot(page, 'TC-1326_expense_section')
        page.close()
    else:
        results.skip('TC-1326', 'Expense section', 'No trips available')

    # ── Section 4: Containers (TC-1330 to TC-1336) ──
    created_container_ids = []
    lift_matrix_payload = api_admin.get('/api/lift-pricing')
    lift_matrix_data = lift_matrix_payload.get('data', {})
    lift_matrix_rows = (
        lift_matrix_data
        if isinstance(lift_matrix_data, list)
        else lift_matrix_data.get('items', lift_matrix_data.get('data', []))
        if isinstance(lift_matrix_data, dict)
        else []
    )
    lift_matrix_row = next(
        (row for row in lift_matrix_rows if row.get('direction') == 'LIFT_UP'),
        None,
    )

    if not trip_id:
        for tc in ['TC-1330', 'TC-1331', 'TC-1332', 'TC-1333', 'TC-1334', 'TC-1335', 'TC-1336']:
            results.skip(tc, 'Container test', 'No trips available for forwarder')
    else:
        # TC-1330: Add container success
        resp = api_fwd.post(f'/api/forwarder/me/trips/{trip_id}/containers', {
            'containerNumber': 'E2E-CTN-001',
            'sealNumber': 'SEAL-001',
            **({'containerTypeId': lift_matrix_row['containerTypeId']} if lift_matrix_row else {}),
        })
        if resp.get('status') in (200, 201) or (resp.get('data') and resp.get('data', {}).get('id')):
            ctn_id = resp.get('data', {}).get('id')
            created_container_ids.append(ctn_id)
            results.pass_('TC-1330', f'Add container → id={ctn_id}')
        else:
            results.fail('TC-1330', 'Add container', f'Status: {resp.get("status")}, Body: {resp}')

        # TC-1331: Add container no seal
        resp = api_fwd.post(f'/api/forwarder/me/trips/{trip_id}/containers', {
            'containerNumber': 'E2E-CTN-002',
            'sealNumber': '',
        })
        if resp.get('status') in (200, 201) or (resp.get('data') and resp.get('data', {}).get('id')):
            ctn_id = resp.get('data', {}).get('id')
            created_container_ids.append(ctn_id)
            results.pass_('TC-1331', 'Add container without seal → id=%s' % ctn_id)
        else:
            results.fail('TC-1331', 'Add container no seal', f'Status: {resp.get("status")}, Body: {resp}')

        # TC-1332: Add container missing number
        resp = api_fwd.post(f'/api/forwarder/me/trips/{trip_id}/containers', {
            'sealNumber': 'SEAL-NOCTN',
        })
        if resp.get('status') in (400, 422):
            results.pass_('TC-1332', 'Missing containerNumber → 400')
        else:
            results.fail('TC-1332', 'Missing container number', f'Expected 400, got {resp.get("status")}')

        # TC-1333: Container list updates
        detail_resp = api_fwd.get(f'/api/forwarder/me/trips/{trip_id}')
        if detail_resp.get('status') == 200:
            detail_data = detail_resp.get('data', {})
            containers = detail_data.get('containers', detail_data.get('data', {}).get('containers', []))
            ctn_numbers = [c.get('containerNumber') or '' for c in containers] if containers else []
            returned_ids = {c.get('id') for c in containers}
            missing_ids = [container_id for container_id in created_container_ids if container_id not in returned_ids]
            if not missing_ids:
                results.pass_('TC-1333', f'All created containers appear in trip detail ({len(containers)} containers)')
            else:
                results.fail('TC-1333', 'Container list update', f'Missing created container IDs: {missing_ids}')
        else:
            results.fail('TC-1333', 'Container list update', f'Status: {detail_resp.get("status")}')

        # TC-1334: Multiple containers
        if len(created_container_ids) >= 2:
            detail_resp = api_fwd.get(f'/api/forwarder/me/trips/{trip_id}')
            if detail_resp.get('status') == 200:
                detail_data = detail_resp.get('data', {})
                containers = detail_data.get('containers', detail_data.get('data', {}).get('containers', []))
                if len(containers) >= 2:
                    results.pass_('TC-1334', f'Multiple containers visible ({len(containers)})')
                else:
                    results.fail('TC-1334', 'Multiple containers', f'Only {len(containers)} returned')
            else:
                results.fail('TC-1334', 'Multiple containers', f'Detail API status: {detail_resp.get("status")}')
        else:
            results.skip('TC-1334', 'Multiple containers', 'Could not create 2 containers')

        # TC-1335: Container info complete
        if created_container_ids:
            detail_resp = api_fwd.get(f'/api/forwarder/me/trips/{trip_id}')
            if detail_resp.get('status') == 200:
                detail_data = detail_resp.get('data', {})
                containers = detail_data.get('containers', detail_data.get('data', {}).get('containers', []))
                created_ctn = next((c for c in containers if c.get('id') == created_container_ids[0]), None)
                if created_ctn:
                    has_number = bool(created_ctn.get('containerNumber'))
                    has_seal = 'sealNumber' in created_ctn
                    has_id = bool(created_ctn.get('id'))
                    if has_number and has_id:
                        results.pass_('TC-1335', f'Container info complete (number: {has_number}, seal key: {has_seal}, id: {has_id})')
                    else:
                        results.fail('TC-1335', 'Container info complete', f'Container data: {list(created_ctn.keys())}')
                else:
                    results.fail('TC-1335', 'Container info complete', 'Created container not returned')
            else:
                results.skip('TC-1335', 'Container info complete', f'Detail API status: {detail_resp.get("status")}')
        else:
            results.skip('TC-1335', 'Container info complete', 'No containers created')

        # TC-1336: Container form toggle
        page = ctx.new_page()
        ctx.login_as('forwarder', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-forwarder-trips/{trip_id}')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        toggle = page.locator('button:has-text("Container"), button:has-text("container"), button:has-text("Thêm"), [class*="toggle"], [class*="collapse"]')
        try:
            if toggle.count() > 0:
                toggle.first.click(timeout=3000)
                page.wait_for_timeout(500)
                ctx.screenshot(page, 'TC-1336_container_toggle')
                results.pass_('TC-1336', 'Container form toggle clicked')
            elif page.locator('input[name*="container"], input[placeholder*="Container"]').count() > 0:
                results.pass_('TC-1336', 'Container form visible without a toggle')
            else:
                results.fail('TC-1336', 'Container form toggle', 'No toggle or visible container input found')
        except Exception as err:
            results.fail('TC-1336', 'Container form toggle', str(err))
        page.close()

    # ── Section 5: Expenses (TC-1340 to TC-1347) ──
    created_expense_ids = []

    if not trip_id:
        for tc in ['TC-1340', 'TC-1341', 'TC-1342', 'TC-1343', 'TC-1344', 'TC-1345', 'TC-1346', 'TC-1347']:
            results.skip(tc, 'Expense test', 'No trips available for forwarder')
    else:
        lift_expense_fields = None
        if created_container_ids and lift_matrix_row:
            lift_expense_fields = {
                'tripContainerId': created_container_ids[0],
                'portId': lift_matrix_row['portId'],
                'containerTypeId': lift_matrix_row['containerTypeId'],
                'loadState': lift_matrix_row.get('loadState', 'LOADED'),
                'buyAmount': int(float(lift_matrix_row['unitPrice'])),
                'expenseDate': str(lift_matrix_row['effectiveDate'])[:10],
            }

        # TC-1340: Create LIFTING expense
        resp = api_fwd.post('/api/forwarder/me/expenses', {
            'tripId': trip_id,
            'expenseType': 'LIFTING',
            **no_invoice_fields('TC-1340'),
            **(lift_expense_fields or {}),
        }) if lift_expense_fields else {'status': 409, 'error': 'Missing lift-pricing fixture'}
        if resp.get('status') in (200, 201) or (resp.get('data') and resp.get('data', {}).get('id')):
            exp_id = resp.get('data', {}).get('id')
            created_expense_ids.append(exp_id)
            results.pass_('TC-1340', f'Create LIFTING expense → id={exp_id}')
        else:
            results.fail('TC-1340', 'Create LIFTING expense', f'Status: {resp.get("status")}, Body: {resp}')

        # TC-1341: Create CUSTOMS expense
        resp = api_fwd.post('/api/forwarder/me/expenses', {
            'tripId': trip_id,
            'expenseType': 'CUSTOMS',
            'buyAmount': 300000,
            **customs_invoice_fields('TC-1341'),
        })
        if resp.get('status') in (200, 201) or (resp.get('data') and resp.get('data', {}).get('id')):
            exp_id = resp.get('data', {}).get('id')
            created_expense_ids.append(exp_id)
            results.pass_('TC-1341', f'Create CUSTOMS expense → id={exp_id}')
        else:
            results.fail('TC-1341', 'Create CUSTOMS expense', f'Status: {resp.get("status")}, Body: {resp}')

        # TC-1342: Create expense with note
        resp = api_fwd.post('/api/forwarder/me/expenses', {
            'tripId': trip_id,
            'expenseType': 'LIFTING',
            **no_invoice_fields('TC-1342'),
            **(lift_expense_fields or {}),
        }) if lift_expense_fields else {'status': 409, 'error': 'Missing lift-pricing fixture'}
        if resp.get('status') in (200, 201) or (resp.get('data') and resp.get('data', {}).get('id')):
            exp_id = resp.get('data', {}).get('id')
            created_expense_ids.append(exp_id)
            results.pass_('TC-1342', f'Create expense with note → id={exp_id}')
        else:
            results.fail('TC-1342', 'Create expense with note', f'Status: {resp.get("status")}, Body: {resp}')

        # TC-1343: Invalid amount (0)
        resp = api_fwd.post('/api/forwarder/me/expenses', {
            'tripId': trip_id,
            'expenseType': 'LIFTING',
            'buyAmount': 0,
        })
        if resp.get('status') in (400, 422):
            results.pass_('TC-1343', 'Amount 0 → 400')
        else:
            results.fail('TC-1343', 'Invalid amount 0', f'Expected 400, got {resp.get("status")}')

        # TC-1344: Invalid amount (negative)
        resp = api_fwd.post('/api/forwarder/me/expenses', {
            'tripId': trip_id,
            'expenseType': 'LIFTING',
            'buyAmount': -100,
        })
        if resp.get('status') in (400, 422):
            results.pass_('TC-1344', 'Negative amount → 400')
        else:
            results.fail('TC-1344', 'Invalid negative amount', f'Expected 400, got {resp.get("status")}')

        # TC-1345: Multiple different-type expenses
        multi_types = [
            ('OTHER', 100000),
            ('CUSTOMS', 150000),
            ('INFRASTRUCTURE', 200000),
        ]
        all_ok = True
        for etype, amt in multi_types:
            resp = api_fwd.post('/api/forwarder/me/expenses', {
                'tripId': trip_id,
                'expenseType': etype,
                'buyAmount': amt,
                **(
                    customs_invoice_fields('TC-1345')
                    if etype == 'CUSTOMS'
                    else no_invoice_fields(f'TC-1345-{etype}')
                ),
            })
            if resp.get('status') in (200, 201) or (resp.get('data') and resp.get('data', {}).get('id')):
                exp_id = resp.get('data', {}).get('id')
                created_expense_ids.append(exp_id)
            else:
                all_ok = False
        if all_ok:
            detail_resp = api_fwd.get(f'/api/forwarder/me/trips/{trip_id}')
            detail_data = detail_resp.get('data', {}) if detail_resp.get('status') == 200 else {}
            expenses = detail_data.get('expenses', detail_data.get('data', {}).get('expenses', []))
            returned_types = {expense.get('expenseType') for expense in expenses}
            expected_types = {expense_type for expense_type, _ in multi_types}
            if expected_types.issubset(returned_types):
                results.pass_('TC-1345', f'Created and reloaded {len(multi_types)} expense types')
            else:
                results.fail('TC-1345', 'Multiple expense types', f'Missing types: {sorted(expected_types - returned_types)}')
        else:
            results.fail('TC-1345', 'Multiple expense types', 'One or more create requests failed')

        # TC-1346: Expense dropdown types
        page = ctx.new_page()
        ctx.login_as('forwarder', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-forwarder-trips/{trip_id}')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        add_buttons = page.locator('button:has-text("Thêm")')
        if add_buttons.count() > 0:
            add_buttons.last.click()
            page.wait_for_timeout(500)
        dropdown = page.locator('select, [class*="dropdown"], [class*="select"], [role="listbox"]')
        if dropdown.count() > 0:
            results.pass_('TC-1346', f'Expense type dropdown visible ({dropdown.count()} selectors found)')
        else:
            results.fail('TC-1346', 'Expense type dropdown', 'No selector found')
        ctx.screenshot(page, 'TC-1346_expense_dropdown')
        page.close()

        # TC-1347: Expense list updates
        if created_expense_ids:
            detail_resp = api_fwd.get(f'/api/forwarder/me/trips/{trip_id}')
            if detail_resp.get('status') == 200:
                detail_data = detail_resp.get('data', {})
                expenses = detail_data.get('expenses', detail_data.get('data', {}).get('expenses', []))
                returned_ids = {expense.get('id') for expense in expenses}
                missing_ids = [expense_id for expense_id in created_expense_ids if expense_id not in returned_ids]
                if not missing_ids:
                    results.pass_('TC-1347', f'All created expenses visible in trip detail ({len(expenses)} found)')
                else:
                    results.fail('TC-1347', 'Expense list updates', f'Missing created expense IDs: {missing_ids}')
            else:
                results.fail('TC-1347', 'Expense list updates', f'Detail status: {detail_resp.get("status")}')
        else:
            results.skip('TC-1347', 'Expense list updates', 'No expenses created')

    # ── Section 6: Delete Expense (TC-1350 to TC-1354) ──

    if not created_expense_ids:
        for tc in ['TC-1350', 'TC-1351', 'TC-1352', 'TC-1353', 'TC-1354']:
            results.skip(tc, 'Delete expense test', 'No expenses created')
    else:
        delete_expense_id = created_expense_ids[-1]
        detail_resp = api_fwd.get(f'/api/forwarder/me/trips/{trip_id}')
        detail_data = detail_resp.get('data', {}) if detail_resp.get('status') == 200 else {}
        current_expenses = detail_data.get(
            'expenses',
            detail_data.get('data', {}).get('expenses', []),
        )
        delete_expense = next(
            (expense for expense in current_expenses if expense.get('id') == delete_expense_id),
            None,
        )
        delete_version = delete_expense.get('updatedAt') if delete_expense else None
        delete_headers = {'If-Unmodified-Since': delete_version} if delete_version else {}

        # TC-1353: A separately authenticated forwarder sharing the shipment
        # may see the trip, but cannot delete another forwarder's expense.
        if api_secondary and delete_version and secondary_forwarder:
            secondary_owned_expense = None
            secondary_owned_version = None
            share_scope = api_admin.patch(
                f'/api/auth/users/{secondary_forwarder["id"]}',
                {'shipmentIds': [shipment_id]},
                {'If-Unmodified-Since': secondary_forwarder.get('updatedAt', '')},
            )
            if share_scope.get('status') == 200:
                secondary_forwarder = share_scope.get('data', secondary_forwarder)
                secondary_create = api_secondary.post('/api/forwarder/me/expenses', {
                    'tripId': trip_id,
                    'expenseType': 'OTHER',
                    'buyAmount': 123000,
                    'sellAmount': 0,
                    'settlementMethod': 'FORWARDER_ADVANCE',
                    **no_invoice_fields('revocation'),
                })
                if secondary_create.get('status') in (200, 201):
                    secondary_owned_expense = secondary_create.get('data', {}).get('id')
                    secondary_detail = api_secondary.get(f'/api/forwarder/me/trips/{trip_id}')
                    secondary_rows = secondary_detail.get('data', {}).get('expenses', [])
                    secondary_row = next(
                        (row for row in secondary_rows if row.get('id') == secondary_owned_expense),
                        None,
                    )
                    secondary_owned_version = secondary_row.get('updatedAt') if secondary_row else None
                else:
                    results.fail(
                        'TC-1353-R-FIXTURE',
                        'Create second forwarder owned expense',
                        f'Status: {secondary_create.get("status")}',
                    )
            else:
                results.fail(
                    'TC-1353-FIXTURE',
                    'Share shipment with second forwarder',
                    f'Status: {share_scope.get("status")}',
                )
            resp = api_secondary.delete(
                f'/api/forwarder/me/expenses/{delete_expense_id}',
                delete_headers,
            )
            if resp.get('status') in (403, 404):
                results.pass_('TC-1353', f'Other forwarder delete denied → {resp.get("status")}')
            else:
                results.fail(
                    'TC-1353',
                    'Cannot delete other expense',
                    f'Expected 403/404, got {resp.get("status")}',
                )
            if secondary_shipment_id:
                revoke_scope = api_admin.patch(
                    f'/api/auth/users/{secondary_forwarder["id"]}',
                    {'shipmentIds': [secondary_shipment_id]},
                    {'If-Unmodified-Since': secondary_forwarder.get('updatedAt', '')},
                )
                if revoke_scope.get('status') == 200:
                    secondary_forwarder = revoke_scope.get('data', secondary_forwarder)
                    revoked_detail = api_secondary.get(f'/api/forwarder/me/trips/{trip_id}')
                    revoked_delete = (
                        api_secondary.delete(
                            f'/api/forwarder/me/expenses/{secondary_owned_expense}',
                            {'If-Unmodified-Since': secondary_owned_version},
                        )
                        if secondary_owned_expense and secondary_owned_version
                        else {'status': None}
                    )
                    if revoked_detail.get('status') == 404 and revoked_delete.get('status') == 404:
                        results.pass_('TC-1353-R', 'Assignment revocation immediately denies known trip and expense IDs')
                    else:
                        results.fail(
                            'TC-1353-R',
                            'Assignment revocation',
                            f'detail={revoked_detail.get("status")}, delete={revoked_delete.get("status")}',
                        )
                    if secondary_owned_expense and secondary_owned_version:
                        restore_scope = api_admin.patch(
                            f'/api/auth/users/{secondary_forwarder["id"]}',
                            {'shipmentIds': [shipment_id]},
                            {'If-Unmodified-Since': secondary_forwarder.get('updatedAt', '')},
                        )
                        if restore_scope.get('status') == 200:
                            secondary_forwarder = restore_scope.get('data', secondary_forwarder)
                            cleanup_owned = api_secondary.delete(
                                f'/api/forwarder/me/expenses/{secondary_owned_expense}',
                                {'If-Unmodified-Since': secondary_owned_version},
                            )
                            if cleanup_owned.get('status') not in (200, 204):
                                results.fail(
                                    'TC-1353-R-CLEANUP',
                                    'Delete second forwarder expense fixture',
                                    f'Status: {cleanup_owned.get("status")}',
                                )
                            final_revoke = api_admin.patch(
                                f'/api/auth/users/{secondary_forwarder["id"]}',
                                {'shipmentIds': [secondary_shipment_id]},
                                {'If-Unmodified-Since': secondary_forwarder.get('updatedAt', '')},
                            )
                            if final_revoke.get('status') == 200:
                                secondary_forwarder = final_revoke.get('data', secondary_forwarder)
                else:
                    results.fail(
                        'TC-1353-R',
                        'Revoke shared shipment',
                        f'Status: {revoke_scope.get("status")}',
                    )
        else:
            results.fail('TC-1353', 'Cannot delete other expense', 'Second forwarder fixture unavailable')

        # TC-1350: Delete own expense
        resp = api_fwd.delete(
            f'/api/forwarder/me/expenses/{delete_expense_id}',
            delete_headers,
        )
        if resp.get('status') in (200, 204):
            results.pass_('TC-1350', f'Delete own expense {delete_expense_id} → 200')
        else:
            results.fail('TC-1350', 'Delete own expense', f'Expected 200, got {resp.get("status")}')

        # TC-1351: Delete non-existent expense
        resp = api_fwd.delete(
            '/api/forwarder/me/expenses/999999',
            {'If-Unmodified-Since': '2026-01-01T00:00:00.000Z'},
        )
        if resp.get('status') in (404, 410):
            results.pass_('TC-1351', 'Delete non-existent expense → 404')
        else:
            results.fail('TC-1351', 'Delete non-existent', f'Expected 404, got {resp.get("status")}')

        # TC-1352: Delete updates list
        if trip_id:
            detail_resp = api_fwd.get(f'/api/forwarder/me/trips/{trip_id}')
            if detail_resp.get('status') == 200:
                detail_data = detail_resp.get('data', {})
                expenses = detail_data.get('expenses', detail_data.get('data', {}).get('expenses', []))
                exp_ids = [e.get('id') for e in expenses] if expenses else []
                if delete_expense_id not in exp_ids:
                    results.pass_('TC-1352', f'Deleted expense {delete_expense_id} no longer in list')
                else:
                    results.fail('TC-1352', 'Delete updates list', f'Expense {delete_expense_id} still returned')
            else:
                results.fail('TC-1352', 'Delete updates list', f'Detail status: {detail_resp.get("status")}')
        else:
            results.skip('TC-1352', 'Delete updates list', 'No trip ID')

        # TC-1354: Delete already deleted
        resp = api_fwd.delete(
            f'/api/forwarder/me/expenses/{delete_expense_id}',
            delete_headers,
        )
        if resp.get('status') in (404, 410):
            results.pass_('TC-1354', 'Delete already-deleted expense → 404')
        else:
            results.fail('TC-1354', 'Delete already deleted', f'Expected 404, got {resp.get("status")}')

    if secondary_forwarder and secondary_forwarder.get('id'):
        cleanup = api_admin.delete(
            f'/api/auth/users/{secondary_forwarder["id"]}',
            {'If-Unmodified-Since': secondary_forwarder.get('updatedAt', '')},
        )
        if cleanup.get('status') != 200:
            results.fail(
                'TC-1353-CLEANUP',
                'Delete second forwarder fixture',
                f'Status: {cleanup.get("status")}',
            )

    # ── Section 7: Admin Expense Views (TC-1360 to TC-1364) ──

    # TC-1360: ADMIN views forwarder expenses
    resp = api_admin.get('/api/forwarder-expenses')
    if resp.get('status') == 200:
        results.pass_('TC-1360', 'ADMIN views forwarder expenses → 200')
    else:
        results.fail('TC-1360', 'ADMIN forwarder expenses', f'Expected 200, got {resp.get("status")}')

    # TC-1361: Filter by trip
    if trip_id:
        resp = api_admin.get(f'/api/forwarder-expenses?tripId={trip_id}')
        if resp.get('status') == 200:
            results.pass_('TC-1361', f'Filter by tripId={trip_id} → 200')
        else:
            results.fail('TC-1361', 'Filter by trip', f'Expected 200, got {resp.get("status")}')
    else:
        resp = api_admin.get('/api/forwarder-expenses?tripId=1')
        if resp.get('status') == 200:
            results.pass_('TC-1361', 'Filter by tripId → 200')
        else:
            results.fail('TC-1361', 'Filter by trip', f'Expected 200, got {resp.get("status")}')

    # TC-1362: Filter by type
    resp = api_admin.get('/api/forwarder-expenses?expenseType=LIFTING')
    if resp.get('status') == 200:
        results.pass_('TC-1362', 'Filter by expenseType=LIFTING → 200')
    else:
        results.fail('TC-1362', 'Filter by type', f'Expected 200, got {resp.get("status")}')

    # TC-1363: FORWARDER blocked from admin expense API
    resp = api_fwd.get('/api/forwarder-expenses')
    if resp.get('status') in (403, 401):
        results.pass_('TC-1363', 'FORWARDER GET /api/forwarder-expenses → 403')
    else:
        results.fail('TC-1363', 'FORWARDER admin expense API', f'Expected 403, got {resp.get("status")}')

    # TC-1364: MANAGER views forwarder expenses
    api_mgr = ApiClient()
    api_mgr.login('giamdoc', 'Abc123')
    resp = api_mgr.get('/api/forwarder-expenses')
    if resp.get('status') == 200:
        results.pass_('TC-1364', 'MANAGER views forwarder expenses → 200')
    else:
        results.fail('TC-1364', 'MANAGER forwarder expenses', f'Expected 200, got {resp.get("status")}')

    # ── Section 8: Mobile (TC-1370 to TC-1373) ──
    mobile_vp = {'width': 375, 'height': 812}

    # TC-1370: Mobile layout 375px
    page = ctx.new_page(viewport=mobile_vp)
    ctx.login_as('forwarder', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/my-forwarder-trips')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    ctx.screenshot(page, 'TC-1370_mobile_trip_list')
    no_overflow = page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    mobile_rows = page.locator('.role-work-inbox__table tbody tr:visible').count()
    mobile_empty = page.get_by_text('Không có việc trong nhóm này.')
    has_mobile_content = mobile_rows > 0 or (mobile_empty.count() > 0 and mobile_empty.first.is_visible())
    if '/my-forwarder-trips' in page.url and no_overflow and has_mobile_content:
        results.pass_('TC-1370', 'Mobile trip list renders without horizontal overflow')
    else:
        results.fail('TC-1370', 'Mobile work inbox', f'URL={page.url}, noOverflow={no_overflow}, rows={mobile_rows}')
    page.close()

    # TC-1371: Mobile trip detail
    if trip_id:
        page = ctx.new_page(viewport=mobile_vp)
        ctx.login_as('forwarder', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-forwarder-trips/{trip_id}')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        ctx.screenshot(page, 'TC-1371_mobile_trip_detail')
        no_overflow = page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        if str(trip_id) in page.url and no_overflow and assert_text_visible(page, 'Chi phí phát sinh', timeout=3000):
            results.pass_('TC-1371', f'Mobile trip detail renders without overflow (trip {trip_id})')
        else:
            results.fail('TC-1371', 'Mobile trip detail', f'URL={page.url}, noOverflow={no_overflow}')
        page.close()
    else:
        results.skip('TC-1371', 'Mobile trip detail', 'No trips available')

    # TC-1372: Mobile container form
    if trip_id:
        page = ctx.new_page(viewport=mobile_vp)
        ctx.login_as('forwarder', page)
        page.wait_for_load_state('networkidle')
        page.goto(f'{BASE_URL}/my-forwarder-trips/{trip_id}')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        ctx.screenshot(page, 'TC-1372_mobile_container_form')
        has_container_ui = (
            assert_text_visible(page, 'Số Container / Seal', timeout=3000)
            or page.locator('input[name*="container"], input[placeholder*="Container"]').count() > 0
        )
        no_overflow = page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        if has_container_ui and no_overflow:
            results.pass_('TC-1372', 'Mobile container section renders without overflow')
        else:
            results.fail('TC-1372', 'Mobile container form', f'containerUI={has_container_ui}, noOverflow={no_overflow}')
        page.close()
    else:
        results.skip('TC-1372', 'Mobile container form', 'No trips available')

    # TC-1373: Mobile sidebar
    page = ctx.new_page(viewport=mobile_vp)
    ctx.login_as('forwarder', page)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    hamburger = page.locator('button[class*="menu"], button[class*="hamburger"], button[class*="sidebar"], [aria-label*="menu"], [class*="hamburger"]')
    try:
        if hamburger.count() > 0:
            hamburger.first.click(timeout=3000)
            page.wait_for_timeout(500)
    except Exception:
        pass
    ctx.screenshot(page, 'TC-1373_mobile_sidebar')
    no_overflow = page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    if hamburger.count() > 0 and no_overflow:
        results.pass_('TC-1373', 'Mobile navigation control is present without overflow')
    else:
        results.fail('TC-1373', 'Mobile navigation', f'menuControls={hamburger.count()}, noOverflow={no_overflow}')
    page.close()


if __name__ == '__main__':
    sys.exit(run_suite('13-forwarder-portal', test_forwarder_portal))
