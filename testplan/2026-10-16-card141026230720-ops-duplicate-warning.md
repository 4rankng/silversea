# Case 141026230720 — Ops khai chi phí tất cả + cảnh báo trùng (P3)

- **Status:** IMPLEMENTED (duplicate-warning half) + VERIFIED-ALREADY-SATISFIED
  (open-scope/all-types half) — see below.
- **Card:** `Kanban/TODO/141026230720-ops-khai-chi-phi-tat-ca-va-canh-bao-trung.docx`
- **Regression tests:**
  - BE: `backend/src/tests/ops-expense-duplicate-warning.test.ts` (4 cases,
    red-green proven: stashing only the service+route change fails exactly the
    two duplicate cases).
  - FE: `frontend/src/features/ops/OpsExpenseFormModal.containers.test.tsx`
    describe "141026230720 — duplicate cost-entry confirm" (4 cases).

## Requirement 1 — mọi Ops được điền TẤT CẢ chi phí (không chia cá nhân/xe)

Verified already satisfied on the recheck build (`8610a42b`), no code change
needed:

- Backend `POST /api/ops/expenses` is `requireRoles(Role.OPS)` with NO
  per-vehicle/person grant: `createOpsExpense` checks only shipment validity,
  container membership, catalog ACTIVE, accounting lock — any OPS account,
  any lot (`backend/src/routes/ops.ts`, `ops-expenses.service.ts`).
- The type catalog `GET /api/ops/expense-types` → `listActiveOpsExpenseTypes`
  returns the ENTIRE active catalog for every OPS caller — no subset logic
  exists anywhere on the path.
- The FE form renders every catalog type (grouped Có/Không hóa đơn).
- Rung-3 proof: Task-1 staging drive (card 141026230710, `hoangnh`, no prior
  link to lot 175) saved `YARD_STORAGE` on cont `MSDU1245780` — see
  `testplan/2026-10-16-card141026230710-ops-khai-chi-phi-recheck.md`.

## Requirement 2 — cảnh báo nhập trùng + xác nhận tường minh

Defect: the shipped warning (`2a64156f`) keyed on CONTAINER only and showed
at selection time; nothing keyed the actual duplicate (same expense TYPE on
the same scope), nothing required a confirm, and lot-wide fees never warned.

Implementation (this commit):

1. **Backend authoritative check at the write** —
   `findLiveDuplicateOpsExpenses(shipmentId, expenseTypeCode,
   shipmentContainerId)`: live (non-VOIDED) rows with the same type on the
   same scope — one container, or lot-wide when both are container-less. A
   cont-scoped row never collides with a lot-wide row (different scopes).
   In `createOpsExpense`, an UNCONFIRMED save with duplicates present throws
   `409 { code: 'OPS_EXPENSE_DUPLICATE', duplicates: [...] }` naming who
   entered what (name, amount, paidAt, cont). Checked inside the caller's
   transaction, so the refused save rolls back atomically and replays with a
   fresh Idempotency-Key are unaffected.
2. **Explicit override, never a silent block** — the route schema takes
   `duplicateConfirmed: boolean`; the resend saves (split payments and
   part-paid stages stay legitimate). This is the ONLY way past the warning.
3. **FE confirm panel** — `OpsExpenseFormModal` recognizes the bounce
   (`opsDuplicateHitsFromError`), shows a warning panel in the card's voice
   ("Loại phí "X" đã được {tên} nhập trước đó — bạn vẫn tiếp tục nhập chứ?")
   listing the earlier rows, with "Kiểm tra lại" (dismiss, keep editing) and
   "Tiếp tục lưu" (resend with `duplicateConfirmed: true`). Other 409s keep
   the red-toast path. Changing Số Cont or Loại phí clears the stale panel.
   The shipped per-cont selection-time heads-up is retained unchanged.

## Gates

- BE `pnpm exec tsc --noEmit` = 0 · BE `tsx --test
  ops-expense-duplicate-warning.test.ts` 4/4 (real DB).
- FE `npx tsc -b` = 0 · FE scoped vitest
  `OpsExpenseFormModal.containers.test.tsx` 14/14 (10 prior + 4 new).
- Root lint: no new findings from the touched files (pre-existing W1-verify
  script errors unchanged).

## Verification coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Duplicate save bounces 409 with earlier rows; confirm resends | DB/API VERIFIED (route test on real DB) + FE component tests | BE 4/4, FE 14/14 logs | staging UI drive follows after deploy (separate table below on completion) |
| All-types open scope for every Ops | UI DRIVEN (Task-1 recheck, hoangnh, YARD_STORAGE) | Task-1 record | other OPS accounts; update/edit path re-scoping not checked |
| PATCH update path can still re-scope a row into a duplicate | NOT TESTED — documented residual | — | the card asks about ENTRY; the edit modal keeps its own validation; follow-up if owner wants the same guard on PATCH |
