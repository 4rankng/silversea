# Case QA-2026-09-25-01 — Loại phí dropdown must not list QA-seed/test rows (OPS audit P0)

- **Case ID:** QA-2026-09-25-01
- **Reported:** 2026-09-25, Director-routed from the cross-role OPS audit (deepseek re-route note);
  also holds the reserved `20260924_3N` ticketing block's OPS P0 slot.
- **Verbatim finding (Director routing note):** *"Loại phí dropdown leaks 6 QA-seed names + 2
  duplicate options; fix = dropdown source filtered to exclude QA-seed/test rows (data class, per
  the Batch C purge family)."*
- **Surface:** OPS "Khai báo chi phí" modal Loại phí dropdown (OpsExpenseFormModal /
  OpsExpenseEditModal) + the same data class feeding the accountant Thêm khoản chi drawer and the
  admin/ancillary catalog projections — all filter on `forwarder_expense_types.status='ACTIVE'`
  (± `deleted_at IS NULL`).
- **Root cause class:** QA API runs seed test rows into `forwarder_expense_types` on staging and
  never purge them; the dropdowns render every ACTIVE row. This is a DATA purge fix (Batch C
  purge family), not a code change — filtering by name pattern in code would misclassify real
  admin-created fees.
- **Mutation surface:** none (read-only retest; the purge itself mutates the 8 staging catalog rows
  listed in `qa/2026-09-25_loaiphi-dropdown_staging-purge.log`).
- **Status:** case PREPARED → purge executed 2026-09-25; rung-2 (DB/API) verification landed;
  UI DRIVEN rung owed to the board-verify pass (browser yielded to agy #4 + filter rebuild worker
  per Director's yield protocol).

## Steps

1. Staging DB census: `SELECT id, code, name, status FROM forwarder_expense_types ORDER BY id` →
   the 6 QA/test rows (ids 1–6: `QA0914`, `QA0915-FUEL`, `HAHA-INVTYPE`, `QAC1-LIFT-UP`,
   `QAC1-LIFT-DOWN`, `QAC1-CSHT`) plus the two duplicate twins (`SANITATION` vs canonical
   `FEE_CLEANING` both named "Phí vệ sinh"; `STORAGE_FEE` vs canonical `FEE_WAREHOUSE` both named
   "Phí lưu kho") are ACTIVE.
2. Reference check before purge: expense rows referencing those codes (ops_expense_entries ×6,
   trip_expenses ×11 — all QA-generated test expenses) exist; SANITATION/STORAGE_FEE have zero
   references.
3. Targeted backup of the 8 rows → `qa/2026-09-25_loaiphi-dropdown_staging-backup.txt`.
4. Purge (staging): `UPDATE forwarder_expense_types SET status='INACTIVE', deleted_at=now(),
   updated_at=now() WHERE id IN (1,2,3,4,5,6,15,17) AND status='ACTIVE' AND deleted_at IS NULL`
   — expect rowcount 8, inside one transaction.
5. Retest dropdown source with the exact service predicate (`status='ACTIVE' AND deleted_at IS
   NULL ORDER BY name`): 39 rows, zero QA/test names, zero duplicate names (GROUP BY name HAVING
   count>1 returns 0 rows).
6. API re-check (rung 2): login staging OPS (`hoangnh`, testaccounts) → `GET /api/ops/expense-types`
   → response items contain no QA/test names and no duplicate names.
7. UI spot (board-verify pass): open OPS Khai báo chi phí on staging, open the Loại phí dropdown,
   confirm 39 clean options.

## Expected behavior

| # | Expectation |
|---|---|
| 1 | User-facing dropdown sources (`/ops/expense-types`, `/expense-accounting/catalog` expenseTypes, bootstrap active projection, ancillary card) list only non-test catalog rows. |
| 2 | QA/test-named rows never render in any Loại phí dropdown while flagged test rows stay purgeable without code changes (data class treatment). |
| 3 | Duplicate option labels ("Phí vệ sinh", "Phí lưu kho") appear exactly once each. |
| 4 | Existing QA expense rows keep rendering their type name in history (leftJoin by code is unfiltered), while NEW expense declarations against purged codes are rejected (create-path check requires ACTIVE + not deleted). |
| 5 | Real customer-entered fees created 09-21 (SANITATION-wave siblings: Đảo vỏ, Hàn cont, Cân lốp, Đóng/trả 2 điểm, Đảo hàng, Phí xe nâng hạ đăng khoa, Chi công nhân tại kho, Phí cân) remain ACTIVE and selectable. |
| 6 | `pnpm seed` / `seedForwarderExpenseTypes` fill-only semantics unchanged; canonical catalog intact. |

## Regression guard

The case re-runs at every QA wave on staging: census query must show 0 ACTIVE QA/test-named rows
and 0 duplicate display names in the dropdown-source projection. Any recurrence re-routes to BE
as a new data-class purge (no code change expected).
