"""Section 07 — M07 Lương, chấm công, kỷ luật (Payroll).

Covers: salary calculation (7.1), attendance calendar (7.2),
period close (7.3), penalties (7.4). Primary surface: /salary,
/config/salary-periods, /penalties, /my-payslips, /my-penalties.
"""
from __future__ import annotations

from visual.lib.runner import tc, VisualTestContext


# ─── 7.1 Salary calculation ───────────────────────────────────────────────

@tc("TC-M07-01-01", roles=["ACCOUNTANT"], url="/salary",
    title="M07-01-01 Salary page renders for accountant")
def tc_m07_01_01(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/salary")
    found = False
    for term in ["Lương", "Lái xe", "Kỳ", "Tháng", "Chấm công"]:
        try:
            ctx.page.wait_for_selector(f"text={term}", timeout=2000)
            found = True
            break
        except Exception:
            continue
    if not found:
        raise AssertionError("/salary did not render payroll labels")


@tc("TC-M07-01-01b-driver", roles=["DRIVER"], url="/my-payslips",
    title="M07-01-01b Driver payslip list renders")
def tc_m07_01_01b_driver(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/my-payslips")
    ctx.expect_url_contains("/my-payslips")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/my-payslips blank for driver")


@tc("TC-M07-01-04-forwarder", roles=["FORWARDER"], url="/salary",
    title="M07-01-04 RBAC — forwarder redirected from /salary")
def tc_m07_01_04_forwarder(ctx: VisualTestContext):
    ctx.login("FORWARDER")
    ctx.goto("/salary")
    ctx.expect_url_contains("/my-orders")


# ─── 7.2 Attendance ────────────────────────────────────────────────────────

@tc("TC-M07-02-01", roles=["ACCOUNTANT"], url="/salary",
    title="M07-02-01 Attendance calendar visible on /salary")
def tc_m07_02_01(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/salary")
    body = ctx.page.inner_text("body")
    # Calendar-ish content: day labels, color legend, day-type names.
    has_calendar = any(t in body for t in ["Chuyến", "Chờ việc", "Sửa xe", "Nghỉ",
                                            "T2", "T3", "Thứ", "CN", "Ngày"])
    if not has_calendar and len(body.strip()) < 100:
        raise AssertionError("no attendance content on /salary")


@tc("TC-M07-02-04-driver", roles=["DRIVER"], url="/salary",
    title="M07-02-04 RBAC — driver redirected from /salary")
def tc_m07_02_04_driver(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/salary")
    ctx.expect_url_contains("/my-trips")


@tc("TC-M07-02-04-customer", roles=["CUSTOMER"], url="/salary",
    title="M07-02-04 RBAC — customer redirected from /salary")
def tc_m07_02_04_customer(ctx: VisualTestContext):
    ctx.login("CUSTOMER")
    ctx.goto("/salary")
    ctx.expect_url_contains("/portal/")


# ─── 7.3 Period close ─────────────────────────────────────────────────────

@tc("TC-M07-03-01", roles=["MANAGER"], url="/config/salary-periods",
    title="M07-03-01 Salary period config page renders for manager")
def tc_m07_03_01(ctx: VisualTestContext):
    ctx.login("MANAGER")
    ctx.goto("/config/salary-periods")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/config/salary-periods blank for manager")


@tc("TC-M07-03-04-driver", roles=["DRIVER"], url="/config/salary-periods",
    title="M07-03-04 RBAC — driver redirected from /config/salary-periods")
def tc_m07_03_04_driver(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/config/salary-periods")
    ctx.expect_url_contains("/my-trips")


# ─── 7.4 Penalties ────────────────────────────────────────────────────────

@tc("TC-M07-04-01", roles=["ACCOUNTANT"], url="/penalties",
    title="M07-04-01 Penalties page renders for accountant")
def tc_m07_04_01(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/penalties")
    found = False
    for term in ["Phạt", "Kỷ luật", "Khấu trừ", "Lái xe", "Lý do"]:
        try:
            ctx.page.wait_for_selector(f"text={term}", timeout=2000)
            found = True
            break
        except Exception:
            continue
    if not found:
        raise AssertionError("/penalties did not render penalty labels")


@tc("TC-M07-04-04-driver-self", roles=["DRIVER"], url="/my-penalties",
    title="M07-04-04 Driver own-penalties page renders")
def tc_m07_04_04_driver_self(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/my-penalties")
    ctx.expect_url_contains("/my-penalties")


@tc("TC-M07-04-04-driver-block", roles=["DRIVER"], url="/penalties",
    title="M07-04-04 RBAC — driver redirected from admin /penalties")
def tc_m07_04_04_driver_block(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/penalties")
    ctx.expect_url_contains("/my-trips")


@tc("TC-M07-04-04-forwarder", roles=["FORWARDER"], url="/penalties",
    title="M07-04-04 RBAC — forwarder redirected from /penalties")
def tc_m07_04_04_forwarder(ctx: VisualTestContext):
    ctx.login("FORWARDER")
    ctx.goto("/penalties")
    ctx.expect_url_contains("/my-orders")
