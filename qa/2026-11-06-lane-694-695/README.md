# qa/2026-11-06-lane-694-695 — evidence index

Lane: SIL-694 (id 806) + SIL-695 (id 807) — điều vận close + issue-order loop.
Worktree branch `fix/sil-dispatch-1`, base `3efeffb9`. Local stack: BE :3002 (this worktree),
FE :7176 (this worktree), DB ss-prod-db:5441 (dev prod-mirror). Accounts per
testplan/testaccounts.txt (password Abc123).

## SIL-694 — governed trip financial close 403 cho mọi vai + kế toán dead-end

Root cause (3 layers, all measured):
1. `backend/src/middleware/authz-grants.ts` exclusive row `POST /trips/:id/complete`
   roles `[ACCOUNTANT, CUS]` — pre-MC-4 CUS-maker list; hard-403'd ADMIN/MANAGER,
   the roles the trips screen shows the close button to (`canComplete = isManagerOrAdmin`).
2. `governance-policy.ts TRIP_FINANCIAL_CLOSE.applyRoles [ADMIN, MANAGER]` vs createRoles
   including ACCOUNTANT — since MC-4 (2026-09-11) make+apply run in ONE request, so the
   accountant's close could never finish (the "kế toán bị lặp" dead-end).
3. `trip-status-machine.service.ts` standard-close branch admitted only ADMIN/MANAGER
   for the governed completion.

Fixes: grant row → `[ADMIN, MANAGER, ACCOUNTANT, CUS]` (= policy createRoles);
applyRoles `+ ACCOUNTANT`; machine admits ACCOUNTANT only when `governanceAuthorized`
(non-governed accountant attempt still 409s naming the channel); FE `canComplete`
admits ACCOUNTANT; FE dispatch surface role-gates the external "Hoàn thành" affordance
(`canCloseExternalTrip`, the complete-external allowlist) — ACCOUNTANT/OPS lose the
dead menu item that always 403'd.

BEFORE (log: `sil694-governed-close-before.log`, trip 1308): ADMIN 403 · MANAGER 403 ·
DISPATCHER 403 · ACCOUNTANT 422 (photo gate) — the button-visible roles all errored.
AFTER (`sil694-governed-close-after.log`, trip 779031): ADMIN 422 · MANAGER 422 ·
ACCOUNTANT 422 (pass authority, clear reason gates) · DISPATCHER 403 (policy — not a
close maker). Full success: `sil694-accountant-close.log` — ACCOUNTANT governed close
trip 1308 → 200, approverRole ACCOUNTANT, trip COMPLETED.

UI DRIVEN (§9 rung 3): `ui-drive.mjs` → `ui-driver.log` + PNGs
`sil694-ui-1/2/3-*.png` — hoapt (ACCOUNTANT) on /trips/759: button visible → reason
modal → close → 200 `POST /api/trips/759/complete` → h1 "Đã hoàn thành".
DB side effect: trips 576/759 `status=COMPLETED, completed_at set`
(cleanup-fixtures.sql documents the fixture rows).

Scoped tests: `backend/src/tests/authz-grant-registry.test.ts` (oracle + DISPATCHER
exclusivity canary), `backend/src/tests/unit/direct-action-policy.test.ts` (apply set),
`frontend/src/pages/DispatchDetailPlanPage.test.tsx` (role gate matrix 6 roles).

## SIL-695 — issue-order với xe có chuyến hoàn thành cùng ngày

NOT REPRODUCED on base 3efeffb9 — the warn-once contract already satisfies the
ticket's accepted alternative ("cảnh báo rõ có ý nghĩa nghiệp vụ, không loop vô hạn").

API (`sil695-overlap-before.log`): raw issue overlapping a same-day COMPLETED trip →
409 `RIG_OVERLAP_COMPLETED` "Có 1 chuyến đã hoàn thành trùng khung giờ phân công này.
Vẫn lưu?"; confirmed retry (`rigOverlapCompletedConfirmed: true`) → 201 trip created.
Non-overlapping window → 201 (no warning — matches the window law).

UI DRIVEN: `ui-drive.mjs` → `sil695-ui-0/1/2-*.png` — dungnv (DISPATCHER) on
/dispatch-detail, plated row on truck 15H-154.26 holding a COMPLETED trip today:
Phát lệnh → warn dialog (business-accurate message) → Xác nhận → row "Đã phát lệnh",
dialog closed, no re-prompt 1.2s later (loop-free). Post-side-effect: trips row
created for fulfillment 1265 (trip status CREATED, truck 32).

Not covered (SIL-695): staging data variant that produced the QA loop — staging build
may predate `9f91245a` (11/10, "the overlap warn confirms and retries on the issue flow
too"); no staging access from this lane (local-only rule). Recommend re-testing the
06/11 staging repro against a trunk build; if a loop re-appears, capture the FE console
+ the failing 409 body.

## Gates
- `2026-11-06_lane-694-695_be-tsc.log` / `..._fe-tsc.log` — typechecks
- `2026-11-06_lane-694-695_be-test.log` / `..._fe-test.log` — full suites
- `2026-11-06_lane-694-695_root-lint.log` / `..._make-build.log`
