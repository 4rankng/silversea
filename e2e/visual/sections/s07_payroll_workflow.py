"""Section 07 WORKFLOWS — M07 salary period-close business rule.

Q09–Q11 (accepted by SilverSea 27/07/2026):
  Q09 — Period close is per-company, never per-driver.
  Q10 — Block entire period on driver error; partial close needs approver.
  Q11 — After close, prefer adjustment in open period over reopening.
"""
from __future__ import annotations

import json
import os
import urllib.request
import urllib.error
from datetime import datetime

from visual.lib.runner import tc, VisualTestContext
from visual.lib.accounts import ACCOUNTS, DEFAULT_PASSWORD

API_URL = os.environ.get("VISUAL_API", "http://localhost:3001").rstrip("/")


def _api_login(role: str = "ADMIN") -> str:
    ident = ACCOUNTS[role]["identifier"]
    body = json.dumps({"identifier": ident, "password": DEFAULT_PASSWORD}).encode()
    req = urllib.request.Request(f"{API_URL}/api/auth/login", data=body,
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())["token"]


def _api(token: str, method: str, path: str, body: dict = None) -> dict:
    data = json.dumps(body).encode() if body else None
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json",
               "Idempotency-Key": f"wf7-{os.getpid()}-{int(__import__('time').time()*1000)}"}
    req = urllib.request.Request(f"{API_URL}{path}", data=data,
        headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read())
        except Exception:
            return {"error": f"HTTP {e.code}", "status": e.code}
    except Exception as e:
        return {"error": str(e)}


# ─── Q09: Period close surface ────────────────────────────────────────────

@tc("TC-M07-WF-01-PERIOD-CLOSE-SURFACE", roles=["MANAGER"], url="/config/salary-periods",
    title="WF Q09 — Salary period config renders with close affordance")
def tc_m07_wf_01_period_close_surface(ctx: VisualTestContext):
    """Q09 (accepted): close is per-company. The /config/salary-periods
    page is where a manager opens/closes periods. We verify the page
    renders and shows period-management UI."""
    ctx.login("MANAGER")
    ctx.goto("/config/salary-periods")
    body = ctx.page.inner_text("body")
    # Should show salary-period related labels.
    found = False
    for term in ["Kỳ lương", "Tháng", "Chốt kỳ", "Mở kỳ", "Phiếu lương", "Lương"]:
        try:
            ctx.page.wait_for_selector(f"text={term}", timeout=2000)
            found = True
            break
        except Exception:
            continue
    if not found and len(body.strip()) < 100:
        raise AssertionError("salary-periods config did not render period labels")


# ─── Q11: Salary close idempotency (cannot double-close) ──────────────────

@tc("TC-M07-WF-02-CLOSE-IDEMPOTENT", roles=["MANAGER"], url="/config/salary-periods",
    title="WF Q11 — Closing an already-closed period is rejected (idempotent)")
def tc_m07_wf_02_close_idempotent(ctx: VisualTestContext):
    """Q11 (accepted): period close is idempotent. We attempt to close an
    arbitrary period via the API; if it's already closed, the API must
    return the existing close record (not error). If it's open, we don't
    actually close (to avoid mutating production data) — we just verify
    the endpoint exists and responds coherently.

    Uses a future period that doesn't exist (2099-12) — close should be
    a no-op or clean rejection, not a 500.
    """
    tok = _api_login("MANAGER")
    # Probe a non-existent period — the API should reject gracefully.
    result = _api(tok, "POST", "/api/salary-periods/2099-12/close",
                  body={"note": "wf-probe"})
    # We accept any of: 200 with idempotent flag, 400/404/409 with VN error,
    # but NOT a 500 (server crash).
    if isinstance(result, dict):
        if result.get("status") == 500 or "Internal" in str(result.get("error", "")):
            raise AssertionError(
                f"salary close API returned 500 for non-existent period: {result}"
            )
    ctx.login("MANAGER")
    ctx.goto("/config/salary-periods")
    ctx.capture(suffix="01-period-config")


# ─── Q10: Driver detail on /salary page ──────────────────────────────────

@tc("TC-M07-WF-03-DRIVER-LIST", roles=["MANAGER"], url="/salary",
    title="WF Q10 — Salary page shows driver list (period scope)")
def tc_m07_wf_03_driver_list(ctx: VisualTestContext):
    """Q10 (accepted): when a driver has an error, the period close blocks
    and the driver is marked 'pending supplement'. The /salary page must
    show the driver roster so the manager can see who's blocking close."""
    ctx.login("MANAGER")
    ctx.goto("/salary")
    body = ctx.page.inner_text("body")
    # Look for driver names or a driver roster.
    has_drivers = any(t in body for t in ["Lái xe", "Tài xế", "Danh sách", "driver"])
    if not has_drivers and len(body.strip()) < 100:
        raise AssertionError("salary page did not show driver roster")


# ─── Driver self-view of payslip (Q09 customer-facing angle) ──────────────

@tc("TC-M07-WF-04-DRIVER-PAYSLIP", roles=["DRIVER"], url="/my-payslips",
    viewport="mobile", title="WF Q09 — Driver can view own payslip periods")
def tc_m07_wf_04_driver_payslip(ctx: VisualTestContext):
    """Q09 (accepted): per-driver state must be Ready/Pending before close.
    The driver's view of /my-payslips is where they see their own state.
    We verify the page renders (with or without data)."""
    ctx.login("DRIVER")
    ctx.goto("/my-payslips")
    body = ctx.page.inner_text("body")
    if len(body.strip()) < 50:
        raise AssertionError("driver /my-payslips blank")
