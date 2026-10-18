# HANDOFF — 2026-10-18 — staged to prod: 171026123000 roster-inactive-units + 171026154000 cargomode-filter

Controller: watchdog cron (Hermes), main checkout `/Volumes/LexarSSD/projects/silversea`.
Merged on 2026-10-18 ~02:10 local. **BOTH** feature branches had gates-green
HANDOFFs sitting on orphan worktrees waiting for trunk merge; golden rule
says merge → push → staging → prod AUTOMATICALLY once scoped gates pass,
so they are shipped together in a single deploy chain.

## Card 1 — 171026123000-roster-inactive-units (merged b347bec4)

**Goal**: `/hr/roster` dropdown "Lọc theo bộ phận" liệt kê unit INACTIVE
("QA Audit Unit 0914") sau khi staging deactivate 5/5; cột BỘ PHẬN cũng
render tên INACTIVE. Owner direction 2026-10-17 (hướng b): ẩn unit
INACTIVE ở roster, không đụng data, không sửa purge tool.

**Code changes** (5 backend services + 1 frontend page + tests):
- `backend/src/services/{user, dispatch-plan-conflict-scan → -382,
  dispatch-planning-detail-plan, trip-create, trip-figure-updates,
  trip-lifecycle-ops}.service.ts` — hide-INACTIVE projection; conflict scan
  service split into detail-plan.
- `backend/src/tests/{hr-roster-read, dispatch-overlap-day-only-trips,
  deposit-bill-suggestions}.test.ts`
- `frontend/src/pages/HrRosterPage.{tsx,test.tsx}` + `TripListPage.tsx`
  + `accounting/DepositRefundTrackerPage.{tsx,test.tsx,css}` (latter 3
  share a dep-bill-lookup cleanup patch with card 2).
- `testplan/2026-10-18-card-171026123000-roster-inactive-units.md`

**Gates (scoped, owner-scoped conventions)**:
- `pnpm lint`: 0 errors, 5 warnings (all pre-existing).  exit 0
- `cd backend && npx tsc --noEmit`: exit 0
- `cd frontend && npx tsc -b`: exit 0
- `make build`: built in 13.33s, exit 0
- BE scoped (hr-roster-read + qa-fixture-purge): 22/22 pass, exit 0
- FE scoped HrRosterPage: 4/4 pass, exit 0
- UI driver 11/11 pass (admin port :7178, dev DB :5441): Bộ phận '—',
  dropdown "Tất cả bộ phận" (no INACTIVE), API `/auth/users/roster`
  identity clean, DB fixture unchanged (read-only hide), 768/390 ok.
- Full BE/FE suites: NOT RUN (owner-scoped gates; scoped suites covered
  every test file touching changed modules).
- `/Users/dev/.paseo/worktrees/1njkloyy/fix-171026123000-roster-inactive-units/qa/2026-10-18_roster-inactive-units_backend-tsc.log`
  ...single FAIL captured 00:30 in `*-red.log` was superseded by green
  rerun 00:33 after comment fix; final state is exit 0.

## Card 2 — 171026154000-cargomode-filter (scope C) (merged after Card 1)

**Goal**: on `DispatchDetailPlanPage`, when only one lot is drivable, the
"Gán xe nhóm" (assign a truck to a group) action must explain WHY it is
disabled in plain text — selection-bar reason, not just an inert disabled
button — so the operator reads the reason instead of guessing.

**Code changes** (frontend only, plus QA artifacts):
- `frontend/src/pages/DispatchDetailPlanPage.{tsx,
  lcl-assign-reason.test.tsx}` — selected-group reason text surfaced,
  `aria-disabled="true"` + `aria-describedby` pointing at reason, handler
  guard on click, replaced `disabled` CSS with `[aria-disabled='true']`
  (DisabledActionTip variant description-as-text pattern).
- `frontend/src/pages/DispatchPlanPage.css` — styling update for the
  aria-disabled button state.
- Testplan: `testplan/2026-10-17-card-171026154000-cargoMode-filter.md`
  + `testplan/qa/scripts/2026-10-18-171026154000-c-assign-reason.mjs`
- Scope A (`cargoMode` filter on dispatch) was ALREADY in main before this
  worktree was created; re-verified here: BE regression 2/2 + FE cargo-mode
  test + dispatch-page vitest pass. **No new code** for A in this merge.

**Gates**:
- `cd backend && npx tsc --noEmit`: EXIT:0
- `pnpm lint`: EXIT:0
- BE `cargoMode` regression test: 2/2 pass, EXIT:0
- FE `tsc -b`: EXIT:0
- FE hardening rerun (`DispatchDetailPlanPage`): EXIT:0
- FE dispatch-pages vitest (scoped): EXIT:0
- UI driver: 19/19 checks pass — selected-bar reason visible verbatim,
  aria-disabled + aria-describedby + title set, guarded click writes no
  API, dialog opens when two lots drivable, phone reason text present,
  DB-driven rows unchanged.
- Evidence: `qa/2026-10-18_171026154000_c_*` (be-tsc, lint,
  be-cargoMode-test, fe-tsc, fe-hardening-rerun, fe-dispatch-pages,
  driver.log, 5 ui screenshots).

## Merge mechanics

- Both branches branched off `main @ 1105d184`. File overlap on
  `TripListPage.tsx` + `accounting/DepositRefundTrackerPage.{tsx,css,test.tsx}`
  + `useTripFormDispatch.ts` + `testplan/...deposit-bill-lookup-digits.md`
  was IDENTICAL diff in both branches — git auto-merged with no conflict.
- HANDOFF.md content conflict each merge — resolved by writing this
  combined document covering BOTH cards (replaces both per-card
  HANDOFFs which are now archived in the merged-in worktrees).

## What did NOT ship this cycle

- `fix-171026205400-bai-ha-regression-rb1` (FB-020): WIP branch, gated
  scoped (lint+tsc+scoped BE+scoped FE all green, FE FULL vitest
  5059/5060 with 1 PRE-EXISTING dev-port-contract offender unrelated to
  this ticket). Not merged because agent `rb2` is STILL ALIVE on the
  same ticket slug with active eslint+tsc children producing WIP commits
  in `fix-171026205400-bai-ha-regression-rb2`. Will be reviewed next
  cycle once rb2 finishes or hits its gated-deliverable state.
- `fix-fb002-fb030-segment-input` (FB-002 + FB-030/075): agent `a2fd54b`
  is idle, commit `5ef5ace7` on branch is the fix for FB-002 (Enter on
  hand-typed segment saves through host). Gates not yet verified; HOLD
  for next cycle unless gates evidence appears.

## Deploy chain (pending)

1. `git push origin main` (this branch)
2. `make demo` → staging vantai.tingting.vip
3. `make deploy` → prod silversea.tingting.vip
4. `GET /api/health` on both, capture buildHash

(Watchdog will execute this chain automatically per skill golden rule.)

## Card 3 — 171026205400-bai-ha-portless (merged from rb2 worktree)

FB-020 (portless IMPORT must name delivery site as "Cảng hạ" not "Chưa có cảng hạ"):
gated green on rb2 at 3fd77532 (3 commits ahead of main). Pre-merge evidence:
- root lint 0, BE tsc 0, FE tsc 0, make build 0
- FE vitest full 5070/5070 (657 files)
- BE node:test unit 300/300; integration 3267/3302 pass — 35 fail RED-AT-BASE
  pre-existing on shared dev DB (verified by detached re-run at 9fd0553c),
  unrelated to FB-020; FB-020's own 3 tests green at HEAD.
- Zombie suites from orphan worktrees (cont-type-dropdown, salary-mode-dialog,
  bai-ha-regression-rb1) killed before serial gate run; gate ran alone once.
See HANDOFF.md in pre-merge worktree (rb2 worktree gone post-cleanup) and
qa/2026-10-18_fb020_*.{log,md} for full evidence.

## Card 4 — 181026021137-fb063 header-cot-wrap (worktree fix, NOT merged)

FB-063 "header cột wrap nhiều dòng" (docx GDrive unreadable; surface identified
by measurement). Surface: `/accounting/invoice-tracking` ("Theo dõi hóa đơn" —
accounting bảng kê), `.record-table` inside `.invoice-tracking-page`:
"NHÀ CUNG CẤP" wrapped 3 lines in a 61px column + 5 headers 2 lines at 1440px
(quantified in testplan/2026-10-18-card-181026021137-fb063-header-cot-wrap.md).
NOT /dispatch-detail (already one-line law) and NOT /shipments (≤2 lines —
within the 1–2 line acceptance).

**Code change** (header-scoped, one page):
- `AccountingInvoiceTrackingPage.css`: thead th `white-space: nowrap` +
  `padding-inline: 8px` (label = one line, auto-layout floors columns at
  label width, Law §4); NEW `tbody td { padding-inline: 6px }` width trade —
  one-line labels at base gutters measured 1250px and cut the action pair
  off-screen (rejected), 6px body gutter lands 1180px vs pre-fix 1190px
  (narrower; "Thao tác" more visible than before).
- Styles test pin for both load-bearing halves; TSX comment-only.

**Gates**: fe-tsc exit 0; scoped vitest 43/43 (5 files incl. styles + production
numeric-identity pins); root lint 0; `make build` 0. UI driver (read-only
measure, admin): invoice-tracking 0 wrapped headers at 1440/1024/768, board
1180 < 1190; sibling surfaces unchanged (shipments ≤2, dispatch 0, phoi-phieu
deliberate 2). Before/after screenshots + budget logs under
qa/2026-10-18_fb063_*.

**Coverage limits**: PayableDetailPage "Bảng kê thanh toán" ledger not measured
(`/api/suppliers/1` returns "Lỗi máy chủ" — pre-existing, rung 0); sibling
record-table surfaces beyond the brief's named candidates not swept (same
defect class would need its own card). Verification ran on worktree vite :7176
because :7175 was taken mid-session by the main checkout's frontend (PID 99794
— untouched); API shared at :3002. Branch `fix-181026021137-fb063-header-wrap`
— commit local, DO NOT merge per brief.

## Wave — red-at-base BE wave 1: heSo surcharge + card-197 negative costs (worktree fix-be-reds-wave1)

Scope: 2 suites red at base `8fc1bcf5` — `heso-surcharge.test.ts` 5/5,
`card197-negative-cost-totals.test.ts` 5/10. Test-only fixes; NO service code
changed (brief's suspects `488b007f`/`8f3a42e8` exonerated by arithmetic).

### Cluster A decision — NOT a formula change
The engine prices fuel at the LATEST `fuel_price_periods` row ≤ transport date;
that table is GLOBAL on the shared dev DB. The suite pinned fixed dates
(period 2026-09-01 @ 29.940, transport 2026-09-15) and a stray row
(`id=207`, 30000 @ 2026-09-09 — in no seed, no test source; QA/manual debris)
outranked the fixture: Δ exactly +60đ/ℓ ⇒ 243148/267463/778074 = the reds.
Fix = suite owns an unoccupied far-future window (fuel-period-envelope
pattern), all worked-number assertions unchanged (card 20260922_59's pin
241948/266143/774234/696811/1100864 intact).

### Cluster B decision — three INTENDED contracts postdate the fixtures
1. `shipmentId` required in `expenseAccountingCreateSchema` — card 20261005
   (commit `2a64156f`) ⇒ `createBase` gains `shipmentId: 1`.
2. Tiền-đường rows key `sourceId` on `expense_accounting_sources.id` — card
   20261005_373 "lần 2" (same commit, the Từ-chối 404 fix) ⇒ listing
   assertions key on the source id (`mkDriverCost` now returns it).
3. Duplicate-entry guard 409 on same type+scope — card 141026230720 (commit
   `030e8e42`), with its documented `duplicateConfirmed` override ⇒ the three
   save-path calls carry the override (the fixture's `mkPriorExpense` IS the
   guard's trigger by design).
Service invariants intact and still pinned: negative cost ⇒ 0 receivable,
negative override refused by name, totals exclude negative rows.

### Gates (evidence: qa/2026-10-18_reds-wave1_*)
- `cd backend && pnpm exec tsx --test src/tests/heso-surcharge.test.ts
  src/tests/card197-negative-cost-totals.test.ts` → 15/15, exit 0 (run twice).
- Sibling smoke `freight-pricing-engine + q61-fuel-period-guard +
  surcharge-threshold-confirmation` → 11/11, exit 0.
- `cd backend && npx tsc --noEmit` → 0. `pnpm lint` → 0.
- testplan case: `testplan/2026-10-18-reds-wave1-heso-and-negative-cost.md`.

### Skipped / follow-up (NOT in wave-1 scope)
- `surcharge-rounding.test.ts` — SAME stray-period root cause (fixture pins
  2026-09-01/2026-09-15; red shows the same shadow-price signature). Needs
  the same hermetic-window fix in a later wave; NOT fixed here because the
  brief scoped wave 1 to the two suites above.
- Shared-DB hygiene: ~56 far-future leftover `fuel_price_periods` rows from
  other suites + stray id=207 left in place — deleting shared rows can change
  other suites' behavior; needs a dedicated hygiene pass with owner sign-off.
- Remaining ~39 of the 44 base failures: unexamined, other waves.

## Card 5 — 111026105610 "QA Audit Unit 0914" vẫn hiện ở /users (worktree fix)

**Entity**: `business_units` row, name "QA Audit Unit 0914" — dữ liệu fixture QA,
KHÔNG phải master data. Không có mặt trong seed/reset-seed (grep toàn repo chỉ ra
nó ở comment/test/purge registry); nó do QA script tạo trên staging. Không có
migration nào cần viết — không sửa schema.

**Hành vi đã chọn**: purge `business_units` đổi `deactivate` → `hard-delete`
(`backend/src/seed/qa-fixture-registry.ts`). Fixture QA bị xoá hẳn thay vì để
lại row INACTIVE.

**Vì sao KHÔNG lọc INACTIVE ở /users** (đây là câu hỏi QA đặt ra, trả lời tường
minh):
- `/users` khác `/hr/roster`. Mọi bề mặt GÁN của /users đã lọc ACTIVE sẵn và
  không thể hiện unit INACTIVE: `loadUsersBusinessUnitIdsMap` join
  `business_units.status='ACTIVE'` (user.service.ts:267-289),
  `UserAddPanel`/`UserEditPanel` lọc ACTIVE ở client.
- Chỗ duy nhất "/users hiện QA Audit Unit 0914" là catalog "Đơn vị phụ trách"
  (`BusinessUnitsManager`) — một bề mặt quản trị VÒNG ĐỜI, cố ý liệt kê cả
  INACTIVE kèm nút "Kích hoạt lại". Ẩn INACTIVE ở đây = xoá vĩnh viễn khả năng
  hoàn tác một lần ngừng sử dụng nhầm, và làm hỏng test đang pin reactivate
  (`UsersPage.business-units.test.tsx`). Đây là quy ước chung của repo, không
  phải sơ suất: `routes/config/catalog-crud.routes.ts:118-122` — "the admin
  surface must see inactive rows too (deactivate → still listed → reactivate),
  while dispatch readers only ever see active zones".
- Nói cách khác: /hr/roster đã đúng luật; /users đã đúng luật; **dữ liệu** mới
  là sai. Sửa dữ liệu rẻ và giữ nguyên mọi năng lực sản phẩm; sửa hiển thị
  sẽ đánh đổi năng lực lấy một dòng fixture.

**An toàn của hard-delete**: entry `user_business_unit_links` đã hard-delete và
chạy TRƯỚC (children → parents, có assert trong test); `user_business_unit_links`
là bảng duy nhất tham chiếu `business_units` và không có ràng buộc FK
(`db/schema/core.ts:53-76`).

**Gates**: BE tsc 0; root lint 0; scoped `qa-fixture-purge` + `hr-roster-read`
22/22; red-at-base đã chứng minh (revert action → test mới FAIL).
Artifacts: `qa/2026-10-18_users-qa-unit-purge_{tests,tsc}.log`.
Case: `testplan/2026-10-18-card-111026105610-users-qa-unit-purge.md`.

**Cần chạy lại ở môi trường QA**: purge phải được chạy lại (`qapurge-dry` →
`qapurge`) thì row mới bị xoá. Đây là thay đổi công cụ purge, không tự động
xoá dữ liệu đã tồn tại.

**Rung**: UI chưa drive trong phiên này — thay đổi nằm ở công cụ purge
backend. Bằng chứng ở mức DB/API VERIFIED (rung 2): test chứng minh row biến
mất khỏi `business_units` và khỏi `listBusinessUnits()` — đúng nguồn dữ liệu
mà /users render. Chưa chụp màn hình /users sau purge.

**Independent review** (`code-reviewer`, read-only): 8 findings, 0 blocking.
Đã xử lý: F1 (claim "chỉ user_business_unit_links tham chiếu business_units"
SAI — còn `shipments.responsible_unit_id`, `salary.payroll_business_unit_id`,
snapshot `payroll_business_unit_id`; đã viết lại rationale + ghi rõ dangling-id
và rằng mọi reader đều lọc ACTIVE nên hành xử y hệt row INACTIVE), F2 (cảnh báo
KHÔNG thêm guard `shipments.responsible_unit_id` — guard lookup bỏ qua
`deleted_at`, sẽ match shipment đã soft-delete và khiến mọi QA unit bị skip
vĩnh viễn, purge exit 2, bug quay lại), F3 (comment "deactivate below" + label
thiếu /users), F4 (sai attribution commit f983a1b3; entry registry đến từ
eb7a8e95 / 2c3668f4), F8 (thêm assert idempotency chạy purge 2 lần).
F5/F6/F7 là vấn đề báo cáo — đã nêu đúng rung và giới hạn gate bên dưới.
