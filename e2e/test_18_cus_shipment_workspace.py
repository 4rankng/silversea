#!/usr/bin/env python3
"""CUS shipment closeout workspace: persisted API contract, RBAC, and responsive UI."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import *  # noqa: E402,F403


TITLE = "18-cus-shipment-workspace"
RUN_ID = uuid.uuid4().hex[:8].upper()
BOOK_SUFFIX_STORED = f"a{RUN_ID[:2]}B{RUN_ID[2]}".replace("-", "")[:5]
BOOK_SUFFIX_QUERY = BOOK_SUFFIX_STORED.swapcase()
DECLARATION_SUFFIX_STORED = f"z{RUN_ID[3:5]}Q{RUN_ID[5]}".replace("-", "")[:5]
DECLARATION_SUFFIX_QUERY = DECLARATION_SUFFIX_STORED.swapcase()


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


def main() -> bool:
    results = TestResults(TITLE)
    try:
        admin_api = login("admin")
        driver_api = login("driver")

        customer_response = admin_api.get("/api/customers?search=Long%20Minh&page=1&pageSize=25")
        customers = rows(customer_response)
        if not check(results, "TC-1801", "CUS có phạm vi khách hàng để tạo lô", bool(customers), str(customer_response)):
            results.write_json()
            return results.print_summary()
        customer_id = customers[0]["id"]

        users_response = admin_api.get("/api/auth/users")
        cus_user = next((user for user in rows(users_response) if user.get("username") == "cus"), None)
        if not cus_user:
            results.fail("TC-1801", "Tài khoản CUS demo tồn tại", str(users_response))
            results.write_json()
            return results.print_summary()
        customer_ids = list(cus_user.get("customerIds") or [])
        if customer_id not in customer_ids:
            scope_response = admin_api.patch(
                f"/api/auth/users/{cus_user['id']}",
                {"customerIds": [*customer_ids, customer_id]},
                headers={"If-Unmodified-Since": cus_user["updatedAt"]},
            )
            if not check(
                results,
                "TC-1801A",
                "Gắn phạm vi khách hàng local cho CUS",
                scope_response.get("status") == 200,
                str(scope_response),
            ):
                results.write_json()
                return results.print_summary()
        cus_api = login("clerk")

        route_response = admin_api.get("/api/routes?page=1&pageSize=25")
        route_rows = rows(route_response)
        cargo_type_response = admin_api.get("/api/cargo-types?page=1&pageSize=25")
        cargo_types = rows(cargo_type_response)
        site_response = admin_api.get(f"/api/shipments/operational-sites?customerId={customer_id}")
        sites = rows(site_response)
        if not check(
            results,
            "TC-1801B",
            "Có tuyến đường và loại hàng để chuẩn hóa lô",
            bool(route_rows) and bool(cargo_types) and bool(sites),
            f"routes={route_response}, cargoTypes={cargo_type_response}, sites={site_response}",
        ):
            results.write_json()
            return results.print_summary()
        factory = next((site for site in sites if site.get("siteType") == "FACTORY"), sites[0])
        warehouse = next((site for site in sites if site.get("siteType") == "WAREHOUSE"), sites[0])

        container_type_response = admin_api.get("/api/container-types?page=1&pageSize=25")
        container_types = rows(container_type_response)
        port_response = admin_api.get("/api/ports?page=1&pageSize=25")
        ports = rows(port_response)
        if not check(
            results,
            "TC-1802",
            "Có danh mục loại container và cảng",
            bool(container_types) and bool(ports),
            f"containerTypes={container_type_response}, ports={port_response}",
        ):
            results.write_json()
            return results.print_summary()
        canonical_container_type = next(
            (item for item in container_types if item.get("code") in ("20DC", "40DC", "40HC")),
            container_types[0],
        )
        container_type_id = canonical_container_type["id"]

        create_response = cus_api.post("/api/shipments/quick", {
            "customerId": customer_id,
            "routeId": route_rows[0]["id"],
            "cargoTypeId": cargo_types[0]["id"],
            "operationalSiteId": factory["id"],
            "pickupWarehouseSiteId": warehouse["id"],
            "cargoMode": "FCL",
            "tradeDirection": "IMPORT",
            "blNumber": f"BLCUS{BOOK_SUFFIX_STORED}",
            "expectedDeliveryDate": datetime.now().strftime("%Y-%m-%d"),
            "operationalNotes": f"CUS workspace E2E {RUN_ID}",
        })
        shipment = create_response.get("data", {})
        if not check(
            results,
            "TC-1803",
            "CUS tạo lô FCL có mã tìm kiếm chính xác",
            create_response.get("status") in (200, 201) and isinstance(shipment.get("id"), int),
            str(create_response),
        ):
            results.write_json()
            return results.print_summary()

        shipment_id = shipment["id"]
        container_response = cus_api.put(f"/api/shipments/{shipment_id}/containers", {
            "expectedVersion": shipment["version"],
            "containers": [{
                "containerTypeId": container_type_id,
                "containerNumber": "MSKU1234565",
                "shippingLineName": "Hãng tàu E2E",
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
            "TC-1804",
            "CUS tạo container nguồn cho workspace",
            container_response.get("status") == 200 and bool(containers),
            str(container_response),
        ):
            results.write_json()
            return results.print_summary()

        declaration_response = cus_api.post(f"/api/shipments/{shipment_id}/declarations", {
            "declarationNumber": f"TK-{DECLARATION_SUFFIX_STORED}",
            "issuedAt": datetime.now().strftime("%Y-%m-%dT09:00:00.000Z"),
            "scope": "SHARED",
            "note": f"Tờ khai suffix {DECLARATION_SUFFIX_STORED}",
        })
        if not check(
            results,
            "TC-1804A",
            "CUS tạo tờ khai nguồn cho tìm kiếm hậu tố chữ-số",
            declaration_response.get("status") == 201,
            str(declaration_response),
        ):
            results.write_json()
            return results.print_summary()

        list_response = cus_api.get(
            f"/api/shipments/cus-workspace?searchSuffix={BOOK_SUFFIX_QUERY}&page=1&limit=20"
        )
        workspace = list_response.get("data", {})
        matching = [item for item in workspace.get("items", []) if item.get("id") == shipment_id]
        check(
            results,
            "TC-1805",
            "Tìm đúng hậu tố Bill/Book chữ-số không phân biệt hoa thường và phân trang sau bộ lọc",
            list_response.get("status") == 200 and len(matching) == 1 and workspace.get("total") == 1,
            str(list_response),
        )

        declaration_search_response = cus_api.get(
            f"/api/shipments/cus-workspace?searchSuffix={DECLARATION_SUFFIX_QUERY}&page=1&limit=20"
        )
        declaration_workspace = declaration_search_response.get("data", {})
        declaration_matching = [item for item in declaration_workspace.get("items", []) if item.get("id") == shipment_id]
        check(
            results,
            "TC-1805A",
            "Tìm đúng hậu tố tờ khai chữ-số không phân biệt hoa thường",
            declaration_search_response.get("status") == 200
            and len(declaration_matching) == 1
            and declaration_workspace.get("total") == 1,
            str(declaration_search_response),
        )

        detail_response = cus_api.get(f"/api/shipments/cus-workspace/{shipment_id}")
        detail = detail_response.get("data", {})
        detail_lines = detail.get("containers", [])
        selectors = detail.get("selectors", {})
        detail_ok = (
            detail_response.get("status") == 200
            and len(detail_lines) == 1
            and isinstance(selectors.get("containerTypes"), list)
            and isinstance(selectors.get("externalCarriers"), list)
        )
        if not check(results, "TC-1806", "Chi tiết trả dữ liệu container và danh mục chọn", detail_ok, str(detail_response)):
            results.write_json()
            return results.print_summary()

        line = detail_lines[0]
        update_response = cus_api.post(
            f"/api/shipments/cus-workspace/{shipment_id}/containers/{line['id']}",
            {
                "expectedShipmentVersion": line["shipmentVersion"],
                "carrierType": "EXTERNAL",
                "newExternalCarrier": {
                    "name": f"Nhà xe E2E {RUN_ID}",
                    "plateNumber": f"E2E-{BOOK_SUFFIX_STORED}",
                },
            },
        )
        updated_line = update_response.get("data", {}).get("line", {})
        check(
            results,
            "TC-1807",
            "CUS lưu thông tin vận hành container bằng optimistic version",
            update_response.get("status") == 200
            and updated_line.get("carrierName") == f"Nhà xe E2E {RUN_ID}"
            and updated_line.get("plateNumber") == f"E2E-{BOOK_SUFFIX_STORED}".upper(),
            str(update_response),
        )

        stale_response = cus_api.post(
            f"/api/shipments/cus-workspace/{shipment_id}/containers/{line['id']}",
            {
                "expectedShipmentVersion": line["shipmentVersion"],
                "containerTypeId": line["containerTypeId"],
            },
        )
        check(
            results,
            "TC-1808",
            "Bản ghi cũ bị từ chối thay vì ghi đè",
            stale_response.get("status") == 409,
            str(stale_response),
        )

        lock_response = cus_api.post(f"/api/shipments/cus-workspace/{shipment_id}/lock", {
            "expectedVersion": updated_line.get("shipmentVersion", shipment["version"]),
            "confirmationId": 999999999,
            "confirmationChecksum": "invalid-confirmation",
            "reason": "E2E không có xác nhận kế toán",
            "acknowledged": True,
        })
        check(
            results,
            "TC-1809",
            "Không thể khóa lô nếu thiếu xác nhận kế toán hợp lệ",
            lock_response.get("status") in (404, 409),
            str(lock_response),
        )

        denied_response = driver_api.get("/api/shipments/cus-workspace?page=1&limit=1")
        check(
            results,
            "TC-1810",
            "Tài xế không được truy cập workspace CUS",
            denied_response.get("status") == 403,
            str(denied_response),
        )

        # ── Cargo terminology, server-derived completeness, and endpoint strictness ──
        containers_all = cus_api.get(
            f"/api/shipments/cus-workspace/containers?searchSuffix={BOOK_SUFFIX_QUERY}&page=1&limit=20"
        )
        containers_all_data = containers_all.get("data", {})
        fixture_rows = [row for row in containers_all_data.get("items", []) if row.get("shipmentId") == shipment_id]
        information_status_present = bool(fixture_rows) and all(
            row.get("informationStatus") in ("COMPLETE", "MISSING") and isinstance(row.get("missingFields"), list)
            for row in fixture_rows
        )
        check(
            results,
            "TC-1816",
            "Dòng container mang trạng thái thông tin và danh sách trường thiếu do server suy ra",
            containers_all.get("status") == 200 and information_status_present,
            str(containers_all),
        )

        containers_missing = cus_api.get(
            f"/api/shipments/cus-workspace/containers?informationStatus=MISSING&searchSuffix={BOOK_SUFFIX_QUERY}&page=1&limit=20"
        )
        missing_data = containers_missing.get("data", {})
        missing_rows = [row for row in missing_data.get("items", []) if row.get("shipmentId") == shipment_id]
        # The fixture deliberately leaves the per-container route, transport
        # date, and appointment unset. FCL authority is container-scoped, so
        # all three applicable fields must be reported in precedence order.
        fixture_missing_ok = len(missing_rows) == 1 and [
            field.get("code") for field in missing_rows[0].get("missingFields", [])
        ] == ["ROUTE", "TRANSPORT_DATE", "APPOINTMENT"]
        check(
            results,
            "TC-1817",
            "Bộ lọc Chưa cập nhật trả đúng dòng FCL còn thiếu với đúng trường áp dụng",
            containers_missing.get("status") == 200
            and fixture_missing_ok
            and missing_data.get("total") == len(missing_data.get("items", [])),
            str(containers_missing),
        )

        strictness_response = cus_api.get(
            f"/api/shipments/cus-workspace?informationStatus=MISSING&searchSuffix={BOOK_SUFFIX_QUERY}&page=1&limit=20"
        )
        check(
            results,
            "TC-1818",
            "Endpoint tổng quan từ chối tham số chỉ dành cho trang chi tiết",
            strictness_response.get("status") == 400,
            str(strictness_response),
        )

        lcl_create_response = cus_api.post("/api/shipments/quick", {
            "customerId": customer_id,
            "routeId": route_rows[0]["id"],
            "cargoTypeId": cargo_types[0]["id"],
            "operationalSiteId": factory["id"],
            "pickupWarehouseSiteId": warehouse["id"],
            "cargoMode": "LCL",
            "tradeDirection": "EXPORT",
            "bookingRef": f"LCLQ{BOOK_SUFFIX_STORED}",
            "expectedDeliveryDate": datetime.now().strftime("%Y-%m-%d"),
            "operationalNotes": f"CUS workspace E2E LCL {RUN_ID}",
        })
        lcl_shipment = lcl_create_response.get("data", {})
        lcl_ok = lcl_create_response.get("status") in (200, 201) and isinstance(lcl_shipment.get("id"), int)
        if lcl_ok:
            lcl_containers = cus_api.get(
                f"/api/shipments/cus-workspace/containers?informationStatus=MISSING&searchSuffix={BOOK_SUFFIX_QUERY}&page=1&limit=20"
            )
            lcl_absent = all(
                row.get("shipmentId") != lcl_shipment["id"]
                for row in lcl_containers.get("data", {}).get("items", [])
            )
            check(
                results,
                "TC-1819",
                "Lô Lẻ không bao giờ xuất hiện trên bảng container hay bộ lọc Chưa cập nhật",
                lcl_containers.get("status") == 200 and lcl_absent,
                str(lcl_containers),
            )

        own_fleet_response = cus_api.post(
            f"/api/shipments/cus-workspace/{shipment_id}/containers/{line['id']}",
            {
                "expectedShipmentVersion": updated_line.get("shipmentVersion", shipment["version"]),
                "carrierType": "OWN",
                "plateNumber": "29C-123.45",
            },
        )
        check(
            results,
            "TC-1820",
            "CUS không thể tự gán xe nội bộ: authority từ chối carrierType OWN",
            own_fleet_response.get("status") == 409,
            str(own_fleet_response),
        )

        with SilverseaTestContext() as ctx:
            for width, height, label in ((1440, 1000, "desktop"), (1024, 900, "laptop"), (768, 1024, "tablet"), (640, 800, "zoom-200-equivalent"), (390, 844, "mobile"), (320, 720, "narrow")):
                page = ctx.new_page({"width": width, "height": height})
                if width == 640:
                    # A 1280 CSS-pixel desktop viewport at 200% browser zoom has
                    # an effective layout viewport of 640 CSS pixels. Chromium
                    # headless ignores the browser zoom shortcut, so verify the
                    # equivalent reflow width and reduced-motion path directly.
                    page.emulate_media(reduced_motion="reduce")
                ctx.login_as("clerk", page)
                page.goto(f"{BASE_URL}/shipments?searchSuffix={BOOK_SUFFIX_QUERY}")
                wait_for_page_ready(page)
                page.get_by_role("heading", name="Tổng quan lô hàng", exact=True).wait_for(timeout=10_000)
                page.wait_for_timeout(300)
                overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
                visible_fixture = page.get_by_text(f"BLCUS{BOOK_SUFFIX_STORED}", exact=False).count() > 0

                if width == 1440:
                    master_row = page.locator("tr.cus-dashboard-row").filter(has_text=f"BLCUS{BOOK_SUFFIX_STORED}")
                    expand_button = master_row.locator("button.cus-dashboard-detail")
                    expand_button.focus()
                    controls = expand_button.get_attribute("aria-controls")
                    page.keyboard.press("Enter")
                    dialog = page.get_by_role("dialog")
                    dialog.wait_for(timeout=10_000)
                    dialog.locator('td[data-label="Giờ hẹn đóng/trả"]:visible').first.wait_for(timeout=10_000)
                    controlled_region_exists = bool(controls) and page.locator(f"#{controls}").count() == 1
                    # The drawer is still completing its entrance transform at
                    # this point. Escape is the tested keyboard dismissal path
                    # and avoids racing Playwright's element-stability guard.
                    page.keyboard.press("Escape")
                    page.wait_for_function("document.querySelectorAll('[role=\"dialog\"]').length === 0", timeout=2_500)
                    focus_restored = page.evaluate("document.activeElement?.classList.contains('cus-dashboard-detail') === true")
                    check(
                        results,
                        "TC-1812",
                        "Mở drawer bằng bàn phím và trả focus đúng hàng",
                        controlled_region_exists and focus_restored,
                        f"ariaControls={controls}, focusRestored={focus_restored}",
                    )

                if width == 390:
                    worksheet_row = page.locator("tr.cus-dashboard-row").filter(has_text=f"BLCUS{BOOK_SUFFIX_STORED}")
                    drawer_opener = worksheet_row.locator("button.cus-dashboard-detail")
                    drawer_opener.focus()
                    drawer_opener.click()
                    dialog = page.get_by_role("dialog")
                    dialog.wait_for(timeout=10_000)
                    focus_moved_inside = page.evaluate("document.activeElement?.getAttribute('aria-label') === 'Đóng'")
                    dialog.locator('td[data-label="Giờ hẹn đóng/trả"]:visible').first.wait_for(timeout=10_000)
                    page.wait_for_function(
                        """() => {
                            const rect = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
                            return Boolean(rect && rect.left >= -1 && rect.right <= window.innerWidth + 1);
                        }""",
                        timeout=3_000,
                    )
                    drawer_inside_viewport = True
                    ctx.screenshot(page, "TC-1813_mobile_detail_drawer")
                    page.keyboard.press("Escape")
                    page.wait_for_function(
                        "document.querySelectorAll('[role=\"dialog\"]').length === 0",
                        timeout=2_000,
                    )
                    focus_restored = page.evaluate("document.activeElement?.classList.contains('cus-dashboard-detail') === true")
                    check(
                        results,
                        "TC-1813",
                        "Drawer mobile giữ và trả focus khi đóng bằng Escape",
                        focus_moved_inside and focus_restored and drawer_inside_viewport,
                        f"focusMoved={focus_moved_inside}, focusRestored={focus_restored}, insideViewport={drawer_inside_viewport}",
                    )

                ctx.screenshot(page, f"TC-1811_{label}_{width}")
                check(
                    results,
                    "TC-1814" if width == 640 else f"TC-1811-{width}",
                    "Workspace CUS reflow ở mức tương đương 200% zoom" if width == 640 else f"Workspace CUS vừa khung {width}px",
                    not overflow and visible_fixture,
                    f"overflow={overflow}, url={page.url}",
                )
                page.context.close()

            page = ctx.new_page({"width": 1440, "height": 1000})
            ctx.login_as("clerk", page)
            page.goto(f"{BASE_URL}/shipments-detail?dateScope=all&searchSuffix={BOOK_SUFFIX_QUERY}")
            wait_for_page_ready(page)
            # URL-backed Trạng thái (điều xe) filter: applying it updates the
            # URL (replaceState) and keeps the select visibly active. The
            # fixture's warning line is asserted via the API in TC-1816/1817;
            # here the fixture row (undispatched, still missing its
            # appointment) must render the server-derived warning after the
            # filter surfaces it.
            fixture_warning = page.locator(f"text=BLCUS{BOOK_SUFFIX_STORED}")
            fixture_warning.first.wait_for(timeout=10_000)
            status_select = page.locator("select", has=page.locator("option[value='UNASSIGNED']")).first
            with page.expect_response(
                lambda response: (
                    "/api/shipments/cus-workspace/containers?" in response.url
                    and "dispatchStatus=UNASSIGNED" in response.url
                    and response.status == 200
                ),
                timeout=10_000,
            ):
                status_select.select_option("UNASSIGNED")
            page.wait_for_function(
                "() => new URLSearchParams(location.search).get('dispatchStatus') === 'UNASSIGNED'",
                timeout=5_000,
            )
            page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            warning = page.locator(".shipment-container-ledger__missing-fields", has_text="Lịch hẹn").first
            warning.wait_for(state="visible", timeout=10_000)
            active_filter_visible = status_select.input_value() == "UNASSIGNED"
            warning_visible = warning.is_visible()
            check(
                results,
                "TC-1821",
                "Bộ lọc Trạng thái (chưa điều xe) nằm trong URL, giữ lựa chọn và hiển thị dòng cảnh báo trường thiếu",
                active_filter_visible and warning_visible,
                f"url={page.url}, activeFilter={active_filter_visible}, warning={warning_visible}",
            )
            page.goto(f"{BASE_URL}/shipments-detail?dateScope=all&searchSuffix={BOOK_SUFFIX_QUERY}")
            wait_for_page_ready(page)
            # The responsive ledger keeps a second semantic table in the DOM;
            # interact with the rendered row instead of its hidden counterpart.
            container_row = page.locator(".shipment-container-ledger tbody tr:visible").filter(has_text="MSKU1234565")
            container_row.wait_for(timeout=10_000)
            all_cells_open = True
            full_coverage = True
            focus_restored = True
            for label in ("Khách hàng & lộ trình", "Chứng từ & hãng tàu", "Thông số container", "Địa điểm nâng / hạ", "Lịch trình", "Phân xe", "Ghi chú"):
                cell = container_row.locator(f'[data-label="{label}"]')
                trigger = cell.locator("button")
                trigger_id = trigger.get_attribute("id")
                coverage = cell.evaluate(
                    """cell => {
                        const trigger = cell.querySelector('button');
                        const cellRect = cell.getBoundingClientRect();
                        const triggerRect = trigger?.getBoundingClientRect();
                        return Boolean(triggerRect
                            && triggerRect.left <= cellRect.left + 1
                            && triggerRect.top <= cellRect.top + 1
                            && triggerRect.right >= cellRect.right - 1
                            && triggerRect.bottom >= cellRect.bottom - 1);
                    }"""
                )
                full_coverage = full_coverage and coverage
                box = cell.bounding_box()
                if not box:
                    all_cells_open = False
                    continue
                cell.click(position={"x": max(4, box["width"] - 4), "y": max(4, box["height"] - 4)})
                editor = page.locator(".shipment-container-ledger__inline-editor")
                try:
                    editor.wait_for(timeout=10_000)
                    page.keyboard.press("Escape")
                    editor.wait_for(state="detached", timeout=3_000)
                    page.wait_for_function(
                        "(id) => document.activeElement?.id === id",
                        arg=trigger_id,
                        timeout=2_000,
                    )
                except Exception:
                    all_cells_open = False
                    focus_restored = False
            ctx.screenshot(page, "TC-1815_detail_full_cell_click")
            check(
                results,
                "TC-1815",
                "Mọi ô chi tiết được phép sửa mở editor từ vùng trống của toàn ô",
                full_coverage and all_cells_open and focus_restored,
                f"coverage={full_coverage}, opened={all_cells_open}, focusRestored={focus_restored}",
            )
            page.set_viewport_size({"width": 390, "height": 844})
            page.goto(f"{BASE_URL}/shipments-detail?dateScope=all&searchSuffix={BOOK_SUFFIX_QUERY}")
            wait_for_page_ready(page)
            mobile_row = page.locator(".shipment-container-ledger tbody tr:visible").filter(has_text="MSKU1234565")
            mobile_schedule = mobile_row.locator(
                '[data-label="Lịch trình"] > .shipment-container-ledger__cell-editor > .shipment-container-ledger__cell-trigger'
            )
            mobile_schedule.wait_for(state="visible", timeout=10_000)
            mobile_schedule.click(position={"x": 20, "y": 20})
            mobile_editor = page.locator('.shipment-container-ledger__inline-editor[data-mode="schedule"]')
            mobile_editor.wait_for(state="visible", timeout=10_000)
            mobile_pointer_opened = mobile_schedule.get_attribute("aria-expanded") == "true"
            check(
                results,
                "TC-1822",
                "Chạm vào ô lịch trình trên mobile mở editor bằng con trỏ, không chỉ bằng bàn phím",
                mobile_pointer_opened,
                f"ariaExpanded={mobile_schedule.get_attribute('aria-expanded')}",
            )
            page.context.close()

    except Exception as error:
        results.fail("TC-1899", "Suite CUS workspace chạy hoàn chỉnh", repr(error))

    results.write_json()
    return results.print_summary()


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
