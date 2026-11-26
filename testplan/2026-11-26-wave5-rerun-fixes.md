# Regression Cases — 2026-11-26 Wave-5 Re-run QA Fixes

Recorded prior to implementation per `AGENTS.md §6`.

---

## Case ID: K2.13 — Container 1 declaration copies to sibling containers on shipment create

- **Route / Surface:** `/shipments/create` (`ShipmentCreateWorkspace.tsx`)
- **Reproduction:** Add 2 FCL container rows on `/shipments/create`, type a declaration number in Container 1.
- **Actual (bug):** Container 2's declaration remains empty on the form and after save.
- **Expected:** Typing `declarationNumber` on Container 1 propagates to sibling containers that are empty or still matched Container 1's prior value (while preserving any container where the user explicitly typed a different value).

---

## Case ID: K2.16 — Changing customer warns before clearing customer-scoped factory/warehouse

- **Route / Surface:** `/shipments/create` (`ShipmentCreateWorkspace.tsx`, `ShipmentCreateModals.tsx`)
- **Reproduction:** Select customer Long Minh + factory ASKEY-XƯỞNG 1, then switch customer to LOG COM.
- **Actual (bug):** Factory is wiped silently with no confirmation dialog.
- **Expected:** A confirmation modal warns that changing the customer will clear the selected factory/warehouse (while keeping Bill/Booking), with confirm/cancel actions.

---

## Case ID: K2.22 — Re-importing system-exported quotation XLSX allows valid blank Giá cos cells

- **Route / Surface:** `/config/quotations` XLSX import (`backend/src/services/quotation-import.service.ts`)
- **Reproduction:** Export an existing quotation XLSX (which contains blank `Giá cos` cells for unpriced vehicle classes) and re-import it.
- **Actual (bug):** `validateImportRows` flags every blank `Giá cos` cell as a mapping error (`18 lỗi ánh xạ`), disabling commit.
- **Expected:** Truly empty `Giá cos` cells are skipped as unpriced classes (zero error) during preview and commit; non-empty invalid/non-positive `Giá cos` values and routes with 0 priced rows remain hard errors.

---

## Case ID: K2.120 — Chot-debit `Phát sinh (CUS)` and `Chi phí ngoài` show blank/`—` instead of fabricated `0 ₫`

- **Route / Surface:** `/accounting/chot-debit` (`accounting-debit-close.service.ts`, `AccountingDebitClosePage.external-cost.tsx`)
- **Reproduction:** Open `/accounting/chot-debit` on a lot with non-`OTHER` trip expenses and null `debitExternalCost`.
- **Actual (bug):** `otherSellKnown` marked true for any trip expense row (even non-`OTHER`), emitting `phatSinhCus: "0"` (`0 ₫`); `ExternalCostCell` rendered `placeholder="0"`.
- **Expected:** `otherSellKnown` is true only when at least one `OTHER` trip expense with non-null `sellAmount` exists; `ExternalCostCell` uses `placeholder="—"` (never `0`).

---

## Case ID: K2.121 — Lạch Huyện surcharge auto-calculates from `port_zone_surcharges` config

- **Route / Surface:** `/accounting/chot-debit`, `/accounting/ghep-bo-debit` (`zone-surcharge.service.ts`, `accounting-debit-close.service.ts`, `debit-merge.service.ts`)
- **Reproduction:** Configure `port_zone_surcharges` (`500.000₫/đầu` for Hateco), open `/accounting/chot-debit` or `/accounting/ghep-bo-debit` for a lot lifting/dropping at Hateco with no manual Ops `ZONE_SURCHARGE` override.
- **Actual (bug):** Both boards only read `ops_expense_entries` (`ZONE_SURCHARGE`) and ignored `port_zone_surcharges` config, leaving Lạch Huyện blank on every lot.
- **Expected:** Batch helper `resolveLotZoneSurchargesBatch` applies the canonical ladder (`ops ZONE_SURCHARGE` override > `port_zone_surcharges` per container lift/drop end), auto-populating Lạch Huyện on both boards.
