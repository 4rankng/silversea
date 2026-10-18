# HANDOFF — 2026-10-18 — fix-lcl-group-backend-rb1: review fixes cho LCL group backend (card 181026145000)

Controller: omp agent (REDO of dead agent ee4560e8), worktree
`/Users/dev/.paseo/worktrees/1njkloyy/fix-lcl-group-backend-rb1`.
Updated: 2026-10-18 ~16:00 +0800.

## Goal & status

Independent review của merge `6e6a7c18` (branch `fix-lcl-group-backend`,
commits 940d85ba/40dec192 — phần đó ĐÃ merge, không redo) flag 3 findings;
fixes của session trước chết chưa commit (worktree bị wipe). Task này land
đúng 3 fixes.

**Status: DONE trên branch `fix-lcl-group-backend-rb1` @ `006ba100`, PUSHED
to origin.** Chờ independent review/merge — KHÔNG deploy (owner: NEVER deploy).

## Scope (3 findings → cases LCL-A181026145000-04/05/06)

1. HIGH — `customer-debt-summary.service.ts` revPrincipalRefs đọc order-1 REV
   principal thiếu `isNull(deletedAt)`: ghost principal (soft-delete giữ slot
   order 1, spec §4) shadow principal promote trong note "Ghép cước cùng Bill
   X". → guard mirror `loadPrincipalRefs` (shipment-debit-summary).
2. MEDIUM — `lcl-grouping.service.ts` `updateLclGroupTruck`: sửa BKS thực ghi
   MỌI thành viên nhóm nhưng chỉ assert lô nêu tên → assert mọi thành viên
   (mirror luật `assertGroupMutable` của un-merge) khi `actualTruckNo != null`.
   Billing-only giữ early named-row assert (per-lot law §2.3).
3. LOW — test gap ghost-order-1 deletion: debt note + debit refs
   (`revGroupPrincipalRef`/`freightOverrideReason`) cite Bill principal
   promote, không cite ghost.

Non-goals: không redo backend đã merge; không đụng frontend dispatch UI waves
(09420a7f/5d03793c); không deploy; không merge branch này.

## Decisions / sources

- Ghost-order-1 invariant: soft-delete không strip leaver — ghost giữ
  `rev_group_id` + `revGroupOrder = 1` cùng hàng với principal promote
  (spec §4, `promoteLclGroupsOnShipmentDelete` + `rewriteSurvivors`).
- Note "Ghép cước cùng Bill X" đi qua nhánh fallback `revPrincipalRefs` khi
  lô thành viên không có stamp `trip_financial_state` (trip sinh sau merge) —
  test seed đúng nhánh đó.
- ADR `2026-10-01-audit-todo-policy-rulings.md` + AGENTS.md là contract.

## Files owned

- `backend/src/services/customer-debt-summary.service.ts` (guard + comment)
- `backend/src/services/lcl-grouping.service.ts` (member assert loop)
- `backend/src/tests/lcl-grouping.test.ts` (seed `seedGhostPrincipalRevTrio`
  + tests 04/05/06)
- `testplan/2026-10-18-card-181026145000-lcl-group-backend-spec-audit.md`
  (cases 04–06)
- `qa/2026-10-18_lcl-review-fixes_*.{log}` (force-tracked)

## Unrelated / concurrent (preserved, untouched)

- Sibling worktrees `fix-fb049-penalty-spacing`, `fix-fb095-fb094-controls`,
  `fix-lcl-form-labels-dispatch` + main checkout — không đụng.
- Session sự cố: worktree `fix-lcl-group-backend-rb1` bị wipe giữa research
  phase (không có edit mất); recreate + `pnpm install` + `pnpm --dir shared
  build` rồi tiếp tục. Failure-mode fix đã áp dụng: commit+push NGAY sau gates
  (`006ba100`), không giữ fix uncommitted.

## QA (all exit 0)

- Red-before 3/3 FAIL — `qa/2026-10-18_lcl-review-fixes_red-before.log`
  (note cite ghost `RVW-a1` thay vì `RVW-a2`; case 05 missing rejection).
- Green-after 3/3 PASS — `qa/2026-10-18_lcl-review-fixes_green-after.log`.
- Scoped suites (`lcl-grouping` + `customer-debt-summary` +
  `shipment-debit-summary`, `npx tsx --test --test-concurrency=1`): 76/76 —
  `qa/2026-10-18_lcl-review-fixes_backend-scoped-tests.log`.
- `cd backend && npx tsc --noEmit`: 0 — `..._backend-tsc.log`.
- `pnpm lint`: 0 — `..._lint.log`.
- Full BE/FE suites, build, UI: NOT RUN (scoped backend fix, no UI surface;
  §9 rung 0 cho UI — không claim UI).

## Next step

1. Merge `fix-lcl-group-backend-rb1` (`006ba100` + handoff commit) → main theo
   quy trình (không tự merge, không push main, KHÔNG deploy).

## Independent review (2026-10-18, code-reviewer `ReviewReviewFixes`)

**APPROVE** trên `006ba100` — 3/3 findings closed, không blocking finding.
2 note non-blocking đã xử lý/ghi nhận:
- Comment MEDIUM overbroad (chỉ mirror accounting leg của assertGroupMutable,
  completed-trip freeze cố ý không mirror) — đã sửa comment trong handoff commit.
- Red-pin -04/-06 phụ thuộc row-order của unordered SELECT trong lý thuyết
  (observed 2/2 ghost wins trong env này, có log); post-fix green là
  deterministic (<=1 live order-1 mỗi nhóm).

## Prior state preserved (watchdog handoff 2026-10-18, cards 1–5 — đã merge)

- Deploy chain pending của watchdog (push main → `make demo` staging →
  `make deploy` prod → health checks) — thuộc watchdog, KHÔNG phải task này.
- Held branches khi đó: `fix-fb002-fb030-segment-input` (agent a2fd54b idle,
  gates chưa verify), `fix-181026021137-fb063-header-wrap` (local commit,
  DO NOT MERGE per brief). Trạng thái hiện tại cần verify lại trực tiếp.

# HANDOFF — 2026-10-18 — card 181026143000 LCL form labels + dispatch sync

Controller: agent session `fix-lcl-form-labels-dispatch` (worktree
`/Users/dev/.paseo/worktrees/1njkloyy/fix-lcl-form-labels-dispatch`,
branch `fix-lcl-form-labels-dispatch`). Last updated: 2026-10-18 ~16:00.
Handoff trước (watchdog cycle đã merge + docs-only verification card) nằm
trong git history của branch này.

## Goal & status — DONE (code + rung 3)

Spec 2026.10.17 (docx `doc_58c2e6857719`, brief /tmp/silversea-army2):
§1a–§1d form LCL + §2 dispatch sync. Phần lớn đã có tại base nhờ FB-105
(`5a17e299` + `3628dae4`). Phiên này drive UI rung 3 toàn chuỗi, tìm và sửa
**2 defect thật** (commits trên branch):

1. `032145a2` fix(forms) §1a — kho quick-add dialog đặt tên theo chiều:
   Xuất khẩu = «Thêm kho trả hàng», Nhập/neutral = «Thêm kho lấy hàng»
   (trước fix: hard-code «lấy hàng» cho cả 2 chiều — đúng lớp lỗi spec nêu).
   Files: `OperationalSiteCreateDialog.tsx` (prop `tradeDirection`),
   `ShipmentCreateModals.tsx`, `ShipmentCreateWorkspace.tsx`, test trong
   `ShipmentCreateWorkspace.lcl-points.test.tsx`.
2. `21121f90` fix(forms) §1c — nút «+ Thêm kho» chuyển về class dùng chung
   `csc-utility-button csc-utility-button--dashed` (bỏ inline palette + fallback
   XANH `#2563eb`, đúng emerald house tokens + one-pattern rule).
   File: `ShipmentCreateLclRouteSection.tsx`, test同 file.

BE không đổi (dispatch shape đã đúng; BE scoped tests xanh lại unchanged).

## Spec-item → file → test (map đầy đủ trong
`testplan/2026-10-18-card-181026143000-lcl-form-labels-dispatch.md`)

§1a label NK/XK + placeholder → `ShipmentCreateLclRouteSection.tsx` +
`OperationalSiteCreateDialog.tsx` (fix) → lcl-points tests + driver rung 3.
§1b validation + ad-hoc waiver → `shipment-create-model.ts` → model tests +
asterisk-contract. §1c combobox + Thêm kho/nhà máy → `ShipmentCreateLclRouteSection.tsx`
(fix class) → lcl-points + ClerkShipmentCreatePage TC-CUS-FACTORY-SEARCH-09.
§1d layout → workspace + `ShipmentCreateLclCargoFields.tsx` → lcl-points.
§2 dispatch 2 màn → `liftDropPoints.ts` + `MasterPlanGrid` + `DetailedPlanGrid`
+ BE `dispatch-planning-detail-plan-read.service.ts` → liftDropPoints /
lcl-display / DSP-PORT-02 / `dispatch-plan-lift-drop-lcl.test.ts`.

## Chỗ spec mơ hồ — cách quyết (chi tiết trong testplan)

1. Premise «label fix cứng» stale ở form (FB-105 đã sửa) nhưng CÒN ĐÚNG ở
   dialog title — đó là 2 defect phiên này sửa.
2. Chưa chọn chiều → label trung tính (pinned có chủ đích).
3. Kho cũng bắt buộc (spec vẽ «*» trên label; validation yêu cầu cả 2 điểm).
4. «Cảng nâng/Nâng hàng» là 2 tên cột trên 2 màn — cùng đọc một rule
   `resolveLiftDropPoints`.
5. Tên gõ tay lưu pickup/delivery_location, hiện đúng cột theo chiều.

## Gates (log trong qa/2026-10-18_lcl-form-labels-dispatch_*.log + 181026143000_*)

- FE vitest scoped 10 file: **245/245** (243 base + 2 fix tests), EXIT 0.
- BE scoped 3 suite (dev DB): 4/4, EXIT 0. FE `tsc -b` 0 · BE `tsc --noEmit` 0
  · root `pnpm lint` 0 · `make build` 0.
- UI driver rung 3 `testplan/qa/scripts/2026-10-18-181026143000-lcl-form-dispatch.mjs`:
  ALL PASS — §1a/§1c/§1d DOM asserts + dialog title 2 chiều, §1b blocked
  submit, TẠO THẬT 2 lô LCL (IMPORT+EXPORT), detail API persisted đúng chiều,
  `/dispatch` + `/dispatch-detail` cột Nâng/Trả đúng chiều. Screenshots
  ui-1..9 + driver.log (exit 0).
- Width sweep `…-widths.mjs` 390/768/1440: dashed class + dialog title + fits,
  ≤40px. widths.log exit 0.

## Coverage table (§9)

| Claim | Rung | Evidence | Not covered |
|---|---|---|---|
| §1a label/placeholder/dialog title | UI DRIVEN | ui-1..3, ui-5/5b png + driver.log | role khác ADMIN |
| §1b validation + waiver | UI DRIVEN (blocked submit) + model tests | ui-6 png; ad-hoc waiver chỉ assert qua test (driver không click «Lệnh chạy ngoài») | ad-hoc click-through thật |
| §1c combobox + 2 nút Thêm | UI DRIVEN | ui-4/5/5b + width png | tạo site thật qua dialog (chỉ cancel) |
| §1d layout 2 card | UI DRIVEN | driver.log DOM assert | — |
| §2 dispatch columns LCL | UI DRIVEN | ui-8/9 png + detail API rows (lots QA-181026143000-*) | role khác; tháng ≠ 10/2026 |

## Files owned / next step

- Code: 2 commits trên (032145a2, 21121f90) + evidence commit này.
- Side-effect trên dev DB: các lô QA `QA-181026143000-*` (có chủ đích, không
  cleanup). Vite worktree :7176 vẫn chạy (nếu cần lại: `cd frontend && npx vite
  --port 7176 --strictPort`, KHÔNG set VITE_API_BASE — proxy /api đã đúng).
- Next: owner review + merge; card 181026143000 đóng như duplicate-verified +
  2 fix.
