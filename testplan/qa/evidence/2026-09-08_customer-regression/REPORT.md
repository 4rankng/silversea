# Staging customer-regression sweep — 2026-09-08

Re-ran the customer-bug regression cases from the 2026-09-06/07/08 bug reports
against staging (`https://vantai.tingting.vip`) using the new
`testplan/qa/` reusable harness.

## Verdict summary

| Case ID                                            | Verdict | Duration | Notes |
|----------------------------------------------------|--------:|---------:|-------|
| FACTORY-DISPLAY-REGRESSION-2026-09-07               | **PASS** | 4.7s | Shipment 5 detail page shows "ASKEY-2" in Nhà máy cell; matches expected short name. |
| TC-CUS-CREATE-021 (Nhà máy X clear)                 | **PASS** | 31.7s | Set "ASKEY-1", X-cleared to empty, re-picked. |
| TC-CUS-CREATE-022 (Tuyến đường X clear)             | **PASS** | 25.8s | Set "KCN QUẾ VÕ, BẮC NINH", X-cleared. |
| TC-CUS-CREATE-023 (Cảng nâng + Cảng hạ X clear)     | **PASS** | 28.0s | Both "Cảng Mipec" → empty. |
| TC-CUS-CREATE-026 (Duplicate Bill guard)           | **PASS** | 25.4s | Inline warning fired (text below); db count for `JJCTCHPDY260305` = 1. |
| TC-CUS-CREATE-028 (Overview ↔ Detail sync)         | **PASS** | 8.4s | Shipment 4 row shows "08:00 7/9/2026 · ASKEY-2 · 2x40HC"; no "Chưa chốt ngày" badge. |

**6/6 PASS** — all customer-reported regressions from 2026-09-06/07 are holding
on staging.

## Evidence (per claim, rung 3)

| Claim | Evidence |
|---|---|
| FACTORY-DISPLAY PASS | `evidence/2026-09-08_customer-regression/01_a_detail.png` (cell shows "ASKEY-2" next to "Nhà máy / công trường") + `results.json` `factoryCellText="ASKEY-2"`. |
| TC-021 PASS | `02_a_customer_and_hinh_thuc_picked.png` → `03_b_nhamay_picked.png` ("ASKEY-1" visible) → `04_c_nhamay_cleared.png` (empty) → `05_d_nhamay_repicked.png`. |
| TC-022 PASS | `06_a_tuyen_picked.png` → `07_b_tuyen_cleared.png`. |
| TC-023 PASS | `08_a_cang_picked.png` → `09_b_cang_cleared.png`. |
| TC-026 PASS | `10_a_bl_typed_inline_warning.png` shows the exact expected text "Số Bill JJCTCHPDY260305 đã được nhập bởi thanhdc lúc 6/9/2026 17:25. Không thể tạo lô trùng." + DB count = 1. |
| TC-028 PASS | `12_a_overview.png` shows shipment 4 row "08:00 7/9/2026 · ASKEY-2 · 2x40HC", no "Chưa chốt ngày". |

## Coverage table

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Factory display regression | UI DRIVEN | `01_a_detail.png`, API shipment id=5 → `operationalSiteId=6` resolves to "ASKEY-2" | Stale caches (next deploy); other shipments without `operationalSiteId`; non-Long Minh customers. |
| X-clear (Nhà máy / Tuyến / Cảng) | UI DRIVEN | screenshots 02-09, `results.json` before/after pairs | Mobile viewport; LCL mode (only FCL covered here). |
| Duplicate Bill guard | UI DRIVEN | inline warning text + `dbCountForBL=1` (no duplicate row created) | Server-side 409 path (frontend blocked submit; defense-in-depth not exercised on this run). |
| Overview ↔ detail sync | UI DRIVEN | `12_a_overview.png` row snippet in `results.json` `rowTextSnippet` | Mobile viewport; non-Long Minh shipments; bulk-edit mode. |

## How to re-run

```sh
STAGING_URL=https://vantai.tingting.vip \
  node testplan/qa/scripts/run-all.mjs customer-regression
```

Output → `testplan/qa/evidence/<next-date>_customer-regression/`.

## Bugs found in the harness (resolved during this sweep)

These were driver bugs, not product bugs — fixed in the harness before this report:

1. **`apiGet` used page.evaluate + localStorage** which throws SecurityError
   before the first `goto()` (`Factory-display` failed). Fixed in
   `lib/harness.mjs` to use the cached token via `fetch` directly.
2. **"Hình thức xuất nhập khẩu" is a native `<select>`**, not a UUI combobox.
   Fixed `lib/selectors.mjs` + `lib/harness.mjs` to dispatch the native value
   setter + `change` event.
3. **`rowContaining` only accepted regex** but cases pass string BL numbers.
   Fixed to accept both.
4. **TC-028 picked the first shipment with appointments** which on staging is
   a NEW shipment without BL. Filtered to BL-bearing shipments.

## What is NOT in this sweep (deferred)

- §1.10 cases 022/024/025 (LCL dropdown X clear, Escape revert)
- §1.11 case 027 (inline duplicate warning — covered indirectly by 026)
- §1.12 cases 029-033 ("Xác nhận" button flow)
- §1.13 cases 034/035 (cross-update sync between rows)
- All cases in `09-e2e-regression.md` and the RBAC matrix

Next sweep: add `cases/customer-regression/` files for §1.12 + §1.13, then
expand `cases/` with topics for E2E and RBAC.
