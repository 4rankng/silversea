#!/usr/bin/env python3
"""E2E Test Suite 01: Trip Lifecycle — create, dispatch, complete, lock, cancel"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from helpers import *
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

def get_first_trip_id(api: ApiClient) -> int:
    """Get first trip ID from the API."""
    resp = api.get('/api/trips')
    items = resp.get('data', {}).get('items', [])
    return items[0]['id'] if items else None

def test_trips(ctx: SilverseaTestContext, results: TestResults):
    api = ApiClient()
    api.login('admin', 'Abc123')

    # ── API: Get catalogs for creating a trip ──
    customers = api.get('/api/customers')
    routes = api.get('/api/routes')
    trucks = api.get('/api/trucks')
    drivers = api.get('/api/drivers')
    cargo_types = api.get('/api/cargo-types')
    container_types = api.get('/api/container-types')

    cust_data = customers.get('data', {})
    route_data = routes.get('data', {})
    truck_data = trucks.get('data', {})
    driver_data = drivers.get('data', {})
    cargo_data = cargo_types.get('data', {})
    container_data = container_types.get('data', {})

    # Try extracting items from various response formats
    def first_item(data):
        if isinstance(data, list) and data:
            return data[0]
        if isinstance(data, dict):
            items = data.get('items', data.get('data', []))
            if isinstance(items, list) and items:
                return items[0]
        return None

    def all_items(data):
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            items = data.get('items', data.get('data', []))
            return items if isinstance(items, list) else []
        return []

    customer_items = all_items(cust_data)
    route_items = all_items(route_data)
    customer = next(
        (item for item in customer_items if float(item.get('fuelSurchargeSharePct') or 0) > 0),
        first_item(cust_data),
    )
    route = next(
        (item for item in route_items if item.get('defaultLegs') or float(item.get('distanceKm') or 0) > 0),
        first_item(route_data),
    )
    truck = first_item(truck_data)
    driver = first_item(driver_data)
    cargo = first_item(cargo_data)
    container = first_item(container_data)

    if not all([customer, route, truck, driver, cargo, container]):
        results.skip('TC-0101', 'Create trip', 'Missing catalog data (customers, routes, trucks, drivers, cargo types, or container types)')
        results.skip('TC-0102', 'View trip detail', 'Depends on TC-0101')
        results.skip('TC-0103', 'Trip list loads', 'Cannot verify without trips')
        results.skip('TC-0104', 'Edit trip', 'Depends on TC-0101')
        return

    # ── TC-0101: Create trip via API ──
    trip_payload = {
        'customerId': customer['id'],
        'routeId': route['id'],
        'truckId': truck['id'],
        'driverId': driver['id'],
        'cargoTypeId': cargo['id'],
        'containerTypeId': container['id'],
        'departureDate': '2026-06-15',
        'customerReference': 'E2E-TEST-001',
    }
    resp = api.post('/api/trips', trip_payload)
    if resp.get('status') == 201 or (resp.get('data') and resp.get('data', {}).get('id')):
        trip_id = resp['data']['id']
        results.pass_('TC-0101', f'Create trip via API → id={trip_id}')
    else:
        results.fail('TC-0101', 'Create trip', f'Got: {resp}')
        trip_id = resp.get('data', {}).get('id') or get_first_trip_id(api)
        if not trip_id:
            return

    # ── TC-0101B: O2C rev1 fuel surcharge is already snapshotted at create ──
    # The merged fuel-surcharge pricing is strict (see shared computeFuelSurcharge):
    # a null base price, a non-positive share, or current <= base all yield 0.
    # When the snapshot has a numeric base AND current > base AND share > 0,
    # the surcharge applies the formula below; otherwise the snapshot and
    # amount are expected to be 0 (no kỳ phụ phí dầu configured yet).
    created_trip = resp.get('data', {})
    surcharge_snapshot = created_trip.get('fuelSurchargeSnapshot')
    if not isinstance(surcharge_snapshot, dict):
        results.fail('TC-0101B', 'Fuel surcharge at trip creation', 'Missing fuelSurchargeSnapshot in create response')
    else:
        current = surcharge_snapshot.get('currentFuelPrice')
        base = surcharge_snapshot.get('baseFuelPrice')
        liters = float(surcharge_snapshot.get('quotaLiters') or 0)
        share = surcharge_snapshot.get('customerSharePct')
        actual = int(float(created_trip.get('fuelSurchargeAmount') or 0))
        if current is None or base is None or share is None or share <= 0 or float(current) <= float(base) or liters <= 0:
            expected = 0
        else:
            expected = int(max(0, float(current) - float(base)) * liters * (float(share) / 100) + 0.5)
        if actual == expected:
            results.pass_('TC-0101B', f'Fuel surcharge snapshotted at create ({actual:,} VND)')
        else:
            results.fail(
                'TC-0101B',
                'Fuel surcharge at trip creation',
                f'expected={expected}, actual={actual}, snapshot={surcharge_snapshot}',
            )

    # ── TC-0102: View trip detail page ──
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/trips/{trip_id}')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/trips/' in page.url and str(trip_id) in page.url:
        results.pass_('TC-0102', 'Trip detail page loads')
    else:
        results.fail('TC-0102', 'Trip detail page', f'Got URL: {page.url}')
    ctx.screenshot(page, 'TC-0102_trip_detail')
    page.close()

    # ── TC-0103: Trip list page ──
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/trips')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/trips' in page.url:
        # Check for trip cards or table rows
        cards = page.locator('table tbody tr, [class*="trip"], [class*="card"]').count()
        results.pass_('TC-0103', f'Trip list loads ({cards} elements found)')
    else:
        results.fail('TC-0103', 'Trip list', f'Got URL: {page.url}')
    ctx.screenshot(page, 'TC-0103_trip_list')
    page.close()

    # ── TC-0104: Trip edit page ──
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/trips/{trip_id}/edit')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    if '/edit' in page.url:
        results.pass_('TC-0104', 'Trip edit page loads')
    else:
        results.fail('TC-0104', 'Trip edit', f'Got URL: {page.url}')
    ctx.screenshot(page, 'TC-0104_trip_edit')
    page.close()

    # ── TC-0105: ACCOUNTANT can view trips ──
    api_acct = ApiClient()
    api_acct.login('ketoan', 'Abc123')
    resp = api_acct.get('/api/trips')
    if resp.get('status') == 200:
        results.pass_('TC-0105', 'ACCOUNTANT can list trips')
    else:
        results.fail('TC-0105', 'ACCOUNTANT trips access', f'Status: {resp.get("status")}')

    # ── TC-0106: DRIVER cannot create trip via API ──
    api_driver = ApiClient()
    api_driver.login('laixe', 'Abc123')
    resp = api_driver.post('/api/trips', trip_payload)
    if resp.get('status') in (403, 401):
        results.pass_('TC-0106', 'DRIVER cannot create trip → 403')
    else:
        results.fail('TC-0106', 'DRIVER create trip', f'Expected 403, got {resp.get("status")}')

    # ── TC-0107: Exact created trip displays its business reference ──
    # Keep the unique internal-code search as an API lookup, independent of
    # page order. Visible identity is the persisted Bill/Booking, never TRP.
    # Wait for that search's actual response before asserting and clicking the
    # exact created trip link; absence, leakage and wrong destinations fail.
    page = ctx.new_page()
    ctx.login_as('admin', page)
    page.wait_for_load_state('networkidle')
    page.goto(f'{BASE_URL}/trips')
    page.wait_for_load_state('networkidle')
    trip_code = created_trip.get('tripCode')
    expected_reference = (created_trip.get('customerReference') or '').strip() or 'Chưa có số Bill/Booking'
    try:
        assert created_trip.get('id') == trip_id and trip_code, 'Creation did not return the exact trip identity'
        with page.expect_response(
            lambda response: '/api/trips' in response.url
            and f'search={trip_code}' in response.url
            and response.status == 200,
            timeout=15_000,
        ) as search_response:
            page.get_by_role('textbox', name='Tìm chuyến đi', exact=True).fill(trip_code)
        search_items = search_response.value.json().get('items', [])
        matches = [item for item in search_items if item.get('id') == trip_id]
        assert len(matches) == 1, f'Search did not return exact created trip #{trip_id}'
        assert matches[0].get('customerReference') == created_trip.get('customerReference'), 'Search business reference changed'
        trip_link = page.locator(f'a.trip-col__link[href="/trips/{trip_id}"]:visible')
        trip_link.first.wait_for(state='visible', timeout=10_000)
        assert trip_link.count() == 1, f'Expected one created-trip link, got {trip_link.count()}'
        assert trip_link.locator('.trip-name > span').first.inner_text() == expected_reference, 'Created-trip Bill/Booking display mismatch'
        row = trip_link.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " table-row ")][1]')
        row_text = row.inner_text()
        accessible_labels = row.locator('[aria-label], [title]').evaluate_all(
            "elements => elements.flatMap(el => [el.getAttribute('aria-label'), el.getAttribute('title')]).filter(Boolean)"
        )
        assert 'TRP-' not in row_text and all('TRP-' not in label for label in accessible_labels), 'Internal trip code leaked in the created row'
        ctx.screenshot(page, 'TC-0107_trip_business_reference_search')
        trip_link.click()
        page.wait_for_url(f'{BASE_URL}/trips/{trip_id}', timeout=10_000)
        page.get_by_text(expected_reference, exact=True).first.wait_for(state='visible', timeout=10_000)
        readback = api.get(f'/api/trips/{trip_id}')
        assert readback.get('status') == 200 and readback.get('data', {}).get('id') == trip_id, 'Created-trip detail readback failed'
        assert readback['data'].get('customerReference') == created_trip.get('customerReference'), 'Detail business reference changed'
        (SCREENSHOT_DIR / 'TC-0107_trip_business_reference_assertions.json').write_text(json.dumps({
            'tripId': trip_id,
            'businessReference': expected_reference,
            'searchMatchedIds': [item['id'] for item in matches],
            'rowText': row_text,
            'rowAccessibleLabels': accessible_labels,
            'href': f'/trips/{trip_id}',
            'clickedDetailUrl': page.url,
            'detailBusinessReference': readback['data'].get('customerReference'),
            'detailStatus': readback['data'].get('status'),
        }, ensure_ascii=False, indent=2), encoding='utf-8')
        results.pass_('TC-0107', 'Created trip Bill/Booking visible; exact detail link opens without internal-code leakage', expected_reference)
    except (PlaywrightTimeoutError, AssertionError) as error:
        results.fail('TC-0107', 'Created trip business reference and detail link', str(error))
    ctx.screenshot(page, 'TC-0107_trip_business_reference_detail')
    page.close()

    # ── TC-0108: Health check works ──
    api_noauth = ApiClient()
    resp = api_noauth.get('/api/health')
    if resp.get('status') == 200:
        results.pass_('TC-0108', 'Health check → 200')
    else:
        results.fail('TC-0108', 'Health check', f'Status: {resp.get("status")}')

if __name__ == '__main__':
    sys.exit(run_suite('01-trip-lifecycle', test_trips))
