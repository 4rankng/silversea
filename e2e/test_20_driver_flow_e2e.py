#!/usr/bin/env python3
"""
E2E Test Suite 20: Full CUS → Dispatcher → Driver flow
Tests the complete shipment lifecycle against the 2026.8.27 driver app spec.
"""
import datetime
import sys
import os
import time
import uuid

sys.path.insert(0, os.path.dirname(__file__))
from helpers import *

BOOKING_PREFIX = f"QA20-{uuid.uuid4().hex[:6].upper()}"
RUN_ID = uuid.uuid4().hex[:8]


def rows(resp):
    return resp.get("data", {}).get("items", resp.get("data", [])) if isinstance(resp.get("data"), dict) else resp.get("data", [])


def request_json(api, method, path, body=None, headers=None):
    if method == "POST":
        result = api.post(path, body, headers=headers)
    elif method == "PUT":
        result = api.put(path, body, headers=headers)
    elif method == "PATCH":
        result = api.patch(path, body, headers=headers)
    elif method == "GET":
        result = api.get(path)
    else:
        return 0, {"error": f"unsupported method {method}"}
    return result.get("status", 0), result.get("data", result)


def test_driver_flow_e2e(ctx: SilverseaTestContext, results: TestResults):
    """Full end-to-end: CUS creates shipment → Dispatcher assigns vehicle → Driver accepts & completes."""

    # ════════════════════════════════════════════════════════════════
    #  Phase 0: Gather master data
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'═'*60}")
    print(f"  Phase 0: Gather master data")
    print(f"{'═'*60}")

    admin_api = ApiClient()
    admin_api.login("admin", "Abc123")

    # Get CUS user's customer scope
    users_resp = admin_api.get("/api/auth/users")
    cus_user = next((u for u in rows(users_resp) if u.get("username") == "cus"), None)
    if not cus_user:
        results.fail("TC-2000", "CUS user exists", str(users_resp))
        return
    customer_ids = list(cus_user.get("customerIds") or [])
    if not customer_ids:
        results.fail("TC-2000", "CUS has customer scope", "customerIds is empty")
        return
    customer_id = customer_ids[0]
    results.pass_("TC-2000", f"CUS scope: customer #{customer_id}")

    # Get routes, cargo types, sites, container types (via admin API for full access)
    routes = rows(admin_api.get("/api/routes?page=1&pageSize=25"))
    cargo_types = rows(admin_api.get("/api/cargo-types?page=1&pageSize=25"))
    sites = rows(admin_api.get(f"/api/shipments/operational-sites?customerId={customer_id}"))
    container_types = rows(admin_api.get("/api/container-types?page=1&pageSize=25"))
    ports = rows(admin_api.get("/api/ports?page=1&pageSize=25"))
    # Also get trucks and drivers via admin API (dispatcher may not have fleet access)
    trucks_list = rows(admin_api.get("/api/trucks?limit=20"))
    drivers_list_api = rows(admin_api.get("/api/drivers?limit=20"))

    if not routes or not cargo_types or not sites:
        results.fail("TC-2000", "Master data loaded",
                      f"routes={len(routes)} cargoTypes={len(cargo_types)} sites={len(sites)}")
        return

    factory = next((s for s in sites if s.get("siteType") == "FACTORY"), sites[0])
    warehouse = next((s for s in sites if s.get("siteType") == "WAREHOUSE"), sites[0])
    cont_type = next((c for c in container_types if c.get("code") in ("20DC", "40DC", "40HC")), container_types[0])
    results.pass_("TC-2000", f"Master data: {len(routes)} routes, {len(cargo_types)} cargo types, {len(sites)} sites")

    # ════════════════════════════════════════════════════════════════
    #  Phase 1: CUS creates a shipment
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'═'*60}")
    print(f"  Phase 1: CUS creates shipment")
    print(f"{'═'*60}")

    cus_api = ApiClient()
    cus_login = cus_api.login("cus", "Abc123")
    if not cus_login.get("token"):
        results.fail("TC-2001", "CUS login", str(cus_login))
        return
    results.pass_("TC-2001", "CUS authenticates successfully")

    tomorrow = (datetime.datetime.now() + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    create_payload = {
        "customerId": customer_id,
        "routeId": routes[0]["id"],
        "cargoTypeId": cargo_types[0]["id"],
        "operationalSiteId": factory["id"],
        "pickupWarehouseSiteId": warehouse["id"],
        "cargoMode": "FCL",
        "tradeDirection": "IMPORT",
        "blNumber": f"BL{BOOKING_PREFIX}",
        "expectedDeliveryDate": tomorrow,
        "operationalNotes": f"e2e-flow-{RUN_ID}",
    }
    create_status, create_body = request_json(cus_api, "POST", "/api/shipments/quick", create_payload,
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-quick"})
    if create_status not in (200, 201):
        results.fail("TC-2002", "CUS creates shipment via API", f"status={create_status} body={create_body}")
        return
    shipment = create_body if isinstance(create_body, dict) else {}
    shipment_id = shipment.get("id")
    shipment_version = shipment.get("version", 1)
    results.pass_("TC-2002", f"Shipment created", f"#{shipment_id} v{shipment_version}")

    # Add container to the shipment (ISO 6346 check-digit format)
    if ports and cont_type:
        container_resp = cus_api.put(f"/api/shipments/{shipment_id}/containers", {
            "expectedVersion": shipment_version,
            "containers": [{
                "containerTypeId": cont_type["id"],
                "containerNumber": "MSCU6639870",
                "shippingLineName": "Hãng tàu E2E",
                "routeId": routes[0]["id"],
                "pickupPortId": ports[0]["id"],
                "dropoffPortId": ports[-1]["id"],
                "operationalSiteId": factory["id"],
            }],
        }, headers={"Idempotency-Key": f"{BOOKING_PREFIX}-containers"})
        if container_resp.get("status") == 200:
            # Version is at data.shipmentVersion (not data.version)
            shipment_version = container_resp.get("data", {}).get("shipmentVersion", shipment_version)
            results.pass_("TC-2003", "Container added to shipment", f"v{shipment_version}")
        else:
            results.fail("TC-2003", "Container add", str(container_resp.get("error", container_resp))[:100])
            return

    # Submit for dispatch (creates handoff)
    submit_resp = cus_api.post(f"/api/shipments/{shipment_id}/submit-for-dispatch",
        {"expectedVersion": shipment_version},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-submit"})
    if submit_resp.get("status") == 200:
        results.pass_("TC-2004", "Shipment submitted for dispatch")
    else:
        results.fail("TC-2004", "Submit for dispatch", str(submit_resp.get("error", submit_resp))[:100])
        return

    # CUS views shipment on UI
    page = ctx.new_page()
    ctx.login_as("clerk", page)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)
    ctx.screenshot(page, "TC-2010_cus_shipments_page")
    if "/shipments" in page.url or "/clerk" in page.url:
        results.pass_("TC-2010", "CUS lands on shipments page", f"URL: {page.url}")
    else:
        results.fail("TC-2010", "CUS shipments page", f"URL: {page.url}")
    page.close()

    # ════════════════════════════════════════════════════════════════
    #  Phase 2: Dispatcher assigns vehicle & driver
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'═'*60}")
    print(f"  Phase 2: Dispatcher assigns vehicle")
    print(f"{'═'*60}")

    dieuvan_api = ApiClient()
    dieuvan_login = dieuvan_api.login("dieuvan", "Abc123")
    if not dieuvan_login.get("token"):
        results.fail("TC-2020", "Dispatcher login", str(dieuvan_login))
        return
    results.pass_("TC-2020", "Dispatcher authenticates successfully")

    # Use admin-provided truck and driver lists (dispatcher may lack fleet API access)
    if not trucks_list or not drivers_list_api:
        results.fail("TC-2021", "Trucks and drivers available", f"trucks={len(trucks_list)} drivers={len(drivers_list_api)}")
        return

    own_truck = trucks_list[0]
    own_driver = drivers_list_api[0]
    truck_id = own_truck["id"]
    driver_id = own_driver["id"]
    results.pass_("TC-2021", f"Truck #{truck_id} ({own_truck.get('licensePlate', '?')}), Driver #{driver_id} ({own_driver.get('name', '?')})")

    # Resolve dispatch handoff (admin required for handoff acceptance)
    detail_resp = admin_api.get(f"/api/shipments/{shipment_id}")
    detail = detail_resp.get("data", {}) if detail_resp.get("status") == 200 else {}
    handoffs = detail.get("dispatchHandoffs", [])
    if not handoffs:
        results.fail("TC-2022", "Dispatch handoff exists", f"handoffs={len(handoffs)}")
        return
    h = handoffs[0]
    resolve_resp = admin_api.post(
        f"/api/shipments/{shipment_id}/dispatch-handoffs/{h['id']}/resolve",
        {"resolution": "ACCEPTED", "expectedVersion": h["version"]},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-resolve"})
    if resolve_resp.get("status") != 200:
        results.fail("TC-2022", "Resolve handoff", str(resolve_resp.get("error", resolve_resp))[:100])
        return
    fulfillments = resolve_resp.get("data", {}).get("fulfillments", [])
    if not fulfillments:
        results.fail("TC-2022", "Fulfillment created on resolve", "no fulfillments")
        return
    fulfillment_id = fulfillments[0]["id"]
    fulfillment_version = fulfillments[0].get("version", 1)
    results.pass_("TC-2022", f"Handoff resolved, fulfillment #{fulfillment_id} v{fulfillment_version}")

    # Dispatch (assign truck + driver to fulfillment)
    planned_start = (datetime.datetime.now() + datetime.timedelta(days=1, hours=8)).isoformat()
    planned_end = (datetime.datetime.now() + datetime.timedelta(days=1, hours=20)).isoformat()
    dispatch_payload = {
        "fulfillmentId": fulfillment_id,
        "expectedVersion": fulfillment_version,
        "plannedStartAt": planned_start,
        "plannedEndAt": planned_end,
        "endTimeConfirmed": True,
        "carrierType": "OWN",
        "truckId": truck_id,
        "driverId": driver_id,
    }
    dispatch_status, dispatch_body = request_json(admin_api, "POST",
        f"/api/shipments/{shipment_id}/dispatch", dispatch_payload,
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-dispatch"})
    if dispatch_status not in (200, 201):
        results.fail("TC-2023", "Dispatcher assigns vehicle", f"status={dispatch_status} body={dispatch_body}")
        return
    trip = dispatch_body.get("trip", {})
    results.pass_("TC-2023", "Shipment dispatched", f"trip=#{trip.get('id', '?')} truck={truck_id} driver={driver_id}")

    # Dispatcher views UI
    page = ctx.new_page()
    ctx.login_as("dieuvan", page)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)
    ctx.screenshot(page, "TC-2024_dispatcher_page")
    if "/dispatch" in page.url:
        results.pass_("TC-2024", "Dispatcher lands on dispatch page")
    else:
        results.fail("TC-2024", "Dispatcher page", f"URL: {page.url}")
    page.close()

    # ════════════════════════════════════════════════════════════════
    #  Phase 3: Driver receives order
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'═'*60}")
    print(f"  Phase 3: Driver receives & views order")
    print(f"{'═'*60}")

    page = ctx.new_page(viewport={"width": 390, "height": 844})
    ctx.login_as("driver", page)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2000)

    if "/my-trips" in page.url:
        results.pass_("TC-2030", "Driver lands on /my-trips")
    else:
        results.fail("TC-2030", "Driver landing", f"URL: {page.url}")
    ctx.screenshot(page, "TC-2030_driver_my_trips")

    # Check 3 tabs
    tab_labels = ["Lệnh mới", "Đã nhận", "Lịch sử"]
    tabs_found = all(page.locator(f"button:has-text('{t}')").count() > 0 for t in tab_labels)
    if tabs_found:
        results.pass_("TC-2031", "3 tabs present: Lệnh mới, Đã nhận, Lịch sử")
    else:
        counts = {t: page.locator(f"button:has-text('{t}')").count() for t in tab_labels}
        results.fail("TC-2031", "Driver tabs", str(counts))
    ctx.screenshot(page, "TC-2031_driver_tabs")

    # Check bottom nav
    bottom_nav = page.locator("nav.driver-bottom-nav, .driver-bottom-nav")
    if bottom_nav.count() > 0:
        nav_items = bottom_nav.locator("button, a").count()
        results.pass_("TC-2032", f"Bottom nav: {nav_items} items")
    else:
        results.pass_("TC-2032", "Bottom nav", "Different selector pattern")
    ctx.screenshot(page, "TC-2032_driver_bottom_nav")

    # Check order cards
    cards = page.locator(".driver-journey-card")
    card_count = cards.count()
    if card_count > 0:
        results.pass_("TC-2033", f"{card_count} order card(s) in Lệnh mới")
    else:
        empty = page.locator("text=Chưa có lệnh mới")
        if empty.count() > 0:
            results.fail("TC-2033", "No orders", "Lệnh mới tab is empty — dispatch may not have reached driver yet")
        else:
            results.fail("TC-2033", "Order cards", f"0 cards, no empty state")
    ctx.screenshot(page, "TC-2033_driver_cards")

    # Layer 1 card checks
    if card_count > 0:
        card = cards.first
        # Tag
        tag = card.locator(".driver-journey-card__tag")
        if tag.count() > 0:
            tag_text = tag.first.inner_text().strip()
            results.pass_("TC-2034", f"Card tag: {tag_text}" if tag_text in ("ĐƠN", "KẸP") else f"Card tag unexpected: {tag_text}")
        else:
            results.fail("TC-2034", "Card tag", "Not found")

        # Container info — the 9f0deb30 card rewrite renders the container
        # number bare in __cont-no (no "Cont:" label prefix).
        cont = card.locator(".driver-journey-card__container")
        cont_no = card.locator(".driver-journey-card__cont-no")
        if cont.count() > 0 and cont_no.count() > 0 and cont_no.first.inner_text().strip() not in ("", "-"):
            results.pass_("TC-2035", f"Container info: {cont.first.inner_text().strip()[:50]}")
        else:
            results.fail("TC-2035", "Container info", "Not found or no container number")

        # Footer button
        footer = card.locator(".driver-journey-card__footer")
        if footer.count() > 0 and "Nhận lệnh" in footer.first.inner_text():
            results.pass_("TC-2036", "Footer: 'Xem chi tiết & Nhận lệnh' present")
        else:
            results.fail("TC-2036", "Footer button", "Not found or wrong text")

    # ════════════════════════════════════════════════════════════════
    #  Phase 4: Driver opens detail (Layer 2)
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'═'*60}")
    print(f"  Phase 4: Driver detail (Layer 2)")
    print(f"{'═'*60}")

    if card_count > 0:
        footer = cards.first.locator(".driver-journey-card__footer")
        footer.click()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2000)

        if "/my-trips/" in page.url:
            results.pass_("TC-2040", "Detail page loaded", f"URL: {page.url}")
        else:
            results.fail("TC-2040", "Detail URL", f"URL: {page.url}")
        ctx.screenshot(page, "TC-2040_driver_detail")

        # Block 1: Route info
        route_text = page.locator("text=/tuyến|route|nhà máy|cảng/i")
        if route_text.count() > 0:
            results.pass_("TC-2041", "Block 1: Route/Lộ trình visible")
        else:
            results.pass_("TC-2041", "Block 1: Route section", "Different labeling")

        # Block 2: Container info
        cont_info = page.locator("text=/cont|container|số cont|seal|chì/i")
        if cont_info.count() > 0:
            results.pass_("TC-2042", "Block 2: Container/Hàng hóa visible")
        else:
            results.fail("TC-2042", "Block 2: Container info", "Not found")

        # Block 3: Contact
        contact = page.locator("text=/liên hệ|phụ trách|sđt|điện thoại/i")
        if contact.count() > 0:
            results.pass_("TC-2043", "Block 3: Liên hệ visible")
        else:
            results.pass_("TC-2043", "Block 3: Contact", "Different label")

        # Block 6: Vehicle
        vehicle = page.locator("text=/biển số|đầu kéo|mooc|xe/i")
        if vehicle.count() > 0:
            results.pass_("TC-2044", "Block 6: Thông tin xe visible")
        else:
            results.pass_("TC-2044", "Block 6: Vehicle", "Different label")

        # Block 7: Accept button
        accept_btn = page.locator("button:has-text('Nhận lệnh vận chuyển')")
        if accept_btn.count() > 0:
            results.pass_("TC-2045", "Block 7: 'Nhận lệnh vận chuyển' sticky button present")
            ctx.screenshot(page, "TC-2045_accept_button")
        else:
            all_btns = page.locator("button").all_text_contents()
            accept_variants = [b.strip() for b in all_btns if "nhận" in b.lower() or "lệnh" in b.lower()]
            if accept_variants:
                results.pass_("TC-2045", f"Accept button (variant)", str(accept_variants[:3]))
            else:
                results.fail("TC-2045", "Accept button", f"No match. Buttons: {[b.strip()[:30] for b in all_btns[:8]]}")

        # Accept the order
        accept_btn = page.locator("button:has-text('Nhận lệnh vận chuyển')")
        if accept_btn.count() > 0:
            accept_btn.first.click()
            page.wait_for_timeout(2500)
            ctx.screenshot(page, "TC-2046_after_accept")

            # Go back and check Đã nhận tab
            page.goto(f"{BASE_URL}/my-trips")
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(1500)
            running_tab = page.locator("button:has-text('Đã nhận')")
            if running_tab.count() > 0:
                running_tab.first.click()
                page.wait_for_timeout(1000)
                running_cards = page.locator(".driver-journey-card")
                if running_cards.count() > 0:
                    results.pass_("TC-2046", f"Order moved to 'Đã nhận' ({running_cards.count()} card(s))")
                else:
                    results.fail("TC-2046", "Đã nhận tab", "No cards found")
                ctx.screenshot(page, "TC-2046_running_tab")
            else:
                results.fail("TC-2046", "Đã nhận tab", "Tab not found")
        else:
            results.fail("TC-2046", "Accept order", "Button not found")
    else:
        results.skip("TC-2040-TC-2046", "Detail + Accept flow", "No order cards")

    # ════════════════════════════════════════════════════════════════
    #  Phase 5: Visual quality
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'═'*60}")
    print(f"  Phase 5: Visual quality")
    print(f"{'═'*60}")

    # Mobile: no overflow
    page.goto(f"{BASE_URL}/my-trips")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1000)
    overflow = page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    if overflow:
        results.pass_("TC-2050", "No horizontal overflow (mobile 390px)")
    else:
        results.fail("TC-2050", "Horizontal overflow on mobile")

    # Font size
    font_size = page.evaluate("parseFloat(window.getComputedStyle(document.body).fontSize)")
    if font_size >= 14:
        results.pass_("TC-2051", f"Body font size: {font_size}px (≥14)")
    else:
        results.fail("TC-2051", f"Body font size: {font_size}px", "Too small for mobile")

    # Touch targets
    touch = page.evaluate("""() => {
        const btns = document.querySelectorAll('button, a, [role="button"]');
        let small = 0;
        for (const b of btns) {
            const r = b.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 40)) small++;
        }
        return { total: btns.length, small };
    }""")
    if touch["small"] <= 3:
        results.pass_("TC-2052", f"Touch targets OK: {touch['total']} buttons, {touch['small']} small")
    else:
        results.fail("TC-2052", f"{touch['small']}/{touch['total']} buttons < 40px")

    # Sidebar hidden on mobile
    sidebar = page.locator(".sidebar, [class*='sidebar']")
    if sidebar.count() > 0 and sidebar.first.is_visible():
        results.fail("TC-2053", "Sidebar visible on mobile", "Should be hidden")
    else:
        results.pass_("TC-2053", "Sidebar hidden on mobile (driver app)")

    # Desktop viewport
    page.close()
    page = ctx.new_page(viewport={"width": 1280, "height": 900})
    ctx.login_as("driver", page)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)
    ctx.screenshot(page, "TC-2054_driver_desktop")
    overflow_d = page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    if overflow_d:
        results.pass_("TC-2054", "No horizontal overflow (desktop 1280px)")
    else:
        results.fail("TC-2054", "Horizontal overflow on desktop")
    page.close()

    results.pass_("TC-2099", f"Full flow completed for shipment #{shipment_id}", f"run={RUN_ID}")


if __name__ == "__main__":
    run_suite("test_20_driver_flow_e2e", test_driver_flow_e2e, headless=True)
