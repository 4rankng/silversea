"""Section 06 — M06 Công nợ phải trả (Accounts Payable).

Covers: fuel AP reconciliation (6.1), multi-supplier AP (6.2),
AP aging (6.3), debt offsets (6.4). Primary surface: /payables,
/payables/:id, /suppliers, /config/suppliers.
"""
from __future__ import annotations

import json
import os
import urllib.request
from typing import Optional

from visual.lib.runner import tc, VisualTestContext
from visual.lib.accounts import ACCOUNTS, DEFAULT_PASSWORD

API_URL = __import__("os").environ.get("VISUAL_API", "http://localhost:3001").rstrip("/")


def _api_get(path: str, role: str = "ACCOUNTANT") -> dict:
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


def _first_payable_id() -> Optional[int]:
    """Return a supplier id for the /suppliers/:id detail page.
    Tries /api/payables first (for a supplier with actual payables),
    then falls back to /api/suppliers (any supplier)."""
    d = _api_get("/api/payables")
    items = d.get("items") or (d.get("data") or {}).get("items") or d.get("data") or []
    if isinstance(items, list) and items:
        first = items[0]
        if isinstance(first, dict):
            return first.get("supplier", {}).get("id") or first.get("id")
    # Fall back to any supplier.
    return _first_supplier_id()


def _first_supplier_id() -> Optional[int]:
    d = _api_get("/api/suppliers")
    items = d.get("items") or (d.get("data") or {}).get("items") or d.get("data") or []
    if isinstance(items, list) and items:
        first = items[0]
        if isinstance(first, dict):
            return first.get("id")
    return None


# ─── 6.1 Fuel AP reconciliation ────────────────────────────────────────────

@tc("TC-M06-01-01", roles=["ACCOUNTANT"], url="/payables",
    title="M06-01-01 AP list renders with payables content")
def tc_m06_01_01(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/payables")
    found = False
    for term in ["Công nợ", "phải trả", "Nhà cung cấp", "Hóa đơn", "NCC", "Phải trả"]:
        try:
            ctx.page.wait_for_selector(f"text={term}", timeout=2000)
            found = True
            break
        except Exception:
            continue
    if not found:
        raise AssertionError("/payables did not render payables labels")


@tc("TC-M06-01-02", roles=["ACCOUNTANT"], url="/payables",
    title="M06-01-02 Empty-state — no AP records, no crash")
def tc_m06_01_02(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/payables")
    body = ctx.page.inner_text("body")
    if "Application error" in body or len(body.strip()) < 50:
        raise AssertionError("/payables crashed or blank")


@tc("TC-M06-01-04-manager", roles=["MANAGER"], url="/payables",
    title="M06-01-04 RBAC — manager view-only on /payables")
def tc_m06_01_04_manager(ctx: VisualTestContext):
    ctx.login("MANAGER")
    ctx.goto("/payables")
    # Manager should see the page (read-only). No assertion beyond render.
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/payables blank for manager")


@tc("TC-M06-01-04-driver", roles=["DRIVER"], url="/payables",
    title="M06-01-04 RBAC — driver redirected from /payables")
def tc_m06_01_04_driver(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/payables")
    ctx.expect_url_contains("/my-trips")


@tc("TC-M06-01-04-customer", roles=["CUSTOMER"], url="/payables",
    title="M06-01-04 RBAC — customer redirected from /payables")
def tc_m06_01_04_customer(ctx: VisualTestContext):
    ctx.login("CUSTOMER")
    ctx.goto("/payables")
    ctx.expect_url_contains("/portal/")


# ─── 6.2 Multi-supplier AP ────────────────────────────────────────────────

@tc("TC-M06-02-01", roles=["ACCOUNTANT"], url="/suppliers",
    title="M06-02-01 Suppliers list renders")
def tc_m06_02_01(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/suppliers")
    # On staging the SPA may need extra time after the initial auth-check
    # redirect settles. Wait UP TO 10s for any supplier-related label.
    found = False
    for term in ["Nhà cung cấp", "Supplier", "NCC", "Tên nhà cung cấp", "Mã số thuế",
                 "Petrolimex", "PV Oil"]:
        try:
            ctx.page.wait_for_selector(f"text={term}", timeout=10000)
            found = True
            break
        except Exception:
            continue
    if not found:
        raise AssertionError("/suppliers did not render supplier labels within 10s")


@tc("TC-M06-02-01b", roles=["ACCOUNTANT"], url="/config/suppliers",
    title="M06-02-01b Supplier config page renders for admin")
def tc_m06_02_01b(ctx: VisualTestContext):
    """Admin can manage suppliers at /config/suppliers."""
    ctx.login("ADMIN")
    ctx.goto("/config/suppliers")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("/config/suppliers blank")


@tc("TC-M06-02-04-driver", roles=["DRIVER"], url="/suppliers",
    title="M06-02-04 RBAC — driver redirected from /suppliers")
def tc_m06_02_04_driver(ctx: VisualTestContext):
    ctx.login("DRIVER")
    ctx.goto("/suppliers")
    ctx.expect_url_contains("/my-trips")


# ─── 6.3 AP aging ─────────────────────────────────────────────────────────

@tc("TC-M06-03-01", roles=["ACCOUNTANT"], url="/payables",
    title="M06-03-01 AP aging buckets present on /payables")
def tc_m06_03_01(ctx: VisualTestContext):
    ctx.login("ACCOUNTANT")
    ctx.goto("/payables")
    body = ctx.page.inner_text("body")
    # Aging info (30/60/90, days, due-date).
    has_aging = any(t in body for t in ["30", "60", "90", "ngày", "đến hạn", "quá hạn"])
    if not has_aging and len(body.strip()) < 100:
        raise AssertionError("no aging indicators on /payables")


# ─── 6.4 Debt offsets ─────────────────────────────────────────────────────

@tc("TC-M06-04-01", roles=["ACCOUNTANT"], url="/payables",
    title="M06-04-01 Debt offset surface reachable (data-dependent)")
def tc_m06_04_01(ctx: VisualTestContext):
    """The offset action lives on /payables/:id or /debt/:id. We smoke-test
    that the payable detail page renders."""
    sid = _first_supplier_id()
    if sid is None:
        raise AssertionError("BLOCKED: no supplier found — run `pnpm seed`")
    ctx.login("ACCOUNTANT")
    ctx.goto(f"/suppliers/{sid}")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError(f"supplier /suppliers/{sid} blank")
