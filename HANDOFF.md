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

Worktree-isolated branch `fix-fb061-phoi-seed-rb1` (salvage re-land of the
dead `fix-fb061-phoi-seed` run's change set; original off main `09420a7f`,
re-landed on `692522c1` with no backend drift between the two bases).

**Goal**: `/accounting/phoi-phieu` listed seed/test rows (factory
`KHO-SEAM-1789702634486`, carrier `STG VERIFY NHA XE 09`, customer
`QA0915 QA-138 Credit Customer`, bills `BL-QAKE-*` / `E2E-*`, plates
`99T-99999` / `51K-PROBE*`, driver `Test Driver R15`).

**Root cause**: earlier rounds only controlled the WRITE side (demo seeders
gated in production; a purge registry run by `make qapurge`). The
production-facing READ, `listPhoiPhieuRows`, had no filter, so a fixture row
written between purges rendered at once — which is why the card kept verifying
FAIL. The two sides had also drifted (`QA_TRIPS_SQL` still used the pre-FB-061
shipment list, so `BL-QAKE`/`E2E` shipments were purged but their trips were
not).

**Code**:
- `backend/src/services/qa-fixture-markers.ts` (NEW) — the single owner of the
  marker signatures, consumed by BOTH the board read and the purge registry.
- `backend/src/services/phoi-phieu-control.service.ts` — `listPhoiPhieuRows`
  excludes any row carrying a marker (shipment / factory / vehicle / driver /
  party / site). `getPhoiPhieuReport` deliberately unchanged (audit surface).
- `backend/src/seed/qa-fixture-registry.ts` — every FB-061 predicate is now
  GENERATED from that owner; `QA_TRIPS_SQL` gained the missing bill families.
- `backend/src/tests/phoi-phieu-fixture-marker-filter.test.ts` (NEW, 5 cases),
  `backend/src/tests/unit/qa-fixture-marker-sql.test.ts` (NEW, 5 pins).
- `backend/src/tests/phoi-phieu-control.test.ts` — grouping fixtures renamed
  off the `QA%` plate signature (`QA-A-…` → `C16A-…`, `QA172A-…` →
  `C172A-…`); the tested properties are unchanged.

**Marker pattern list** (owner: `services/qa-fixture-markers.ts`):
- shipment refs: `QA%`, `BL-QAKE%`, `E2E-%`, `CARD226-QA%`, `BILL-QAC1%`
  (bl_number / booking_ref / shipment_code)
- shipment notes: `QA-BUG3%`, `card226 advisory-lock probe%`
- factory / operational sites (name, short_name, code, trip snapshot,
  `shipments.factory_name`): `QA%`, `KHO-SEAM%`
- plates (`trucks.license_plate`, `trip_carrier_info.external_plate_number`):
  `QA%`, `99T-99999`, `51K-PROBE%`
- people (`drivers.name`, `external_driver_name`): `QA%`, `Test Driver%`
- parties (`customers.name`, `suppliers.name`): `QA%`, `STG VERIFY%`
- run-scoped epoch signature on every one of the above: `-[0-9]{10,13}$`

**Seed files changed**: no demo seeder authors these rows (verified by grep —
`src/seed.ts` + `src/seed/*` carry no QA/probe names). The repeat source was
self-authored QA fixtures plus the purge drift, so layer 2 is the registry
rewiring above rather than a seed edit. `backend/src/reset-seed.ts` is a full
wipe + canonical seed and is untouched by design.

**Deliberate non-markers**: a bare `NHA XE` — the live roster has real carriers
such as `CÔNG TY TNHH VẬN TẢI NHA XE BIEN BAC`, and the phrase would hide live
payable rows. The fixture family is `STG VERIFY%`.

---

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
