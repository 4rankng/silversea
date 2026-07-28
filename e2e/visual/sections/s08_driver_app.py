"""Section 08 — M08 Ứng dụng lái xe (Driver Mobile App).

6 groups: mobile UX (8.1), dispatch reception (8.2), two-orders view (8.3),
progress + cost (8.4), OCR container/seal (8.5), payslip (8.6).
All TCs use mobile viewport 375×667. Primary surface: /my-trips,
/my-trips/two-orders, /my-trips/:id, /my-earnings, /my-payslips,
/my-penalties.
"""
from __future__ import annotations

from visual.lib.runner import tc, VisualTestContext


def _assert_no_horizontal_scroll(ctx: VisualTestContext, max_width: int = 450):
    scroll_width = ctx.page.evaluate("document.body.scrollWidth")
    if scroll_width > max_width:
        raise AssertionError(
            f"mobile horizontal scroll: {scroll_width}px > {max_width}px max"
        )


# ─── 8.1 Driver mobile UX ─────────────────────────────────────────────────

@tc("TC-M08-01-01-trips", roles=["DRIVER"], url="/my-trips",
    viewport="mobile", title="M08-01-01 Driver trips mobile — no horizontal scroll")
def tc_m08_01_01_trips(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/my-trips")
    _assert_no_horizontal_scroll(ctx)
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("driver /my-trips blank")


@tc("TC-M08-01-01-earnings", roles=["DRIVER"], url="/my-earnings",
    viewport="mobile", title="M08-01-01 Driver earnings mobile — renders")
def tc_m08_01_01_earnings(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/my-earnings")
    _assert_no_horizontal_scroll(ctx)


@tc("TC-M08-01-01-payslips", roles=["DRIVER"], url="/my-payslips",
    viewport="mobile", title="M08-01-01 Driver payslips mobile — renders")
def tc_m08_01_01_payslips(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/my-payslips")
    _assert_no_horizontal_scroll(ctx)


@tc("TC-M08-01-01-penalties", roles=["DRIVER"], url="/my-penalties",
    viewport="mobile", title="M08-01-01 Driver penalties mobile — renders")
def tc_m08_01_01_penalties(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/my-penalties")
    _assert_no_horizontal_scroll(ctx)


# ─── 8.2 Dispatch reception (covered via /my-trips list) ─────────────────

@tc("TC-M08-02-01", roles=["DRIVER"], url="/my-trips",
    viewport="mobile", title="M08-02-01 Driver sees assigned trips (data-dependent)")
def tc_m08_02_01(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/my-trips")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("driver /my-trips blank")


# ─── 8.3 Two-orders view ─────────────────────────────────────────────────

@tc("TC-M08-03-01", roles=["DRIVER"], url="/my-trips/two-orders",
    viewport="mobile", title="M08-03-01 Driver two-orders view renders")
def tc_m08_03_01(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/my-trips/two-orders")
    _assert_no_horizontal_scroll(ctx)
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("driver /my-trips/two-orders blank")


# ─── 8.4 Progress + cost ─────────────────────────────────────────────────

@tc("TC-M08-04-01", roles=["DRIVER"], url="/my-trips",
    viewport="mobile", title="M08-04-01 Driver progress UI reachable")
def tc_m08_04_01(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/my-trips")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("driver /my-trips blank")


# ─── 8.5 OCR (camera) — UI gated to assigned trips only, smoke-test page ─

@tc("TC-M08-05-01", roles=["DRIVER"], url="/my-trips",
    viewport="mobile", title="M08-05-01 Driver trips list (OCR surface)")
def tc_m08_05_01(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/my-trips")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("driver trips list blank for OCR smoke")


# ─── 8.6 Payslip (mobile view) ───────────────────────────────────────────

@tc("TC-M08-06-01", roles=["DRIVER"], url="/my-payslips",
    viewport="mobile", title="M08-06-01 Driver payslip list (mobile)")
def tc_m08_06_01(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/my-payslips")
    found = False
    for term in ["Phiếu lương", "Kỳ", "Tháng", "Lương", "Tiền"]:
        try:
            ctx.page.wait_for_selector(f"text={term}", timeout=2000)
            found = True
            break
        except Exception:
            continue
    if not found:
        # Empty state is OK if the page renders.
        body = ctx.page.inner_text("body")
        if len(body.strip()) < 50:
            raise AssertionError("driver /my-payslips blank")


# ─── RBAC: other roles blocked from driver URLs ──────────────────────────

@tc("TC-M08-RBAC-admin-trips", roles=["ADMIN"], url="/my-trips",
    title="M08 RBAC — admin redirected from /my-trips to /dashboard")
def tc_m08_rbac_admin_trips(ctx: VisualTestContext):
    ctx.login("ADMIN")
    ctx.goto("/my-trips")
    ctx.expect_url_contains("/dashboard")


@tc("TC-M08-RBAC-customer-trips", roles=["CUSTOMER"], url="/my-trips",
    title="M08 RBAC — customer redirected from /my-trips")
def tc_m08_rbac_customer_trips(ctx: VisualTestContext):
    ctx.login("CUSTOMER")
    ctx.goto("/my-trips")
    ctx.expect_url_contains("/portal/")
