"""Section 98 WORKFLOWS — Export verification (Excel/PDF download handlers).

Automates the regression-doc TCs that were marked MANUAL because they
require downloading and inspecting exported files. Playwright's
`expect_download()` + `download.path()` lets us capture the file and
assert basic properties (non-empty, valid xlsx/pdf file signatures).
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

from visual.lib.runner import tc, VisualTestContext, ApiLogin, API_URL
from visual.lib.accounts import ACCOUNTS, DEFAULT_PASSWORD
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError


def _get_first_customer_id() -> int | None:
    """Get the first customer id without disguising auth/API failures as missing seed data."""
    login_result = ApiLogin().login(
        ACCOUNTS["ACCOUNTANT"]["identifier"],
        DEFAULT_PASSWORD,
    )
    tok = login_result.get("token")
    if not tok:
        raise AssertionError(
            f"customer lookup authentication failed: {login_result.get('error') or login_result}"
        )
    req = urllib.request.Request(
        f"{API_URL}/api/customers?pageSize=1",
        headers={"Authorization": f"Bearer {tok}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            d = json.loads(r.read())
            items = d.get("items", [])
            return items[0]["id"] if items else None
    except urllib.error.HTTPError as exc:
        raise AssertionError(
            f"customer lookup API returned HTTP {exc.code}"
        ) from exc
    except Exception as exc:
        raise AssertionError(f"customer lookup API failed: {exc}") from exc


def _find_export_control(
    ctx: VisualTestContext,
    selectors: list[str],
    *,
    surface: str,
    optional: bool = False,
) -> str:
    """Return the first visible export control or raise a non-passing result."""
    for selector in selectors:
        try:
            ctx.page.wait_for_selector(selector, state="visible", timeout=1500)
            return selector
        except PlaywrightTimeoutError:
            continue

    if optional:
        raise AssertionError(
            f"BLOCKED: optional capability not exposed: {surface}"
        )
    raise AssertionError(f"required export control not found: {surface}")


def _login_for_required_export(ctx: VisualTestContext, role: str) -> None:
    """Make authentication a required acceptance condition for export flows."""
    try:
        ctx.login(role)
    except Exception as exc:
        raise AssertionError(f"{role} export authentication failed: {exc}") from exc


def _download_and_assert(
    ctx: VisualTestContext,
    control: str,
    *,
    extension: str,
    magic: bytes,
    description: str,
) -> int:
    """Trigger a required download and validate that the resulting file is real."""
    try:
        with ctx.page.expect_download(timeout=15000) as download_info:
            ctx.page.click(control, timeout=15000)
        download = download_info.value
    except PlaywrightTimeoutError as exc:
        raise AssertionError(
            f"{description} did not trigger a download within 15 seconds"
        ) from exc

    failure = download.failure()
    if failure:
        raise AssertionError(f"{description} download failed: {failure}")

    out_path = ctx.run_dir / f"{ctx.tc_id}.{extension}"
    try:
        download.save_as(str(out_path))
    except Exception as exc:
        raise AssertionError(
            f"{description} download could not be saved: {exc}"
        ) from exc

    if not out_path.is_file():
        raise AssertionError(f"{description} download file is missing")

    size = out_path.stat().st_size
    if size < 1000:
        raise AssertionError(
            f"{description} download is too small: {size} bytes"
        )
    with out_path.open("rb") as downloaded_file:
        actual_magic = downloaded_file.read(len(magic))
    if actual_magic != magic:
        raise AssertionError(
            f"{description} download has invalid file signature: {actual_magic!r}"
        )
    return size


# ─── Customer statement Excel export (/customers/:id) ────────────────────

@tc("TC-EXPORT-XLSX-DEBT", roles=["ACCOUNTANT"], url="/customers/:id",
    title="Export — customer statement Excel downloads successfully")
def tc_export_xlsx_debt(ctx: VisualTestContext):
    """Click 'Xuất sao kê' on /customers/:id and verify the xlsx downloads.
    Verifies: file is non-empty + has xlsx magic bytes (PK zip header)."""
    cid = _get_first_customer_id()
    if cid is None:
        raise AssertionError("BLOCKED: no customer found for export test")

    _login_for_required_export(ctx, "ACCOUNTANT")
    ctx.goto(f"/customers/{cid}")
    control = _find_export_control(
        ctx,
        ['button:has-text("Xuất sao kê")'],
        surface="/customers/:id customer-statement XLSX",
    )
    size = _download_and_assert(
        ctx,
        control,
        extension="xlsx",
        magic=b"PK",
        description="customer-statement XLSX",
    )
    ctx.detail = f"xlsx downloaded OK ({size} bytes)"


# ─── Customer statement PDF export ───────────────────────────────────────

@tc("TC-EXPORT-PDF-DEBT", roles=["ACCOUNTANT"], url="/customers/:id",
    title="Optional capability discovery — debt-detail PDF export")
def tc_export_pdf_debt(ctx: VisualTestContext):
    """Discover and validate a debt-detail PDF control if the optional UI exists."""
    cid = _get_first_customer_id()
    if cid is None:
        raise AssertionError("BLOCKED: no customer found")

    ctx.login("ACCOUNTANT")
    ctx.goto(f"/customers/{cid}")
    control = _find_export_control(
        ctx,
        ['button:has-text("PDF")', 'a:has-text("PDF")', '[data-tour-id*="pdf"]'],
        surface="/customers/:id debt-detail PDF",
        optional=True,
    )
    size = _download_and_assert(
        ctx,
        control,
        extension="pdf",
        magic=b"%PDF",
        description="optional debt-detail PDF",
    )
    ctx.detail = f"pdf downloaded OK ({size} bytes)"


# ─── Customer portal statement export (CUSTOMER role) ───────────────────

@tc("TC-EXPORT-PORTAL-STATEMENT", roles=["CUSTOMER"], url="/portal/statement",
    title="Export — customer portal XLSX and PDF download successfully")
def tc_export_portal_statement(ctx: VisualTestContext):
    """Download and validate both customer-portal statement formats."""
    _login_for_required_export(ctx, "CUSTOMER")
    ctx.goto("/portal/statement")
    xlsx_control = _find_export_control(
        ctx,
        ['button:has-text("XLSX")'],
        surface="/portal/statement XLSX",
    )
    xlsx_size = _download_and_assert(
        ctx,
        xlsx_control,
        extension="xlsx",
        magic=b"PK",
        description="customer-portal statement XLSX",
    )
    pdf_control = _find_export_control(
        ctx,
        ['button:has-text("PDF")'],
        surface="/portal/statement PDF",
    )
    pdf_size = _download_and_assert(
        ctx,
        pdf_control,
        extension="pdf",
        magic=b"%PDF",
        description="customer-portal statement PDF",
    )
    ctx.detail = f"xlsx ({xlsx_size} bytes) and pdf ({pdf_size} bytes) downloaded OK"


# ─── Trip list Excel export (/trips) ─────────────────────────────────────

@tc("TC-EXPORT-XLSX-TRIPS", roles=["ADMIN"], url="/trips",
    title="Export — trip list Excel downloads successfully")
def tc_export_xlsx_trips(ctx: VisualTestContext):
    """Click an export button on /trips and verify xlsx download."""
    _login_for_required_export(ctx, "ADMIN")
    ctx.goto("/trips")
    control = _find_export_control(
        ctx,
        ['button[aria-label="Xuất danh sách chuyến ra Excel"]'],
        surface="/trips trip-list XLSX",
    )
    size = _download_and_assert(
        ctx,
        control,
        extension="xlsx",
        magic=b"PK",
        description="trip-list XLSX",
    )
    ctx.detail = f"trips xlsx downloaded OK ({size} bytes)"


# ─── Finance P&L export (/finance) ───────────────────────────────────────

@tc("TC-EXPORT-XLSX-FINANCE", roles=["MANAGER"], url="/finance",
    title="Export — finance P&L Excel downloads successfully")
def tc_export_xlsx_finance(ctx: VisualTestContext):
    """Click an export button on /finance and verify xlsx download."""
    _login_for_required_export(ctx, "MANAGER")
    ctx.goto("/finance")
    control = _find_export_control(
        ctx,
        ['button:has-text("Xuất Excel")'],
        surface="/finance P&L XLSX",
    )
    size = _download_and_assert(
        ctx,
        control,
        extension="xlsx",
        magic=b"PK",
        description="finance P&L XLSX",
    )
    ctx.detail = f"finance xlsx downloaded OK ({size} bytes)"
