"""Section 10 — M10 Ứng dụng nhân viên chứng từ (CUS App).

3 groups: quick shipment create (10.1), document entry (10.2),
dispatch handoff (10.3). Mobile viewport. Primary surface:
/shipments/new, /clerk/shipments/:id/docs.

The canonical CUS fixture is used by default. A legacy CLERK fixture may be
configured explicitly only for a compatibility run.
"""
from __future__ import annotations

from visual.lib.runner import tc, VisualTestContext


def _assert_no_horizontal_scroll(ctx: VisualTestContext, max_width: int = 450):
    scroll_width = ctx.page.evaluate("document.body.scrollWidth")
    if scroll_width > max_width:
        raise AssertionError(
            f"mobile horizontal scroll: {scroll_width}px > {max_width}px max"
        )


# ─── 10.1 Quick shipment create ──────────────────────────────────────────

@tc("TC-M10-01-01", roles=["CUS"], url="/shipments/new",
    viewport="mobile", title="M10-01-01 CUS quick-create page renders")
def tc_m10_01_01(ctx: VisualTestContext):
    ctx.login("CUS")
    ctx.goto("/shipments/new")
    _assert_no_horizontal_scroll(ctx)
    found = False
    for term in ["Lô", "Khách hàng", "Tạo", "Shipment", "Mã lô", "BL"]:
        try:
            ctx.page.wait_for_selector(f"text={term}", timeout=2000)
            found = True
            break
        except Exception:
            continue
    if not found:
        raise AssertionError("/shipments/new did not render create labels")


# ─── 10.2 Document entry ─────────────────────────────────────────────────

@tc("TC-M10-02-01", roles=["CUS"], url="/shipments/new",
    viewport="mobile", title="M10-02-01 CUS doc-entry surface reachable")
def tc_m10_02_01(ctx: VisualTestContext):
    ctx.login("CUS")
    ctx.goto("/shipments/new")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/shipments/new blank for doc-entry")


# ─── 10.3 Dispatch handoff ───────────────────────────────────────────────

@tc("TC-M10-03-01", roles=["CUS"], url="/shipments",
    title="M10-03-01 CUS shipments list reachable (handoff context)")
def tc_m10_03_01(ctx: VisualTestContext):
    ctx.login("CUS")
    ctx.goto("/shipments")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/shipments blank for clerk")


# ─── RBAC: other roles blocked from clerk URLs ──────────────────────────

@tc("TC-M10-RBAC-driver", roles=["DRIVER"], url="/shipments/new",
    title="M10 RBAC — driver redirected from clerk create")
def tc_m10_rbac_driver(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/shipments/new")
    ctx.expect_url_contains("/my-trips")


@tc("TC-M10-RBAC-customer", roles=["CUSTOMER"], url="/shipments/new",
    title="M10 RBAC — customer redirected from clerk create")
def tc_m10_rbac_customer(ctx: VisualTestContext):
    ctx.login("CUSTOMER")
    ctx.goto("/shipments/new")
    ctx.expect_url_contains("/portal/")
