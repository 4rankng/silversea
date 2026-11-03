# SIL-667 (id 774) — Dispatch-detail inline PHÂN LOẠI on fulfillment-less rows: no more silent fail

Date: 2026-11-03 · Branch: `fix/sil667-inline-silent-fail` · Base: `origin/main` (`a41b39e2`)

---

## 1. Root Cause Analysis (file:line)

- **Files & Lines:**
  - `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx` — `handleInlineClassificationSave` (SIL-648 inline editor, ~L307)
  - `frontend/src/features/dispatch/detailed-plan/useDispatchDetailPlan.ts` — `savePlan` → `updateDispatchDetailPlan(row.fulfillmentId, …)` (~L397)
  - `frontend/src/api/dispatchPlanningClient.ts` — `updateDispatchDetailPlan` builds the URL from the id (~L587)
  - `backend/src/routes/shipments/dispatch-planning.routes.ts` — `PATCH /dispatch-detail-plan-rows/:fulfillmentId/plan` rejects a non-integer id with `400 'fulfillmentId không hợp lệ.'` (~L472–475)
- **Root Cause:**
  - The PHÂN LOẠI column renders its inline edit button for every non-completed row with more than one classification option — including **branch rows** (a READY container the union query lists before any fulfillment exists: `fulfillmentId = null`, `shipmentContainerId` set, `dispatch-detail-plan-fulfillment-less.ts` L143/L155).
  - On save the SIL-648 handler called `onAtomicSave(row, …)` directly. With `row.fulfillmentId == null` the client PATCHed `/api/shipments/dispatch-detail-plan-rows/null/plan` → `400 'fulfillmentId không hợp lệ.'` → the optimistic value reverted while the user had already read "Kẹp" on screen; the error only reached the top-of-grid banner (missed) and the optional toast — a silent fail in practice. Staging repro: a fresh lot row (with or without a container number) fails until the Điều phối dialog is opened once (which decomposes the container and creates the fulfillment).
  - The Điều phối editor cell never had this bug: `openEditor` routes fulfillment-less rows through `onEnsureFulfillment` (`DispatchPlanEditorCell.tsx` openEditor → `ensureFulfillmentFor`) — the same proven decompose command the inline path was missing.
- **Fix (chosen option A of the ticket — save succeeds):**
  - `handleInlineClassificationSave` now resolves the fulfillment identity BEFORE saving on a `fulfillmentId == null` row:
    1. calls `onEnsureFulfillment(row)` (the existing decompose, `ensureFulfillment.ts`),
    2. on success saves against the ensured row (`fulfillmentId`/`version`/`shipmentVersion` fresh) and re-keys the in-flight select state so the optimistic value never flickers back,
    3. on failure shows `ENSURE_FULFILLMENT_FAILED_MESSAGE` on the grid banner (via the hook's `onError`) **and** the toast, reverts the optimistic value, and sends no plan request,
    4. if no ensure handler is wired, fails loudly with `'Dòng chưa có phân xe — dùng Chỉnh sửa điều phối để phân xe trước khi đổi phân loại.'` (banner `role="alert"` + toast) and sends no plan request.
  - `ensureFulfillment.ts` exports the single failure sentence (`ENSURE_FULFILLMENT_FAILED_MESSAGE`) so the banner and the toast read identically.
  - Rows that already have a fulfillment keep the exact previous code path (no extra round-trip, no behavior change).

## 2. What Changed Per File

1. `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx`:
   - `handleInlineClassificationSave`: ensure-fulfillment preamble, `activeKey` re-pointing after decompose, loud no-handler path; weight-warning retry now re-saves against the ensured row.
2. `frontend/src/features/dispatch/detailed-plan/ensureFulfillment.ts`:
   - Exported `ENSURE_FULFILLMENT_FAILED_MESSAGE`; the catch uses it.
3. `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.test.tsx`:
   - `renderGrid` gained an optional `{ withToast }` wrapper (ToastProvider) so toast visibility is assertable;
   - New describe `SIL-667 inline classification on fulfillment-less rows` (3 tests).

## 3. Regression Cases

| ID | Case | Expected |
|---|---|---|
| SIL-667-R1 | Inline PHÂN LOẠI edit on a row WITHOUT fulfillment (fresh lot row, with container number or empty) | POST decompose fires, then PATCH `/dispatch-detail-plan-rows/:id/plan` with the NEW id → 200; grid shows the new classification; **no** request to `/dispatch-detail-plan-rows/null/plan` |
| SIL-667-R2 | Decompose fails (row without container line, or endpoint error) | No plan request; grid banner (`role="alert"`) + toast both show the decompose-failure sentence; optimistic value reverts to stored |
| SIL-667-R3 | `onEnsureFulfillment` not wired (defensive) | No plan request; banner + toast show the "dùng Chỉnh sửa điều phối" guidance |
| SIL-667-R4 | Inline PHÂN LOẠI edit on a row WITH fulfillment | Unchanged behavior: direct PATCH with the row id, success or loud error as before |

## 4. Acceptance Criteria (from the ticket)

1. No request ever hits `/dispatch-detail-plan-rows/null/plan` — proven by network capture in the driver (`qa/scripts/2026-11-03-sil667-*.mjs`).
2. No silent failure: every failed save surfaces on the grid (`role="alert"` banner) and the toast.
3. Rows WITH fulfillment: inline edit behavior unchanged (SIL-648 tests still green, 73/73 on the grid file).
4. Error copy is aria-visible (`role="alert"` banner, `role="log"` toast) — never console-only.

## 5. Verification coverage (UI verification contract, §9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| BEFORE: inline PHÂN LOẠI on a fulfillment-less row PATCHes `/dispatch-detail-plan-rows/null/plan` → 400, value stays Đơn | UI DRIVEN | `testplan/qa/evidence/2026-11-03-sil667/2026-11-03_sil667_before_branch-after-click.png`, `2026-11-03_sil667_before_driver.log` (network capture shows the `/null/` PATCH; cont SIAU4184988) | staging parity (driven on local dev :3005/:7233); card-mode layout |
| AFTER: same flow → POST decompose → PATCH `/:id/plan` 200, grid shows Kẹp, no error surface, NO editor modal | UI DRIVEN | `2026-11-03_sil667_after_branch-after-click.png`, `2026-11-03_sil667_after_driver.log` (11/11 incl. `after_no_editor_modal`; cont SIAU7539377, fulfillment 1314) | card-mode layout; error-path drive (decompose failure is unit-pinned only) |
| AFTER: DB side effect — fresh ACTIVE fulfillment with `dispatch_classification = DOUBLE` | DB VERIFIED | driver log `branch_db_fulfillments`: `1312\|SINGLE\|canceled`, `1314\|DOUBLE\|active` (psql on local dev container) | — |
| AC3: row WITH fulfillment keeps working (single PATCH, no /null/) | UI DRIVEN | `2026-11-03_sil667_{before,after}_owned-after-click.png` + driver `owned_*` records (fulfillment 1295→DOUBLE, 1313→COMBINED) | — |
| Unit: no null-identity save call, loud failure, guidance fallback, quiet ensure | vitest | `DetailedPlanGrid.test.tsx` SIL-667 describe (73/73) | wire-level /null/ absence is driver-proven |

Local stack: backend :3005 + frontend :7233 from this worktree (the shared :7175/:3002 stack belongs to another lane); login dungnv (DISPATCHER); fixtures `2026-11-03-sil667-fixture.mjs`.

## 6. Fast-follow candidates (out of SIL-667 scope, from review)

1. `DetailedPlanGrid.tsx` `handleQuickIssueOrder` — the weight-warning confirm retry's `await onIssueOrder(…)` is unguarded (same class as the F4 fix on the classification path; different command + different failure contract, left untouched deliberately).
2. Shared Toast container announces all toasts as `role="log"`/polite — errors would ideally ride `role="status"`/alert semantics at the primitive level (uiux note).

## 7. Review

Independent code-reviewer pass, round 1: **Block** (F1 — inline ensure inherited the hook's editor auto-open; modal popped mid-inline-save with a stale-draft revert hazard; plus F2–F5). All five fixed per recommendations (quiet `{ autoOpen: false }` ensure variant in the hook, guarded await, stale optimistic-key delete, guarded confirm retry, comment honesty). Round 2 re-verification: **Approve** — reviewer independently re-ran vitest/tsc/lint and the driver evidence.
