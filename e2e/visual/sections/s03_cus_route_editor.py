"""Section 03b — CUS route editor (Hình sửa hành trình) on /shipments-detail.

Covers the bugs the user reported on 2026-08-22:
  - Stale-data 409 was being treated as the only 409; domain 409s (e.g.
    `Hình thức hàng FCL/LCL chưa được xác định.`) discarded the user's draft.
  - Long Vietnamese error / recovery text overflowed the 420px editor box.
  - No-op save bumped the shipment version, so the very next identical
    save 409-conflicted.
  - Cross-role (CUS vs Điều vận) concurrent editing of the same container
    is not covered elsewhere.

This section exercises the CUS route editor at the desktop viewport. The
concurrency case uses the configured dispatcher account for the competing API
write, while the browser remains on the CUS draft.

Browser-focused cases open a real container on /shipments-detail and capture
the relevant rendered state. TC-04 directly verifies the same container-save
API used by the editor because an unchanged form correctly disables its save
button.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.request
import urllib.error
from typing import Optional

from visual.lib.runner import tc, VisualTestContext
from visual.lib.accounts import ACCOUNTS, DEFAULT_PASSWORD

API_URL = os.environ.get("VISUAL_API", "http://localhost:3001").rstrip("/")


# ─── helpers ──────────────────────────────────────────────────────────────

def _api_login(identifier: str, password: str) -> Optional[str]:
    body = json.dumps({"identifier": identifier, "password": password}).encode()
    req = urllib.request.Request(
        f"{API_URL}/api/auth/login", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read()).get("token")
    except Exception:
        return None


def _api_get(token: str, path: str) -> dict:
    req = urllib.request.Request(
        f"{API_URL}{path}", headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"error": str(e)}


def _api_post(token: str, path: str, payload: dict, idempotency_key: str) -> dict:
    req = urllib.request.Request(
        f"{API_URL}{path}",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Idempotency-Key": idempotency_key,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise AssertionError(
            f"POST {path} returned HTTP {error.code}: {error.read().decode()}"
        ) from error


def _first_editable_container(token: str) -> Optional[dict]:
    """Return {shipmentId, containerId, version, containerNumber} for a
    container that CUS can edit (lift/drop ports are DIRECT). Falls back to
    DISPATCHER-visible shipments if CUS has none.
    """
    body = _api_get(token, "/api/shipments/cus-workspace?page=1&limit=20")
    items = body.get("items") or []
    for item in items:
        # The CUS list items do not include container-level permissions; we
        # need to fetch the detail to confirm a container is editable.
        detail = _api_get(token, f"/api/shipments/cus-workspace/{item['id']}")
        for line in detail.get("containers") or []:
            perms = line.get("permissions") or {}
            if perms.get("liftSiteEditable") or perms.get("dropoffSiteEditable"):
                return {
                    "shipmentId": item["id"],
                    "containerId": line["id"],
                    "version": line.get("shipmentVersion") or item.get("version"),
                    "containerNumber": line.get("containerNumber") or f"CONT-{line['id']}",
                    "shipmentVersion": line.get("shipmentVersion"),
                }
    return None


def _open_route_editor(ctx: VisualTestContext, container_number: str = "") -> None:
    """Click the 'Chỉnh sửa điểm nâng hạ' trigger for the route editor.

    The CUS route editor trigger is a button with `data-cell-label="điểm nâng hạ"`.
    Using that attribute selector is robust against the visible text changing
    as the cell content evolves (carrier name, route name, etc.).
    """
    trigger = ctx.page.locator('button[data-cell-label="điểm nâng hạ"]').first
    trigger.click(timeout=4000)
    ctx.page.wait_for_timeout(400)


# ─── TCs ──────────────────────────────────────────────────────────────────

@tc(
    "TC-CUS-DETAIL-ROUTE-01", roles=["CUS"],
    url="/shipments-detail",
    title="CUS route editor: opens for a real editable container",
)
def tc_route_01_happy_path(ctx: VisualTestContext):
    """Open the route editor for a real editable container and capture the
    rendered editor as a visual baseline.
    """
    ctx.login("CUS")
    token = _api_login(ACCOUNTS["CUS"]["identifier"], DEFAULT_PASSWORD)
    if not token:
        raise AssertionError("BLOCKED: CUS API login failed")
    target = _first_editable_container(token)
    if not target:
        raise AssertionError("BLOCKED: no editable CUS container is available")

    # The /shipments-detail page needs a searchSuffix (4–5 chars) to render
    # a specific container. Reuse the last 5 chars of billOrBookNumber.
    detail_body = _api_get(token, f"/api/shipments/cus-workspace/{target['shipmentId']}")
    bl = (detail_body.get("summary") or {}).get("billOrBookNumber")
    suffix = None
    if bl:
        cleaned = "".join(ch for ch in bl if ch.isalnum())
        if len(cleaned) >= 4:
            suffix = cleaned[-5:].upper()
    if not suffix:
        raise AssertionError("BLOCKED: editable shipment has no navigation suffix")

    ctx.goto(f"/shipments-detail?searchSuffix={suffix}&dateScope=all")
    ctx.page.wait_for_timeout(800)
    _open_route_editor(ctx, target["containerNumber"])
    # Editor must be open: 'Cảng nâng' label is visible.
    try:
        ctx.page.wait_for_selector('label:has-text("Cảng nâng")', timeout=4000)
    except Exception:
        raise AssertionError("route editor did not open — 'Cảng nâng' label missing")
    # Capture the open-editor screenshot for the visual baseline.
    ctx.capture(suffix="editor-open")


@tc(
    "TC-CUS-DETAIL-ROUTE-04", roles=["CUS"],
    url="/shipments-detail",
    title="CUS container route API: identical lift/drop save is a no-op",
)
def tc_route_04_noop_save(ctx: VisualTestContext):
    """Regression: an identical lift/drop save must not bump the shipment
    version. This API-level regression verifies the version is unchanged after
    the round trip; the editor itself correctly disables save while unchanged.
    """
    ctx.login("CUS")
    token = _api_login(ACCOUNTS["CUS"]["identifier"], DEFAULT_PASSWORD)
    if not token:
        raise AssertionError("BLOCKED: CUS API login failed")
    target = _first_editable_container(token)
    if not target:
        raise AssertionError("BLOCKED: no editable CUS container is available")

    # Save twice with identical values. A legacy row may perform a one-time
    # cargo-mode repair on the first request; the second request must be a
    # genuine no-op and keep the repaired/current version stable.
    detail_before = _api_get(token, f"/api/shipments/cus-workspace/{target['shipmentId']}")
    line_before = next(
        (l for l in detail_before.get("containers", []) if l["id"] == target["containerId"]),
        None,
    )
    if not line_before:
        raise AssertionError("BLOCKED: selected container is absent from shipment detail")

    # POST identical values. Retry on a transient lock conflict
    # (the integration suite runs against the same DB and may have a stale
    # advisory lock from a prior request).
    import urllib.request as _ur
    expected_version = line_before.get("shipmentVersion") or detail_before["summary"]["version"]

    def save(version: int, cycle: int) -> dict:
        payload = json.dumps({
            "expectedShipmentVersion": version,
            "liftSiteId": line_before.get("liftSiteId"),
            "dropoffSiteId": line_before.get("dropoffSiteId"),
        }).encode()
        last_err = None
        for attempt in range(3):
            req = _ur.Request(
                f"{API_URL}/api/shipments/cus-workspace/{target['shipmentId']}/containers/{target['containerId']}",
                data=payload, method="POST",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "Idempotency-Key": (
                        f"visual-noop-{target['containerId']}-{version}-{cycle}-{attempt}"
                    ),
                },
            )
            try:
                with _ur.urlopen(req, timeout=10) as r:
                    return json.loads(r.read())
            except _ur.HTTPError as error:
                err_body = error.read().decode()
                if error.code == 409 and "Khóa" in err_body and attempt < 2:
                    time.sleep(1.0 * (attempt + 1))
                    continue
                last_err = f"HTTP {error.code}: {err_body}"
                break
        raise AssertionError(f"no-op save failed: {last_err}")

    first_response = save(expected_version, 1)
    first_version = first_response.get("line", {}).get("shipmentVersion")
    if not isinstance(first_version, int):
        raise AssertionError("first no-op response did not include shipmentVersion")
    response = save(first_version, 2)
    if response.get("line", {}).get("shipmentVersion") != first_version:
        raise AssertionError(
            f"second identical save bumped version: before={first_version} "
            f"after={response['line']['shipmentVersion']}"
        )


@tc(
    "TC-CUS-DETAIL-ROUTE-06", roles=["CUS"],
    url="/shipments-detail",
    title="CUS route editor: domain 409 (Hình thức hàng) shows inline, draft preserved",
)
def tc_route_06_domain_409(ctx: VisualTestContext):
    """The frontend must distinguish a true optimistic-conflict 409 from a
    domain 409 like 'Hình thức hàng FCL/LCL chưa được xác định.'. The
    domain 409 must surface as an inline danger alert and keep the editor
    open with the user's draft intact. We assert this by mocking the API
    response and inspecting the rendered DOM.
    """
    ctx.login("CUS")
    token = _api_login(ACCOUNTS["CUS"]["identifier"], DEFAULT_PASSWORD)
    if not token:
        raise AssertionError("BLOCKED: CUS API login failed")
    target = _first_editable_container(token)
    if not target:
        raise AssertionError("BLOCKED: no editable CUS container is available")
    detail_body = _api_get(token, f"/api/shipments/cus-workspace/{target['shipmentId']}")
    bl = (detail_body.get("summary") or {}).get("billOrBookNumber")
    if not bl:
        raise AssertionError("BLOCKED: editable shipment has no navigation suffix")
    suffix = "".join(ch for ch in bl if ch.isalnum())[-5:].upper()

    ctx.goto(f"/shipments-detail?searchSuffix={suffix}&dateScope=all")
    ctx.page.wait_for_timeout(800)

    # Install a route handler that returns a domain 409 for the container
    # PATCH. This is a black-box test: we do not mutate application code,
    # only intercept the network response.
    domain_message = "Hình thức hàng FCL/LCL chưa được xác định."
    ctx.page.route(
        "**/api/shipments/cus-workspace/*/containers/*",
        lambda route: route.fulfill(
            status=409,
            content_type="application/json",
            body=json.dumps({"error": domain_message}),
        ),
    )
    # Open the first available route editor.
    trigger = ctx.page.locator('button[data-cell-label="điểm nâng hạ"]')
    try:
        trigger.first.click(timeout=4000)
    except Exception as error:
        raise AssertionError("BLOCKED: no route-editor trigger is visible") from error
    ctx.page.wait_for_timeout(400)
    # The save button is disabled until a field is dirty. Open the Cảng nâng
    # dropdown and pick the first available option so the form becomes dirty.
    try:
        lift_field = ctx.page.locator('[id^="shipment-detail-lift-"]').first
        lift_field.click()
        ctx.page.wait_for_timeout(300)
        # Pick the second option (first one is the current value).
        options = ctx.page.locator('[role="option"]')
        if options.count() > 1:
            options.nth(1).click()
        else:
            raise AssertionError("Cảng nâng dropdown has no alternative options")
        ctx.page.wait_for_timeout(300)
    except AssertionError:
        raise
    except Exception as e:
        raise AssertionError(f"could not change Cảng nâng to dirty the form: {e}")
    # Click the save button.
    try:
        ctx.page.get_by_role("button", name=re.compile(r"Lưu hành trình")).first.click(timeout=4000)
    except Exception:
        raise AssertionError("save button not visible — editor did not open")
    # The alert must appear with the domain message.
    try:
        ctx.page.wait_for_selector(f'[role="alert"]:has-text("{domain_message}")', timeout=5000)
    except Exception:
        raise AssertionError(
            f"domain 409 not shown inline: '{domain_message}' missing in [role=alert]"
        )
    # The stale-data recovery banner must NOT be present.
    body = ctx.page.inner_text("body")
    if "Đã tải bản mới nhất" in body:
        raise AssertionError(
            "domain 409 was incorrectly treated as stale data — recovery banner present"
        )
    # Editor must still be open: cancel button visible.
    cancel = ctx.page.get_by_role("button", name=re.compile(r"Hủy hành trình"))
    if cancel.count() == 0:
        raise AssertionError("editor closed after domain 409 — draft would be lost")


@tc(
    "TC-CUS-DETAIL-ROUTE-08", roles=["CUS"],
    url="/shipments-detail",
    title="CUS route editor: long Vietnamese error text wraps, no overflow",
)
def tc_route_08_long_error_text(ctx: VisualTestContext):
    """Regression: long Vietnamese error / recovery text in the inline
    editor must wrap inside the 420px popover, not overflow horizontally
    into the row to the right. The CSS contract is in ShipmentsDetailPage.css
    (.shipment-container-ledger__edit-error / __recovery).
    """
    ctx.login("CUS")
    token = _api_login(ACCOUNTS["CUS"]["identifier"], DEFAULT_PASSWORD)
    if not token:
        raise AssertionError("BLOCKED: CUS API login failed")
    target = _first_editable_container(token)
    if not target:
        raise AssertionError("BLOCKED: no editable CUS container is available")
    detail_body = _api_get(token, f"/api/shipments/cus-workspace/{target['shipmentId']}")
    bl = (detail_body.get("summary") or {}).get("billOrBookNumber")
    if not bl:
        raise AssertionError("BLOCKED: editable shipment has no navigation suffix")
    suffix = "".join(ch for ch in bl if ch.isalnum())[-5:].upper()
    ctx.goto(f"/shipments-detail?searchSuffix={suffix}&dateScope=all")
    ctx.page.wait_for_timeout(800)

    long_message = "Hệ thống từ chối: " + ("lô hàng vừa thay đổi do người khác cập nhật; " * 6)
    long_message = long_message.rstrip("; ")
    ctx.page.route(
        "**/api/shipments/cus-workspace/*/containers/*",
        lambda route: route.fulfill(
            status=409,
            content_type="application/json",
            body=json.dumps({"error": long_message}),
        ),
    )
    trigger = ctx.page.locator('button[data-cell-label="điểm nâng hạ"]')
    try:
        trigger.first.click(timeout=4000)
    except Exception as error:
        raise AssertionError("BLOCKED: no route-editor trigger is visible") from error
    ctx.page.wait_for_timeout(400)
    # Dirty the form by picking a different lift port.
    try:
        lift_field = ctx.page.locator('[id^="shipment-detail-lift-"]').first
        lift_field.click()
        ctx.page.wait_for_timeout(300)
        options = ctx.page.locator('[role="option"]')
        if options.count() > 1:
            options.nth(1).click()
        else:
            raise AssertionError("BLOCKED: Cảng nâng has no alternative option")
        ctx.page.wait_for_timeout(300)
    except AssertionError:
        raise
    except Exception as error:
        raise AssertionError("BLOCKED: could not dirty the route editor") from error
    try:
        ctx.page.get_by_role("button", name=re.compile(r"Lưu hành trình")).first.click(timeout=4000)
    except Exception:
        raise AssertionError("save button not visible — editor did not open")
    try:
        ctx.page.wait_for_selector('[role="alert"]', timeout=5000)
    except Exception:
        raise AssertionError("alert did not appear")
    # The alert's bounding box must be within the popover (≤ 420px wide).
    popover = ctx.page.locator(".shipment-container-ledger__inline-editor").first
    alert = ctx.page.locator('[role="alert"]').first
    if popover.count() == 0 or alert.count() == 0:
        raise AssertionError("popover or alert not located")
    pop_box = popover.bounding_box()
    alert_box = alert.bounding_box()
    if not pop_box or not alert_box:
        raise AssertionError("could not measure popover or alert")
    if alert_box["x"] + alert_box["width"] > pop_box["x"] + pop_box["width"] + 1:
        raise AssertionError(
            f"alert overflows popover: alert right={alert_box['x'] + alert_box['width']}, "
            f"popover right={pop_box['x'] + pop_box['width']}"
        )
    # And the page itself must not have horizontal scroll.
    scroll_w = ctx.page.evaluate("document.documentElement.scrollWidth")
    client_w = ctx.page.evaluate("document.documentElement.clientWidth")
    if scroll_w - client_w > 1:
        raise AssertionError(
            f"page horizontal overflow: scrollWidth={scroll_w}, clientWidth={client_w}"
        )


@tc(
    "TC-CUS-DSH-CONCURRENCY-01", roles=["CUS", "DISPATCHER"],
    url="/shipments-detail",
    title="CUS vs Điều vận: stale 409 from concurrent edit triggers recovery banner",
)
def tc_concurrency_stale_409(ctx: VisualTestContext):
    """A genuine optimistic conflict (CUS opens, Điều vận edits, CUS saves)
    must surface the stale-data recovery banner. This is the only case
    where discarding the user's draft is correct.
    """
    ctx.login("CUS")
    token_cus = _api_login(ACCOUNTS["CUS"]["identifier"], DEFAULT_PASSWORD)
    if not token_cus:
        raise AssertionError("BLOCKED: CUS API login failed")
    dispatcher_identifier = ACCOUNTS["DISPATCHER"]["identifier"]
    token_dispatcher = _api_login(dispatcher_identifier, DEFAULT_PASSWORD)
    if not token_dispatcher:
        raise AssertionError("BLOCKED: dispatcher API login failed")
    target = _first_editable_container(token_cus)
    if not target:
        raise AssertionError("BLOCKED: no editable CUS container is available")
    detail_body = _api_get(token_cus, f"/api/shipments/cus-workspace/{target['shipmentId']}")
    bl = (detail_body.get("summary") or {}).get("billOrBookNumber")
    if not bl:
        raise AssertionError("BLOCKED: editable shipment has no navigation suffix")
    suffix = "".join(ch for ch in bl if ch.isalnum())[-5:].upper()
    line_before = next(
        (line for line in detail_body.get("containers", [])
         if line["id"] == target["containerId"]),
        None,
    )
    if not line_before:
        raise AssertionError("BLOCKED: selected container is absent from shipment detail")
    original_lift_id = line_before.get("liftSiteId")
    original_dropoff_id = line_before.get("dropoffSiteId")
    alternate_port = next(
        (port for port in detail_body.get("selectors", {}).get("ports", [])
         if port.get("id") != original_dropoff_id),
        None,
    )
    if not alternate_port:
        raise AssertionError("BLOCKED: no alternate dropoff port is configured")

    # Open the editor first so its draft keeps the current shipment version.
    ctx.goto(f"/shipments-detail?searchSuffix={suffix}&dateScope=all")
    ctx.page.wait_for_timeout(800)
    _open_route_editor(ctx, target["containerNumber"])
    # Dirty the form by changing the lift port.
    try:
        lift_field = ctx.page.locator('[id^="shipment-detail-lift-"]').first
        lift_field.click()
        ctx.page.wait_for_timeout(300)
        options = ctx.page.locator('[role="option"]')
        if options.count() > 1:
            options.nth(1).click()
        else:
            raise AssertionError("BLOCKED: lift selector has no alternate option")
        ctx.page.wait_for_timeout(300)
    except AssertionError:
        raise
    except Exception as error:
        raise AssertionError("BLOCKED: could not dirty the route editor") from error

    endpoint = (
        f"/api/shipments/cus-workspace/{target['shipmentId']}"
        f"/containers/{target['containerId']}"
    )
    concurrent_version = line_before.get("shipmentVersion") or detail_body["summary"]["version"]
    _api_post(
        token_dispatcher,
        endpoint,
        {
            "expectedShipmentVersion": concurrent_version,
            "dropoffSiteId": alternate_port["id"],
        },
        f"visual-concurrent-{target['containerId']}-{concurrent_version}",
    )

    try:
        try:
            ctx.page.get_by_role(
                "button", name=re.compile(r"Lưu hành trình")
            ).first.click(timeout=4000)
        except Exception as error:
            raise AssertionError("save button not visible — editor did not open") from error
        try:
            ctx.page.get_by_text(re.compile(r"Đã tải bản mới nhất")).wait_for(timeout=5000)
        except Exception as error:
            raise AssertionError(
                "stale-data 409 did not surface the recovery banner"
            ) from error
    finally:
        # Restore the original operational value so repeated local/staging QA
        # does not leave a different port behind.
        detail_after = _api_get(
            token_dispatcher,
            f"/api/shipments/cus-workspace/{target['shipmentId']}",
        )
        line_after = next(
            (line for line in detail_after.get("containers", [])
             if line["id"] == target["containerId"]),
            None,
        )
        ports_changed = line_after and (
            line_after.get("liftSiteId") != original_lift_id
            or line_after.get("dropoffSiteId") != original_dropoff_id
        )
        if ports_changed:
            restore_version = (
                line_after.get("shipmentVersion")
                or detail_after["summary"]["version"]
            )
            _api_post(
                token_dispatcher,
                endpoint,
                {
                    "expectedShipmentVersion": restore_version,
                    "liftSiteId": original_lift_id,
                    "dropoffSiteId": original_dropoff_id,
                },
                f"visual-concurrent-restore-{target['containerId']}-{restore_version}",
            )
