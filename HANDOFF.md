# HANDOFF — 2026-10-19 — CUS display x5 (cards 191026181942) — gate + evidence re-drive

Controller: omp agent, worktree `/Users/dev/.paseo/worktrees/1njkloyy/fix-cus-display-rb1`,
branch `fix-cus-display-rb1` (off `main` = `cd1fc396`).

**Status**: the five-card code ALREADY landed at HEAD via `79f0b10d` (merged
`cd1fc396` = origin/main). This run verified each card against the brief
(LCL lịch truth-wins predicate · empty-allocation "Chưa phân xe" muted chip ·
`emptyDayCargoLabel` cargoMode wording · CBM suppress + zero-count signal mute ·
NameCell short-name layer) and produced fresh verification artifacts only — no
code delta. Rung-3 evidence re-driven against THIS tree (driver
`testplan/qa/scripts/2026-10-19-cus-display-five-cards-rung3.mjs`, `QA_BASE`
env override added in `68dd2bac` — a salvage-guard auto-commit of the dirty
edit; dev contract ports :7175/:7176 were occupied by unrelated worktrees'
servers, ephemeral vite :7178 used instead, then stopped; :3002 served
identical backend code from the main checkout).

**Findings**: (1) `ShipmentsPage.test.tsx` "opens one compact edit dialog…"
is load-sensitive flake — 3 reds under 4-way agent CPU saturation (5s/15s
timing), green on a light box and with instrumentation; bisect (pre-merge
`CusShipmentRow`+`ShipmentContainerLedger`) exonerates the five-card merge.
Suspected mechanism: the animated modal exit keeps `role="dialog"` mounted
past the unnamed `findByRole('dialog')` window. Left for the closeout-
workspace test-hygiene owner; not part of the display cards. (2) Card 7's
"max-w + truncate (CSS ellipsis)" pattern is implemented as the law-conformant
wrap + accessible tooltip — `table-no-truncation.styles.test.ts` (law §4)
bans ellipsis on data cells; pinned in testplan case R5.

**Gates** (`qa/2026-10-19_cus-display-five-cards_gates.log`): `tsgo -b` 0 ·
`tsc -b` 0 · scoped vitest 270/270 · `pnpm lint` 0 · RUNG3 DRIVE PASS
(`qa/2026-10-19_cus-display-five-cards_ui-driver.log` + 7 card screenshots).

**Limits**: DB rows unchanged this run (read-only drive; identity file from the
original run still accurate); route/carrier short names depend on master-data
`shortName` (absent → full name renders, still tooltip-accessible); the
Kế hoạch kehoach shot samples an unconfigured customer (full name + tooltip).

---

# HANDOFF — 2026-10-19 — FB-030/075 auto-advance (verified fixed) + FB-066 quick-add BKS

Controller: omp agent, worktree `/Users/dev/.paseo/worktrees/1njkloyy/fix-fb030-fb066`,
branch `fix-fb030-fb066` (off `38a2d814`). Updated 2026-10-19. **DONE — committed
`22c9c80b` + PUSHED to origin.**

**FB-030/075** (gõ ngày/giờ không tự nhảy segment — brief "regression lần 3"):
verified **FIXED at HEAD, NO code change**. Live rung-3 puppeteer drive of the
exact QA-named surface (quick-edit "Chỉnh sửa Lịch trình" dialog, account `cus`)
proved day "14" → month segment (`activeSeg: mm2`) and Giờ "1430" → day
hand-off (`activeSeg: dd`); screenshots
`qa/2026-10-19_fb030-fb066_repro/fb030-dialog-after-{day14,gio1430}.png`. The
R23 FAIL (batch B5 Kế toán) was staging build **`597e4c84`**, which git-ancestry
CONFIRMS predates BOTH prior fixes (`4efa6e2c` ledger onComplete, `692522c1`
TimeInput HHmm normalise). No R25 QA report exists — `/tmp/req/r25.md` is the
LCL Gán xe nhóm guide, not a verdict. Did NOT fabricate a redundant fix.

**FB-066** (thiếu nút thêm nhanh BKS): the LCL "Gán xe nhóm"
(`AssignTruckGroupDialog`, r25 guide step 3 + lclspec) and "Đổi BKS nhóm"
(`LclGroupTruckEditDialog`, chungtu-dieuvan B.1) BKS thực pickers had free-text
`gõ mới` but NO quick-add registration button. Added shared
`components/shared/QuickAddButton` (+css — ONE implementation, no third CSS
copy) and wired the existing `QuickAddVehicleDialog` (internal truck POST
/trucks, external xe-ngoài POST /carrier-fleet-vehicles) to both dialogs; the
created plate is preselected and folds into the option list (`fleetNonce`
re-runs the fleet fetch; own-fleet refetches the catalog).

Regression pins: `AssignTruckGroupDialog.test.tsx` (external + own-fleet),
`LclGroupTruckEditDialog.test.tsx` (existing-nhà-xe). Regression plan:
`testplan/2026-10-19-fb030-075-fb066-advance-quickadd.md`. Drivers:
`testplan/qa/scripts/2026-10-19-fb030-fb066-repro.mjs` (FB-030),
`…-fb066-quickadd-rung.mjs` (FB-066).

**Gates** (`qa/2026-10-19_fb030-075_fb066_gates.log`, force-tracked): `tsgo -b`
0 · `tsc -b` 0 · `pnpm lint` 0 · scoped vitest 8 files/149 tests (TimeInput,
DateTimeSegments+hosts, ShipmentContainerScheduleEditor, both LCL dialogs,
DispatchPlanEditorCell, DispatchDetailPlanPage.lcl-assign-reason). UI rung 3
screenshots force-tracked under `qa/2026-10-19_fb030-fb066_repro/` +
`qa/2026-10-19_fb066_quickadd/`. Ephemeral stack (backend :3003, frontend
:7178 → dev DB :5441) STOPPED after capture; the other worktree's :3002/:7175
were untouched.

**Limits**: FB-066 plate-create POST not exercised end-to-end in the drive
(button presence + dialog-open proven); FB-030 mobile ≤640px and non-cus roles
not driven; FB-030/075 needs owner re-verification on the NEXT staging build
that contains `4efa6e2c` + `692522c1` (production prohibition).

---

# HANDOFF — 2026-10-19 — card 182300: lái xe chỉ XEM "Tiền đường" (chiphispec §1)

Controller: omp agent, worktree `/Users/dev/.paseo/worktrees/1njkloyy/fix-driver-tienduong`,
branch `fix-driver-tienduong` (off `64f81514` = origin/main). Updated: 2026-10-19.

## Goal & status — DONE (code + gates + UI rung 3; committed + pushed, see Git)

Spec §1: "tiền đường hệ thống tự ghi; kế toán được chỉnh; lái xe chỉ xem".
Two lanes of one defect class (driver-written Tiền đường money) fixed:

1. **Create** — fee-norm rows (Trả đêm…, `costType` forced ROAD_ALLOWANCE by the
   norm) used to store the driver's "Thực chi": `insertDriverIncidentalCostTx`
   now IGNORES a divergent amount and stores the SYSTEM norm figure in both
   `amount` and `driverEnteredAmount` (card 20260921_7 AC3 "overridable" is
   SUPERSEDED by this card). Non-norm road rows keep the driver actual.
2. **Edit** — `updateAccountingExpense` non-finance branch (DRIVER/OPS) now 403s
   ANY update of a native ROAD_ALLOWANCE/LIFT_DROP_ZONE DRIVER row (message
   "Khoản này do hệ thống tự ghi nhận — kế toán điều chỉnh tại màn hình phơi
   phiếu."). Keyed on NATIVE costType (source metadata can lag). Finance
   (`requireExpenseFinance`) + phơi phiếu `correctAccountingExpense` untouched.
3. **FE** — norm-row "Thực chi (VND)" is `disabled`, showing the system value
   with copy "Hệ thống tự ghi nhận theo định mức …"; sibling options (Vé cầu
   đường, Tiền đường khác …) stay editable.

Cases TD-RO-01..04: `testplan/2026-10-18-card182300-driver-tien-duong-readonly.md`.

## Gates (`qa/2026-10-18_card182300_gates.log`, force-tracked)

BE tsc 0 · FE tsgo -b 0 · FE vitest scoped 38/38 · BE m84 10/10 (incl. the new
TD-RO-02/03/04 test) · root lint 0 · sibling accounting suites (source +
remediation + phoi-phieu-control) 74/74. UI rung 3 via
`testplan/qa/scripts/2026-10-18-card182300-tienduong-readonly-ui.mjs` exit 0 —
local stack serving THIS worktree (frontend 7178 → backend 3003 → dev DB;
7176 was occupied by another lane); shots `qa/…_ui-01/02/03*.png` + driver log;
fee-norms API identity NIGHT_RETURN amount=100000 == locked display 100.000.

## Not covered / limits

- Offline driver mobile queue (separate app) — the server-side ignore-field
  governs it; no client update shipped here.
- Staging drive not performed (local-only default); both ephemeral services
  (7178/3003) STOPPED after capture.

# HANDOFF — 2026-10-18 — card 191026100020: LCL hoàn thiện — xác minh 10 work items = ĐÃ CÓ trên main

Worktree `fix-lcl-hoan-thien-v2` (= origin/main `20d4cb27`, 0 lệch).

**Goal**: brief card 191026100020 liệt kê 10 work items (DM trọng tải/bảng
giá, fix "Chưa có cont", CONTAINER 3 dòng, tag Ghép, ghép cước thu khách,
PHÂN XE 2 dòng, kế toán chốt debit, edge hủy ghép/xóa Lô 1, debit note BKS
ảo, form LCL D.1–D.6).

**Status: DONE — KHÔNG có gap code.** Cả 10 items đã được hiện thực + test
pin trên main bởi các wave trước (FB-090…FB-095, 181026143000, 181026145000
(+rb1), 181026185900 A/B/D, card 365 (D.6), 191026100000). Biên bản
per-item (code refs + test pin + qa logs):
`testplan/2026-10-18-card-191026100020-lcl-hoan-thien-verification.md`.

**Gates**: BE/FE tsc 0 error; 337 scoped tests pass 0 fail (BE 125, FE 212)
— logs `qa/2026-10-18_card-191026100020_*.log` (force-tracked).

**Không covered**: UI drive lại trên commit này (không sửa code → không có
control thay đổi; claim rung-3 của các luồng thuộc card trước, artifacts
`qa/2026-10-16_lcl-loop_ui-driver.log`, `b03af5a9`, `a6e4d924`).

**Lưu ý cho agent sau**: branch `origin/fix/lcl-spec-gaps` (5 commit, chậm
270) là stale — nội dung 3 fix của nó đã có trên main phong phú hơn; KHÔNG
merge nếu không có chỉ định. Brief nhắc branch `fix-lcl-hoan-thien` không
tồn tại trên origin.
# HANDOFF — 2026-10-18 — card 191026100030: chiphispec verify gaps (fix-chiphispec-gaps-rb2)

**Goal**: verify + fix the remaining chiphispec (`Fix lại các chi phí của từng
phân hệ.docx`) gaps on top of 09ff9406 (§1-2) / cddf3315 (§3) — QA-guide
scenarios B.1–B.6 (`docs/qa-guides/2026-10-16_huong-dan-kiem-thu-hang-le-chi-phi.docx`).
REDO of the dead `fix-chiphispec-gaps-rb1` run (passed all gates, died before
commit+push); change-set reconstructed from its reviewed final state.

**Verified, no change**: §2 dup-warning format (name-first, `OPS #<id>`
fallback — `opsDuplicateWho`); §3a hoàn cược 4-số-cuối (digit-run lookup +
CUS autofill, card 171026212000 already landed); §3b thêm khoản chi gọn
(FB-097: 2 nhóm, NCC=nhà xe default, HĐ tùy chọn, thu=trả, nhập liên tục).

**Fixed** (regression cases CP-GAP-01..05 in
`testplan/2026-10-18-card191026100030-chiphispec-gaps.md`):
1. Driver cost photo gate re-scoped to mirror `insertDriverIncidentalCostTx`
   exactly — every DRIVER_SHIPMENT row (incl. negative) requires the biên lai
   (message = BE's own line), ordinary Tiền đường rows no longer blocked.
   `DriverExpenseCorrection` drops Số/Ngày hóa đơn + stops sending
   invoiceNumber/invoiceDate (omit ≠ null — a hidden-field null used to WIPE
   legacy stored numbers on any edit).
2. Lotless-trip (hàng-lẻ wave-model) defect class on the READ side: 6 sites
   (works list, phoi board, chi-hô, voucher, void, THU ghiChu join) + the
   `assertTripShipmentAccountingUnlocked` FAIL-OPEN now resolve the trip's lot
   via `coalesce(trips.shipment_id, shipment_fulfillments.shipment_id)`.
   `backend/src/tests/lotless-trip-read-fallback.test.ts` (7 cases).
3. Chốt-debit polish: ≤40px header buttons <768, dead selector gone,
   scroll-cue re-hung to the 641–1107 band (its `ledger-desktop` class made it
   unshowable), inert rows lose the pointer cursor, money cells wrap instead of
   spilling, DebitSettlementRoundDialog hex fallbacks → `--ink-3`/`--err`.

**Gates**: BE/FE tsc 0; `pnpm lint` 0 (1 pre-existing unused-import error
fixed forward); scoped combined `tsx --test` (lotless-trip-read-fallback +
phoi-phieu-control) 49/49 + sibling suites green (record incl. both
environment notes: `qa/2026-10-18_chiphispec-gaps_gates.md`). Independent
code-reviewer pass (on the lost run): PASS w/ minor findings, all resolved in
this change-set.

**Limits**: UI claims are rung 1 (code-read + DOM tests) — no live browser
drive this lane; the unfiltered `/accounting/expenses` read 409s the whole
screen when any stale source row exists (`hydrateExpenseAccountingSource`) —
seen only under parallel-test teardown residue, not reproduced in normal use;
`card197-negative-cost-totals`' companywide TỔNG CỘNG equality races sibling
fixture writes when the 10-file batch runs in parallel (serialized green) —
pre-existing test fragility, worth a scoping card.

---

# HANDOFF — 2026-10-18 — FB-061 (141026012010): board read no longer lists seed/test data
# HANDOFF — 2026-10-18 — card 191026100010 (chứng từ điều vận B + Lái xe C)

Controller: omp agent, worktree `/Users/dev/.paseo/worktrees/1njkloyy/fix-dieuvan-laixe`,
branch `fix-dieuvan-laixe` (off `a9e4b75b` + style commit `c1f412f8`).
Updated: 2026-10-19 ~01:35 +0800 (rb1 verification dispatch).

## Goal & status

Source `chungtu-dieuvan.docx` mục B (/dispatch + /dispatch-detail) và C (driver
portal `/api/driver/me/*`), 7 items. **Status: DONE, rb1-verified.** The dead
agent's original status claim ("committed and PUSHED") was FALSE — it died
before committing (reflog: no fix commit ever existed). True chain:

1. Implementing agent died post-work, pre-commit.
2. Orchestrator salvaged its uncommitted tree verbatim as `c58ff01c`
   (pushed to `origin/fix-dieuvan-laixe`), gates UNVERIFIED at salvage time.
   The salvage recovered 18 files but MISSED one: the
   `ShipmentExpensePanel.test.tsx` unused-`waitFor` one-liner (HEAD alone is
   lint-red on that file).
3. rb1 verification (2026-10-19, this worktree) re-ran the scoped gates —
   all green, results in the Evidence section below, logs
   `qa/2026-10-19_card191026100010_rb1-*`. The residual one-liner landed as
   `52c0214f` (pushed). KHÔNG deploy (owner rule).

### rb1 verified gates (2026-10-19, exact commands + verbatim results)

- `cd backend && npx tsc --noEmit` → exit 0 (0 errors).
- `cd backend && npx tsx --test src/tests/dispatch-overlap-warning.test.ts
  src/tests/trip-overlap-warning.test.ts src/tests/dispatch-overlap-day-only-trips.test.ts
  src/tests/dispatch-detail-plan-363.test.ts src/tests/dispatch-plan-row-rig-conflict.test.ts
  src/tests/dispatch-plan-row-lcl-rig.test.ts src/tests/trip-factory-snapshot.test.ts`
  → `tests 68 · pass 68 · fail 0`, exit 0 (the two changed BE services:
  conflict-scan + detail-plan covered by all 7).
- `cd frontend && pnpm exec tsc --noEmit` → exit 0; canonical
  `cd frontend && npx tsc -b` → exit 0.
- `cd frontend && pnpm exec vitest run` on the 8 touched specs
  (DetailedPlanGrid.{container-port-weight,fb095-badge,lcl-grouping,base},
  DispatchPlanEditorCell, LclGroupTruckEditDialog, DriverTaskInfoSections,
  ShipmentExpensePanel) → `Test Files 8 passed (8) · Tests 215 passed (215)`,
  exit 0.
- Root `pnpm lint` → exit 0 WITH `52c0214f`; at salvage HEAD alone eslint on
  ShipmentExpensePanel.test.tsx = 1 error (`'waitFor' is defined but never
  used`) — `qa/2026-10-19_card191026100010_rb1-eslint-head-state.log`.
- NOT re-run by rb1: full FE suite, full BE unit suite, `make build`, and the
  live UI drives (dead agent's `qa/2026-10-18_card191026100010_*` artifacts
  remain as its record, unverified by rb1).

## What landed (per item)

- **B.1 FIX** — after "Gán xe nhóm" there was no way to change BKS. Added
  `LclGroupTruckEditDialog.tsx` (+css) on the EXISTING `updateLclTruck`
  (FB-093, `POST /api/shipments/lcl/truck`) with two affordances: the
  "Đổi BKS nhóm" row action in the Nhóm ghép trả ĐV menu, and the group
  line + button inside the "Chỉnh sửa điều phối" popup; grouped-row plate
  edits in the popup now run `updateLclTruck` BEFORE the atomic plan save
  (clear/defer refused on grouped rows). "Đơn" rows already had Sửa /
  Phân xe lại (verified, no change).
- **B.2 VERIFY** — external issue-before-plate already landed (cards
  20261004_359 `6c5836f3`, `68187f33`); re-verified via the "Bổ sung sau"
  FE describe + `trip-factory-snapshot.test.ts` BE describes. Internal keeps
  its mandatory plate.
- **B.3 VERIFY** — the ĐẢO VỎ auto-seed already removed (card 20261005_362
  `390dc945`); pin re-verified ("choosing Lấy Lẻ seeds NO tag").
- **B.4 FIX** — the quoted hard 409 "Đầu xe X đã được gán cho lô/tác vụ khác
  trong khung giờ trùng lặp." fired on the DELIBERATE "Gán xe nhóm"
  arrangement (one group = one truck). Cost-group siblings (same non-null
  `costGroupId`) now split out of the cross-lot HARD tier into the existing
  warn-once tier (RIG_OVERLAP_COMPLETED + " Vẫn lưu?") in BOTH
  `assertPlanRowRigAvailable` and `assertTripRigAvailable`; cross-lot
  overlaps without a shared group keep the hard block (pinned), and a
  sibling's weak slot never downgrades a true holder (mixed-set pin).
- **B.5 VERIFY** — container-bold/port-normal already landed (card
  20261005_361 `11f4ec4c`); pinned by the NEW
  `DetailedPlanGrid.container-port-weight.test.tsx` contract test.
- **C.1 FIX** — driver "Cảng hạ" resolves through the shared
  `resolveLiftDropPoints` rule (LCL direction swap: Nhập → Hạ = Nhà máy /
  bãi trả; Xuất → kho). FCL chain byte-identical (port → free text → FB-020
  snapshot), EXPORT never borrows the factory, legacy returnDepot precedence
  kept.
- **C.2 VERIFY** — SĐT kho tel: link already landed (card 20261005_364
  `26dee2d1`); driven live (anchor + href + click).

## Adjacent fixes required to turn the gates green (both one-liners)

- `frontend/src/features/expense-accounting/ShipmentExpensePanel.test.tsx` —
  removed an unused `waitFor` import (root lint was red from card 09ff9406).
- `testplan/qa/scripts/2026-10-18-fb095-fb094-ui-driver.mjs` — its QA_BASE
  DEFAULT was `localhost:7176`, breaking the dev-port contract test; default
  is now the documented 7175 (env override unchanged).

## Evidence

Regression plan + verdicts: `testplan/2026-10-18-card191026100010-dieuvan-laixe.md`.
Dead agent's logged gate claims (its own record, NOT re-run by rb1; logs in
`qa/2026-10-18_card191026100010_*`): FE 5152/5152, fe-tsc 0, be-tsc 0, BE
overlap 13/13 (repro red→green: exact quoted hard 409 before, warn-once
after), BE unit 305/305, lint 0, `make build` 0. Of these, rb1 independently
re-verified on 2026-10-19: be-tsc 0, BE affected 68/68, fe-tsc 0 (both
`--noEmit` and `-b`), FE scoped 215/215, root lint 0 (after `52c0214f`) —
see the rb1 gates table above and `qa/2026-10-19_card191026100010_rb1-*`.
UI rung-3 (driver `laixe`, token-injected): `qa/…_ui-c1-before.png` (main
build: "Chưa có cảng hạ" beside the delivery row naming the yard) vs
`…_ui-c1-after.png` (fixed: "Bãi JJ LOGISTICS"); `…_ui-c2-*.png` tel: link
click; driver log + API/DB identity file alongside. QA fixture edits
(trip 60516/67894 driver, shipment 104507 factory_name) were REVERTED after
capture.

## Deliberate non-changes / limits

- Master plan (/dispatch) got no new affordance: the card named "popup điều
  phối + row actions" (both on /dispatch-detail); the master-plan allocation
  popover remains editable pre-issue and issued lots still reassign via
  /dispatch-detail "Phân xe lại".
- Group NHÀ XE (carrier) change for a grouped lot is still the per-row popup /
  Phân xe lại path; `assignLclCostGroup` regroup semantics untouched (money
  law).
- The issue-time gate (`dispatch-resource-availability`) was NOT weakened:
  FB-012's same-lot carve-out there is unchanged; the quoted message never
  came from that gate.
- Driver-portal backend chain untouched (FB-020 `resolveDeliveryStage` keeps
  owning FCL); no LCL-IMPORT trip with a real factory existed in the local
  dev DB, so the C.1 UI drive used a locally seeded factory name on fixture
  lot 104507 (reverted).

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

# HANDOFF — 2026-10-18 — rb1 re-attempt: FB-095 badge hủy ghép + FB-094 Xuất Debit Note (cards 181026145610 / 181026145620)

## Goal & status — DONE (salvage → gates → 2 commits pushed)

Agent trước hoàn tất QA rung 3 cả 2 card nhưng chết trước khi commit; toàn bộ
change set được salvage nguyên vẹn từ worktree `fix-fb095-fb094-controls` vào
rb1 (9 file, cp -p), gate re-run xanh trên cây tổng, 2 commit landed + push
ngay theo commit = push rule.

- `0e325cc4` feat(dispatch): FB-095 — group badge menu (Xem nhóm / Hủy ghép) +
  unmerge confirm flow.
- `239556ec` feat(accounting): FB-094 — Xuất Debit Note trên chốt-debit.
- Branch `fix-fb095-fb094-controls-rb1` → origin (`0e325cc4..239556ec`).

## Cutover FB-094 (đụng độ song song — cần biết khi review)

`028be26f` (13 commit trước) đã land MỘT bản FB-094 song song + test
`AccountingDebitClosePage.debit-export.test.tsx` (cùng card 181026145620) —
stream salvage phát triển trên base `09420a7f` chưa có commit đó. Giữ bản
salvaged (control tên đúng testplan "Xuất Debit Note", đã rung-3) và xóa
debit-export.test.tsx như superseded (wording pin `Xuất Debit Note (N)` /
`Đã xuất Debit Note cho N lô.` mâu thuẫn testplan). Seam chung giữ nguyên:
Idempotency-Key theo selection, đúng 1 lần createDebitNoteBatch +
exportDebitNoteFile, blob + a[download] + revoke 10s, lỗi server hiện nguyên
văn role="alert", không tải file khi lỗi.

## Independent review (`ReviewFb095Fb094`) — REQUEST-FIXES, đã resolve

1. BLOCKING: testplan trỏ FB095-UI-01 + gate scope vào `DetailedPlanGrid.lcl-grouping`
   (không chứa case) → sửa trỏ `DetailedPlanGrid.fb095-badge`, gate scope列出
   đủ 7 suite đã chạy.
2. Danh sách thành viên Xem nhóm thiếu member ở trang khác → marker
   "Còn N thành viên ở trang khác" (fix data-shape cần payload nhóm — ngoài scope).
3. Cutover làm rơi pin đúng-1-issue-call → khôi phục `toHaveBeenCalledTimes(1)`.
4. Error message rỗng mất fallback → khôi phục `&& error.message`.
5. Header claim "FCL rows never get the badge" chưa có case → thêm case FCL +
   stale group data.

## Gates (qa/2026-10-18_fb095-fb094_*.log — lần 1 + RE-RUN sau review)

- FE `pnpm exec tsc --noEmit` 0 errors (EXIT 0); `npx tsc -b` 0 errors (EXIT 0).
- vitest new3 (`fb095-badge`/`lcl-unmerge`/`export`): 3 files / **10 tests**
  (8 ở lần 1, +2 case review); siblings (`lcl-grouping`/`lcl-assign-reason`/
  `AccountingDebitClosePage.test`/`lcl-columns`): 4 files / **39 tests**. All pass.
- `pnpm lint` 0 · `make build` ok. Worktree mới phải `pnpm install
  --frozen-lockfile` trước (PATH `tsc` là TS 6.0.3 lạ — không dùng).

## Coverage table (§9 — evidence rung 3 tái sử dụng từ run đã chết, theo yêu cầu)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| FB095-UI-01..03 badge → menu → confirm → POST unmerge → toast + refresh | UI DRIVEN | qa/2026-10-18_fb095_ui-01..05.png, `_db-after.json`, driver logs (FB095-01..14, DB rows 104250/104251/104252 + audit 70467) | FB095-UI-04: dialog điều phối giữ nguyên — code-read only (ngoài phạm vi) |
| FB094-UI-01..03 nút Xuất Debit Note + xlsx thật + lỗi nguyên văn | UI DRIVEN | qa/2026-10-18_fb094_ui-01..03.png, driver logs (FB094-01..08, DB document id 8375), xlsx `qa/downloads/giay-bao-no-BULK-IMP-0019.xlsx` (untracked) | error path chỉ qua unit test; widths 390/768/1440 không quét lại; role khác QA account |

Driver: run-1 12 PASS rồi crash Postgres `errorMissingColumn` khi gom evidence
thêm; resume 11 PASS, `DONE failures=0` — tổng FB095-01..14 + FB094-01..08 xanh.

## Files owned / next step

- Commits `0e325cc4` + `239556ec` (đã push). Evidence local chưa track:
  `qa/downloads/*.xlsx`, `qa/2026-10-18_fb095-fb094_fe-vitest-scoped.log` (run
  7-file của agent trước trên cây cũ).
- Next: owner review + merge vào trunk; đóng card 181026145610 / 181026145620
  khi merge.

# HANDOFF — 2026-10-18 — rb1: BE reds cluster B — PHOI-11 provenance + E2E warn-contract (QA-AUDIT-PHOI-11 ×3)

## Goal & status — DONE (5 target reds xanh, 0 red mới)

Re-attempt của agent chết `ecc8c049` (worktree/branch mất sạch — làm lại từ
main `20d4cb27`). Cluster B = red-at-base còn lại sau cluster A (`a50a98e6`):
(1) QA-AUDIT-PHOI-11 ×3 trong `expense-source-remediation.test.ts`, (2) E2E
suite `comprehensive.test.ts` ×2. Base: integration 3352/3335/**17 fail**
(unit 305/305). Sau fix: integration 3352/3344/**8 fail** — cả 8 là red
cluster khác (subset chặt của 17 base, 0 red mới); cluster B + toàn bộ CUS
suite xanh.

## Root cause (3, đều test-side — không đổi product code)

1. **TC-REDSB1 — PHOI-11 ×3 (fixture id-drift, card 20261005_373 lần 2)**:
   `getPhoiPhieuTienDuong` key `sourceId` trên `expense_accounting_sources.id`
   từ card 20261005_373 (fix "Từ chối" 404, pin bởi
   `phoi-phieu-control.test.ts:254`); fixture vẫn expect driver-cost id
   (`actual [5715,22853]` vs `expected [5715,5716]`). Provenance service đúng
   nguyên vẹn (driverEnteredAmount 0/null/10000110000, expenseTypeCode,
   feeNormCode, costType… đều giữ) — chỉ identity assert lệch. Fix: key linked
   head theo `active.id`, legacy unlinked giữ fallback native id.
2. **TC-REDSB2 — E2E ×2 (warn-contract fixture drift, FB-038 family / ticket
   111026105630 / card 171026121100)**: POST /api/trips trả warn tier
   `409 RIG_OVERLAP_COMPLETED` ("…Vẫn lưu?") vì DB dev có holder trip trùng
   khung với driver fixture; contract đã ship `confirmOverlap` (create/figures)
   + `rigOverlapCompletedConfirmed` (reassign) = leg retry đã confirm. E2E chỉ
   gửi lần đầu. Financial operations đỏ là cascade (`tripId` undefined → query
   UNDEFINED_VALUE). Fix: 4 call guard-running của lifecycle mang documented
   confirm key; warn vẫn được pin bởi suite riêng (`dispatch-overlap-*`,
   `trip-overlap-warning`…).
3. **TC-REDSB3 — advance-draft-recovery (lộ ra ở gate run 1)**: `state()` đọc
   `auditLogs` KHÔNG `orderBy` rồi assert `audit.at(-1)` = "audit cuối" — thứ
   tự heap, không phải thứ tự insert; churn audit_logs của các suite trước đã
   đảo thứ tự (`'Đã ghi sổ tạm ứng cũ'` ≠ `'Đã hủy tạm ứng chưa giao tiền'`).
   Xanh khi chạy lẻ 8/8. Fix: `orderBy(asc(id))` — nội dung assert giữ nguyên.
4. Kèm: `cus-lcl-undated-parity-d6.test.ts` bỏ import `eq` thừa (red lint gốc,
   stray từ card 181026185900 D.6 — cùng loại dọn gate với `a50a98e6`).

## Gates (qa/2026-10-18_be-reds-clusterB_* — counts verbatim)

- BE `pnpm exec tsc --noEmit` **0 errors** (exit 0); FE `pnpm exec tsc -b` +
  `pnpm exec tsc --noEmit` **0 errors** (exit 0); root `pnpm lint` **0 errors**
  (exit 0); `pnpm context:check` valid (v1, 8 profiles, 25 paths).
- Targeted red-before: 20 tests / 15 pass / **5 fail** (`_targeted-red-base.log`);
  green-after: 20/20 (`_targeted-green.log`).
- Full suite (`pnpm test`, `_full-suite-final.log`): unit `305/305/0`;
  integration `3352 tests / 3344 pass / 8 fail` (exit 1 — 8 red cluster khác:
  quotation-entity ×4 [surcharge/chiphispec], dispatch-fulfillment FB-018,
  photo-trip-scope ×2, q23). Base run 17 fail; q11 ×2 + tool-executables +
  q15-salary lật xanh state-sensitive giữa các run — không claim nguyên nhân.
- Summary artifact: `qa/2026-10-18_be-reds-clusterB_gates-summary.md`;
  regression case: `testplan/2026-10-18-be-reds-clusterB-phoi11-e2e.md`
  (TC-REDSB1/2/3).

## Coverage table (§9 — test-side only, không đổi UI)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| TC-REDSB1 PHOI-11 provenance đọc active-only | 1 CODE-READ + unit/integration (không UI) | targeted-green.log 20/20; full-suite-final | UI Tiền đường không drive (ngoài scope cluster) |
| TC-REDSB2 E2E lifecycle warn-contract | 1 + integration (in-process HTTP) | full-suite-final comprehensive 7/7 | UI overlap dialog không click |
| TC-REDSB3 audit-order determinism | 1 + integration | advance-draft-recovery 8/8 (lẻ + full) | — |

Không có claim "works end-to-end" — đây là fix test-fixture, không đổi behavior
product.

## Files owned / next step

- `backend/src/tests/{expense-source-remediation,comprehensive,advance-draft-recovery,cus-lcl-undated-parity-d6}.test.ts`
  + `testplan/2026-10-18-be-reds-clusterB-phoi11-e2e.md` + qa artifacts
  (force-tracked) — 1 commit trên branch `fix-be-reds-phoi-e2e-rb1`.
- 8 red còn lại thuộc cluster khác (surcharge-rb3 / chiphispec-gaps / dispatch /
  photo-authz / q23) — không đụng; theo dõi khi các wave đó land.
- Next: owner review + merge vào trunk.
Independent review verdict (Card1910Review) was recorded in the dead agent's
session and is not independently re-verifiable here; any findings resolve as
forward fixes. rb1 (2026-10-19) verified the scoped gates green and landed the
missed lint one-liner (`52c0214f`); branch `fix-dieuvan-laixe` pushed through
that commit. Awaiting owner merge/deploy instruction — NEVER deploy.

---

# HANDOFF — 2026-10-19 — card 191026160000: money format + chốt-debit fixes + duyệt tạm/hoàn ứng (chiphi2-b)

Controller worktree `/Users/dev/.paseo/worktrees/1njkloyy/fix-chiphi2-b`, branch
`fix-chiphi2-b` (off main `eed0b2f3`). Updated 2026-10-19. See
`testplan/2026-10-19-card-191026160000-chiphi2-b.md` for the full case table,
review resolution and dev-DB residue list.

**§1 Money format** — Timesheet lương lines + 4 config money inputs
(LiftPricing, WeightTiers, CapTable, AncillaryRevenue) moved to
`formatMoney` / `NumberField grouped(signed)`; API payload shapes unchanged.
`formatMoney` already existed (`frontend/src/lib/format.ts`) — the sweep only
covered the missing surfaces.

**§2 Chốt-debit** — board defaults to the CURRENT MONTH (8864-row unbounded
load froze select-all — the QA repro; captured pre-fix), select-all guard
>2000; selected row paints accent-soft + ✓ tick in Ngày; two-tier header
rowSpan cells bottom-aligned; "Chọn Debit" dialog groups the selection BY NGÀY
with per-date ticks (untick excludes lots from count/sum/shipmentIds; đợt
period follows ticked dates); settlement success KEEPS the selection; export
key root cause FIXED (raw id-join key >100 chars → 400; now FNV-1a selection
hash inside `createDebitNoteBatch`, used by both /accounting/chot-debit and
/shipments-debit) + 200-lot union cap surfaced on the button.

**§3 Duyệt tạm/hoàn ứng** — (3a) PHÊ DUYỆT TẠM ỨNG verified working at HEAD
(rung 3; QA staging build predates 3b252b4b — no code change); (3b) NEW
`POST /api/advance-settlements/:id/check` (ADMIN/ACCOUNTANT) stamps
checked_by/checked_at + version bump; creation no longer stamps
checkedBy=submitter (Option B's tick stays approved_by; deadlock-order pin
updated); "DUYỆT PHIẾU HOÀN ỨNG" row action on /advances tab Phiếu hoàn ứng;
(3c) Ops chi → hoàn tạm ứng: trace proved ĐNTT counts only KT-CONFIRMED ops
expenses; "Chi phí Ops" tab now shows the duyệt state + per-row Duyệt wired
to the SAME `/expense-accounting/confirm` phơi phiếu uses.

Gates: lint 0 · be tsc 0 · fe tsc -b 0 · fe vitest 215/215 · be scoped 41/41
(advance-settlement-check NEW) · make build OK. UI rung 3 before/after:
`qa/2026-10-19_chiphi2-b_repro/` + `qa/2026-10-19_chiphi2-b_after/` (10 shots +
dom-facts.json + exported xlsx). Drivers:
`testplan/qa/scripts/2026-10-19_chiphi2b-*.mjs`; settlement seed/cleanup:
`backend/scripts/seed-chiphi2b-settlement.ts`.

Not covered: staging drive (local-only); mobile ≤640px debit board not driven;
invoice-required confirm flow beyond the surfaced refusal; known edges F3/F6/F9
in the testplan.

