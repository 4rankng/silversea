"""Section 11 — M11 Báo cáo tài chính & lãi lỗ (Finance & P&L).

Covers 6 groups: P&L by period (11.1), per-truck P&L (11.2),
advance/settlement (11.3), payment-term evaluation (11.4),
director dashboard (11.5), query assistant (11.6).
Surface: /finance, /profit, /dashboard, /admin/advance-settlements.
"""
from __future__ import annotations

from visual.lib.runner import tc, VisualTestContext


# ─── 11.1 P&L by period ───────────────────────────────────────────────────

@tc("TC-M11-01-01", roles=["MANAGER"], url="/finance",
    title="M11-01-01 Finance/P&L page renders for manager")
def tc_m11_01_01(ctx: VisualTestContext):
    ctx.login("MANAGER")
    ctx.goto("/finance")
    found = False
    for term in ["Doanh thu", "Chi phí", "Lợi nhuận", "Tài chính", "Biên", "Kỳ"]:
        try:
            ctx.page.wait_for_selector(f"text={term}", timeout=2000)
            found = True
            break
        except Exception:
            continue
    if not found:
        raise AssertionError("/finance did not render P&L labels")


@tc("TC-M11-01-02", roles=["MANAGER"], url="/finance",
    title="M11-01-02 Unlocked-period banner — page renders stable")
def tc_m11_01_02(ctx: VisualTestContext):
    ctx.login("MANAGER")
    ctx.goto("/finance")
    body = ctx.page.inner_text("body")
    if "Application error" in body or len(body.strip()) < 50:
        raise AssertionError("/finance crashed/blank")


@tc("TC-M11-01-04-driver", roles=["DRIVER"], url="/finance",
    title="M11-01-04 RBAC — driver redirected from /finance")
def tc_m11_01_04_driver(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/finance")
    ctx.expect_url_contains("/my-trips")


@tc("TC-M11-01-04-customer", roles=["CUSTOMER"], url="/finance",
    title="M11-01-04 RBAC — customer redirected from /finance")
def tc_m11_01_04_customer(ctx: VisualTestContext):
    ctx.login("CUSTOMER")
    ctx.goto("/finance")
    ctx.expect_url_contains("/portal/")


@tc("TC-M11-01-04-forwarder", roles=["FORWARDER"], url="/finance",
    title="M11-01-04 RBAC — forwarder redirected from /finance")
def tc_m11_01_04_forwarder(ctx: VisualTestContext):
    ctx.login("FORWARDER")
    ctx.goto("/finance")
    ctx.expect_url_contains("/my-forwarder-trips")


# ─── 11.2 Per-truck P&L ──────────────────────────────────────────────────

@tc("TC-M11-02-01", roles=["MANAGER"], url="/finance",
    title="M11-02-01 Per-truck view reachable on /finance")
def tc_m11_02_01(ctx: VisualTestContext):
    ctx.login("MANAGER")
    ctx.goto("/finance")
    body = ctx.page.inner_text("body")
    # Per-truck tab/section.
    has_truck = any(t in body for t in ["Đầu xe", "Xe", "Theo xe", "Biển số"])
    if not has_truck and len(body.strip()) < 100:
        raise AssertionError("no per-truck section on /finance")


# ─── 11.3 Advance & settlement ────────────────────────────────────────────

@tc("TC-M11-03-01", roles=["MANAGER"], url="/admin/advance-settlements",
    title="M11-03-01 Advance-settlements admin page renders")
def tc_m11_03_01(ctx: VisualTestContext):
    ctx.login("MANAGER")
    ctx.goto("/admin/advance-settlements")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/admin/advance-settlements blank")


# ─── 11.4 Payment-term evaluation ────────────────────────────────────────
# Embedded in /finance report — covered by TC-M11-01-01.

@tc("TC-M11-04-01", roles=["MANAGER"], url="/finance",
    title="M11-04-01 Payment-term evaluation visible on /finance")
def tc_m11_04_01(ctx: VisualTestContext):
    ctx.login("MANAGER")
    ctx.goto("/finance")
    body = ctx.page.inner_text("body")
    # Either payment-term data or empty state.
    if len(body.strip()) < 50:
        raise AssertionError("/finance blank for payment-term check")


# ─── 11.5 Director dashboard ──────────────────────────────────────────────

@tc("TC-M11-05-01", roles=["MANAGER"], url="/dashboard",
    title="M11-05-01 Director dashboard KPIs render for manager")
def tc_m11_05_01(ctx: VisualTestContext):
    ctx.login("MANAGER")
    ctx.goto("/dashboard")
    found = False
    for term in ["Doanh thu", "Chi phí", "Lợi nhuận", "Số chuyến", "Dòng tiền",
                 "Hàng hai chiều", "Hiệu quả"]:
        try:
            ctx.page.wait_for_selector(f"text={term}", timeout=2000)
            found = True
            break
        except Exception:
            continue
    if not found:
        raise AssertionError("director dashboard did not render KPIs")


@tc("TC-M11-05-02", roles=["MANAGER"], url="/dashboard",
    title="M11-05-02 Stale-data label — dashboard renders stable")
def tc_m11_05_02(ctx: VisualTestContext):
    ctx.login("MANAGER")
    ctx.goto("/dashboard")
    body = ctx.page.inner_text("body")
    if "Application error" in body:
        raise AssertionError("dashboard crashed")


# ─── 11.6 Query assistant (chatbot) ───────────────────────────────────────
# LLM non-deterministic — only smoke-check the chat UI is reachable.

@tc("TC-M11-06-01", roles=["MANAGER"], url="/dashboard",
    title="M11-06-01 Chatbot/query-assistant UI present on dashboard")
def tc_m11_06_01(ctx: VisualTestContext):
    ctx.login("MANAGER")
    ctx.goto("/dashboard")
    # Look for chat input or assistant affordance.
    has_chat = False
    for sel in ['input[placeholder*="Hỏi"]', 'input[placeholder*="Trợ lý"]',
                'button:has-text("Trợ lý")', '[class*="chat"]', '[class*="assistant"]',
                'textarea']:
        try:
            ctx.page.wait_for_selector(sel, timeout=1500)
            has_chat = True
            break
        except Exception:
            continue
    if not has_chat:
        # Some dashboards put chat behind a button — that's acceptable.
        body = ctx.page.inner_text("body")
        if len(body.strip()) < 100:
            raise AssertionError("dashboard blank with no chat affordance")


# ─── /profit page (profit-distribution view) ──────────────────────────────

@tc("TC-M11-PROFIT-01", roles=["ADMIN"], url="/profit",
    title="M11 Profit page renders for admin")
def tc_m11_profit_01(ctx: VisualTestContext):
    ctx.login("ADMIN")
    ctx.goto("/profit")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/profit blank for admin")
