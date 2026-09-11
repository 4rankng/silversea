# QA — TC-DDP-005 CUS role gating PASS rung 3

**Ticket:** 8afc13a9 (Dispatch detailed-plan: all containers + reassign)
**Staging commit under test:** 1ac871fd / 7418e604
**Status:** PASS rung 3 — both assertions of TC-DDP-005 hold.

## Setup
- Cleared `localStorage` + `sessionStorage`. Navigated to `https://vantai.tingting.vip/login`.
- Logged in as `tiepvv` / `Abc123` (CUS staging account per `testplan/testaccounts.txt`). Note: `canon-cs` and `samsung-cs` are local-dev-only; tiepvv / thanhdc / anhdtv / huyenntt / anhntn are the real staging CUS accounts.
- Login redirected to `/shipments` (CUS home: "Tổng quan lô hàng" = Shipment overview).

## Assertion 1 — CUS does NOT see carrier-picker / assign control

### Action
- Attempted to navigate directly to `https://vantai.tingting.vip/dispatch-detail`.

### Observed
- Browser stayed on `/shipments` (CUS home). Navigation to `/dispatch-detail` did NOT render the dispatcher grid.
- `document.querySelectorAll('.dispatch-assignment-cell__trigger, .dispatch-assignment-cell__quick-issue').length === 0`.
- `document.querySelector('.detailed-plan-grid')` returned `null`.
- All buttons visible on the CUS page: "Nghiệp vụ Chứng từ", "Tổng quan lô hàng", "Chi tiết lô hàng", "Tạo lô mới", "Tìm kiếm", "Tải XLSX", etc. — **NO dispatcher assignment controls present**.

### Verdict
PASS — the carrier-picker / assign control is **not visible** to CUS in the dispatch-detail view (because CUS cannot reach the page in the first place; the SPA redirects to `/shipments`).

## Assertion 2 — API call returns 403

### Action
- Extracted the CUS JWT from `localStorage.getItem('token')` (304-char JWT, eyJ-prefixed).
- Sent `PUT /api/dispatch/containers/1/carrier` with `Authorization: Bearer <CUS-token>` and body `{"carrierId": 2}`.

### Observed
- HTTP status: **403** (Forbidden).
- (Body content not captured — the structured-clone serialization threw an error on the full response object, but the status code came back clearly.)

### Verdict
PASS — the server returns 403 when CUS attempts the carrier assignment API directly.

## Combined verdict

| Assertion | Result |
|---|---|
| TC-DDP-005a — CUS does not see the assign control | PASS |
| TC-DDP-005b — CUS API call returns 403 (or 404) | PASS (403) |

**TC-DDP-005 PASS rung 3.**

## Artifacts saved
- `qa/2026-09-10_ddp005-cus-role-gating-pass.md` — THIS report.
- No UI screenshot — browser MCP returned "Screenshot failed: the embedded browser did not produce a frame in time" on every attempt. Text/DOM evidence only.

## Bonus observation
- CUS sees only shipment-level data ("LOG COMNEWEB-1 KCN ĐỒNG VĂN, HÀ NAM", "TESTSS2609 Chưa có tờ khai", "API verification shipment - staging regr"). No carrier/truck/driver data is exposed to CUS.
- CUS sidebar does not contain a "Điều phối" (Dispatch) or "Vận hành" (Operations) link — confirms RBAC at the navigation level, not just the API level.
