"""Section 09 — M09 Ứng dụng nhân viên hiện trường (Forwarder/Field App).

5 groups: advance/disbursement (9.1), shipment cost entry (9.2),
lift-price suggestion (9.3), aggregation (9.4), document photos (9.5).
All mobile viewport. Primary surface: /my-forwarder-trips,
/my-forwarder-trips/:id, /my-advances, /my-settlements,
/my-settlements/new.
"""
from __future__ import annotations

from visual.lib.runner import tc, VisualTestContext


def _assert_no_horizontal_scroll(ctx: VisualTestContext, max_width: int = 450):
    scroll_width = ctx.page.evaluate("document.body.scrollWidth")
    if scroll_width > max_width:
        raise AssertionError(
            f"mobile horizontal scroll: {scroll_width}px > {max_width}px max"
        )


# ─── 9.1 Advance & disbursement ──────────────────────────────────────────

@tc("TC-M09-01-01-trips", roles=["FORWARDER"], url="/my-forwarder-trips",
    viewport="mobile", title="M09-01-01 Forwarder trips mobile — renders")
def tc_m09_01_01_trips(ctx: VisualTestContext):
    ctx.login("FORWARDER")
    ctx.goto("/my-forwarder-trips")
    _assert_no_horizontal_scroll(ctx)
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("forwarder /my-forwarder-trips blank")


@tc("TC-M09-01-01-advances", roles=["FORWARDER"], url="/my-advances",
    viewport="mobile", title="M09-01-01 Forwarder advances mobile — renders")
def tc_m09_01_01_advances(ctx: VisualTestContext):
    ctx.login("FORWARDER")
    ctx.goto("/my-advances")
    _assert_no_horizontal_scroll(ctx)


# ─── 9.2 Shipment cost entry (via settlement create) ────────────────────

@tc("TC-M09-02-01", roles=["FORWARDER"], url="/my-settlements/new",
    viewport="mobile", title="M09-02-01 Forwarder settlement create form (mobile)")
def tc_m09_02_01(ctx: VisualTestContext):
    ctx.login("FORWARDER")
    ctx.goto("/my-settlements/new")
    _assert_no_horizontal_scroll(ctx)
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("forwarder /my-settlements/new blank")


# ─── 9.4 Settlement list / aggregation ───────────────────────────────────

@tc("TC-M09-04-01", roles=["FORWARDER"], url="/my-settlements",
    viewport="mobile", title="M09-04-01 Forwarder settlements list (mobile)")
def tc_m09_04_01(ctx: VisualTestContext):
    ctx.login("FORWARDER")
    ctx.goto("/my-settlements")
    _assert_no_horizontal_scroll(ctx)


# ─── 9.5 Photos (UI gated to assigned trips) ─────────────────────────────

@tc("TC-M09-05-01", roles=["FORWARDER"], url="/my-forwarder-trips",
    viewport="mobile", title="M09-05-01 Forwarder trips list (photo surface)")
def tc_m09_05_01(ctx: VisualTestContext):
    ctx.login("FORWARDER")
    ctx.goto("/my-forwarder-trips")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("forwarder trips blank for photo smoke")


# ─── RBAC: other roles blocked from forwarder URLs ───────────────────────

@tc("TC-M09-RBAC-admin", roles=["ADMIN"], url="/my-forwarder-trips",
    title="M09 RBAC — admin redirected from /my-forwarder-trips")
def tc_m09_rbac_admin(ctx: VisualTestContext):
    ctx.login("ADMIN")
    ctx.goto("/my-forwarder-trips")
    ctx.expect_url_contains("/dashboard")


@tc("TC-M09-RBAC-driver", roles=["DRIVER"], url="/my-forwarder-trips",
    title="M09 RBAC — driver redirected from /my-forwarder-trips")
def tc_m09_rbac_driver(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/my-forwarder-trips")
    ctx.expect_url_contains("/my-trips")


@tc("TC-M09-RBAC-customer", roles=["CUSTOMER"], url="/my-forwarder-trips",
    title="M09 RBAC — customer redirected from /my-forwarder-trips")
def tc_m09_rbac_customer(ctx: VisualTestContext):
    ctx.login("CUSTOMER")
    ctx.goto("/my-forwarder-trips")
    ctx.expect_url_contains("/portal/")
