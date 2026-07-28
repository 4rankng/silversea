"""Section 02 — M02 Báo giá cước & Doanh thu phi VT (Pricing & Revenue).

Covers 5 groups: fixed pricing (2.1), weight-tier pricing (2.2),
auto-revenue (2.3), lift catalog (2.4), ancillary revenue (2.5).
Surface: /config/pricing-tables, /config/weight-pricing-tiers,
/config/lift-pricing, /config/ancillary-revenue.
"""
from __future__ import annotations

from visual.lib.runner import tc, VisualTestContext


# ─── 2.1 Fixed pricing ────────────────────────────────────────────────────

@tc("TC-M02-01-01", roles=["ACCOUNTANT"], url="/config/pricing-tables",
    title="M02-01-01 Pricing tables config page renders for accountant")
def tc_m02_01_01(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/config/pricing-tables")
    found = False
    for term in ["Bảng giá", "Cước", "Khách hàng", "Tuyến", "Giá"]:
        try:
            ctx.page.wait_for_selector(f"text={term}", timeout=2000)
            found = True
            break
        except Exception:
            continue
    if not found:
        raise AssertionError("/config/pricing-tables did not render pricing labels")


@tc("TC-M02-01-02", roles=["ACCOUNTANT"], url="/config/pricing-tables",
    title="M02-01-02 Empty-state — pricing page doesn't crash")
def tc_m02_01_02(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/config/pricing-tables")
    body = ctx.page.inner_text("body")
    if "Application error" in body or len(body.strip()) < 50:
        raise AssertionError("pricing tables crashed/blank")


@tc("TC-M02-01-04-driver", roles=["DRIVER"], url="/config/pricing-tables",
    title="M02-01-04 RBAC — driver redirected from pricing config")
def tc_m02_01_04_driver(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/config/pricing-tables")
    ctx.expect_url_contains("/my-trips")


@tc("TC-M02-01-04-customer", roles=["CUSTOMER"], url="/config/pricing-tables",
    title="M02-01-04 RBAC — customer redirected from pricing config")
def tc_m02_01_04_customer(ctx: VisualTestContext):
    ctx.login("CUSTOMER")
    ctx.goto("/config/pricing-tables")
    ctx.expect_url_contains("/portal/")


# ─── 2.2 Weight-tier pricing ─────────────────────────────────────────────

@tc("TC-M02-02-01", roles=["ACCOUNTANT"], url="/config/weight-pricing-tiers",
    title="M02-02-01 Weight-pricing-tiers config renders")
def tc_m02_02_01(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/config/weight-pricing-tiers")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/config/weight-pricing-tiers blank")


@tc("TC-M02-02-02", roles=["ACCOUNTANT"], url="/config/weight-pricing-tiers",
    title="M02-02-02 Validation surface — page renders stable")
def tc_m02_02_02(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/config/weight-pricing-tiers")
    body = ctx.page.inner_text("body")
    if "Application error" in body:
        raise AssertionError("weight-pricing-tiers crashed")


# ─── 2.3 Auto-revenue (covered at /trips/:id; covered in s01) ────────────
# Skipped — auto-revenue is asserted at trip detail, already in s01.

# ─── 2.4 Lift catalog ─────────────────────────────────────────────────────

@tc("TC-M02-04-01", roles=["ACCOUNTANT"], url="/config/lift-pricing",
    title="M02-04-01 Lift pricing config page renders")
def tc_m02_04_01(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/config/lift-pricing")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/config/lift-pricing blank")


@tc("TC-M02-04-02", roles=["ACCOUNTANT"], url="/config/lift-pricing",
    title="M02-04-02 Lift pricing validation — page renders stable")
def tc_m02_04_02(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/config/lift-pricing")
    body = ctx.page.inner_text("body")
    if "Application error" in body:
        raise AssertionError("lift-pricing crashed")


# ─── 2.5 Ancillary revenue ────────────────────────────────────────────────

@tc("TC-M02-05-01", roles=["ACCOUNTANT"], url="/config/ancillary-revenue",
    title="M02-05-01 Ancillary revenue config page renders")
def tc_m02_05_01(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/config/ancillary-revenue")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/config/ancillary-revenue blank")


@tc("TC-M02-05-04-driver", roles=["DRIVER"], url="/config/ancillary-revenue",
    title="M02-05-04 RBAC — driver redirected from ancillary-revenue")
def tc_m02_05_04_driver(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/config/ancillary-revenue")
    ctx.expect_url_contains("/my-trips")


@tc("TC-M02-05-04-customer", roles=["CUSTOMER"], url="/config/ancillary-revenue",
    title="M02-05-04 RBAC — customer redirected from ancillary-revenue")
def tc_m02_05_04_customer(ctx: VisualTestContext):
    ctx.login("CUSTOMER")
    ctx.goto("/config/ancillary-revenue")
    ctx.expect_url_contains("/portal/")
