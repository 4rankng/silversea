# SIL-669 (id 776) — Dispatch-detail inline PHÂN LOẠI save fired PATCH twice — fake error on success

Date: 2026-11-03 · Branch: `fix/sil669-double-patch` · Base: `origin/main` (`3c3ff847`)

## 1. Root Cause (file:line)

- **Ticket evidence (QA round-3, staging 41c75c08):** editing the inline Phân loại on /dispatch-detail and saving fired **two identical** `PATCH /shipments/dispatch-detail-plan-rows/:id/plan` requests — #1 answered `200` (saved), the duplicate `409` ("Tác vụ điều xe đã thay đổi. Vui lòng tải lại.", stale `expectedFulfillmentVersion` against the row #1 just bumped). The duplicate's error painted the grid banner (`role="alert"`) and the shared toast even though the save succeeded. Verified both directions (Đơn→Kẹp, Kẹp→Đơn); the value always persisted — a display bug, not a data bug.
- **Cause chain (all FE, single owner):** the only emitter of that URL is `savePlan` → `updateDispatchDetailPlan` (useDispatchDetailPlan.ts ~L397 → dispatchPlanningClient.ts ~L587), called from `handleInlineClassificationSave` (DetailedPlanGrid.tsx). Every duplicate commit — programmatic/harness re-dispatch, a double commit in one flush, or a stale-closure re-pick on the re-keyed fresh row (the decomposed row's closure still carries the pre-save `classification`, defeating the `nextClassification === row.classification` guard) — re-entered the handler with the same stale version and went straight to the wire. The handler had **no idempotency guard**: nothing stopped a second save of the same intent while the first was in flight.
- Why the local hand-drive could not reproduce it: React Aria's listbox dedupes same-value picks (`useSelectState.setValue` fires `onSelectionChange` only when the key differs from the rendered `displayValue`) and the inline select disables itself while `savingClassificationKey === rowKey`; on a localhost stack the in-flight window is ~15–30 ms. Staging latency (decompose RTT + PATCH RTT in the hundreds of ms) widens the window so a harness/programmatic duplicate lands inside it — reproduced deterministically by driving the grid's own onChange seam twice (the seam any programmatic duplicate rides) with the PATCH response held ~900 ms.

## 2. Fix

`DetailedPlanGrid.tsx` — `handleInlineClassificationSave` is now wrapped by an idempotency guard:

- `inlineSaveInFlightRef: Map<string, DispatchClassification>` keyed on the **physical row** identity — `c:<shipmentContainerId>` for container rows, `s:<shipmentId>` for container-less LCL lots (distinct namespaces, never merged; the decompose re-key keeps the same container id, so the guard survives the re-key instead of being re-armed).
- A commit whose (identity, target value) is already in flight returns immediately — no optimistic update, no save, no PATCH.
- The entry is released in an outer `finally` on **every** exit — success, save failure, and both SIL-667 decompose-failure early returns — so a re-pick after any failure is a brand-new save attempt (reviewer blocker fix).
- Same target value only: a genuinely different pick saves as usual once the in-flight one settles; different rows hold independent entries.

## 3. What did NOT change

- SIL-667 decompose-then-save flow (quiet `{ autoOpen: false }`, loud failure banner+toast, no `/null/` PATCH) — untouched; pinned by the existing tests + driver baseline.
- SIL-638 TC6.2 weight-warning confirmed retry — the "Vẫn lưu?" retry calls `onAtomicSave` directly from the confirm closure and never consults the guard.
- Real-conflict display: a single genuine save answered 409 still paints the banner + toast with the server's message (pinned by unit test and driver scenario 4).
- No backend changes; no lint suppressions; no type widening.

## 4. Regression cases

| ID | Case | Expected |
|---|---|---|
| SIL-669-R1 | Duplicate commit (same pick) while the save is in flight | Exactly ONE `onAtomicSave`/PATCH; no error banner/toast on success |
| SIL-669-R2 | Commit on the re-keyed fresh row during the in-flight save | No second save against the stale identity |
| SIL-669-R3 | Successful save | No error banner, no error toast |
| SIL-669-R4 | Real conflict: single save answered 409 | Banner `role="alert"` + toast with the conflict sentence; optimistic reverted |
| SIL-669-R5 | Same-value retry after a FAILED decompose | Second decompose runs, save fires (guard released on the failure exit) |
| SIL-669-R6 | Same-value retry after a FAILED save (409) | A new PATCH fires; success clears the banner |

R1–R6 pinned in `DetailedPlanGrid.test.tsx` describe "SIL-669 inline classification duplicate save (PATCH fired twice)".

## 5. Verification

- Scoped: `cd frontend && pnpm vitest run src/features/dispatch/detailed-plan/DetailedPlanGrid.test.tsx src/features/dispatch/detailed-plan/useDispatchDetailPlan.test.tsx` → **140/140 pass** (incl. sil648/sil667/weight-warning pins).
- `pnpm exec tsc -p frontend/tsconfig.json --noEmit` → **0 errors**.
- Browser drive (local dev, this lane FE :7192 → BE :3003, shared dev DB `ss-prod-db`:5441, role `dungnv`, fixtures `SIL669A/B/C-*` fresh per phase):
  - `PHASE=before` (pre-fix build via stash): **9/9** — duplicate commits fired 2 identical PATCHes (200 then 409) + fake banner+toast, value persisted (`qa/2026-11-03-sil669/2026-11-03_sil669_before_driver.log`, `*_s2-duplicate.png`, `*_s3-decompose-window.png`).
  - `PHASE=after` (fixed build): **13/13** — baseline single pick = 1 PATCH clean; duplicate scenarios = exactly 1 PATCH 200, no error surface, persisted; rival-writer conflict = single PATCH 409 with banner+toast (`2026-11-03_sil669_after_driver.log`, `*_s4-conflict.png`).
  - DB proof: `2026-11-03_sil669_db-proof.log` (`shipment_fulfillments` classification per fixture).
  - Independent code review: blocker (guard leak on decompose-failure exits) + major (id namespace) + minor (single-slot eviction) found and fixed before landing; regression tests R5/R6 added.
