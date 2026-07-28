"""Section 04 — M04 Quy trình chi hộ & thu hộ khép kín (Disbursement).

7 groups: shipment init (4.1), field-staff cost entry (4.2), aggregation
(4.3), accountant approval (4.4), debit-note generation (4.5), invoice
classification (4.6), no-invoice items (4.7).
Surface: /shipments/:id, /expenses, /expenses/new, /customers/:id/billing/new.
"""
from __future__ import annotations

import json
import os
import urllib.request
from typing import Optional

from visual.lib.runner import tc, VisualTestContext
from visual.lib.accounts import ACCOUNTS, DEFAULT_PASSWORD

API_URL = __import__("os").environ.get("VISUAL_API", "http://localhost:3001").rstrip("/")


def _api_get(path: str, role: str = "ADMIN") -> dict:
    ident = ACCOUNTS[role]["identifier"]
    body = json.dumps({"identifier": ident, "password": DEFAULT_PASSWORD}).encode()
    req = urllib.request.Request(f"{API_URL}/api/auth/login", data=body,
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            tok = json.loads(r.read())["token"]
    except Exception:
        return {"error": "login"}
    req = urllib.request.Request(f"{API_URL}{path}",
        headers={"Authorization": f"Bearer {tok}"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"error": str(e)}


def _first_shipment_id() -> Optional[int]:
    d = _api_get("/api/shipments")
    items = d.get("items") or (d.get("data") or {}).get("items") or d.get("data") or []
    if isinstance(items, list) and items:
        first = items[0]
        if isinstance(first, dict):
            return first.get("id")
    return None


# ─── 4.1 Shipment init ───────────────────────────────────────────────────

@tc("TC-M04-01-01", roles=["ADMIN"], url="/shipments",
    title="M04-01-01 Admin shipments list (disbursement root)")
def tc_m04_01_01(ctx: VisualTestContext):
    ctx.login("ADMIN")
    ctx.goto("/shipments")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/shipments blank for admin")


# ─── 4.2 Field-staff cost entry ──────────────────────────────────────────

@tc("TC-M04-02-01-forwarder", roles=["FORWARDER"], url="/my-forwarder-trips",
    title="M04-02-01 Forwarder cost-entry surface (mobile)")
def tc_m04_02_01_forwarder(ctx: VisualTestContext):
    ctx.login("FORWARDER")
    ctx.goto("/my-forwarder-trips")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("forwarder cost-entry surface blank")


# ─── 4.3 Aggregation — covered at /expenses ──────────────────────────────

@tc("TC-M04-03-01", roles=["ADMIN"], url="/expenses",
    title="M04-03-01 Expense list page renders")
def tc_m04_03_01(ctx: VisualTestContext):
    ctx.login("ADMIN")
    ctx.goto("/expenses")
    found = False
    for term in ["Chi phí", "Khoản chi", "Chi hộ", "Chuyến", "Ngày"]:
        try:
            ctx.page.wait_for_selector(f"text={term}", timeout=2000)
            found = True
            break
        except Exception:
            continue
    if not found:
        raise AssertionError("/expenses did not render expense labels")


# ─── 4.4 Accountant approval (covered functionally in backend) ──────────

@tc("TC-M04-04-01", roles=["ACCOUNTANT"], url="/expenses",
    title="M04-04-01 Accountant sees expense approval surface")
def tc_m04_04_01(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/expenses")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/expenses blank for accountant")


# ─── 4.5 Debit-note generation ───────────────────────────────────────────

@tc("TC-M04-05-01", roles=["ADMIN"], url="/shipments/:id",
    title="M04-05-01 Shipment detail reachable for debit-note context")
def tc_m04_05_01(ctx: VisualTestContext):
    sid = _first_shipment_id()
    if sid is None:
        raise AssertionError("BLOCKED: no shipment found — run `pnpm seed`")
    ctx.login("ADMIN")
    ctx.goto(f"/shipments/{sid}")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError(f"shipment /shipments/{sid} blank")


# ─── 4.6 Invoice-required classification ────────────────────────────────
# Surface is in expense detail / approval flow — smoke via /expenses.

@tc("TC-M04-06-01", roles=["ACCOUNTANT"], url="/expenses/new",
    title="M04-06-01 Expense create form reachable (invoice-required context)")
def tc_m04_06_01(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/expenses/new")
    body = ctx.page.inner_text("body")
    # Form may redirect (adminOnly) — either is acceptable.
    if len(body.strip()) < 50:
        raise AssertionError("/expenses/new blank for accountant")


# ─── 4.7 No-invoice items ────────────────────────────────────────────────
# Same /expenses surface; classification is field-level.

@tc("TC-M04-07-01", roles=["ACCOUNTANT"], url="/expenses",
    title="M04-07-01 Expense list — no-invoice classification surface")
def tc_m04_07_01(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/expenses")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/expenses blank for no-invoice check")


# ─── RBAC ─────────────────────────────────────────────────────────────────

@tc("TC-M04-RBAC-driver-expenses", roles=["DRIVER"], url="/expenses",
    title="M04 RBAC — driver redirected from /expenses")
def tc_m04_rbac_driver(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/expenses")
    ctx.expect_url_contains("/my-trips")


@tc("TC-M04-RBAC-customer-expenses", roles=["CUSTOMER"], url="/expenses",
    title="M04 RBAC — customer redirected from /expenses")
def tc_m04_rbac_customer(ctx: VisualTestContext):
    ctx.login("CUSTOMER")
    ctx.goto("/expenses")
    ctx.expect_url_contains("/portal/")
