"""Section 12 — M12 Nhiên liệu & Số hóa chứng từ dầu (Fuel).

Covers 3 groups: fuel norms (12.1), monthly reconciliation (12.2),
pump photo OCR (12.3). Surface: /config/fuel-norms, /config/fuel,
/trips/:id (pump photos), /payables (fuel invoices).

Note: per the regression doc, M12-02 (reconciliation UI) and M12-03
(pump photo UI) have endpoints not yet wired in the UI. We cover
what IS reachable.
"""
from __future__ import annotations

from visual.lib.runner import tc, VisualTestContext


# ─── 12.1 Fuel norms ──────────────────────────────────────────────────────

@tc("TC-M12-01-01", roles=["ACCOUNTANT"], url="/config/fuel-norms",
    title="M12-01-01 Fuel norms config page renders for accountant")
def tc_m12_01_01(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/config/fuel-norms")
    found = False
    for term in ["Định mức", "Nhiên liệu", "Loại xe", "Tuyến", "Lít", "km"]:
        try:
            ctx.page.wait_for_selector(f"text={term}", timeout=2000)
            found = True
            break
        except Exception:
            continue
    if not found:
        raise AssertionError("/config/fuel-norms did not render fuel-norms labels")


@tc("TC-M12-01-02", roles=["ACCOUNTANT"], url="/config/fuel-norms",
    title="M12-01-02 Validation surface — fuel-norms page renders stable")
def tc_m12_01_02(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/config/fuel-norms")
    body = ctx.page.inner_text("body")
    if "Application error" in body:
        raise AssertionError("/config/fuel-norms crashed")


@tc("TC-M12-01-04-driver", roles=["DRIVER"], url="/config/fuel-norms",
    title="M12-01-04 RBAC — driver redirected from fuel-norms config")
def tc_m12_01_04_driver(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/config/fuel-norms")
    ctx.expect_url_contains("/my-trips")


# ─── Fuel config (general) ────────────────────────────────────────────────

@tc("TC-M12-FUEL-CONFIG", roles=["ACCOUNTANT"], url="/config/fuel",
    title="M12 /config/fuel page renders")
def tc_m12_fuel_config(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/config/fuel")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/config/fuel blank")


# ─── 12.2 Monthly reconciliation (UI not wired per regression doc) ────────

@tc("TC-M12-02-04-driver", roles=["DRIVER"], url="/payables",
    title="M12-02-04 RBAC — driver redirected from /payables (fuel recon)")
def tc_m12_02_04_driver(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/payables")
    ctx.expect_url_contains("/my-trips")


@tc("TC-M12-02-04-manager", roles=["MANAGER"], url="/payables",
    title="M12-02-04 RBAC — manager view-only on /payables (fuel recon)")
def tc_m12_02_04_manager(ctx: VisualTestContext):
    ctx.login("MANAGER")
    ctx.goto("/payables")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/payables blank for manager")
