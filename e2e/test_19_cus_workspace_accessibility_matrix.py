#!/usr/bin/env python3
"""CUS shipment workspace role/action matrix and WCAG evidence."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(__file__))
from helpers import *  # noqa: E402,F403


TITLE = "19-cus-workspace-accessibility-matrix"
RUN_ID = uuid.uuid4().hex[:8].upper()
SEARCH_SUFFIX = f"{uuid.uuid4().int % 10_000:04d}"
CONTROL_MIN_SIZE = 24
DISPATCHER_USERNAME = os.environ.get("NEPO_DISPATCHER_USERNAME", f"e2e-dispatcher-{os.getpid()}")
DISPATCHER_PASSWORD = os.environ.get("NEPO_DISPATCHER_PASSWORD", "Abc123")

ROLE_EXPECTATIONS = {
    "clerk": {
        "api_status": 200,
        "action_kind": "LOCK",
        "action_enabled": False,
        "action_label": "Khóa lô",
        "ui_button": "Khóa lô",
        "ui_reason": "Cần Kế toán xác nhận lại số liệu trước khi khóa lô.",
    },
    "accountant": {
        "api_status": 200,
        "action_kind": "CONFIRM_FINANCE",
        "action_enabled": False,
        "action_label": "Xác nhận tài chính",
        "ui_button": "Xác nhận chi phí",
        "ui_reason": "Chưa có Debit Note hiện hành đủ điều kiện.",
    },
    "admin": {
        "api_status": 200,
        "action_kind": "LOCK",
        "action_enabled": False,
        "action_label": "Khóa lô",
        "ui_button": "Khóa lô",
        "ui_reason": "Chỉ CUS được khóa lô.",
    },
    "manager": {
        "api_status": 200,
        "action_kind": "LOCK",
        "action_enabled": False,
        "action_label": "Khóa lô",
        "ui_button": "Khóa lô",
        "ui_reason": "Chỉ CUS được khóa lô.",
    },
    "dispatcher": {
        "api_status": 200,
        "action_kind": "LOCK",
        "action_enabled": False,
        "action_label": "Khóa lô",
        "ui_button": "Khóa lô",
        "ui_reason": "Chỉ CUS được khóa lô.",
    },
    "forwarder": {
        "api_status": 403,
    },
}

RESPONSIVE_VIEWPORTS = [
    ("desktop", 1440, 1000, False),
    ("laptop", 1024, 900, False),
    ("tablet", 768, 1024, False),
    ("mobile", 390, 844, False),
    ("narrow-reduced", 320, 720, True),
]


def rows(response) -> list[dict]:
    payload = response.get("data", {}) if isinstance(response, dict) else {}
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("items", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []


def login(role_key: str) -> ApiClient:
    api = ApiClient()
    if role_key == "dispatcher":
        account = {
            "identifier": DISPATCHER_USERNAME,
            "password": DISPATCHER_PASSWORD,
        }
        result = api.login(account["identifier"], account["password"])
        if not result.get("token"):
            admin_api = ApiClient()
            admin_login = admin_api.login(
                DEMO_ACCOUNTS["admin"]["identifier"],
                DEMO_ACCOUNTS["admin"]["password"],
            )
            if not admin_login.get("token"):
                raise RuntimeError(f"Không thể đăng nhập admin để tạo dispatcher: {admin_login}")
            create_result = admin_api.post("/api/auth/users", {
                "username": account["identifier"],
                "fullName": "E2E Dispatcher Workspace",
                "password": account["password"],
                "role": "DISPATCHER",
                "status": "ACTIVE",
            })
            if create_result.get("status") not in (200, 201):
                raise RuntimeError(f"Không thể tạo dispatcher E2E: {create_result}")
            result = api.login(account["identifier"], account["password"])
        if not result.get("token"):
            raise RuntimeError(f"Không thể đăng nhập dispatcher: {result}")
        return api

    account = DEMO_ACCOUNTS[role_key]
    result = api.login(account["identifier"], account["password"])
    if not result.get("token"):
        raise RuntimeError(f"Không thể đăng nhập {role_key}: {result}")
    return api


def check(results: TestResults, tc_id: str, title: str, condition: bool, detail: str = "") -> bool:
    if condition:
        results.pass_(tc_id, title, detail)
        return True
    results.fail(tc_id, title, detail)
    return False


def login_page(ctx: NepoTestContext, role_key: str, page: Page):
    if role_key != "dispatcher":
        return ctx.login_as(role_key, page)

    api = login("dispatcher")
    page.goto(f"{BASE_URL}/login")
    page.wait_for_load_state("networkidle")
    page.fill('input[id="username-input"], input[id="identifier"], input[placeholder*="Tên đăng nhập"]', DISPATCHER_USERNAME)
    page.fill('input[type="password"]', DISPATCHER_PASSWORD)
    page.click('button[type="submit"], button:has-text("Đăng nhập")')
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    page.evaluate(f'localStorage.setItem("token", "{api.token}")')
    if "/login" in page.url:
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
    return page, api.token, {"role": "DISPATCHER"}


def no_horizontal_overflow(page: Page) -> bool:
    return page.evaluate(
        "document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"
    )


def collect_page_issues(page: Page):
    console_errors: list[str] = []
    page_errors: list[str] = []

    def on_console(message):
        if message.type == "error":
            console_errors.append(message.text)

    def on_page_error(error):
        page_errors.append(str(error))

    page.on("console", on_console)
    page.on("pageerror", on_page_error)
    return console_errors, page_errors


def assert_min_target(results: TestResults, tc_id: str, title: str, locator, detail_prefix: str) -> bool:
    try:
        locator.wait_for(state="visible", timeout=10_000)
        box = locator.bounding_box()
        if not box:
            raise AssertionError("control has no bounding box")
        if box["width"] < CONTROL_MIN_SIZE or box["height"] < CONTROL_MIN_SIZE:
            raise AssertionError(f"target too small: {box['width']:.0f}x{box['height']:.0f}")
        results.pass_(tc_id, title, f"{detail_prefix}: {box['width']:.0f}x{box['height']:.0f}")
        return True
    except Exception as error:
        results.fail(tc_id, title, f"{detail_prefix}: {error}")
        return False


def workspace_list(api: ApiClient):
    return api.get(f"/api/shipments/cus-workspace?searchSuffix={SEARCH_SUFFIX}&page=1&limit=20")


def ensure_fixture(results: TestResults) -> tuple[int, int]:
    admin_api = login("admin")

    customer_response = admin_api.get("/api/customers?search=Long%20Minh&page=1&pageSize=25")
    customers = rows(customer_response)
    if not check(results, "TC-1901", "Có khách hàng cục bộ để tạo lô workspace", bool(customers), str(customer_response)):
        raise RuntimeError("Thiếu khách hàng để tạo fixture workspace")
    customer_id = customers[0]["id"]

    users_response = admin_api.get("/api/auth/users")
    users = rows(users_response)
    cus_user = next((user for user in users if user.get("username") == "cus"), None)
    if not cus_user:
        raise RuntimeError(f"Không tìm thấy tài khoản CUS demo: {users_response}")
    customer_ids = list(cus_user.get("customerIds") or [])
    if customer_id not in customer_ids:
        scope_response = admin_api.patch(
            f"/api/auth/users/{cus_user['id']}",
            {"customerIds": [*customer_ids, customer_id]},
            headers={"If-Unmodified-Since": cus_user["updatedAt"]},
        )
        if not check(results, "TC-1902", "Gắn phạm vi khách hàng local cho CUS", scope_response.get("status") == 200, str(scope_response)):
            raise RuntimeError("Không thể gắn phạm vi khách hàng cho CUS")

    cus_api = login("clerk")
    route_response = admin_api.get("/api/routes?page=1&pageSize=25")
    cargo_type_response = admin_api.get("/api/cargo-types?page=1&pageSize=25")
    container_type_response = admin_api.get("/api/container-types?page=1&pageSize=25")
    port_response = admin_api.get("/api/ports?page=1&pageSize=25")
    site_response = admin_api.get(f"/api/shipments/operational-sites?customerId={customer_id}")
    route_rows = rows(route_response)
    cargo_types = rows(cargo_type_response)
    container_types = rows(container_type_response)
    ports = rows(port_response)
    sites = rows(site_response)
    if not check(
        results,
        "TC-1903",
        "Có danh mục route/cargo/container/site để tạo fixture workspace",
        bool(route_rows) and bool(cargo_types) and bool(container_types) and bool(ports) and bool(sites),
        f"routes={route_response}, cargoTypes={cargo_type_response}, containerTypes={container_type_response}, ports={port_response}, sites={site_response}",
    ):
        raise RuntimeError("Thiếu danh mục đầu vào cho fixture workspace")

    factory = next((site for site in sites if site.get("siteType") == "FACTORY"), sites[0])
    warehouse = next((site for site in sites if site.get("siteType") == "WAREHOUSE"), sites[0])
    container_type = next(
        (item for item in container_types if item.get("code") in ("20DC", "40DC", "40HC")),
        container_types[0],
    )

    create_response = cus_api.post("/api/shipments/quick", {
        "customerId": customer_id,
        "routeId": route_rows[0]["id"],
        "cargoTypeId": cargo_types[0]["id"],
        "operationalSiteId": factory["id"],
        "pickupWarehouseSiteId": warehouse["id"],
        "cargoMode": "FCL",
        "tradeDirection": "IMPORT",
        "bookingRef": f"E2E-CUS-A11Y-{RUN_ID}",
        "blNumber": f"BLCUS{SEARCH_SUFFIX}",
        "expectedDeliveryDate": datetime.now().strftime("%Y-%m-%d"),
        "operationalNotes": f"CUS workspace accessibility {RUN_ID}",
    })
    shipment = create_response.get("data", {})
    if not check(
        results,
        "TC-1904",
        "CUS tạo lô kiểm tra workspace có hậu tố tìm kiếm xác định",
        create_response.get("status") in (200, 201) and isinstance(shipment.get("id"), int),
        str(create_response),
    ):
        raise RuntimeError("Không thể tạo lô kiểm tra workspace")

    container_response = cus_api.put(f"/api/shipments/{shipment['id']}/containers", {
        "expectedVersion": shipment["version"],
        "containers": [{
            "containerTypeId": container_type["id"],
            "containerNumber": "MSKU1234565",
            "shippingLineName": "Hãng tàu Accessibility",
            "pickupPortId": ports[0]["id"],
            "dropoffPortId": ports[-1]["id"],
        }],
    })
    container_payload = container_response.get("data", {})
    containers = container_payload.get("items", container_payload.get("containers", [])) if isinstance(container_payload, dict) else []
    if not containers and isinstance(container_payload, list):
        containers = container_payload
    if not check(
        results,
        "TC-1905",
        "CUS tạo container nguồn cho workspace accessibility",
        container_response.get("status") == 200 and bool(containers),
        str(container_response),
    ):
        raise RuntimeError("Không thể tạo container kiểm tra workspace")

    return shipment["id"], customer_id


def verify_api_role_matrix(results: TestResults):
    for role_key, expectation in ROLE_EXPECTATIONS.items():
        api = login(role_key)
        response = workspace_list(api)
        tc_id = f"TC-1910-{role_key.upper()}"
        if expectation["api_status"] == 403:
            check(
                results,
                tc_id,
                f"{role_key} bị chặn khỏi API workspace CUS",
                response.get("status") == 403,
                str(response),
            )
            continue

        items = rows(response)
        row = next((item for item in items if item.get("billOrBookNumber") == f"BLCUS{SEARCH_SUFFIX}"), None)
        condition = (
            response.get("status") == 200
            and row is not None
            and row.get("action", {}).get("kind") == expectation["action_kind"]
            and row.get("action", {}).get("enabled") == expectation["action_enabled"]
            and row.get("action", {}).get("label") == expectation["action_label"]
        )
        check(
            results,
            tc_id,
            f"{role_key} nhận đúng hành động workspace theo vai trò",
            condition,
            str(response),
        )


def verify_role_viewport_matrix(ctx: NepoTestContext, results: TestResults):
    viewports = [
        ("desktop", 1440, 1000),
        ("laptop", 1024, 900),
        ("tablet", 768, 1024),
        ("mobile", 390, 844),
        ("narrow", 320, 720),
    ]
    for role_key in ("clerk", "accountant", "admin", "manager", "dispatcher", "forwarder"):
        expectation = ROLE_EXPECTATIONS[role_key]
        display_role = "ops" if role_key == "forwarder" else role_key
        for label, width, height in viewports:
            page = ctx.new_page({"width": width, "height": height})
            console_errors, page_errors = collect_page_issues(page)
            tc_id = f"TC-1920-{role_key.upper()}-{width}"
            try:
                login_page(ctx, role_key, page)
                page.goto(f"{BASE_URL}/shipments?searchSuffix={SEARCH_SUFFIX}")
                page.wait_for_load_state("networkidle")

                if expectation["api_status"] == 403:
                    condition = (
                        DEMO_ACCOUNTS[role_key]["home"] in page.url
                        and page.get_by_role("heading", name="Quản lý lô hàng", exact=True).count() == 0
                        and no_horizontal_overflow(page)
                        and not console_errors
                        and not page_errors
                    )
                    check(
                        results,
                        tc_id,
                        f"{display_role} không thấy workspace CUS ở {width}px",
                        condition,
                        f"console={console_errors}, pageErrors={page_errors}, url={page.url}",
                    )
                    continue

                page.get_by_role("heading", name="Quản lý lô hàng", exact=True).wait_for(timeout=10_000)
                page.wait_for_timeout(300)
                visible_fixture = page.get_by_text(f"BLCUS{SEARCH_SUFFIX}", exact=False).count() > 0
                overflow_ok = no_horizontal_overflow(page)
                workspace_layout = page.locator(".cus-workspace").get_attribute("data-layout")
                if workspace_layout == "cards":
                    card = page.locator("article.cus-mobile-card").filter(has_text=f"BLCUS{SEARCH_SUFFIX}").first
                    card.locator("button.cus-mobile-card__reference").click()
                else:
                    row = page.locator("tr.cus-master-row").filter(has_text=f"BLCUS{SEARCH_SUFFIX}").first
                    row.locator("button.cus-row-toggle").click()
                dialog = page.get_by_role("dialog")
                dialog.wait_for(timeout=10_000)
                button = dialog.get_by_role("button", name=expectation["ui_button"]).first
                reason_visible = dialog.get_by_text(expectation["ui_reason"], exact=False).count() > 0
                button.wait_for(state="visible", timeout=10_000)
                condition = (
                    visible_fixture
                    and overflow_ok
                    and button.is_disabled() == (not expectation["action_enabled"])
                    and reason_visible
                    and not console_errors
                    and not page_errors
                )
                check(
                    results,
                    tc_id,
                    f"{display_role} nhận đúng hành động workspace ở {width}px",
                    condition,
                    f"layout={workspace_layout}, overflow={overflow_ok}, console={console_errors}, pageErrors={page_errors}, url={page.url}",
                )
                ctx.screenshot(page, f"TC-1920_{role_key}_{label}")
            except Exception as error:
                results.fail(
                    tc_id,
                    f"{display_role} nhận đúng hành động workspace ở {width}px",
                    f"{error}; url={page.url}; console={console_errors}; pageErrors={page_errors}",
                )
                ctx.screenshot(page, f"TC-1920_{role_key}_{label}_fail")
            finally:
                page.context.close()


def open_mobile_drawer(page: Page):
    card = page.locator("article.cus-mobile-card").filter(has_text=f"BLCUS{SEARCH_SUFFIX}").first
    opener = card.locator("button.cus-mobile-card__reference")
    opener.wait_for(state="visible", timeout=10_000)
    opener.focus()
    opener.click()
    dialog = page.get_by_role("dialog")
    dialog.wait_for(timeout=10_000)
    page.get_by_text("Cước đầu ra", exact=True).wait_for(timeout=10_000)
    return opener, dialog


def active_has_class(page: Page, class_name: str) -> bool:
    return page.evaluate(
        "(className) => document.activeElement?.classList.contains(className) === true",
        class_name,
    )


def verify_responsive_cus_surface(ctx: NepoTestContext, results: TestResults):
    for label, width, height, reduced_motion in RESPONSIVE_VIEWPORTS:
        page = ctx.new_page({"width": width, "height": height})
        console_errors, page_errors = collect_page_issues(page)
        try:
            if reduced_motion:
                page.emulate_media(reduced_motion="reduce")
            login_page(ctx, "clerk", page)
            page.goto(f"{BASE_URL}/shipments?searchSuffix={SEARCH_SUFFIX}")
            page.wait_for_load_state("networkidle")
            try:
                page.get_by_role("heading", name="Quản lý lô hàng", exact=True).wait_for(timeout=10_000)
            except Exception as error:
                results.fail(
                    f"TC-1933-{width}",
                    f"Workspace CUS tải được ở {width}px",
                    f"Không tải được heading workspace: {error}; url={page.url}; console={console_errors}",
                )
                ctx.screenshot(page, f"TC-1933_{label}_{width}_fail")
                continue
            page.wait_for_timeout(300)

            visible_fixture = page.get_by_text(f"BLCUS{SEARCH_SUFFIX}", exact=False).count() > 0
            overflow_ok = no_horizontal_overflow(page)

            if width == 1440:
                row = page.locator("tr.cus-master-row").filter(has_text=f"BLCUS{SEARCH_SUFFIX}").first
                expand_button = row.locator("button.cus-row-toggle")
                expand_button.focus()
                controls = expand_button.get_attribute("aria-controls")
                page.keyboard.press("Enter")
                dialog = page.get_by_role("dialog")
                dialog.wait_for(timeout=10_000)
                page.get_by_text("Cước đầu ra", exact=True).wait_for(timeout=10_000)
                controlled_region_exists = bool(controls) and page.locator(f"#{controls}").count() == 1
                page.keyboard.press("Escape")
                page.wait_for_function(
                    "document.querySelectorAll('[role=\"dialog\"]').length === 0",
                    timeout=2_500,
                )
                focus_restored = active_has_class(page, "cus-row-toggle")
                check(
                    results,
                    "TC-1930",
                    "Desktop keyboard mở/đóng drawer và trả focus đúng aria-controls",
                    controlled_region_exists and focus_restored,
                    f"ariaControls={controls}, focusRestored={focus_restored}, console={console_errors}, pageErrors={page_errors}",
                )

            if width in (390, 320):
                opener, dialog = open_mobile_drawer(page)
                close_button = page.get_by_role("button", name="Đóng")
                action_button = dialog.get_by_role("button", name="Khóa lô")
                focus_in_dialog = page.evaluate(
                    "document.activeElement?.getAttribute('aria-label') === 'Đóng'"
                )

                assert_min_target(
                    results,
                    f"TC-1931-{width}-OPEN",
                    f"Nút mở chi tiết mobile {width}px đạt tối thiểu 24px",
                    opener,
                    "mở chi tiết",
                )
                assert_min_target(
                    results,
                    f"TC-1931-{width}-CLOSE",
                    f"Nút đóng drawer mobile {width}px đạt tối thiểu 24px",
                    close_button,
                    "đóng drawer",
                )
                assert_min_target(
                    results,
                    f"TC-1931-{width}-ACTION",
                    f"Nút hành động drawer mobile {width}px đạt tối thiểu 24px",
                    action_button,
                    "hành động drawer",
                )

                close_button.click()
                page.wait_for_function(
                    "document.querySelectorAll('[role=\"dialog\"]').length === 0",
                    timeout=2_500,
                )
                close_button_restored = active_has_class(page, "cus-mobile-card__reference")

                backdrop_restored = True
                if width > 320:
                    opener, _ = open_mobile_drawer(page)
                    page.locator(".drawer-overlay").click(position={"x": 10, "y": 10})
                    page.wait_for_function(
                        "document.querySelectorAll('[role=\"dialog\"]').length === 0",
                        timeout=2_500,
                    )
                    backdrop_restored = active_has_class(page, "cus-mobile-card__reference")

                opener, _ = open_mobile_drawer(page)
                page.keyboard.press("Escape")
                page.wait_for_function(
                    "document.querySelectorAll('[role=\"dialog\"]').length === 0",
                    timeout=2_500,
                )
                escape_restored = active_has_class(page, "cus-mobile-card__reference")

                reduced_motion_ok = True
                if reduced_motion:
                    reduced_motion_ok = page.evaluate(
                        "() => window.matchMedia('(prefers-reduced-motion: reduce)').matches"
                    )

                check(
                    results,
                    f"TC-1932-{width}",
                    f"Drawer mobile {width}px có nút đóng, backdrop, Escape và trả focus",
                    focus_in_dialog and close_button_restored and backdrop_restored and escape_restored and reduced_motion_ok,
                    f"focusInDialog={focus_in_dialog}, close={close_button_restored}, backdrop={backdrop_restored}, escape={escape_restored}, reducedMotion={reduced_motion_ok}",
                )

            check(
                results,
                f"TC-1933-{width}",
                f"Workspace CUS không tràn ngang ở {width}px và không có lỗi runtime",
                visible_fixture and overflow_ok and not console_errors and not page_errors,
                f"overflow={overflow_ok}, console={console_errors}, pageErrors={page_errors}, url={page.url}",
            )
            ctx.screenshot(page, f"TC-1933_{label}_{width}")
        finally:
            page.context.close()


def suite(ctx: NepoTestContext, results: TestResults):
    ensure_fixture(results)
    verify_api_role_matrix(results)
    verify_role_viewport_matrix(ctx, results)
    verify_responsive_cus_surface(ctx, results)


if __name__ == "__main__":
    raise SystemExit(run_suite(TITLE, suite))
