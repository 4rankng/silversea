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
