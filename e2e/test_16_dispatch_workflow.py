#!/usr/bin/env python3
"""E2E suite 16: dispatch workflow role, bounded-data, and responsive smoke checks."""

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

ROLE_SURFACES = {
    "admin": "/config/master-data-import",
    "manager": "/dispatch",
    "accountant": "/config/debit-note-templates",
    "clerk": "/clerk/shipments/new",
    "driver": "/my-trips",
    "customer": "/portal/shipments",
}


def responsive_role_matrix(ctx: NepoTestContext, results: TestResults):
    for role, path in ROLE_SURFACES.items():
        page = ctx.new_page({"width": 1440, "height": 1000})
        ctx.login_as(role, page)
        role_failures = []
        for label, width, height in VIEWPORTS:
            page.set_viewport_size({"width": width, "height": height})
            page.goto(f"{BASE_URL}{path}")
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(250)
            stayed_on_surface = path in page.url
            overflow = page.evaluate(
                "Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) "
                "- document.documentElement.clientWidth"
            )
            body_text = page.locator("body").inner_text().strip()
            if not stayed_on_surface:
                role_failures.append(f"{label}: redirected to {page.url}")
            if overflow > 1:
                role_failures.append(f"{label}: horizontal overflow {overflow}px")
            if not body_text:
                role_failures.append(f"{label}: empty page")
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
        results.pass_(
            "TC-1601",
            "Dispatch queue is server-bounded",
            f"loaded={len(queue_items)}, total={queue_page.get('total')}",
        )
    else:
        results.fail("TC-1601", "Dispatch queue is server-bounded", str(queue))

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
        results.pass_("TC-1602", "Fleet response is bounded", f"trucks={len(trucks)}, drivers={len(drivers)}")
    else:
        results.fail("TC-1602", "Fleet response is bounded", str(fleet))

    accountant_api = ApiClient()
    accountant_account = DEMO_ACCOUNTS["accountant"]
    accountant_api.login(accountant_account["identifier"], accountant_account["password"])
    denied_queue = accountant_api.get("/api/shipments/dispatch-queue?limit=1")
    denied_fleet = accountant_api.get("/api/shipments/dispatch-fleet?limit=1")
    if denied_queue.get("status") == 403 and denied_fleet.get("status") == 403:
        results.pass_("TC-1603", "ACCOUNTANT cannot inspect or operate dispatch")
    else:
        results.fail(
            "TC-1603",
            "ACCOUNTANT cannot inspect or operate dispatch",
            f"queue={denied_queue.get('status')}, fleet={denied_fleet.get('status')}",
        )

    responsive_role_matrix(ctx, results)

    for role in ("manager", "clerk", "driver"):
        page = ctx.new_page({"width": 390, "height": 844})
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


if __name__ == "__main__":
    sys.exit(run_suite("16-dispatch-workflow", test_dispatch_workflow))
