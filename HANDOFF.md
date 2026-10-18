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

## Card 5 — 171026215500-fb030-075 advance regression (worktree fix, PUSHED)

QA re-test on staging `8fc1bcf5`: "gõ '14' không tự nhảy sang tháng" in the
"Chỉnh sửa Lịch trình" surface. Branch `fix-fb030-advance-regress` off
`8fc1bcf5`, commit **c58f570e**, pushed to origin.

**Investigation (the delta)**: live probes on the pinned quick-edit dialog
PASS on `8fc1bcf5` in dev AND `vite build` output — including QA's exact
fixture lot 130022 (prefilled 20/10/2026 + 15:45, the complete-draft parent
echo path): day "14" → month focus everywhere (probes a1–a4, a6/a6b, b1/b2).
The real regression is probe **c2**: the `/shipments-detail` container ledger
inline schedule editor (`ScheduleEditorBody`) renders TimeInput WITHOUT the
FB-030 `onComplete` hand-off — 53eb9f2a wired it only in `CusQuickEdit`
(sibling sweep miss; unit tests green because no test covered the ledger
host's giờ→ngày hand-off). Focus stuck in the giờ box → the follow-up day "14"
typed into giờ → date segments never advance → QA's exact symptom.

**Code change** (c58f570e):
- `frontend/src/features/shipments/detail/ShipmentContainerScheduleEditor.tsx`:
  `TimeInput onComplete` → focus the appointment date `[data-seg="dd"]` via
  `groupRef` — exact `CusQuickEdit.tsx:86-87` pattern.
- `.../ShipmentContainerScheduleEditor.test.tsx`: regression test
  (red-before 1 failed / green-after 13/13).
- `testplan/2026-10-18-fb030-075-advance-regression.md` + probe driver
  `testplan/qa/scripts/2026-10-18-fb030-advance-live-probe.mjs` (read-only,
  mutation monitor 0).

**Gates (all exit 0)**: forms vitest 216/216 (26 files); host suites
231/231; full FE suite **5095/5095** (660 files); `npx tsc -b`; root lint;
`make build`. Logs `qa/2026-10-18_fb030-advance_fix/*.log`
(`fe-hosts-vitest-red-before.log` = the failing-before run).

**Rung 3**: probes 12/12 green post-fix on dev (`ui-driver-dev.log`) and
production build (`ui-driver-prodbuild.log`), screenshots `ui-dev/` +
`ui-prodbuild/`. Pre-fix FAIL evidence (c2 `pass:false` with full DOM state):
`qa/2026-10-18_fb030-advance_repro/probe-run.log` (dev) +
`qa/2026-10-18_fb030-advance_prodbuild/probe-run.log`. Disclosure: the
repro-dir PNGs were overwritten by post-fix runs (driver OUT was hardcoded;
now `QA_OUT` overridable) — text records are the surviving pre-fix evidence.

**Independent review**: code-reviewer `ReviewFb030Fix` — APPROVE, no required
fixes (ref/keyed-remount, disabled, IMPORT/EXPORT, pattern parity, test
quality, full TimeInput host sweep verified; 3 info-only notes).

**Coverage limits**: mobile sheet ≤640px and non-cus roles not driven; LCL
"Ngày vận chuyển" has no natural time→date hand-off (out of scope);
`DispatchTimeFilterField` is a filter with no next field (unchanged by
design). Staging re-verification by owner after deploy (production
prohibition — staging not driven from here).

## Card 6 — fb109-fb113 popup "Chỉnh sửa chứng từ và hãng tàu" (worktree fix, PUSHED)

- **Surface/component**: CUS Chi tiết lô (`/shipments-detail`) popup editor
  `ShipmentContainerLedger` `mode="documents"` ("Chỉnh sửa chứng từ và hãng
  tàu"), hosted by `ShipmentContainersPage` via `useCusDetail.saveDocuments`.
- **API flow**: Lưu → `PATCH /shipments/:id` (Bill/Booking/Nhập-Xuất/Hãng tàu)
  + `POST /shipments/cus-workspace/:id/containers/:contId` (per-cont tờ khai —
  BE `updateCusShipmentContainerLine` ghi số + auto-copy sang cont còn trống +
  heal fulfillment trong 1 transaction, trả `declarationSync.updatedContainerIds`);
  nút copy → `POST .../copy-declaration` (empty-only, never overwrite).
- **Behavior**: FB-113 — thứ tự trường Số Bill/Booking → Số tờ khai →
  Nhập/Xuất → Hãng tàu (test DOM-order pin, mutation-checked). FB-109 — số tờ
  khai persist per-cont (reload-survives) + auto-copy CHỈ sang cont còn trống,
  cont đã có số không bị ghi đè; clear cục bộ. Luật 171026180010 (ghi đè mọi
  sibling) ĐƯỢC THU HẸP theo design note card FB-109 — xem Amendment
  2026-10-18 trong `testplan/2026-10-17-tokhai-save-sync.md`; driver cũ
  `qa-20261017-tokhai-save-sync-ui.mjs` gắn banner SUPERSEDED.
- **Gates**: be-tsc 0, fe-tsc 0, lint 0, FE scoped 75/75 (ledger +
  declarations), BE declaration suite 10/10 — `qa/2026-10-18_fb109_*`,
  `qa/2026-10-18_fb113_*`. Independent review `Fb109Review`: core VERIFIED;
  findings 1-3,5 landed (stale driver banner, testplan superseded markers, R2
  retitle, evidence cites). Finding 4 còn mở (minor): blank-arm predicate
  `btrim` không cắt tab/newline + chưa có fixture sibling whitespace-only —
  không reachable qua app writes (trimOrNull), cần follow-up nếu có legacy
  seed rows.
- **Coverage**: UI rung 0 (không drive popup this session — orchestrator cắt
  scope, QA verify trên staging); rung 2 qua BE integration tests trên dev DB
  (:5441). Full FE suite có 2 fail pre-existing `numeric-identity.styles`
  (cần `make build` ra dist/assets — build-prerequisite, không liên quan diff).
