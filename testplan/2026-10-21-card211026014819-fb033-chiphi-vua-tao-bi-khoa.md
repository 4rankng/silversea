# FB-033 — chi phí VỪA TẠO bị khóa sửa/xóa (card 211026014819)

## Case

- **Card:** `Kanban/TODO/211026014819-fb033-chi-phi-vua-tao-bi-khoa-sua-xoa.docx`
  (GDrive-wedged — unreadable; worked from filename + orchestrator brief).
- **Reported:** an expense (chi phí) that was JUST CREATED becomes locked —
  cannot sửa (edit) / xóa (delete). QA retested 01:48 SGT 2026-10-21 on staging
  and it still failed; the retest build already contained the 17/10 role-pin
  ancestor (b8f9af41), so this is a real current defect.

## Root cause (proven by local repro, pre-fix)

The O2C auto-offset hook (`autoOffsetRecordedExpense`,
`advance-shared.service.ts`) fires INSIDE the forwarder's own save
(`createTripExpense` → `propagateRecordedExpense`). For an Ops with a funded,
unconsumed tạm ứng, creation immediately books a live
`advance_settlements`/`settlement_expenses` link (auto settlement
`auto_offset_expense_id` set). Every active-link guard then read that row as
"đã gửi kế toán":

- BE: `updateTripExpense` / `updateForwarderTripExpense[InTx]` → 409
  `Chi phí đã gửi kế toán, chỉ được điều chỉnh trên phiếu hoàn ứng` /
  `Chi phí đã gửi kế toán, không thể sửa`;
  `deleteTripExpenseInTx` → 409 `Chi phí đã gửi kế toán, không thể xóa`;
  `deleteTripExpenseGuarded` → `Không thể xóa chi phí đã được thanh toán`;
  `confirmAccountingExpenses` → 409 `Khoản chi đã ghi nhận trong phiếu hoàn ứng
  hiện hành; không đối chiếu lại.`
- FE: `getForwarderTripDetail.activeSettlementId` counted the auto settlement →
  Sửa/Xóa disabled with title `Khoản chi đã gửi kế toán` +
  "Đã lập phiếu" badge.

So the row locked itself in the same transaction that created it — seconds
after "Lưu". Data-dependent (requires funded tạm ứng), which is why clean local
accounts passed while staging failed.

This contradicts (evidence):
1. The hook's own PRD quote — the auto-offset belongs to fees "được Kế toán
   duyệt"; a self-recorded chi-hộ expense has no accountant decision.
2. The repo's newest advance contract (the accounting-source skip in the same
   function): "Sources managed by expense accounting allocate advances
   explicitly… Confirmation alone must never consume the balance."
3. The wallet contract (card 071026141580 + the 16/10 FB-033 wave): a
   just-created, unconfirmed, unvoided row must be editable/deletable by its
   author.

## Reproduction steps (pre-fix)

1. Local dev: fund an advance for an OPS user (`POST /api/ops/wallet/advance-requests`
   → accountant `POST /api/advance-requests/:id/approve`, KP-148 duyệt = giải ngân).
2. Link the Ops to a lot with an active trip (admin `PATCH /api/auth/users/:id`
   `shipmentIds`).
3. `POST /api/forwarder/me/expenses` (OPS_ADVANCE) → 201 RECORDED.
4. Immediately: trip detail shows `activeSettlementId: 2200` (canEdit true,
   buttons disabled); `PATCH …/expenses/:id` → 409 `Chi phí đã gửi kế toán,
   không thể sửa`; `DELETE …/expenses/:id` → 409 `Chi phí đã gửi kế toán,
   không thể xóa`. Reload does not help — the lock is the settlement link.

Pre-fix evidence: `qa/2026-10-21_fb033-chiphi-khoa/` (ui-*.png from the OPS
wallet drive that PASSED there because the native ops-expense surface never
auto-offsets — the failing surface was the chi-hộ/trip one; the pre-fix API
409s are quoted in this file and in the driver logs).

## Expected behavior

A just-created chi-hộ expense stays editable and deletable by its author. The
auto-offset settlement booked by creation itself is a bookkeeping shadow of the
expense — it must never act as a kế-toán submission. Manual phiếu hoàn ứng
(`auto_offset_expense_id IS NULL`) keep the existing immutability untouched.

## Fix (shipped)

- `advance-shared.service.ts`: `releaseAutoOffsetSettlements` +
  `releaseAutoOffsetAndFindActiveManualLink` (+ pure `isReleasableAutoOffsetSettlement`,
  `autoOffsetReversalAmount`). Release = reverse the OPS_SETTLEMENT debit with
  the same ADJUSTMENT shape the governed reversal posts, flip the settlement to
  REVERSED and clear the `auto_offset_expense_id` slot marker (partial UNIQUE
  index) so the mutation's re-offset can insert a fresh one. Author mutations
  call this before the active-link guards; only a MANUAL settlement keeps the
  lock.
- `forwarder.service.ts`: wired into `updateTripExpense`,
  `updateForwarderTripExpense`, `updateForwarderTripExpenseInTx`,
  `deleteTripExpenseInTx` (soft void) and `deleteTripExpenseGuarded` (hard
  delete — also drops the released shadow link rows; `settlement_expenses` has
  no FK on `trip_expense_id`).
- `expense-accounting-write.service.ts`: `confirmAccountingExpenses` releases
  before the legacy-settlement refusal (đối chiếu no longer dead-ends on the
  create-hook settlement).
- `forwarder-trip-query.service.ts`: `activeSettlementId` counts only MANUAL
  settlements → the FE Sửa/Xóa gate and "Đã lập phiếu" badge no longer fire on
  the auto offset.
- Unit pin: `backend/src/tests/fb033-auto-offset-release.test.ts` (4 tests).

## Post-fix verification (2026-10-21, local :3303/:7177)

- API (`testplan/qa/scripts/2026-10-21-fb033-chiphi-vua-tao-api-verify.mjs`,
  log `qa/2026-10-21_fb033-chiphi-khoa/2026-10-21_fb033-chiphi-khoa_api-verify.log`):
  fresh create 201 (auto settlement attached) → immediate PATCH **200**
  (amount updated; old settlement REVERSED, re-offset at the NEW amount —
  ledger pairs 77603/77604, 77605/77606 balanced) → immediate DELETE **200**
  (soft-voided).
- UI (`testplan/qa/scripts/2026-10-21-fb033-chiphi-vua-tao-fwd-ui-drive.mjs`,
  log `qa/2026-10-21_fb033-chiphi-khoa/fwd-ui-driver.log` + fwd-ui-*.png):
  chi-hộ row created through `/my-forwarder-trips/:id` → Sửa/Xóa ENABLED
  (`editTitle: "Điều chỉnh chi phí"`, no "Khoản chi đã gửi kế toán") → UI edit
  landed → UI delete landed (voided, "Lý do hủy" shown).
- OPS wallet surface unchanged and green end-to-end (create → Sửa toast
  "Đã cập nhật khoản chi" → Xóa → "Đã hủy"):
  `2026-10-21-fb033-chiphi-vua-tao-ui-drive.mjs` + ui-*.png.

## Gates

| Gate | Result |
|---|---|
| `cd backend && npx tsc --noEmit` | 0 errors |
| `cd backend && npx tsx --test --test-concurrency=1 src/tests/fb033-auto-offset-release.test.ts` | 4/4 pass |
| `cd backend && pnpm test` | 330/330 pass |
| `pnpm lint` | 0 errors |
| `make build` | succeeds |
| `cd frontend && npx tsgo -b` / `npx tsc -b` | 0 errors (no FE changes) |

## Coverage notes

- Staging re-drive after deploy is QA's R-next step (this lane is local-only).
- The pre-fix failing row (28601) was repaired and voided during verification;
  residual local fixtures: funded advance requests for `opsqa` (ids 8138/8139,
  RECORDED, reason "FB-033 repro/verify tạm ứng") — consumption fully released.
- Not covered: OPS wallet legacy (TRIP-sourced) row edit through the wallet UI
  (same backend guards, API-level covered); DRIVER-surface rows (no auto-offset
  there — `settlementMethod` differs).
