"""Section 10 — M10 Ứng dụng nhân viên chứng từ (Clerk App).

3 groups: quick shipment create (10.1), document entry (10.2),
dispatch handoff (10.3). Mobile viewport. Primary surface:
/clerk/shipments/new, /clerk/shipments/:id/docs.

An exact CLERK fixture is mandatory. Configure VISUAL_CLERK_IDENTIFIER when
the environment does not use the default ``clerk`` identifier; the runner
fails preflight on a missing account or role mismatch.
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

@tc("TC-M10-01-01", roles=["CLERK"], url="/clerk/shipments/new",
    viewport="mobile", title="M10-01-01 Clerk quick-create page renders")
def tc_m10_01_01(ctx: VisualTestContext):
    ctx.login("CLERK")
    ctx.goto("/clerk/shipments/new")
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
        raise AssertionError("/clerk/shipments/new did not render create labels")


# ─── 10.2 Document entry ─────────────────────────────────────────────────

@tc("TC-M10-02-01", roles=["CLERK"], url="/clerk/shipments/new",
    viewport="mobile", title="M10-02-01 Clerk doc-entry surface reachable")
def tc_m10_02_01(ctx: VisualTestContext):
    ctx.login("CLERK")
    ctx.goto("/clerk/shipments/new")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/clerk/shipments/new blank for doc-entry")


# ─── 10.3 Dispatch handoff ───────────────────────────────────────────────

@tc("TC-M10-03-01", roles=["CLERK"], url="/shipments",
    title="M10-03-01 Clerk shipments list reachable (handoff context)")
def tc_m10_03_01(ctx: VisualTestContext):
    ctx.login("CLERK")
    ctx.goto("/shipments")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/shipments blank for clerk")


# ─── RBAC: other roles blocked from clerk URLs ──────────────────────────

@tc("TC-M10-RBAC-driver", roles=["DRIVER"], url="/clerk/shipments/new",
    title="M10 RBAC — driver redirected from clerk create")
def tc_m10_rbac_driver(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/clerk/shipments/new")
    ctx.expect_url_contains("/my-trips")


@tc("TC-M10-RBAC-customer", roles=["CUSTOMER"], url="/clerk/shipments/new",
    title="M10 RBAC — customer redirected from clerk create")
def tc_m10_rbac_customer(ctx: VisualTestContext):
    ctx.login("CUSTOMER")
    ctx.goto("/clerk/shipments/new")
    ctx.expect_url_contains("/portal/")
