#!/usr/bin/env python3
"""
E2E Test Suite 20: Full CUS → Dispatcher → Driver flow
Tests CUS submission, direct dispatch, and driver acceptance of one isolated fixture.
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


def create_driver_flow_fixture(ctx: SilverseaTestContext, results: TestResults):
    """Create one native CUS/direct-dispatch fixture shared by both driver suites."""

    # ════════════════════════════════════════════════════════════════
    #  Phase 0: Gather master data
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'═'*60}")
    print(f"  Phase 0: Gather master data")
    print(f"{'═'*60}")

    admin_api = ApiClient()
    admin_api.login(DEMO_ACCOUNTS['admin']["identifier"], DEMO_ACCOUNTS['admin']["password"])

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
    trucks_list = rows(admin_api.get("/api/trucks?limit=50"))
    drivers_list_api = rows(admin_api.get("/api/drivers?limit=50"))
    trailers_list = rows(admin_api.get("/api/trailers?limit=50"))

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
    cus_login = cus_api.login(DEMO_ACCOUNTS['clerk']["identifier"], DEMO_ACCOUNTS['clerk']["password"])
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

    # Submit intake; the detail-plan fulfillment can be issued directly.
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
    dieuvan_login = dieuvan_api.login(DEMO_ACCOUNTS['dispatcher']["identifier"], DEMO_ACCOUNTS['dispatcher']["password"])
    if not dieuvan_login.get("token"):
        results.fail("TC-2020", "Dispatcher login", str(dieuvan_login))
        return
    results.pass_("TC-2020", "Dispatcher authenticates successfully")

    # Use admin-provided truck and driver lists (dispatcher may lack fleet API access)
    if not trucks_list or not drivers_list_api:
        results.fail("TC-2021", "Trucks and drivers available", f"trucks={len(trucks_list)} drivers={len(drivers_list_api)}")
        return

    driver_user = next((u for u in rows(users_resp)
                        if u.get("username") == DEMO_ACCOUNTS["driver"]["identifier"]), None)
    own_driver = next((d for d in drivers_list_api
                       if driver_user and d.get("userId") == driver_user["id"]
                       and d.get("status") == "ACTIVE"), None)
    trailer_by_id = {t["id"]: t for t in trailers_list if t.get("status") == "ACTIVE"}
    required_trailer_type = "20FT" if cont_type.get("code", "").startswith("20") else "40FT"
    own_truck = next((t for t in trucks_list
                      if t.get("status") == "ACTIVE"
                      and t.get("currentTrailerId") in trailer_by_id
                      and (trailer_by_id[t["currentTrailerId"]].get("type") or t.get("trailerType"))
                      in (None, required_trailer_type)), None)
    if not own_driver or not own_truck:
        results.fail("TC-2021", "Active driver account and compatible truck/trailer",
                     f"driver={bool(own_driver)} truck={bool(own_truck)}")
        return
    truck_id = own_truck["id"]
    driver_id = own_driver["id"]
    results.pass_("TC-2021", f"Truck #{truck_id}, linked driver #{driver_id}")

    # The product's detail-plan action issues directly; internal handoff
    # approval is not part of the current workflow.
    plan_resp = dieuvan_api.get(f"/api/shipments/dispatch-detail-plan-rows?q={BOOKING_PREFIX}")
    fulfillments = [r for r in rows(plan_resp) if r.get("shipmentId") == shipment_id]
    if plan_resp.get("status") != 200 or len(fulfillments) != 1:
        results.fail("TC-2022", "Exact fixture in dispatcher detail plan",
                     f"status={plan_resp.get('status')} rows={len(fulfillments)}")
        return
    fulfillment_id = fulfillments[0]["fulfillmentId"]
    fulfillment_version = fulfillments[0]["version"]
    results.pass_("TC-2022", f"Direct-dispatch fulfillment #{fulfillment_id} v{fulfillment_version}")

    # Dispatch requires an explicit business timezone, as supplied by the UI.
    start_at = datetime.datetime.fromisoformat(f"{tomorrow}T08:00:00+07:00")
    existing_trips = []
    for resource in (f"driverId={driver_id}", f"truckId={truck_id}"):
        schedule = admin_api.get(f"/api/trips?{resource}&pageSize=50")
        assert schedule.get("status") == 200, "Cannot read fixture resource schedule"
        existing_trips.extend(rows(schedule))
    for existing in existing_trips:
        if existing.get("status") not in ("CANCELED", "COMPLETED") and existing.get("plannedEndAt"):
            existing_end = datetime.datetime.fromisoformat(existing["plannedEndAt"].replace("Z", "+00:00"))
            start_at = max(start_at, existing_end + datetime.timedelta(hours=1))
    planned_start = start_at.isoformat()
    planned_end = (start_at + datetime.timedelta(hours=12)).isoformat()
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
    dispatch_status, dispatch_body = request_json(dieuvan_api, "POST",
        f"/api/shipments/{shipment_id}/dispatch", dispatch_payload,
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-dispatch"})
    if dispatch_status not in (200, 201):
        results.fail("TC-2023", "Dispatcher assigns vehicle", f"status={dispatch_status} body={dispatch_body}")
        return
    trip = dispatch_body.get("trip", {})
    assert trip.get("id") and trip.get("tripCode"), "Dispatch did not return trip identity"
    assert trip.get("driverId") == driver_id, "Dispatch assigned a different driver"
    results.pass_("TC-2023", "Shipment dispatched", f"trip=#{trip.get('id', '?')} truck={truck_id} driver={driver_id}")

    return {
        "admin_api": admin_api, "shipment_id": shipment_id, "trip": trip,
        "fulfillment_id": fulfillment_id, "booking_prefix": BOOKING_PREFIX,
    }


def cleanup_driver_flow_fixture(fixture, results):
    admin_api = fixture["admin_api"]
    shipment_id = fixture["shipment_id"]
    trip = fixture["trip"]
    current = admin_api.get(f"/api/trips/{trip['id']}")
    current_trip = current.get("data", {})
    if current.get("status") != 200 or current_trip.get("shipmentId") != shipment_id:
        results.fail("TC-2098", "Fixture cleanup identity", "Trip read or shipment identity mismatch")
    elif current_trip.get("status") != "CANCELED":
        cleanup = admin_api.post(f"/api/trips/{trip['id']}/cancel",
                                 {"expectedVersion": current_trip["version"]},
                                 headers={"Idempotency-Key": f"{fixture['booking_prefix']}-cleanup"})
        if cleanup.get("status") == 200:
            results.pass_("TC-2098", "Own fixture trip released after assertions")
        else:
            results.fail("TC-2098", "Own fixture cleanup", f"status={cleanup.get('status')}")


def test_driver_flow_e2e(ctx: SilverseaTestContext, results: TestResults):
    fixture = create_driver_flow_fixture(ctx, results)
    if fixture is None:
        return
    shipment_id = fixture["shipment_id"]
    trip = fixture["trip"]
    fulfillment_id = fixture["fulfillment_id"]
    try:
        # Dispatcher views UI
        page = ctx.new_page()
        ctx.login_as("dispatcher", page)
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
        bottom_nav = page.get_by_role("navigation", name="Điều hướng chính")
        nav_items = bottom_nav.locator("button:visible, a:visible")
        # docs/prd/ManHinhLaiXe.md specifies four primary driver tabs.
        if bottom_nav.is_visible() and nav_items.count() == 4:
            results.pass_("TC-2032", "Four visible bottom-navigation actions")
        else:
            results.fail("TC-2032", "Driver bottom navigation", f"visible actions={nav_items.count()}")
        ctx.screenshot(page, "TC-2032_driver_bottom_nav")

        # Check order cards
        cards = page.locator(".driver-journey-card").filter(has_text=trip["tripCode"])
        card_count = cards.count()
        if card_count == 1:
            results.pass_("TC-2033", f"Created trip #{trip['id']} visible in Lệnh mới")
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
                if tag_text == "ĐƠN":
                    results.pass_("TC-2034", f"Single-trip fixture tag: {tag_text}")
                else:
                    results.fail("TC-2034", "Single-trip fixture tag", f"Expected ĐƠN, got {tag_text}")
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

            if page.url.rstrip("/").endswith(f"/my-trips/{trip['id']}"):
                results.pass_("TC-2040", "Detail page loaded", f"URL: {page.url}")
            else:
                results.fail("TC-2040", "Detail URL", f"URL: {page.url}")
            ctx.screenshot(page, "TC-2040_driver_detail")

            # Block 1: Route info
            route_text = page.locator("text=/tuyến|route|nhà máy|cảng/i")
            if route_text.count() > 0:
                results.pass_("TC-2041", "Block 1: Route/Lộ trình visible")
            else:
                results.fail("TC-2041", "Block 1: Route section", "Expected route section was not located")

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
                results.fail("TC-2043", "Block 3: Contact", "Expected contact section was not located")

            # Current PRD section 3 removes duplicate truck/trailer detail rows.
            vehicle_rows = page.get_by_text("Đầu kéo", exact=True).count() + page.get_by_text("Rơ moóc", exact=True).count()
            if vehicle_rows == 0:
                results.pass_("TC-2044", "No duplicate truck/trailer rows in order detail")
            else:
                results.fail("TC-2044", "Duplicate vehicle rows in order detail", f"rows={vehicle_rows}")

            # Block 7: Accept button
            accept_bar = page.get_by_test_id("accept-sticky-bar")
            accept_btn = accept_bar.get_by_role("button", name="Nhận lệnh vận chuyển", exact=True)
            if accept_btn.count() == 1 and accept_btn.is_visible():
                results.pass_("TC-2045", "Block 7: 'Nhận lệnh vận chuyển' sticky button present")
                ctx.screenshot(page, "TC-2045_accept_button")
            else:
                all_btns = page.locator("button").all_text_contents()
                accept_variants = [b.strip() for b in all_btns if "nhận" in b.lower() or "lệnh" in b.lower()]
                if accept_variants:
                    results.fail("TC-2045", "Sticky acceptance control was not identified", str(accept_variants[:3]))
                else:
                    results.fail("TC-2045", "Accept button", f"No match. Buttons: {[b.strip()[:30] for b in all_btns[:8]]}")

            # Accept the order
            if accept_btn.count() == 1 and accept_btn.is_enabled():
                with page.expect_response(
                    lambda response: urlparse(response.url).path == f"/api/driver/me/fulfillments/{fulfillment_id}/progress"
                    and response.request.method == "POST",
                    timeout=15000,
                ) as acceptance:
                    accept_btn.click()
                acceptance_status = acceptance.value.status
                acceptance_detail = acceptance.value.text()[:500] if acceptance_status not in (200, 201) else ""
                ctx.screenshot(page, "TC-2046_after_accept")

                # Go back and check Đã nhận tab
                page.goto(f"{BASE_URL}/my-trips")
                page.wait_for_load_state("networkidle")
                page.wait_for_timeout(1500)
                running_tab = page.locator("button:has-text('Đã nhận')")
                if running_tab.count() > 0:
                    running_tab.first.click()
                    page.wait_for_timeout(1000)
                    running_cards = page.locator(".driver-journey-card").filter(has_text=trip["tripCode"])
                    if acceptance_status in (200, 201) and running_cards.count() == 1:
                        results.pass_("TC-2046", f"Order moved to 'Đã nhận' ({running_cards.count()} card(s))")
                    else:
                        results.fail("TC-2046", "Exact accepted fixture in Đã nhận tab",
                                     f"status={acceptance_status}, matchingCards={running_cards.count()}, response={acceptance_detail}")
                    ctx.screenshot(page, "TC-2046_running_tab")
                else:
                    results.fail("TC-2046", "Đã nhận tab", "Tab not found")
            else:
                detail = accept_bar.inner_text() if accept_bar.count() else "Sticky acceptance control not found"
                results.fail("TC-2046", "Accept order unavailable for fixture", detail)
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

        ctx.screenshot(page, "TC-2050_driver_mobile_layout")
        # Approved compact scale: body/data/controls12px, captions11px.
        typography = page.evaluate("""() => ({
            body: parseFloat(getComputedStyle(document.body).fontSize),
            useful: [...document.querySelectorAll('.driver-journey-card__route, .driver-journey-card__footer')]
                .filter(el => el.getBoundingClientRect().height > 0)
                .map(el => parseFloat(getComputedStyle(el).fontSize))
        })""")
        if typography["body"] >= 12 and typography["useful"] and min(typography["useful"]) >= 12:
            results.pass_("TC-2051", "Compact mobile body and useful card text ≥12px")
        else:
            results.fail("TC-2051", "Mobile typography below the approved scale", str(typography))

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
        sidebar_in_view = page.locator("aside.sidebar").evaluate_all("""elements => elements.some(el => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0
                && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
        })""")
        if sidebar_in_view:
            results.fail("TC-2053", "Sidebar intersects driver mobile viewport")
        else:
            results.pass_("TC-2053", "Sidebar absent from driver mobile viewport")

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

        results.pass_("TC-2099", f"Submission, dispatch, and acceptance checks reached for shipment #{shipment_id}", f"run={RUN_ID}")

    finally:
        cleanup_driver_flow_fixture(fixture, results)


if __name__ == "__main__":
    sys.exit(run_suite("test_20_driver_flow_e2e", test_driver_flow_e2e, headless=True))
