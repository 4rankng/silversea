#!/usr/bin/env python3
"""Composite dispatch workflow RBAC, bounded-data, and responsive smoke checks."""

from datetime import datetime, timedelta
from pathlib import Path
import re
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from helpers import *


VIEWPORTS = [
    ("desktop", 1440, 1000),
    ("laptop", 1024, 900),
    ("tablet", 768, 900),
    ("mobile", 390, 844),
    ("narrow", 320, 720),
]

CONTROL_MIN_SIZE = 44
REPO_ROOT = Path(__file__).resolve().parent.parent
MASTER_DATA_FIXTURE = next((REPO_ROOT / "docs/quytrinh").rglob("29.7 - DATA PM.xlsx"))

ROLE_SURFACES = {
    "admin": "/config/master-data-import",
    "manager": "/dispatch",
    "accountant": "/config/debit-note-templates",
    "clerk": "/clerk/shipments/new",
    "driver": "/my-trips",
    "customer": "/portal/shipments",
}


def assert_control_box(
    page: Page,
    locator,
    label: str,
    results: TestResults,
    tc_id: str,
    context: str,
):
    try:
        locator.wait_for(state="visible", timeout=5000)
        if not locator.is_visible():
            raise AssertionError("control is not visible")
        if not locator.is_enabled():
            raise AssertionError("control is disabled")
        box = locator.bounding_box()
        if not box:
            raise AssertionError("control has no bounding box")
        if box["width"] < CONTROL_MIN_SIZE or box["height"] < CONTROL_MIN_SIZE:
            raise AssertionError(f"control too small: {box['width']:.0f}x{box['height']:.0f}")
        results.pass_(tc_id, label, f"{context} visible at {box['width']:.0f}x{box['height']:.0f}")
        return True
    except Exception as exc:
        results.fail(tc_id, label, f"{context}: {exc}")
        return False


def iso_local_now(hours_ahead: int = 2) -> str:
    return (datetime.now() + timedelta(hours=hours_ahead)).replace(microsecond=0, second=0, minute=0).strftime("%Y-%m-%dT%H:%M")


def prepare_admin_import(page: Page):
    page.locator("#master-data-file").set_input_files(str(MASTER_DATA_FIXTURE))


def proxy_api_for_page(page: Page):
    def proxy_api(route):
        response = route.fetch(
            url=route.request.url.replace(BASE_URL, API_URL, 1),
        )
        route.fulfill(response=response)

    page.route(f"{BASE_URL}/api/**", proxy_api)


def dismiss_onboarding_checklist(page: Page):
    """Keep first-run guidance from covering the role's primary action."""
    dismiss_button = page.get_by_role("button", name=re.compile(r"Để sau$"))
    if dismiss_button.count() > 0 and dismiss_button.first.is_visible():
        dismiss_button.first.click()
        page.get_by_role("dialog", name=re.compile(r"Bắt đầu sử dụng")).wait_for(
            state="hidden", timeout=5000
        )


def prepare_dispatch_issue(page: Page):
    page.locator(".dispatch-task").first.click()
    page.get_by_label("Ngày giờ chạy").fill(iso_local_now())
    end_input = page.get_by_label("Kết thúc dự kiến")
    if end_input.is_enabled():
        end_input.fill(iso_local_now(4))
    elif page.locator("label.dispatch-confirm input").count() > 0:
        page.get_by_label("Tôi xác nhận giờ kết thúc vì tuyến chưa có thời lượng chuẩn.").check()

    truck_select = page.get_by_label("Biển số xe")
    if truck_select.count() > 0:
        if truck_select.locator("option").count() > 1:
            truck_select.select_option(index=1)
    driver_select = page.get_by_label("Lái xe")
    if driver_select.count() > 0 and driver_select.input_value() == "" and driver_select.locator("option").count() > 1:
        driver_select.select_option(index=1)
    return page.get_by_role("button", name="Phát hành lệnh điều xe")


def responsive_role_matrix(ctx: NepoTestContext, results: TestResults):
    for role, path in ROLE_SURFACES.items():
        page = ctx.new_page({"width": 1440, "height": 1000})
        proxy_api_for_page(page)
        ctx.login_as(role, page)
        role_failures = []
        for label, width, height in VIEWPORTS:
            page.set_viewport_size({"width": width, "height": height})
            page.goto(f"{BASE_URL}{path}")
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(250)
            dismiss_onboarding_checklist(page)
            stayed_on_surface = path in page.url
            overflow = page.evaluate(
                "Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) "
                "- document.documentElement.clientWidth"
            )
            body_text = page.locator("body").inner_text().strip()
            control_ok = False
            if not stayed_on_surface:
                role_failures.append(f"{label}: redirected to {page.url}")
            if overflow > 1:
                role_failures.append(f"{label}: horizontal overflow {overflow}px")
            if not body_text:
                role_failures.append(f"{label}: empty page")

            if role == "admin":
                prepare_admin_import(page)
                control_ok = assert_control_box(
                    page,
                    page.get_by_role("button", name="Kiểm tra dữ liệu"),
                    f"{role} control",
                    results,
                    f"TC-1604-{role.upper()}-{label}-control",
                    f"{label}: admin analyze action",
                )
            elif role == "accountant":
                control_ok = assert_control_box(
                    page,
                    page.get_by_role("button", name="Thêm mẫu"),
                    f"{role} control",
                    results,
                    f"TC-1604-{role.upper()}-{label}-control",
                    f"{label}: accountant template action",
                )
            elif role == "clerk":
                control_ok = assert_control_box(
                    page,
                    page.get_by_role("button", name="Gửi sang điều phối", exact=True),
                    f"{role} control",
                    results,
                    f"TC-1604-{role.upper()}-{label}-control",
                    f"{label}: clerk create-trip action",
                )
            elif role == "driver":
                trip_cards = page.locator(".driver-trip-card")
                if trip_cards.count() > 0:
                    first_trip = trip_cards.first
                    control_ok = assert_control_box(
                        page,
                        first_trip,
                        f"{role} control",
                        results,
                        f"TC-1604-{role.upper()}-{label}-control",
                        f"{label}: driver trip link",
                    )
                else:
                    empty_state = page.locator(".empty-state")
                    control_ok = assert_control_box(
                        page,
                        empty_state,
                        f"{role} empty state",
                        results,
                        f"TC-1604-{role.upper()}-{label}-control",
                        f"{label}: driver empty state",
                    )
            elif role == "customer":
                shipment_rows = page.locator(".portal-list__row")
                if shipment_rows.count() > 0:
                    first_shipment = shipment_rows.first
                    control_ok = assert_control_box(
                        page,
                        first_shipment,
                        f"{role} control",
                        results,
                        f"TC-1604-{role.upper()}-{label}-control",
                        f"{label}: customer shipment link",
                    )
                else:
                    empty_state = page.get_by_text("Chưa có lô hàng")
                    control_ok = assert_control_box(
                        page,
                        empty_state,
                        f"{role} empty state",
                        results,
                        f"TC-1604-{role.upper()}-{label}-control",
                        f"{label}: customer empty state",
                    )
            elif role == "manager":
                rendered_tasks = page.locator(".dispatch-task")
                if rendered_tasks.count() > 0:
                    issue_button = prepare_dispatch_issue(page)
                    control_ok = assert_control_box(
                        page,
                        issue_button,
                        f"{role} control",
                        results,
                        f"TC-1604-{role.upper()}-{label}-control",
                        f"{label}: dispatch issue action",
                    )
                elif page.get_by_role("button", name="Tiếp nhận").count() > 0:
                    control_ok = assert_control_box(
                        page,
                        page.get_by_role("button", name="Tiếp nhận").first,
                        f"{role} control",
                        results,
                        f"TC-1604-{role.upper()}-{label}-control",
                        f"{label}: dispatch handoff action",
                    )
                else:
                    fallback = page.get_by_role("button", name="Tải lại")
                    control_ok = assert_control_box(
                        page,
                        fallback,
                        f"{role} control",
                        results,
                        f"TC-1604-{role.upper()}-{label}-control",
                        f"{label}: dispatch refresh action",
                    )

            if not control_ok:
                role_failures.append(f"{label}: primary control missing or undersized")
            ctx.screenshot(page, f"TC-1604_{role}_{label}")

        if role_failures:
            results.fail(f"TC-1604-{role.upper()}", f"{role} responsive role surface", "; ".join(role_failures))
        else:
            results.pass_(f"TC-1604-{role.upper()}", f"{role} surface is usable at all five viewports", path)
        page.close()


def test_dispatch_workflow(ctx: NepoTestContext, results: TestResults):
    manager_api = ApiClient()
    manager_account = DEMO_ACCOUNTS["manager"]
    manager_login = manager_api.login(manager_account["identifier"], manager_account["password"])
    if not manager_login.get("token"):
        results.fail("TC-1601", "Dispatcher login", str(manager_login))
        return

    queue = manager_api.get("/api/shipments/dispatch-queue?limit=50&status=READY")
    queue_data = queue.get("data", {})
    queue_items = queue_data.get("items")
    queue_page = queue_data.get("page", {})
    if (
        queue.get("status") == 200
        and isinstance(queue_items, list)
        and len(queue_items) <= 50
        and queue_page.get("limit", 50) <= 50
        and isinstance(queue_page.get("total"), int)
    ):
        first_queue_item = queue_items[0] if queue_items else None
        queue_detail_ok = True
        if first_queue_item:
            required_fields = [
                ("fulfillmentId", int),
                ("shipmentId", int),
                ("taskStatus", str),
                ("customer", dict),
                ("route", dict),
                ("shipment", dict),
                ("unitSummary", dict),
            ]
            for field_name, expected_type in required_fields:
                if not isinstance(first_queue_item.get(field_name), expected_type):
                    queue_detail_ok = False
                    break
            if queue_detail_ok:
                shipment = first_queue_item["shipment"]
                unit_summary = first_queue_item["unitSummary"]
                if not (
                    isinstance(shipment.get("declarationNumbers"), list)
                    and isinstance(first_queue_item["customer"].get("name"), str)
                    and isinstance(first_queue_item["route"].get("name"), str)
                    and isinstance(unit_summary.get("label"), str)
                ):
                    queue_detail_ok = False
                if first_queue_item["taskStatus"] == "DISPATCHED" and not isinstance(first_queue_item.get("dispatch"), dict):
                    queue_detail_ok = False
                if first_queue_item["taskStatus"] == "READY" and first_queue_item.get("dispatch") is not None:
                    queue_detail_ok = False
        if queue_detail_ok:
            results.pass_(
                "TC-1601",
                "Dispatch queue is server-bounded",
                f"loaded={len(queue_items)}, total={queue_page.get('total')}, first_item_contract=ok",
            )
        else:
            results.fail("TC-1601", "Dispatch queue is server-bounded", f"contract mismatch: {queue}")
    else:
        results.fail("TC-1601", "Dispatch queue is server-bounded", str(queue))

    if queue.get("status") == 200 and queue_items:
        first_item = queue_items[0]
        if first_item["taskStatus"] == "READY":
            if not (first_item["shipment"].get("code") or first_item["shipment"].get("bookingRef") or first_item["shipment"].get("blNumber")):
                results.fail("TC-1601B", "Dispatch queue has a deterministic shipment identity", str(first_item))
            else:
                results.pass_("TC-1601B", "Dispatch queue has a deterministic shipment identity", first_item["shipment"].get("code") or first_item["shipment"].get("bookingRef") or first_item["shipment"].get("blNumber"))
        else:
            results.pass_("TC-1601B", "Dispatch queue has a deterministic shipment identity", first_item["shipment"].get("code") or first_item["shipment"].get("bookingRef") or first_item["shipment"].get("blNumber"))

    fleet = manager_api.get("/api/shipments/dispatch-fleet?limit=100")
    fleet_data = fleet.get("data", {})
    trucks = fleet_data.get("trucks")
    drivers = fleet_data.get("drivers")
    if (
        fleet.get("status") == 200
        and isinstance(trucks, list)
        and isinstance(drivers, list)
        and len(trucks) <= 100
        and len(drivers) <= 100
    ):
        if trucks:
            first_truck = trucks[0]
            if not isinstance(first_truck.get("licensePlate"), str) or "capacityKg" not in first_truck:
                results.fail("TC-1602B", "Fleet contract exposes truck capacity", str(first_truck))
            else:
                results.pass_("TC-1602B", "Fleet contract exposes truck capacity", f"{first_truck.get('licensePlate')} capacity={first_truck.get('capacityKg')}")
        if drivers:
            first_driver = drivers[0]
            if not isinstance(first_driver.get("name"), str) or "userId" not in first_driver:
                results.fail("TC-1602C", "Fleet contract exposes driver binding", str(first_driver))
            else:
                results.pass_("TC-1602C", "Fleet contract exposes driver binding", f"{first_driver.get('name')} userId={first_driver.get('userId')}")
        results.pass_("TC-1602", "Fleet response is bounded", f"trucks={len(trucks)}, drivers={len(drivers)}")
    else:
        results.fail("TC-1602", "Fleet response is bounded", str(fleet))

    accountant_api = ApiClient()
    accountant_account = DEMO_ACCOUNTS["accountant"]
    accountant_api.login(accountant_account["identifier"], accountant_account["password"])
    denied_queue = accountant_api.get("/api/shipments/dispatch-queue?limit=1")
    denied_fleet = accountant_api.get("/api/shipments/dispatch-fleet?limit=1")
    shipment_id = queue_items[0]["shipmentId"] if queue_items else None
    if shipment_id is None:
        shipment_list = manager_api.get("/api/shipments?page=1&pageSize=1")
        shipment_items = shipment_list.get("data", {}).get("items", [])
        shipment_id = shipment_items[0].get("id") if shipment_items else None
    readable_shipment = accountant_api.get(f"/api/shipments/{shipment_id}") if shipment_id else {"status": 0}
    if (
        denied_queue.get("status") == 403
        and denied_fleet.get("status") == 403
        and readable_shipment.get("status") == 200
    ):
        results.pass_("TC-1603", "ACCOUNTANT is operationally read-only without dispatch assignment access")
    else:
        results.fail(
            "TC-1603",
            "ACCOUNTANT is operationally read-only without dispatch assignment access",
            f"queue={denied_queue.get('status')}, fleet={denied_fleet.get('status')}, shipment={readable_shipment.get('status')}",
        )

    responsive_role_matrix(ctx, results)

    for role in ("manager", "clerk", "driver"):
        page = ctx.new_page({"width": 390, "height": 844})
        proxy_api_for_page(page)
        ctx.login_as(role, page)
        page.goto(f"{BASE_URL}{ROLE_SURFACES[role]}")
        page.wait_for_load_state("networkidle")
        text = page.locator("body").inner_text().lower()
        forbidden = [term for term in ("zalo", "bản đồ gps", "theo dõi gps trực tiếp") if term in text]
        if forbidden:
            results.fail(f"TC-1605-{role.upper()}", f"{role} workflow has no forbidden integration", ", ".join(forbidden))
        else:
            results.pass_(f"TC-1605-{role.upper()}", f"{role} workflow has no Zalo or live GPS map")
        page.close()

    driver_api = ApiClient()
    driver_account = DEMO_ACCOUNTS["driver"]
    driver_api.login(driver_account["identifier"], driver_account["password"])
    driver_list = driver_api.get("/api/driver/me/trips")
    driver_items = driver_list.get("data", {}).get("items")
    if driver_list.get("status") != 200 or not isinstance(driver_items, list):
        results.fail("TC-1606", "Driver fulfillment list contract", str(driver_list))
    elif driver_items and not all("fulfillmentId" in item for item in driver_items):
        results.fail("TC-1606", "Driver fulfillment list contract", "Missing fulfillmentId deep-link authority")
    else:
        results.pass_("TC-1606", "Driver list uses fulfillment deep-link authority", f"items={len(driver_items)}")

    customer_api = ApiClient()
    customer_account = DEMO_ACCOUNTS["customer"]
    customer_api.login(customer_account["identifier"], customer_account["password"])
    customer_scope = customer_api.get("/api/portal/customer-scope")
    customer_id = customer_scope.get("data", {}).get("primaryCustomerId")
    customer_list = customer_api.get(f"/api/portal/shipments?page=1&limit=10&customerId={customer_id}" if customer_id else "/api/portal/shipments?page=1&limit=10")
    customer_items = customer_list.get("data", {}).get("items") or customer_list.get("items")
    if customer_list.get("status") == 200 and isinstance(customer_items, list):
        if customer_items:
            first_customer_item = customer_items[0]
            if not (isinstance(first_customer_item.get("id"), int) and isinstance(first_customer_item.get("shipmentCode"), (str, type(None))) and isinstance(first_customer_item.get("status"), str)):
                results.fail("TC-1607", "Customer portal shipment contract", str(first_customer_item))
            else:
                results.pass_("TC-1607", "Customer portal shipment contract", f"items={len(customer_items)}")
        else:
            results.pass_("TC-1607", "Customer portal shipment contract", "no customer shipments in seed data")
    else:
        results.fail("TC-1607", "Customer portal shipment contract", str(customer_list))


if __name__ == "__main__":
    sys.exit(run_suite("16-dispatch-workflow", test_dispatch_workflow))
