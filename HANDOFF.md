# HANDOFF — feat-gomhang-polish (các dòng còn lại sau wave 60d0c576 — GP-01…GP-06)

- Owner/controller: this session (worktree `/Users/dev/.paseo/worktrees/
  1njkloyy/feat-gomhang-polish`, branch `feat-gomhang-polish` off main
  60d0c576). Last updated: 2026-10-23.
- Goal: 6 dòng hygiene/polish còn lại sau wave gộp hàng (testplan/
  2026-10-23-gomhang-polish.md): GP-01 CUS bar mang tấn/CBM (wire
  `shipment-debit-summary` thêm `cargoWeightKg`/`cargoVolumeCbm`) · GP-02 tag
  "Ghép thu cước cùng Lô 1" 1 dòng truncate+tooltip · GP-03 bỏ ô "BKS báo
  khách" khỏi dialog ĐV (LclGroupTruckEditDialog + inline edit DetailedPlanGrid)
  · GP-04 server-error gộp khác-KH không im lặng (gate null-customerId + error
  toast) · GP-05 card badge 1 dòng/title/gap ≥8px · GP-06 ⋯/tick ≥44px card.
  STATUS: DONE — rung 3 QA + full gates green (CHANGELOG 23/10 chiều 2,
  qa/2026-10-23-gomhang-polish/).
- Scope cấm đã giữ: KHÔNG đụng `pages/MasterPlanPage*` +
  `features/dispatch/master-plan/*`. Sót ngoài scope: ô "BKS báo khách (ảo)"
  của `DispatchAllocationLclDialog` (master-plan lane — grep "BKS báo khách"
  toàn dispatch features còn đúng field đó + comment luật ở
  `AssignTruckGroupDialog` + read-only display `LclGroupTruckLine` "Ảo:" /
  tooltip badge "Báo khách X" — spec §1 cấm NHẬP ở ĐV, display giữ nguyên).
- Wire đổi (shared schema + BE read-side): `shipmentDebitSummaryItemSchema`
  thêm `cargoWeightKg`/`cargoVolumeCbm` (nullable decimal string, kg/CBM);
  BE `shipment-debit-summary.service.ts` select + passthrough 2 cột sẵn có.
  Bar CUS drop-empty: thành phần không lô nào có số liệu thì khỏi câu tổng
  (không bịa 0) — khác bar ĐV (luôn in cả hai).
- Quyết định có ý thức: (a) `--control-touch-h` = 40px nhưng sàn tap target
  card ≥44px theo brief → trigger ⋯ đặt `min-width/min-height: 44px` riêng;
  tick = button 44px + hộp vẽ 18px `::before` (scoped `.dpcard`, không sửa
  `LclSelectCheckbox.css` shared — master-plan lane đang dùng component đó);
  (b) chip trạng thái giữ inline `white-space: normal` cho TABLE, card ép
  1 dòng bằng rule element-level `.dpcard__issue .dispatch-assignment-cell__issue
  > span:not([aria-hidden])`; (c) MergeRevGroupDialog gate giờ là "1 customerId
  KHÁC NULL duy nhất" — mirror `findRevCustomerConflict` của BE (null = conflict).
- QA: rung 3 READ-ONLY (driver qa/scripts/2026-10-23-gomhang-polish.mjs, 390px,
  BE worktree :3003 + FE :7183; DB groups trước/sau identity null/null):
  GP-01 bar "Đang chọn 2 lô: Tổng 2,214 tấn | 9,002 CBM" (lô 106+107 KH id 2)
  đúng số liệu wire · GP-05 gap 8px/1 dòng/title/⋯ 44×44 · GP-06 tick 44×44
  enabled + dim. Ảnh: gp01-cus-bar-390.png · gp05-card-badge-390.png ·
  gp06-card-touch-390.png.
- Independent code-review pass (code-reviewer): verdict pass-with-nits; đã sửa
  hết findings hành động được — strip NHÓM GHÉP vào luật GP-02 (High), test
  GP-04 mixed null + rename (Medium), guard submit chống double-fire/gate lách
  (Low×2), tách thông báo rỗng vs không đổi ở inline BKS nhóm (Low); giữ
  optional type cho 2 field wire mới (old-server tolerance, đúng convention
  `freightOverrideReason?`). Finding "vitest pin CSS text" chấp nhận: rung 3
  Playwright là bằng chứng rendered (gap/44px đo bằng getBoundingClientRect).
- Gates: root lint 0 · be tsc 0 · be tests 0 · fe tsc -b 0 · fe tsgo -b 0 ·
  scoped vitest 540/540 · FULL FE 5523/5523 (715 files; sau `make build` cho
  numeric-identity) · make build 0. Lưu ý flake tải: 2 test debounce
  (PayableListPage CommissionModal, AccountingWorkspaceRoot strip reset) fail
  khi chạy song song make build+puppeteer, pass isolation + pass rerun unloaded.

---

# HANDOFF — feat-gomhang-fe (spec 23/10 cards 231026123901/902/903 — FE gộp hàng on-demand)

- Owner/controller: this session (worktree `/Users/dev/.paseo/worktrees/
  1njkloyy/feat-gomhang-fe`, branch `feat-gomhang-fe` off main aab19931).
  Last updated: 2026-10-23.
- Goal: 3 QA ticket R38 trên nền grid redesign 23/10 — (901) cột CHỌN
  on-demand + nút [📦 Gộp hàng] + floating bar cả ĐV lẫn CUS; (902) popup
  Gán xe nhóm ĐV đúng 4 trường, hết BKS ảo; (903) CUS per-lot 3 outputs +
  Gộp xe thu khách popup 3 trường, 100/0 + tag + Tách nhóm. STATUS: DONE —
  rung 3 QA + full gates green (xem CHANGELOG 23/10 chiều, qa/2026-10-23-gomhang-fe/).
- Nhánh chính đổi: `LclMergeModeToggle` (components/shared) + dock
  `styles/lcl-merge.css` dùng chung 3 mặt; DetailedPlanGrid/MasterPlanGrid
  render cột CHỌN khi page truyền `onToggleLclSelection` (= mode bật); ĐV FCL
  dim/disable, CUS tick mọi dòng (tick phục vụ cả Xuất Debit Note — gộp vẫn
  chỉ LCL chưa nhóm; CTA gộp dời header → floating bar). Client:
  `assignLclCostGroup` xóa billing fields; `mergeLclRevGroup`/
  `setLclLotRevClass` nhận `freightRevenue`.
- Deviation đã ghi: (a) CUS bar không có tấn/CBM (wire quyết toán không mang
  cargo measures — FE-only scope); (b) tag thành viên trên bảng CUS in dạng
  BE "Ghép cước cùng Bill {Lô 1}" thay vì literal "Ghép thu cước cùng Lô 1"
  (BE live, response `revMergeTag` mang literal; FE hiển thị theo wire).
- QA: BEFORE :7175 / AFTER :7183 (driver qa/scripts/2026-10-23-gomhang-fe.mjs;
  BE trunk :3002; fixture lô 122+173 KH LONG MINH, dọn bằng tách nhóm — FINAL
  DB groups null). Catalog QA note: đã tạo vehicle_size_classes "3.5T" (id 5,
  admin idempotency qa-gomhang-fe-35t) vì dev DB chỉ có cont classes.
- Gates: root lint 0 · fe tsc -b 0 · fe tsgo -b 0 · FULL FE 714/5514 PASS
  (make build trước cho numeric-identity) · make build 0. BE không đổi.
  Independent code-review pass resolved: UnmergeRevGroupAction copy về luật
  23/10 (dissolve = restore pre-merge), print guard bar CUS, clear selection
  khi đổi khoảng ngày, reset giá nhập tay sau lưu. Chấp nhận có ý thức: FCL
  dim tick dùng native disabled (house pattern của LclSelectCheckbox, giống
  lô đã nhóm). Follow-up đề xuất (ngoài scope 3 card): ĐV còn ô BKS báo
  khách ở DispatchAllocationLclDialog + LclGroupTruckEditDialog (spec §1 nói
  không nhập BKS ảo ở ĐV — cần owner ruling); toast tách nhóm COST của
  DispatchDetailPlanPage ("về cước riêng" — BE giữ tiền Lô 1).

---

# HANDOFF — redesign-dispatch-grid (owner screenshots 23/10 "UI shitty")

- Owner/controller: this session (worktree `/Users/dev/.paseo/worktrees/1njkloyy/
  redesign-dispatch-grid`, branch `redesign-dispatch-grid` off main 2425726d).
  Last updated: 2026-10-23.
- Goal: làm lại từ gốc grid Điều vận Chi tiết (/dispatch-detail) theo spec
  consult + brief A/B/C: <640px card list (header KHÁCH HÀNG + Bill + badge
  Loại + chip trạng thái + menu ⋯ duy nhất; body 1 dòng/fact, SĐT không bao
  giờ wrap ký tự; Phát lệnh = nút chính duy nhất) · ≥640px table min-width
  (Khách ≥180 · Điều phối ≥200 · Ghi chú ≥160) scroll TRONG container +
  sticky header + cột Thao tác pin phải chỉ ⋯ menu — hết nút đỏ inline ·
  desktop row compact theo nội dung (64–88px), header line-clamp-2, cân đối
  cột (thu Thời gian/Khách hàng). STATUS: DONE — see qa/2026-10-23-dispatch-grid-redesign/.
- Thay đổi (FE-only, không đụng BE/API):
  - `DispatchRowActionsMenu.tsx`: menu ⋯ duy nhất chứa mọi row verb (Sửa điều
    phối/Phân xe lại · Đổi nhà xe/BKS · Ghép chuyến · Tách nhóm · Xóa lô LAST
    danger); render trên MỌI dòng chưa COMPLETED (kể cả chưa gán xe).
  - `DispatchPlanEditorCell.tsx`: bỏ nút Sửa inline; editor mở qua prop
    `openRequest` signal (key = detailRowKey); SĐT driver-phone nowrap+
    ellipsis ở base (chặn wrap từng ký tự).
  - NEW `DispatchPlanCardList.tsx` (<640px) + grid switch bằng ResizeObserver
    đo wrapper (`CARD_MODE_BREAKPOINT = 640`, jsdom fallback = table).
  - `DetailedPlanGrid.tsx/.css`: cột Thao tác sticky-right; table min-width
    1340px + shares 100% (schedule 10.3/route 13.6/ports 8.8×2/documents 7.9/
    container 11.05/assignment 15.1/classification 7.15/notes 12.1/actions
    5.5); header wrap tối đa 2 dòng; XÓA band card td-grid 900/640 + FB-043
    fixed-height (--dpg-row-h) + pair-btn + lcl-unmerge + note-action--delete;
    wrapper `overflow-x:auto; overflow-y:clip` (giữ sticky thead theo app-body).
  - Xóa `DispatchPairAction.tsx` (logic vào menu); QuickIssueOrderButton thêm
    variant `labeled` cho card foot; `lclCargoLine/lclMeasureLine` +
    `detailedScheduleLine` chuyển vào `DispatchPlanCellValues.ts` (grid
    re-export giữ import surface cũ).
  - design-lock `dispatch.mjs`: phone locks (390/500) retarget `.dpcard`.
- Lưu ý luật áp dụng: menu trigger card 40px (`--control-touch-h`, ceiling
  40px law 2026-09-27) thay vì "44px" trong brief — dùng token nhà; design:drift
  ĐỎ ở base (baseline stale 2026-10-04, nợ có sẵn như HANDOFF REQ-07 ghi);
  delta lane này: mọi counter ≤ base (rawZIndex giữ 82 nhờ z-index calc token).
- QA (qa/2026-10-23-dispatch-grid-redesign/, driver `qa/scripts/
  2026-10-23-dispatch-grid-redesign.mjs`, env-only ports): BEFORE (main :7175)
  xác nhận đúng defect owner — rows 242–502px @390/768, SĐT 46px = 3 dòng
  @1440, 50 nút Xóa lô đỏ. AFTER (worktree :7182, role dungnv NV015 vì mirror
  không có demo dieuvan): 20/20 PASS rung 3 — cards @390 + menu mở (items
  đúng, Xóa lô LAST), rows 70–93px, SĐT 1 dòng 15px, 0 inline delete, rail
  scroll trong container, sticky actions khi scroll, page không overflow;
  DB identity trước/sau không đổi (n=186). Case testplan/
  2026-10-23-dispatch-grid-redesign.md.
- Gates (final, logs trong qa/2026-10-23-dispatch-grid-redesign/): lint 0 ·
  FE tsc -b 0 · tsgo -b 0 · scoped detailed-plan 399/399 · dispatch-feature
  76 files 689/689 · FULL FE 714 files 5506/5506 PASS (sau `make build` dist)
  · make build 0. design:drift ĐỎ ở base (nợ baseline stale, stash-verified);
  delta lane ≤ base. dev-port-contract đỏ ở base do comment script lane
  create-field-order (7176) — fixed drive-by trong changeset (comment →
  placeholder). BE không đổi → BE gates không đụng. Commit 8a28c094 pushed
  origin/redesign-dispatch-grid.
- Env verify: worktree FE :7182 (VITE proxy :3002), DB chung :5441; trunk
  :3002/:7175 của main checkout không đụng. Không mutate data QA dùng chung.
- Non-goals: master plan /dispatch; role sweep khác; staging; keyboard-nav
  menu; Card tap → "Chi tiết" (grid KHÔNG có navigation đó hiện tại — không
  phát minh; note line mở dialog ghi chú như cũ).
- Merge note cho orchestrator: lane `fix-cus-tokhai-cont` (fd3974b) sửa
  tờ khai gần vùng CUS ledger — không đụng file nào trong changeset này;
  conflict (nếu có) chỉ có thể ở HANDOFF.md/qa paths.

---

# HANDOFF — fix-filter-lcl-day (card 231026000252, ticket 261022201006b)

- Owner/controller: this session (worktree `/Users/dev/.paseo/worktrees/1njkloyy/
  fix-filter-lcl-day`, branch `fix-filter-lcl-day`). Last updated: 2026-10-23.
- Goal: "FILTER NGÀY LỌT lô LCL" — lot K547238574983 (LCL, transportDate
  2026-10-17) survived the 23/10..23/10 filter on Chi tiết while Tổng quan
  filtered it away. Owner law: **undated = luôn hiện; dated = phải qua filter
  như lô cont**; giữ đồng bộ LCL-01 (SAME filter → same lots on both surfaces).
  STATUS: DONE — fix + tests + real-data QA + UI rung-3 + full gates green,
  independent review in flight at handoff time (commit lands after verdict).
- Root cause: `containerDayTriageCondition` (cus-workspace-sql.service.ts)
  lane-1 blanket escape for container-less LCL rows (added for LCL-01) exempted
  DATED LCL lot rows from the day triage entirely ("bỏ qua bộ lọc ngày hoàn toàn").
- Fix — one law, three shared implementations:
  1. `containerDayTriageCondition`: 2 arms now (null-day passthrough +
     dateArms). A lot row's day is its EDD leg of
     `coalesce(appointment VN, EDD)`; dated rows pass the filter.
  2. `shipmentTransportDateCondition` (Tổng quan + list-summaries deliveryDate
     arm = core.routes master-plan): null-day passthrough in BOTH arms (EXISTS +
     container-less) so undated lots show under every filter. Card
     261022201006b's Z-leak gate (`not exists (containers)` on the EDD leg) kept.
  3. `filterContainersByDateRange` (container-date-filter.ts, scoped-count twin):
     keeps rows resolving to no day — counts never contradict rows (2 old pins
     flipped to the new contract, cited to the card).
- Tests: 4 named cases (LCL dated in-range / LCL dated out-range / LCL undated /
  cont dated) in colocated `backend/src/services/container-date-filter.test.ts`
  (pre-ruling location; pure unit) + SQL-contract pins rewritten in
  `backend/src/tests/unit/cus-container-day-triage.test.ts` and
  `backend/src/tests/unit/shipment-transport-date-condition.test.ts`.
- Evidence `qa/2026-10-23-filter-lcl-day/`: repro before 19/27 (8 FAIL = defect,
  incl. real lot on Chi tiết 23/10) → after 27/27; UI rung-3 17/17 (both screens,
  screenshots + DOM + scoped requests + DB proof); tiepvu-filter-ui rerun 7/7
  (driver has 7 checks — brief said 8); boundary probe 13/13; lcl01-lan2-repro
  5/7 — the 2 FAILs are ONE dated-2099 fixture under Chi-tiết's default lens,
  superseded by req 2 (see case doc Supersession note).
- Supersession (read before claiming "phá LCL-01"): the old LCL-01 repro's
  "dated LCL lot visible on CHI TIẾT default lens" checks ARE requirement 2's
  target behavior reversed — dated = phải qua filter (acceptance: fixture dated
  2026-10-17 under 23/10 filter → 0 kết quả). Same-filter sync verified by the
  new driver's SYNC checks; undated-always is the discoverability anchor.
- Gates: root lint 0 · be-tsc 0 · BE full 338/338 · fe tsgo 0 + `tsc -b` 0 ·
  FE full 5489/5489 (711 files) · make build 0 · boundary probe 13/13 ·
  scoped date-filter tests 26/26. dev-port-contract 11/11 (one driver-comment
  port hardcode fixed in the new repro driver).
- Local env: BE worktree :3008 + FE :7181 (VITE_API_PROXY_TARGET 3008), DB :5441
  (ss-prod-db = staging mirror; real lot K547238574983 = id 124 / SHP-2610-00064,
  booking_ref column). Demo `cus` user CREATED (local-only, customer_id=1,
  testaccounts.txt demo stand-in) because the staging mirror has no CUS demo
  account (prod has none by design) — needed for the tiepvu UI rerun. Trunk
  :3002/:7175 untouched.
- Not covered / limits: `filterContainersByDateRange` undated-keep changes scoped
  count cells + dispatch master-plan totals to match visible rows (by design,
  not separately UI-swept); FE default-lens asymmetry (Tổng quan bare vs Chi
  tiết today-lens) unchanged — identical to cont lots ("như lô cont"); customs
  cutoff (`dateFrom/dateTo` on /api/shipments) deliberately untouched.

# HANDOFF — fix-kho-search-race (TiepVu22Oct-3: gõ GLC đè pick bị ăn ký tự)

- Owner/controller: this session (worktree
  /Users/dev/.paseo/worktrees/1njkloyy/fix-kho-search-race, branch
  `fix-kho-search-race` off main 19140823).
- Last updated: 2026-10-23.
- Goal: search kho lấy hàng (danh mục chung) — khách báo gõ đủ "GLC" không
  ra, gõ "LC" lại thấy (TiepVu22Oct-3 / TiepVu22Oct-4.docx image4).
  STATUS: DONE — fix + unit tests (red-green) + Playwright UI driven
  (truoc/sau, delay 0/120/400ms, final green trên build cuối) + gates +
  independent review (code-reviewer DONE_WITH_CONCERNS → 2 findings fix
  trong changeset: dropoff-port sweep + commitEnterMatch session-end;
  1 finding từ chối có lý do — blur-resync sẽ wipe free-text FB-105);
  landing via trunk commit `fix(cus): search kho — chặn race stale-response,
  gõ full 'GLC' ra kết quả (TiepVu22Oct-3)` + push theo instruction của
  owner.
- Điều tra (repro-first, `qa/2026-10-23-search-glc-race/`): KHÔNG có
  server-side search theo keystroke (network log chỉ mount-time
  `?scope=shared` + `?customerId=1`); không có ngưỡng ≤2/≥3 ký tự. Lỗi còn
  sót trên main sau 261022213755b: gõ ĐÈ lên ô kho đã có pick — keystroke
  đầu làm onCustomValue clear id (value id → '') và sync effect trong
  `uui-searchable-field.tsx` chạy `setInputValue('')` ăn mất chữ vừa gõ
  ("GLC" → ô còn "LC"). Symptom "GLC → menu đóng" của khách trùng dạng
  pre-fix 261022213755b (ảnh chụp trước khi fix deploy); field trống đã
  xanh trên main — residual là path gõ đè, đã fix bằng typing-session law:
  khi typedCustomTextRef live, sync effect không đè inputValue; luật
  chosenKey (fromLiveTyping) giữ nguyên.
- Files: `frontend/src/features/shipments/create/uui-searchable-field.tsx`
  (+26/−8: typing-session guard + commitEnterMatch session-end),
  `frontend/src/features/shipments/create/ShipmentCreateContainerRow.tsx`
  (sweep: allowsCustomValue cho Cảng hạ, twin Cảng nâng), test mới
  `uui-searchable-field.typing-session.test.tsx` (8 tests, 2 fail trên code
  cũ — red-green proof), testplan case
  `testplan/cycles/2026-10/2026-10-23-tiepvu3-kho-search-stale-race.md`.
- Env verify: FE worktree :7176 (proxy chung BE :3002, đã tắt sau QA); trunk
  :3002/:7175 chạy từ main checkout. DB :5441 có kho GLC id 27166 (tạo cho
  repro, GIỮ LẠI để regression tái chạy).
- Gates: root lint 0 · FE `tsc -b` 0 · `make build` 0 · FE full vitest FINAL
  712 files / 5497 tests ALL PASS (2 run đầu: 2 fail thiếu dist ở worktree
  mới — xanh sau build; 1 flake KT-16 ShipmentFinanceForm dưới tải — xanh
  scoped 4/4, không import module bị đổi) · scoped searchable-field 23/23 ·
  create-feature 224/224.
- Non-goals: không đổi exact-match semantics của warehouseCustomText
  (owner ruling 261022213755b passthrough); không thêm server search;
  UuiSelectField/finance form không thuộc changeset.
# HANDOFF — fix-tiepvu-rb2 (cards 261022201006b/c, TiepVu 22/10 evening)

- Owner/controller: this session (worktree
  /Users/dev/.paseo/worktrees/1njkloyy/fix-tiepvu-rb2, branch `fix-tiepvu-rb2`
  off main 39e40fc1).
- Last updated: 2026-10-22 ~22:15.
- Goal: (b) "Lọc theo ngày trên CUS vẫn trả lô ngày khác" +
  (c) "App lái xe bỏ hiển thị mã chuyến" (REQ-07 cũ). STATUS: DONE —
  independent code-reviewer verdict READY_WITH_CONCERNS, all 5 findings
  resolved (strict date grammar + 400 at the route, end-exclusive VN-day
  bound, coalesce-law regex pin in tests, dead CSS removed, comment anchors
  fixed); landing via the trunk commit titled `fix(cus,driver): filter ngày
  đúng VN timezone + bỏ mã chuyến màn lái xe (TiepVu 22/10, cards
  261022201006b/c)`.
- Card B root causes (probe-first, `qa/scripts/2026-10-22-tiepvu-filter-boundary-probe.mjs`
  — before 8/13 with 4 leak FAILs → after 13/13):
  (1) lot-level date filter OR-ed `expectedDeliveryDate` unconditionally —
  reappointed lots leaked back under their old EDD day (fixture lot Z). Fix =
  `shipmentTransportDateCondition` in `cus-workspace-sql.service.ts` (EDD is
  the day only for container-less lots; else union of per-container
  `coalesce(appointment VN date, EDD)` — same law as the Chi tiết triage);
  used by CUS workspace shipment-mode AND `list-summaries` deliveryDate arm.
  (2) `GET /shipments?dateFrom&dateTo` compared `customsCutoffAt` (timestamptz)
  to a UTC-day window (`new Date('YYYY-MM-DD')`) — leaked/dropped rows at the
  00:00/23:59 VN boundary. Fix = `businessZoneDayStartInstant`/
  `businessZoneDayEndInstant` in `container-date-filter.ts` (VN-day window).
  FE param format was already YYYY-MM-DD — no FE change for card B.
- Card C: trip-code display removed from `/my-trips` cards, `/my-trips/:id`
  fact grid (Thông tin lệnh), and `/my-penalties` meta (sweep). `tripCode`
  KEPT on wire/DB (board matching in DriverTripDetailPage untouched).
  `driverTripCodeLabel` (REQ-07) deleted with its tests as dead code.
- Non-goals: card 261022201006a (tờ khai) — trùng scope lane
  `fix-cus-tokhai-cont` đang chạy, không thuộc changeset này. Also spotted
  same-class comparison on the dispatch handoff queue
  (`date(dispatch_handoffs.vehicle_needed_by)` in dispatch-planning-queries) —
  different screen/owner, NOT in this card; open a follow-up card if wanted.
- Env verify: BE worktree :3006 + FE :7179 (VITE proxy 3006), DB chung :5441
  (ss-prod-db); trunk :3002/:7175 and tokhai lane :3005/:7178 untouched.
  Worktree stacks can stay up or be killed after the session.
- Gates: root lint 0 · BE tsc 0 · BE tests 338/338 · FE tsgo 0 + `tsc -b` 0 ·
  FULL FE 710 files/5473 tests (after `vite build` — numeric-identity needs
  dist) · `make build` OK.
- QA artifacts: `qa/2026-10-22-tiepvu-b-c/` (probe before/after logs, UI
  driver logs + screenshots for BOTH cards, DB proofs, gates.log). Regression
  cases with results: `testplan/2026-10-22-card261022201006b-cus-date-filter.md`,
  `testplan/2026-10-22-card261022201006c-driver-trip-code.md`.
- Blockers/next: none. Review informational (pre-existing, NOT this diff):
  `CONTAINER_SORT_SQL.transportDate` / `containerMissingBitsSql` still give an
  FCL-undated container a NULL sort/completeness date while the filter law
  counts it under the lot's EDD day — pre-existing divergence worth a card if
  the owner wants full single-sourcing. Same-class date comparison on the
  dispatch handoff queue (`date(dispatch_handoffs.vehicle_needed_by)` in
  dispatch-planning-queries) — different screen/owner, NOT in this card.

---

# HANDOFF — fix-uui-select-modal (card 221026123031)

- Owner/controller: this session (OpenCode, worktree
  /Users/dev/.paseo/worktrees/1njkloyy/fix-uui-select-modal, branch
  `fix-uui-select-modal` off main 5c917db5).
- Last updated: 2026-10-22 ~13:35.
- Goal: "UuiSelectField listbox không click được trong modal (blocker tạo khung
  giá)". STATUS: DONE — nhưng KẾT LUẬN LÀ FALSE POSITIVE, không có bug sản phẩm.
  Product code KHÔNG đổi; main đã được verify E2E tạo khung giá OK (KH chọn
  được, `201 POST /api/quotations` id 2526/2527, list refetch, DB proof).
- Root cause chuỗi sai của repro cũ: (1) `[role="option"]` trần trúng row của
  `ul[role=listbox].quotation-frames__list` (trang, dưới scrim modal — chặn
  click là ĐÚNG); (2) thiếu "Ngày hiệu lực"; (3) fill() tràn vào segment DD của
  ô ngày segmented. Giả thuyết z-index BỊ BÁC BỎ: react-aria useOverlayPosition
  hardcode inline `zIndex: 100000` cho popover portalled — luôn trên --z-modal.
- Fix thật (đúng defect class — QA harness): driver chuẩn
  `qa/scripts/2026-10-22-uui-select-modal-driver.mjs` (scope option vào
  `.ds-uui-select__popover`, type ngày theo digits, đủ trường bắt buộc);
  testplan/cases/case-QA-2026-10-22-uui-select-modal.md; evidence
  qa/2026-10-22-uui-select-modal/.
- Gates (trên tree final = main + QA files): FE scoped 282/282, tsc -b 0,
  lint 0, vite build OK, FULL FE 710 files/5481 tests PASS (sau build dist —
  numeric-identity cần dist như HANDOFF trước đã ghi).
- Blockers/next: none. Lưu ý: đã revert sạch sửa z-index popover.tsx thử trong
  phiên (no-op thua inline style của react-aria) — không được đem lại.

---

# HANDOFF — fix-lcl-kho-chung (card 261022093245)

- Owner/controller: this session (OpenCode, worktree
  /Users/dev/.paseo/worktrees/1njkloyy/fix-lcl-kho-chung).
- Last updated: 2026-10-22 ~10:45.
- Goal: LCL "Kho lấy hàng (CFS/Cảng)" list từ danh mục chung, không lọc theo
  khách. STATUS: DONE — commit 57f692d5 pushed to origin/fix-lcl-kho-chung.
- Scope: BE `GET /operational-sites?scope=shared` + drop customer-scope guards
  on the warehouse point (fulfillment snapshot + intake dispatch validate;
  factory keeps customer-scope). FE create form reads shared catalog; payload
  labels resolve via union; hint reword; "+ Thêm kho" kept.
- Non-goals: FCL port pickers, cus-workspace, ports-catalog merge into the kho
  dropdown (id spaces differ — deliberately not mixed).
- Files owned: shipment-intake.service.ts, shipment-fulfillment.service.ts,
  core.routes.ts (operational-sites GET), shipmentClient.ts,
  ShipmentCreateWorkspace.tsx, ShipmentCreateLclRouteSection.tsx + tests.
- Preserved: user's trunk backend on :3002 untouched; worktree QA stack
  (3003/7177) stopped after evidence; docker network pool full — worktree
  `make dev` fails on network create, run backend/frontend directly instead.
- QA artifacts: qa/2026-10-22-lcl-kho-chung/ (before/after API, UI driver
  before/after + screenshots, gates.log). Regression case:
  testplan/cases/case-QA-2026-10-22-lcl-kho-chung.md (all R1–R6 verified;
  R1/R2 UI DRIVEN rung 3, shipment 312533 SHP-2610-19366 on shared kho 442).
- Gates: lint 0, BE tsc 0, BE tests pass (unit 4/4 new + integration 338/338),
  FE tsc -b 0, FE full suite green (numeric-identity needs dist — built),
  make build OK. All on final code state.
- Blockers/next: none. Possible follow-up: UI hiển thị owner-khách của từng
  kho trong dropdown (hiện chỉ tên kho) nếu owner muốn.


---

# CUS tờ khai inline + sync · sửa/thêm cont hết lỗi (cards 261022095235a/b, Zalo 20:03 + ruling 09:50 22/10) — 2026-10-22

Controller: this agent, worktree `1njkloyy/fix-cus-tokhai-cont`, branch
`fix-cus-tokhai-cont` (off main 839d0577).

**Status**: DONE — repro-first: API flows add/đổi/xóa cont trên lô data bẩn
ĐÃ XANH từ các card trước (probe 13/13); gap thật = (1) /shipments/:id không
còn nút Thêm/Xóa cont (TICKET-09 gỡ 17/10 — ruling 09:50 22/10 BẬT LẠI,
supersede, FB-112 mở lại), (2) editor số cont workboard dead-end 400 không
gợi ý sửa. Cả hai đã fix + tờ khai click-to-edit đưa vào ledger chia sẻ.

- **Card A (261022095235a)**: cột "Số tờ khai" MỚI trên `CusContainerLedger`
  (drawer Tổng quan + /shipments/:id) — click-to-edit, Enter lưu ngay qua
  container-line command = law FB-109 auto-copy (chỉ cont còn trống,
  divergence cho phép, toast theo declarationSync); nút Copy 1-call
  (copy-declaration). KHÔNG phát minh law mới — BE không đổi.
- **Card B (261022095235b)**: `/shipments/:id` host CHÍNH
  `CusContainerLedger` (writer roles ADMIN/MANAGER/CUS/DISPATCHER, chưa lock,
  chưa COMPLETED/CANCELED; reader giữ section đọc) → Thêm/Xóa container hoạt
  động TỪ màn chi tiết; remove 409 có recovery (parity add r19); workboard
  editor số cont có ISO hint + "Đổi thành <số>" 1 chạm (giống add-row
  191026100000).
- **Gates (sau review fixes)**: root lint 0 · FE `tsgo --noEmit` 0 + `tsc -b`
  0 · **FULL FE 5467/5467 TOÀN XANH** · `make build` OK. BE/src không đổi →
  BE gates không đụng.
- **Evidence**: `qa/2026-10-22-cus-tokhai-cont/` — pre-fix driver (hasAdd:false
  @detail), api-repro-dirty-flows, sync-probe 13/13 (R2/R3/R2b/cross-lot
  409/cardB), post-fix driver 15/15 UI (rung 3: screenshots + DB proof qua
  psql), resp-sweep 12/12 @390/768/1440 (cell hiển thị, không page-overflow,
  scroll nằm trong band), drawer-fanout 6/6 (sau review fix HIGH#1); probe
  `qa/scripts/2026-10-22-tokhai-cont-sync-probe.mjs`; regression
  `testplan/2026-10-22-card261022095235ab-tokhai-containers.md` (TOKHAI-R1…R9
  + mục review đã xử lý).
- **Review độc lập**: code-reviewer DONE_WITH_CONCERNS → 4 finding (HIGH
  drawer sibling stale, MEDIUM disable-blur, MEDIUM LCL dead card, LOW
  !line-throw/idempotency) — TẤT CẢ đã fix + test + verify rung 3.
- **Env verify**: BE worktree :3005 + FE :7178 (VITE proxy 3005), DB chung
  :5441 (ss-prod-db), role cus. Port 3002/7175 thuộc checkout main — không đụng.

---

# R32 báo giá UI spec verify (card 221026040542) — 2026-10-22

Controller: this agent, worktree fix-quote-ui-spec (off main cae84f8d), branch fix-quote-ui-spec.

**Status**: DONE — verify-first, **0 src change cần thiết**: QA verify-fail
"không có UI báo giá" là SAI — 14/14 mục checklist BaoGia.md CÓ tại
`/config/quotations`. UI DRIVEN 29/29 + gates xanh + evidence + commit/push.
(Prepend theo quy ước stacked log; lịch sử các lane trước giữ nguyên bên dưới.)

- **Đối chiếu field-by-field** (`qa/2026-10-22-quote-ui/README.md`): khung giá
  (tên mẫu/giá dầu tham chiếu/ngày hiệu lực/làm tròn NONE-THOUSAND-TEN_THOUSAND)
  · lưới 10 hạng/tuyến (6 lẻ + 4 cont, nhãn từ `QUOTATION_GRID_COLUMNS`, seed
  đủ 12 mã chuẩn trong `vehicle_size_classes`) · mỗi ô 3 giá trị (Hệ số input +
  Lít dẫn xuất + Giá cos, thiếu giá hiện "Thiếu giá" đúng ruling 2) · nút
  Nhập xlsx (preview→Ghi nhận/Huỷ, Huỷ không ghi vết 2→2) + Xuất xlsx (6590B
  khớp API) + per-version Xuất xlsx + Xem payload chỉ đọc.
- **KHÔNG đụng lag field**: hiển thị "Trễ N ngày" từ `freight_rate_terms`;
  `fuelPriceLagDays` do lane song song thêm — đã ghi trong evidence là sắp có.
- **UI DRIVEN 29/29** (`qa/drivers/2026-10-22-quote-ui-drive.mjs` →
  `qa/2026-10-22-quote-ui_ui-driver.log`, 1440×1000, admin): API identity
  30 cell = 3 tuyến × 10 mã; DB proof `qa/2026-10-22-quote-ui_db-proof.txt`.
- **Gates**: FE `tsgo --noEmit` 0 + `tsgo -b` 0 · scoped vitest config pages
  236/236 · **FULL FE 5454/5454** (run 1 fail 2 chỉ vì worktree chưa build —
  test pin production CSS cần dist; sau `pnpm build` toàn xanh) · root lint 0.
  0 src change → BE gates không đụng. (Shared `npm test` có 2 fail fifoAging
  pre-existing tại cae84f8d — debt aging, ngoài scope, không thuộc gates.)
- **Testplan case**: `testplan/2026-10-22-card221026040542-quote-ui-spec.md`
  (QA-BG-UI-1…5).
# QA R32 — Báo giá ENGINE WIRING + fuelPriceLagDays khung giá — 2026-10-22

Controller: this agent, worktree `1njkloyy/feat-quote-engine-wiring`, branch
`feat-quote-engine-wiring` (off main `cae84f8d`). Closes
`testplan/cases/case-QA-2026-10-22-quote-engine-wiring.md` (QA R32 "không
engine", spec BaoGia.md §2 + CuocPhiPhuPhiDau.md §2/§7).

**Status**: DONE — verify-first: engine wiring đã có sẵn ở trunk từ R31 (8
call site qua `lockShipmentFreightRate`); lane bổ sung (1) lag là thuộc tính
KHUNG giá, (2) endpoint preview-rate cho QA, (3) test pin công thức + căn cứ.

- **fuelPriceLagDays khung giá**: column `quotations.fuel_price_lag_days`
  (int ≥0, NOT NULL DEFAULT 1 = import-lag NEWEB; migration
  `20261022090000` + journal idx 152, đã áp dev 5441, backfill an toàn) +
  zod `quotationCreateSchema` + `QuotationView`; create/update/get/list +
  import commit ghi lag khung qua `resolveImportedFuelLag`; FE
  QuotationCreateDialog (default 1) + strip "Thông tin khung" trên
  QuotationConfigPage hiển thị + sửa được (draft-on-blur, số rác không lưu).
- **Engine theo khung hiệu lực**: `resolveQuotationHints` trả frame nguồn
  (id/tên/effectiveDate/lag); lag tra giá dầu = `effectiveFuelLagDays(frame,
  terms)` — khung THẮNG, terms fallback (khách chưa có khung giữ nguyên hành
  vi seed NEWEB lag 1). Formula mapping comment code→C/E/F/G/H/J/K trong
  engine header.
- **Preview-rate (QA probe)**: `POST /api/quotations/preview-rate`
  {customerId, factoryId|routeId, hạng, ngày} → J/H/K + liters + nguồn frame;
  non-material-write + ACCOUNTANT/ADMIN như import preview; nhà máy =
  operational_sites FACTORY → route canonical.
- **Pure wiring core**: `freight-lot-basis.ts` (không db) —
  `classifyLotPricingBasis` (đủ/thiếu căn cứ LOCK/SKIP, giữ nguyên hành vi
  lockShipmentFreightRate gồm LCL-lock-at-dispatch và 409 MISSING_WEIGHT ở
  dispatch) + `effectiveFuelLagDays`; unit-test đầy đủ.

**Evidence** (`qa/2026-10-22-quote-engine/`, backend worktree port 3009, dev
DB 5441, account ketoan): case1 đủ căn cứ NEWEB CONT40 2026-09-20 → AUTO
E=91, J=4.182.000, H=889.744, K=5.071.744 + frame nguồn #1 lag 1 (khớp bảng
§6.1); case2 thiếu điều khoản → MANUAL 0/0/0 + formula chỉ thiếu căn cứ
(không bịa số); case3 khung lag 71 → target 07-11 → H=354.664, K=4.536.664
(khớp §6.2 — chứng minh lag KHUNG điều khiển engine, terms vẫn lag 1); case4
dọn frame tạm xong quay lại đúng case1; case5 factoryId 27004 → route 1 cùng
K. Driver log + JSON mỗi case.

**Gates**: root lint 0 · be-tsc 0 · BE unit 386/386 + full BE (unit+
integration) 0 fail · shared touched-file tests 25/25 (10 fail fifoAging là
pre-existing trên main, ngoài scope) · fe tsc -b 0 · scoped quotation FE
27/27 · **full FE suite 708 files / 5.455 tests 0 fail** · make build 0.

## Not covered (R32 lane)

- UI click-through màn QuotationConfigPage (lag editor) — DB/API VERIFIED
  (PUT payload có test FE; evidence cấp API theo brief). QA R32 tự E2E.
- Staging (owner NEVER per law); role CUS gọi preview-rate (chỉ ACCOUNTANT/
  ADMIN theo thiết kế admin/test).
- shared fifoAging 10 fail pre-existing main — không đụng lane này.

---

# DRI-03 lan 2 (card 211026180628) — kẹp 2x20' verify theo lot QA 133/SHP-2610-00069 — 2026-10-21

Controller: this agent, worktree fix-dri03-lan2 (off main 9aab78d2), branch fix-dri03-lan2.

**Status**: DONE — verify-first, **0 src change cần thiết**: fix lần 1 (1a7fc73b,
đã ở main) GIỮ NGUYÊN trên shape lot QA thật. 20/20 UI DRIVEN PASS + gates xanh +
evidence + commit/push. (Prepend theo quy ước stacked log; lịch sử các lane trước
giữ nguyên bên dưới.)

- **Shape thật (GET staging READ-ONLY, admin)**: lô 133/SHP-2610-00069, Long Minh,
  revGroupId NULL, 2×20'DC (typeId 1), containerNumber/seal/weight/appointment NULL,
  status PENDING_DATE, 0 trips — QA đang tự dispatch cho bqhuong. Snapshot:
  `qa/2026-10-21-dri03-lan2/staging-lot-shape-SHP-2610-00069.json`.
- **Local seed theo shape thật** (`testplan/qa/scripts/2026-10-21-dri03-lan2-fixture.mjs`,
  idempotent): lot 312425/SHP-2610-19309 BL DRIL2-KEP (Long Minh, IMPORT, FCL, 2×20DC
  NULL số, appt 09:00/12:00 +07 RIÊNG từng cont) → dieuvan assign truck 186320
  (bqhuong 42966, trailer 40FT id 1) từng fulfillment (leg 2 qua warn-once
  RIG_OVERLAP_COMPLETED + confirm — đúng fix dis-03) → phát lệnh từng leg → trips
  194126 (TRP-202610-1589, 09:00) + 194127 (TRP-202610-1590, 12:00) → KEP pair 2899
  ACTIVE (draft từ GET /trips/:id như PairTripsDialog; KHÔNG tự build ISO từ DB —
  tz naive lệch múi giờ).
- **UI DRIVEN 20/20** (`testplan/qa/scripts/2026-10-21-dri03-lan2-driver.mjs` →
  `qa/2026-10-21-dri03-lan2/dri03-lan2-ui-driver.log`, 390×844, bqhuong):
  R1 board 2 card KẾP giờ riêng 09:00/12:00 "Chưa có số cont" · R2/R4 detail mỗi leg
  mã riêng + giờ riêng + Cảng nâng SITC - Lạch Huyện / Cảng hạ TC - HICT + bento đúng
  1 cont (8.000/7.500 kg) · R3/R4 nhập số cont per leg — DB trip_containers 28754/
  28756 đúng từng dòng, KHÔNG TRỘN · R5 Nhận lệnh leg A: A IN_TRANSIT, B vẫn CREATED,
  ORDER_RECEIVED chỉ ở A. 0 console error.
- **Gates** (`qa/2026-10-21-dri03-lan2/gates-*.log`): FE `npx tsgo -b` 0 · root
  `pnpm lint` 0 · scoped vitest driver 5 files **185/185** · `make build` 0 ·
  dev-port-contract PASS (run 1 bắt script lane hardcode 7185/3025 → sửa về contract
  default 3002/7175 env-only — chỉnh duy nhất ngoài evidence). Full FE 3 lần dưới
  máy tải 19–40 (đa lane): mỗi lần một tập fail timing KHÁC NHAU, file nào cũng
  từng pass ở run khác / ở gate lane gốc; 0 src change nên không có cơ chế ảnh
  hưởng — logs full1/2/3 kèm; full-run xanh cần máy yên (nợ controller, tiền lệ
  FB-066). 0 src change → BE gates không đụng.
- **Testplan case**: `testplan/cases/case-QA-2026-10-21-dri03-lan2-kep-real-shape.md`
  (DRIL2-A1/R1..R5 + coverage §9). Case lane 1 giữ nguyên.
- **Data để lại (dev DB 5441)**: lot 312425, trips 194126/194127 (A đã IN_TRANSIT sau
  R5), KEP pair 2899, truck 186320. Không đụng dữ liệu lane khác trên DB chia sẻ.

## Not covered

- Staging re-drive sau deploy (owner NEVER per law) — QA tự E2E trên staging với lot 133.
- EXPORT direction (lot QA là IMPORT); hoàn thành chuyến/e-POD từng leg (ngoài scope
  card); OCR camera thật (unit pin lane 1); viewport 768/1440 (app lái xe mobile 390).

---


# LCL-01 lan 2 — overview/detail không đồng bộ, shape container-row chưa có ngày (card 211026180528) — 2026-10-21

Controller: this agent, worktree `1njkloyy/fix-lcl01-lan2`, branch `fix-lcl01-lan2`
(off main `9aab78d2`). Commit `ddf45946`, pushed origin. Staging READ-ONLY suốt lane.

**Status**: DONE — verify-first trên build 9aab78d2 → root cause → fix → gates →
review độc lập (land as-is) → commit+push. Staging KHÔNG deploy (owner recut wave).

- **QA lot (diff probe)**: staging probe toàn bộ page, 6 account (5 CUS + admin),
  đúng 1 lô rớt: **133 / SHP-2610-00069** — QA Vũ Văn Tiệp tạo 17:09 (`POST
  /shipments` body `{customerId}` → cargo_mode NULL) + 2 cont 20' chưa hẹn ngày
  17:11 (fixture DRI-03; owner addendum xác nhận). Card wedge 18:05 = lô này.
- **Root cause**: `containerDayTriageCondition` (lan 1) chỉ miễn container-less
  LCL. Row CÓ container mà triage day `coalesce(appointment, EDD)` = NULL không
  match range nào → bị mọi date arm drop khi Tổng quan (không date scope mặc định)
  vẫn liệt kê.
- **Fix**: arm thứ ba `isNull(containerTransportDateSql())` — row không có triage
  day đi ngoài day-triage bất kể cargo shape; arm lan 1 + dateArms giữ nguyên.
  Nulls-first sort arm của board sống lại (unscheduled lên đầu).
- **Gates**: be-tsc 0 · scoped 35/35 · BE unit 347/347 · BE test 335/335 · lint 0 ·
  pin 6/6 (3 cũ + 3 mới). BEFORE repro failures=2 → AFTER 8/8 (qa/2026-10-21-lcl01-lan2/).
- **Nợ/lưu ý**: (1) commit message có lỗi gõ "зерка" (cosmetic, không amend theo
  luật append-only); (2) bất đối xứng cố ý còn lại: Tổng quan với filter ngày TỰ
  CHỌN vẫn ẩn lô undated — đã ghi case doc, ngoài scope; (3) staging re-verify sau
  deploy thuộc owner; UI click-through 390px chưa drive (evidence cấp API theo
  brief); (4) QA lot 133 để nguyên cho DRI-03 (KHÔNG dispatch).

---

# DIS-08 lan 2 — container identity weight law (card 211026180428) — 2026-10-21

Controller: agent, worktree `fix-dis08-lan2` (off main `9aab78d2`), branch
`fix-dis08-lan2`. Previous HANDOFF owners (FB-066 quickadd, R29F FB-093) đều
DONE — replaced per protocol.

**Status**: DONE — root-caused, fixed, verified UI DRIVEN 15/15 (390/768/1440),
gates green, review APPROVE. Commit trên branch; push theo brief.

## Root cause (verify-first, staging read-only + local)

QA wedge 18:04 là CỘT "Tổng quan hàng hóa" trên /dispatch: cùng dòng cont
"1 x 40HC" = **400** trong cột Hàng, nhưng 600 dưới Cảng nâng/Hạ (sibling
selector page-local card B 18/10). Không có law dùng chung — mỗi surface tự pin
(master port columns / detail cell 20261005_361 / cargo cell không pin gì).
Loại trừ: CSS token undefined (var chain + `--fw-semibold:600` trên :root OK),
font mapping (SemiBold 600 face thật, widths 400/500/600/700 khác nhau).

## Fix

Shared owner `frontend/src/styles/operational-table-typography.css`:
`.ops-container-line, .ops-table .ops-container-line { font-weight:
var(--ops-table-primary-weight) }`. Compound selector là bắt buộc — selector
đơn thua `.master-plan-grid__location-value{400}` cùng specificity theo source
order (regression bị local driver bắt sống: port summaries rơi 400 round đầu).
Áp: cargo count lines (flag `identity`, placeholder "Chưa có cont" giữ thường),
port summaries (xóa sibling selector), detail serial (xóa page-local weight,
giữ size/nowrap). Port name 400 mọi chỗ. Non-goals: drawer (đã ≥600), presence
chips, XLSX export (text-only).

## Evidence

`qa/2026-10-21-card-211026144400-quickadd-flake/` (force-tracked): baseline FAIL
r2/r5, fix-idle r1-r5, fix-load r1-r5, full-suite + 2 lane logs (TRUNCATED, ghi
ro trong README), README verdict.

# R29F — FB-093 re-verify trên staging-built FE (nút "Tách nhóm" Kế toán) — 2026-10-21

Controller: agent, worktree feat-r29f-fb093-stgverify (off main ebd032fb), branch feat-r29f-fb093-stgverify.

**Status**: DONE — verdict **PASS 5/5 (UI DRIVEN)** trên staging-built FE. Fix
`essentialWhenHasData` (merge ebd032fb) đã được verify đúng lỗ hổng cần đóng
(lần trước mới chỉ local FE :7191 → staging API). Card 211026092400 đã
QA_TESTED từ lane trước; lane này là confirmatory — 0 src change.

## Next

- Merge trunk + staging recut khi wave đóng (src change có runtime FE).
- Regression case: `testplan/2026-10-21-dis08-lan2-cards.md` (DIS08-L2-01..05).
# DRI-01 + DIS-09 — tel: trên /trips/:id + Đổi nhà xe/BKS row-menu — 2026-10-21

Lane: paseo (glm-5.3-flash), worktree `fix-dri01-dis09-visible` off main `9aab78d2`.
Cards: 211026130743 (DRI-01) + 211026130015 (DIS-09). Audit ruling: "code CÓ
nhưng nằm màn khác màn QA vào = bug".

**Status**: DONE — commit trên branch, đã push. Gates: lint 0 · BE tsc 0 · BE
unit 348/348 · BE integration 335/335 · FE tsc 0 · FE vitest FULL 5429/5429 ·
make build OK. UI DRIVEN rung-3 (driver `testplan/qa/scripts/2026-10-21-dri01-dis09-ui-drive.mjs`,
18/18 PASS exit 0, evidence `qa/2026-10-21-dri01-dis09/`).

## DRI-01 — SĐT kho/nhà máy tel: trên /trips/:id + mọi danh sách
- BE `trip-factory-site.service.ts`: `TripFactorySiteView` + `contactName`/
  `contactPhone` LUÔN đọc LIVE site (snapshot chỉ đóng băng name/address —
  đúng nguồn driver channel gọi là SĐT kho). `/api/trips/:id` đã attach sẵn.
- FE: dòng "SĐT kho/nhà máy" TelLink trong BasicInfoCard; SĐT "Liên hệ & hướng
  dẫn" /trips/:id + /fw-trips/:id đổi sang TelLink chung (bỏ raw href chết với
  số có space/dot); /config/factories `callable`; OperationalSiteDetailsDialog
  + FactoryDetailPopover tel:.
- UI drive: trip 194048 (admin, 390px) — SĐT KHO/NHÀ MÁY `tel:02253555555`;
  seed instructions `0989 130 345` → hiển thị giữ space, href `tel:0989130345`.
  /config/factories: 52 tel link + 26 nút Gọi.

## DIS-09 — "Đổi nhà xe/BKS" vào ROW MENU (⋯) dòng đã gán
- Component mới `DispatchRowActionsMenu.tsx`: menu ⋯ trên dòng đã gán
  (carrierType != null, chưa COMPLETED): item "Đổi nhà xe/BKS" (lô ghép → mở
  CÙNG modal badge, draft pre-filled) + "Phân xe lại" (chuyến đã phát, cùng
  luật live-trip editor trigger). LIST PORTAL ra body `position: fixed` — cell
  body là `overflow: hidden`, absolute bị cắt (bắt bằng styles test).
- UI drive: /dispatch-detail?q=FB095UI-482D6671-A (dieuvan, 1440px), nhóm 2 lô
  109225/109226 BKS `29X-QA482D`: menu mở ngay trên dòng → 1 click dialog
  pre-filled → đổi `29X-QA-D9A` → toast + DB cả 2 lô → revert UI về nguyên
  trạng (DB proof 2 chiều).

## Gotchas cho session sau
- `dev-port-contract.test.ts` soi MỌI script trong testplan/qa/scripts —
  throwaway probe để ports lạ sẽ đỏ gate (đã rời bỏ tmp probe).
- FE full suite có flake load (waitFor timeout) — file nào đỏ thì chạy lẻ để
  phân biệt; đã chứng minh run 1 ≠ run 2 file đỏ khác nhau + stash-bisect
  RoleWorkInbox pair-flake có sẵn trên base.
- Local DB: nhóm 8038cabd (2 lô FB095UI-482D6671-A/B, delivery 17/10) là fixture
  DIS-09 dùng được; các nhóm QA khác (29C-QA*) fulfillment đã cancel — không
  lên board.
- Trip 194048 có instructions mới seed (SĐT 0989 130 345) — fixture DRI-01.
# LCL form visible-by-default — 4 card verify-fail (211026130115/30215/30315/30415) — 2026-10-21

Lane: worktree fix-lcl-form-visible off main 9aab78d2 (paseo 1njkloyy).

**Status**: DONE — 4 card "ẨN sau default" đóng bằng UI-visible-by-default trên
form tạo lô `/shipments/new` (form mặc định Nhập/FCL). Commit: 4 card visible-
by-default (kho title/LCL radio/reveal mở sẵn/quy cách hint).

## Thay đổi (1 shared owner: features/shipments/create + 1 component)

- **LCL-02 (211026130115)**: "+ Thêm kho" hiện trước khi chọn KH; dialog quick-add
  mở ở picker-mode (tự render chọn KH — `customerId ? Number() : undefined`,
  fix luôn cái bẫy `Number('') === 0`); title theo hướng (Nhập/mặc định "lấy
  hàng", Xuất "trả hàng" — law 181026143000 §1a). FACTORY giữ gate chọn KH +
  toast (contract riêng).
- **LCL-03 (211026130215)**: segmented control "Loại hàng" lên ĐẦU form —
  headingless band `ShipmentCreateSection id="mode"` (title optional mới) +
  `.csc-mode-band__row`; Lịch & ghi chú rụng ngay khi chọn Hàng lẻ (như cũ).
- **LCL-04 (211026130315)**: "Ngày giao hàng" mở sẵn ngay trong top band cạnh
  segmented control — 1 field luôn visible (181026200700 law giữ nguyên: không
  "+" reveal, không repeater, FCL vẫn không có field này).
- **LCL-05 (211026130415)**: placeholder "Gợi ý quy cách (chọn hoặc gõ)"; combobox
  chuyển sang variant `searchable` (focus-trigger, như factory picker) — dropdown
  mở có gợi ý sẵn khi click, free-text vẫn commit qua `onCustomValue` (FB-079).

## Bắt buộc đọc nếu đụng lại

- **Scroll-dismissal race**: click NGAY sau scroll-into-view tức thì sẽ bị overlay
  đóng menu trong ~60ms (mọi picker trong app đều vậy — customer/route combobox
  cùng hành vi). User thật (scroll xong rồi click) luôn thấy gợi ý. Test/probe
  phải pre-scroll + settle trước khi click; đừng "fix" bằng cách phá luật dismiss
  của overlay.
- **Vite dev + git stash**: stash/pop khi dev server đang chạy sẽ treo cache module
  (server trả code cũ) — restart Vite sau khi stash xong, nếu không evidence sai
  lệch hoàn toàn (đã gặp: probe "after" fail 3/4 vì server cũ).
- **Máy này load-flake (FB-066 class)**: load average 68–77 khi các lane chạy
  song song → vitest 5s-timeout fail ngẫu nhiên ở file bất kỳ. Phân biệt bằng
  chạy lại idle/standalone + base-run (git stash). `qa/2026-10-21-lcl-visible/
  2026-10-21_lcl-visible_fe-flake-atbase.txt` = 3 file nghi vấn pass 163/163 trên
  BASE khi quiet.
- `numeric-identity.styles.test.ts` đọc `dist/assets` — phải `pnpm --dir frontend
  build` trước full-suite.
- `dev-port-contract.test.ts` bắt script QA hardcode 7175/3002 — dùng `QA_BASE`
  env khi chạy port khác.

## Gates + evidence

tsgo -b 0 · tsc -b 0 · lint 0 · build 0 · scoped vitest (create + ClerkShipmentCreatePage)
**261/261 ×3** (mới: `ShipmentCreateWorkspace.lcl-visible.test.tsx` 4/4 pin 4 card) ·
full FE + UI-probe before/after: `qa/2026-10-21-lcl-visible/` (README verdict +
coverage table, 21/21 probe PASS, screenshots before/sau từng card trên form mặc
định Nhập). Reviewer độc lập: APPROVE (nits đã sửa). Regression case:
`testplan/2026-10-21-lcl-visible-default-4cards.md`; driver
`testplan/qa/scripts/2026-10-21-lcl-visible-probe.mjs`.

# FB-066 lan 3 / card 211026144400 — flaky quick-add "Nha xe" Escape settle (test-only) — 2026-10-21

Lane: paseo bdcd1424 (glm-5.3-flash, worktree ragged-sheep off 454fab6b). Agent
chet luc cho battery load → guard salvage 980b1c49; controller chay lai gates + merge.

**Status**: DONE — flake dong bang TEST fix; KHONG phai bug production (browser
that focus luon nam trong menu khi mo, Escape chuan react-aria dong binh thuong).

## Root cause (probe runtime)

Escape ban vao `document.activeElement` dua voi DOM focus async cua react-aria vao
listbox: khi focus con o TRIGGER button (ngoai popover portalled), event khong
bubble qua popover (handler nam tren popover — useOverlay keyboardProps) →
popover KHONG BAO GIO dong het budget 4s. Khong phai van de budget 1s nhu card
nau (budget that da la 4s tu lan truoc). Focus kip vao option → dong dong bo ~1ms.

## Fix (0 assertion weaken)

- Escape ban vao option DA await ben trong popover (duong bubble that: option →
  listbox → popover).
- `{ timeout: 20_000 }` cho 4 test async — vitest default 5s/test kep cac waitFor.
- Regression case: `testplan/2026-10-21-card-211026144400-quickadd-escape-settle.md`.

## Gates (verbatim)

- Baseline pre-fix idle 2/5 FAIL (r2, r5) → flake ton tai tren may nay.
- Post-fix: idle 5/5 + load 2-lane 5/5 (agent battery).
- Controller salvage re-verify 16:27: scoped vitest 3 lan x 5/5 (15.8s/15.6s/32.4s,
  run 3 duoi contention song song tsc+eslint) · FE tsc 0 · scoped eslint 0.
- Full-suite duoi load BI KILL khi agent idle (log truncated, khong summary; cac
  fail thay duoc la file khac — numeric-identity, AssignTruckGroupDialog, DIS
  group = pham vi lane khac; quick-add khong co trong fail list) → can full-run
  tren main de chung minh not.
- Review doc lap: APPROVE (6/6 constraint, react-aria@3.53.1).

## Verdict tóm tắt

- **Surface chính PASS**: ketoan profile sạch (storedChoice=null) →
  `/accounting/chot-debit` → cột "Thông số container" TỰ HIỂN + nút "Tách nhóm"
  enabled trên từng dòng nhóm R29F (aria-label nêu Số Bill). KT4 giữ nguyên
  (cột tiền breakdown vẫn ẩn).
- **Flow PASS**: click "Tách nhóm" dòng R29F-02 → dialog → unmerge **200**
  (`dissolved:true`) → board hết nút/note R29F; DB cả 2 lô revGroup=null,
  note=null; cước về đúng trạng thái trước ghép (lô chính null như trước, lô
  member 0₫ computed-zero D02).
- **Regression mini PASS**: `[]` → đủ cột; `['phanXe']` → phanXe ẩn đúng
  choice, container VẪN hiện; `['container']` → ẩn đúng (choice thắng
  essentialWhenHasData). 2 luật không va chạm.

## Bắt buộc đọc nếu dùng lại evidence này

- **Build drift**: task pin ebd032fb, resume pin 85ea2cef, build thực tế tại
  drive time **806acf89** (merge REQ-07 — chỉ driver-display FE, không đụng
  accounting). Drift được ghi nhận + chứng minh fix live bằng chunk bytes
  (`AccountingDebitClosePage-DJu42oE9.js` chứa `essentialWhenHasData`) trong
  `qa/2026-10-21-r29f-fb093-stgverify/00-build-and-fix-proof.txt`. Scripts
  abort khi health lệch `QA_EXPECT_BUILD`.
- **Note-literal trap**: board DOM render "(Ghép cùng Bill X)" (label
  `ghépCùngRef`) KHÁC chuỗi API "Ghép cước cùng Bill X" — assert từng surface
  theo literal của nó (run 1 fail 1/5 chỉ vì nhiễu này, evidence giữ dưới
  prefix `run1-note-literal-*`).

## Artifacts + scripts

- Evidence: `qa/2026-10-21-r29f-fb093-stgverify/` (README verdict + coverage
  table §9, PNG từng bước, DOM fragments, db-*.json, net.log, ui-driver.log).
- Drivers: `testplan/qa/scripts/2026-10-21-r29f-fb093-setup-merge.mjs` (UI tạo
  2 lô LCL R29F + UI ghép) và `testplan/qa/scripts/2026-10-21-r29f-fb093-tach-verify.mjs`
  (surface + tách nhóm + regression). Idempotent: tái dùng lô R29F nếu còn.
- Data test để lại: shipment 972/973 (SHP-2610-00572/573, booking R29F-01/02,
  YUANFANG) — cuối task cả 2 ungrouped, lock OPEN. Merge→unmerge ×2 chu kỳ
  (tiepvv merge, ketoan unmerge).

## Residual (ngoài scope, đã ghi nhận từ R29)

Kênh debit-summary hiển thị `freightAuto=0` KHÔNG kèm reason cho lô member
không-trip sau tách — snapshot `freight_rate_snapshots` giữ đúng reason D02
"Tách khỏi nhóm ghép — chờ định giá lại" nhưng read channel không surface.
Không phải defect "thiếu nút"; cần card riêng nếu muốn surface.

## Next steps (không blocking)

- Card riêng (nếu khách muốn): surface reason D02 trên debit-summary cho member
  sau tách.
- Khi staging recut tiếp và cần re-verify pin: `QA_EXPECT_BUILD=<hash> node
  testplan/qa/scripts/2026-10-21-r29f-fb093-*.mjs`.

---

# ENV-01 — make stgqa: clone prod→staging + auto-purge + QA fixture riêng — 2026-10-21

Controller: this agent, worktree feat-env01-stgqa (off main 1b56eeea).
Supersedes the REQ-19 handoff (status DONE, merged in f0877875 — verified).

**Status**: DONE — pipeline + unit/integration evidence + docs + commit/push.
Issue card: 4rankng/silversea#10. Regression case:
testplan/cases/case-2026-10-21-env01-stgqa-pipeline.md.

## Scope

- `make stgqa` (Makefile, NEW): stgdb sync (đã gồm QA-class purge) → reset
  mật khẩu Abc123 → seed fixture QA. Preflight chặn nếu image staging thiếu
  script ENV-01 (không bỏ staging với mật khẩu prod-set giữa chừng).
- `make stgqa-seed` (NEW): re-seed fixture sau `make demo`/`make qapurge`.
- backend/src/seed/stgqa-fixtures.ts (pure catalog: BU QA-DEMO, KH QAKH-DEMO,
  nhà xe QAKHO-DEMO, 4 lô QAENV01-* FCL-IMP/FCL-EXP/LCL/FCL-KEP 2×20DC).
- backend/src/seed/seed-qa-fixtures.ts + reset-staging-passwords.ts
  (executors; gate STGQA_ENV=local|staging + refuse prod host, cùng luật
  purge-qa-fixtures.ts). Idempotent upserts theo natural key, revive
  soft-deleted; BU hard-delete ⇒ seed ghi lại responsible_unit_id khi revive.
- Định hướng tham chiếu theo CHECK constraint + census prod: EXPORT→booking_ref,
  IMPORT→bl_number (ngược quy ước thế giới — đây là luật repo).

## Non-goals / decisions

- KHÔNG đổi hành vi `make stgdb` (mirror thuần). KHÔNG purge theo isAdHoc —
  lệnh chạy ngoài là dữ liệu kinh doanh thật. KHÔNG chạy trên staging trong PR.
- Fixture nằm trong QA marker class (qa-fixture-markers) ⇒ FB-061 giữ nguyên:
  view gương-prod ẩn, qapurge dọn.

## Evidence (qa/)

- 2026-10-21_env01-stgqa_lint.log / _be-tsc.log / _be-test.log (338+330) /
  _build.log — exit 0 hết.
- 2026-10-21_env01-stgqa_probe.log + 2026-10-21-env01-stgqa/probe-result.json
  — 13/13 PASS trên local dev DB (seed 2× idempotent, users không đụng,
  reset gộp hash, purge dọn class, re-seed phục hồi cùng lot ids).

## Remaining (next owner)

- Chạy thật `make stgqa` trên staging SAU khi `make demo` deploy image chứa
  ENV-01 (owner instruction) — chưa có lần chạy staging nào.
- Staging drive UI (rung 3) chưa làm — PR chỉ cài đặt + hướng dẫn per brief.
# REQ-07 — Format mã chuyến trong Driver App (doc khách REQ-07) — 2026-10-21

Controller: agent, worktree feat-req07-trip-code-format (off main c643ef1e), branch feat-req07-trip-code-format.

**Status**: DONE — display-layer only + gates + UI DRIVEN (local, 390px). Ưu
Thấp nhưng khách đã duyệt dispatch; làm gọn đúng brief, KHÔNG đụng backend/DB.

- **AUDIT (1) — tripCode sinh ra**: `backend/src/services/trip-create.service.ts`
  `generateTripCode()` (dòng 41-68): `TRP-${yearMonth}-${String(counter).padStart(4,'0')}`
  qua `trip_code_counters` (yearMonth + counter, lock chống loop). Row thật
  (DB dev 5441/silversea, read-only): 152 row shape chuẩn
  `TRP-202606-0084`, `TRP-202608-7037`; legacy `TRP-C12-53-1791212851260-gvr4vb`,
  `CN-…` (429), `BULK-TR-…` — formatter phải passthrough legacy, không vỡ.
- **AUDIT (2) — driver screens trước fix**: danh sách `DriverTripsPage` và
  chi tiết `DriverTripHeader` CHỈ hiển thị Bill/Booking (internal-ids law,
  CHIEF 26/09; `tripCode` có trong wire nhưng không render); lưới
  `DriverTaskInfoSections` không có hàng mã; `DriverTwoOrdersPage` type-only;
  `DriverPenaltyPage:238` render chuỗi generator THÔ — leak duy nhất.
- **FIX (display-only)**: `driverTripCodeLabel()` mới trong
  `features/driver/driver-display.ts` — shape chuẩn
  `TRP <yyyy>-<mm> · <seq>` (regex khớp đúng generator, seq giữ nguyên số,
  pad 4 khi thiếu; legacy → passthrough trim; null/'' → null để caller ẩn
  hàng, cùng contract `driverDeliveryDestination`). Render ở: (a) card danh
  sách — dòng "Mã chuyến …" dưới Bill, ẩn khi null, Bill vẫn lead (REQ-07
  điều chỉnh mệnh đề "TRP never renders" của card 20260927_1 — bill/booking
  giữ nguyên display key, SHP-/QADRV- vẫn cấm); (b) chi tiết — hàng "Mã
  chuyến" ĐẦU lưới Thông tin lệnh (icon untitled-ui `file-02`, search_icons
  verified; TaskFact house primitive, không tự chế layout mới — Tailkit không
  dùng vì không có layout mới); (c) `DriverPenaltyPage` — mã qua formatter,
  hết leak thô. KHÔNG đổi backend/generation/DB; KHÔNG migrate.
- **Gates (verbatim, log trong `qa/2026-10-21-req07-tripcode/`)**:
  `cd frontend && npx tsgo -b` → exit 0 · scoped vitest 10 files 195/195
  (driver-display 12, DriverTripsPage 42, DriverTripDetailPage 52,
  shipmentCostEntry 8, DriverPenaltyPage 4, pages/driver/ 77) ·
  `pnpm lint` → 0 · `make build` → exit 0 · driver script 10/10 PASS exit 0.
  Full FE suite **5374/5376** — 2 fail ĐỀU pre-existing trên branch base,
  A/B-verified bằng `git stash` rerun, không thuộc diff này:
  (1) `dev-port-contract` — script FB-033/FB-093 hardcode port
  3303/7177/7188 (FB-002 handoff đã ghi nhận, card riêng cho owner FB-033;
  script REQ-07 của task này env-only, không nằm trong offender list);
  (2) `DispatchAllocationLclDialog.quick-add.test.tsx:153` (FB-066) —
  **flake** async race nút "Áp dụng": 7 run A/B (có diff: F/P/F · sạch:
  P/F/P/F) fail ~50% cả HAI phía; card riêng cho owner.
- **Pre-existing branch debt (không phải do diff, stash-verified 2×: reviewer
  + author)**: `pnpm design:drift` đỏ ở base (baseline 2026-10-04 lag so với
  main; mọi category tăng đều không liên quan file này — diff CSS chỉ dùng
  token) và `pnpm size-check` spawn suite đã retire (e54504bf). Việc
  rebaseline thuộc owner; KHÔNG `--update` lậu 60+ raw values lạ vào baseline.
- **Evidence**: `qa/2026-10-21-req07-tripcode/` — 3 PNG 390px (list/detail/
  penalties) + `ui-driver.log` 10/10 PASS + `dom-list-codes.txt`/
  `dom-detail-facts.txt` + `db-0/1/2` (thử reassign nhầm keyspace
  users→drivers: 192861 về 3834, 67894 về 2, đều khôi phục; card evidence
  dùng trip 85065 `TRP-202610-0631` CỦA SẴN quyet (drivers.id 3), không mutate
  gì trong run cuối). Driver `testplan/qa/scripts/2026-10-21-req07-tripcode-ui-drive.mjs`.
  Regression `testplan/2026-10-21-req07-tripcode.md` (REQ07T-01..03).
- **Independent review**: subagent code-reviewer DONE — 0 critical/high/medium;
  2 low nit đã fix (hoist double formatter call trong penalty map; QA script
  env-overridable trip + derive label). Reviewer xác nhận: regex an toàn,
  contract test được củng cố (không weaken), CSS token-only, drift đỏ là
  pre-existing (tự stash-verify), không leak secret.
- **Verification coverage (§9)**:

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| REQ07T-01 card danh sách format chuẩn, raw string biến mất, Bill vẫn lead | UI DRIVEN | `ui-01-list-390.png` + `ui-driver.log` T01 3/3 + `dom-list-codes.txt` | HISTORY bucket card; card legacy-shape thật (BULK trip không có fulfillment nên không lên board — passthrough pinned ở unit) |
| REQ07T-02 chi tiết: hàng "Mã chuyến" đầu lưới, hàng giờ kế hoạch theo sau | UI DRIVEN | `ui-02-detail-390.png` + T02 4/4 + `dom-detail-facts.txt` | lô không mã ('—' → unit `DriverTaskInfoSections.test` REQ-07 case); role khác DRIVER |
| REQ07T-03 penalty hết leak thô | Unit VERIFIED (không UI-drive được) | `DriverPenaltyPage.test.tsx` 4/4; UI chỉ chụp empty-state (`ui-03-penalties-390.png`) — local không có penalty row gắn trip | formatted meta row chưa từng UI-driven (cần staging có data thật) |
| formatter legacy passthrough + null | Unit VERIFIED | `driver-display.test.ts` 6 case (TRP-C12, BULK-TR, CN-, dài, thiếu) | row legacy thật trên UI |
| không đổi backend/DB | CODE-READ ONLY | diff không chứa backend/; `generateTripCode` nguyên vẹn | — |

- **Not covered**: staging (bqhuong) chưa drive lại — fix local-only, chưa
  deploy; viewport 768/1440 (driver app là mobile-first, màn hình chỉ có
  390); Hai lệnh trong ngày (two-orders) không hiển thị mã (type-only, không
  thuộc REQ-07 scope hiển thị).

---



# REQ-19/TICKET-07 — depth audit cước hàng lẻ gom nhiều lô (tải trọng + 20/40) + cargo-fit advisory — 2026-10-21

Controller: agent, worktree feat-req19-cuoc-depth (off main c643ef1e).

**Status**: DONE — audit 3 câu (code-cite dưới) + implement GAP thật (cargo-fit
advisory shared/BE/FE) + unit/scoped gates xanh + E2E probe 11/11 PASS + commit/push.

## Audit answers (code-cite)

1. **1 xe 5T gom 3 lô — cước mỗi lô?** KHÔNG chia tỷ lệ kg/CBM. Luật =
   principal/member theo DEV SPEC 2026-10-15 đã nghiệm thu:
   - COST (trả ĐV): `lcl-grouping.service.ts:assignLclCostGroup` → Lô 1 =
     `applyPrincipalCostFreight` (manual `freightCost` > bảng giá
     `resolveCarrierVehicleClassPrice`: tuyến × loại xe × nhà xe, row nhà xe
     riêng thắng generic), Lô 2..N `externalFreightCost='0'`; phát lệnh tách lô
     chưa có trip → `applyLclCostGroupFreightToNewTrip` (dispatch-planning-
     commands.service.ts:732).
   - REV (thu KH): `mergeLclRevGroup` → Lô 1 = 100% AUTO
     `resolveCustomerVehicleClassPrice` (KH × tuyến × loại xe, chỉ cùng 1 KH),
     Lô 2..N revenue 0₫ + stamp "Ghép cước cùng Bill X"; boards đọc kênh F-2
     (`revenue-override-read.service.ts`).
   - Trọng tải tấn/cont 20/40 = **khóa bảng giá** (`vehicle_size_classes`),
     không phải hệ số phân bổ. FB-095 promote-on-unmerge/delete bảo toàn tiền.
2. **"Quy đổi cont 20/40" cho hàng lẻ?** Lô lẻ KHÔNG có cột cont-type
   (`shipments`: cargoWeightKg/cargoVolumeCbm/packageCount/packageType) và
   KHÔNG có quy đổi CBM→20' ở bất kỳ đâu. CONT20/CONT40 là loại xe tính cước
   trong DM (bảng giá thu/trả); spec đã nghiệm thu không đòi quy đổi →
   không implement quy đổi. **GAP thật**: không tín hiệu "hàng gom vừa tải
   trọng lớp xe đã chọn?" (thanh chọn chỉ hiển thị tổng — DispatchDetailPlan
   Page.tsx:296-304; dialog chọn lớp mù).
3. **Thu/trả từng lô đúng phần khi gom?** ĐÚNG — mỗi chiều vật hóa trên kênh
   đọc của từng lô (trip revenue + stamp / trip external_freight_cost);
   debit note in đúng phần + "Ghép xe cùng Bill" (billing-document-draft
   service.ts:652-656). E2E probe chứng minh: Σ thu nhóm = 1× giá KH 5T,
   Σ trả = 1× giá nhà xe (cascade riêng>chung), Lô 2..N = 0₫ cả hai chiều.

## Implement (GAP: tải trọng advisory — không đổi luật tiền)

- `shared/src/constants/lcl-cargo-fit.ts` (NEW): `parseTonnageKg` ('5T'→5000;
  cont/rác→null), `assessLclCargoFit` → FITS|OVER|NO_WEIGHT|CONTAINER_CLASS|
  UNKNOWN_CLASS (Σ known kg vs tải trọng; không bịa dung tích cont; advisory
  only). Export barrel shared/src/index.ts. Unit 7/7.
- BE `assignLclCostGroup`: stamp `cargoFit` vào `LclGroupAssignResult` +
  audit metadata (additive, non-breaking). Pin unit (source-scan)
  `backend/src/tests/unit/lcl-cargo-fit-wiring.test.ts` 4/4.
- FE `AssignTruckGroupDialog`: row contract + adapters thêm cargoWeightKg/
  cargoVolumeCbm; fit line `role=status` dưới ô loại xe (FITS muted, OVER đỏ
  `--danger`, cont nhắc đối chiếu CBM); CSS `assign-truck-group__fit[--over]`.
  Test 4 case mới — dialog suite 16/16.

## Evidence + gates (qa/2026-10-21-req19-cuoc/)

- **E2E probe 11/11 PASS exit 0** (`probe.log`, `probe-verdicts.json`,
  `bang-tinh-case.md`): CASE A = case gốc brief (5T + 3 lô 1.500/1.500/2.000 kg,
  CBM 3,2/4,8/6,0, LONG MINH × route 1): Lô 1 trả 1.100.000 (nhà xe riêng thắng
  generic 1.234.500), Lô 2/3 = 0₫; thu Lô 1 = 2.400.000 (bảng giá KH 5T),
  members 0₫ + stamp; Σ = 1× mỗi chiều; audit cargoFit FITS|5000. CASE B: Σ
  4.000 kg trên 3.5T → 201 + cargoFit OVER (advisory không chặn; board-miss Lô 1
  giữ null, không bịa 0₫). Fixture QA-REQ19-* dọn sạch (5 lots/5 trips/1
  carrier/1 supplier/1 pricing row).
- Gates verbatim trong `gates/`: BE tsc 0 · BE full **330/330** (326 + 4 pin
  mới) · FE tsc -b 0 · FE scoped dispatch surfaces 38 files **409/409** +
  dialog 16/16 · lint 0 · make build 0 · shared tsc 0 + lcl-cargo-fit 7/7.
- **Pre-existing (A/B stash, không của task này)**: shared `fifoAging.test.ts`
  6 fail trên cây sạch.
- Probe: backend worktree :3304 (env-only, đã tắt), DB ss-prod-db :5441 chỉ
  đọc + fixture QA-tag; :3002/:7175+ của task khác không đụng.

## Verification coverage (§9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Luật tiền gom (trả+thu) đúng spec trên case thật 5T/3 lô | DB/API VERIFIED + API DRIVEN (POST thật qua service thật) | probe.log REQ19-A1..A8, bang-tinh-case.md | không click UI dialog thật (luật BE); role khác dieuvan/ketoan |
| cargoFit OVER advisory không chặn + không đổi luật tiền | DB/API VERIFIED | REQ19-B1..B2 | UI click submit khi OVER (pin vitest che) |
| Dialog fit line (FITS/OVER/cont/thiếu kg) | CODE-READ + unit (rung 1 cho UI) | AssignTruckGroupDialog.test.tsx 4 mới | chưa UI-drive dialog thật 390/768/1440; MergeRevGroupDialog (CUS) không thêm fit — ngoài scope |
| BE stamp cargoFit response+audit | DB/API VERIFIED | REQ19-A1-fit, REQ19-A8 | — |

## Not covered / nợ

- UI-drive dialog Gán xe nhóm thật (sau merge); fit line cho MergeRevGroupDialog
  (chiều thu CUS — cần ruling riêng nếu muốn); fare boards ngoài 5T/3.5T;
  staging re-drive sau deploy (owner NEVER per law).
- Quy đổi CBM→20' và phân bổ tỷ lệ: KHÔNG làm (spec không đòi; đổi luật tiền
  là owner decision — không mở lại không có chỉ thị mới).
- Independent review (về sau commit theo chỉ đạo orchestrator): **APPROVE**,
  0 critical/high — advisory không bao giờ thành gate, luật tiền byte-identical,
  parse khớp ladder seed thật, numeric-string an toàn cấu trúc. Medium duy nhất:
  `shared fifoAging.test.ts` đỏ — **pre-existing, A/B stash chứng minh trên cây
  sạch** (diff không đụng calculations/; file import trực tiếp fifoAging.ts,
  không qua barrel) → cần card riêng cho owner. Low-priority polish (không chặn):
  thống nhất name/code trong copy NO_WEIGHT/UNKNOWN; live-region mount rỗng rồi
  set text; pin regex wiring dễ gãy khi reformat; fallback CSS 12px vs token 11px.

---

# FB-093 follow-up — nút "Tách nhóm" cho Ghép cước thu khách (card 211026024348) — 2026-10-21

Controller: agent, worktree fix-fb093-tach-nhom (off main f056944f), branch fix-fb093-tach-nhom.

**Status**: DONE — fix + scoped/full gates + UI DRIVEN (staging before · local after). Card 211026024348 (QA: "FB-093 ghép cước thu khách thiếu nút tách nhóm"). Card .docx vẫn bị GDrive BadZipFile/EDEADLK — scope theo tiêu đề + brief; đã thử lại trước commit, không đọc được.

- **BUG**: sau Ghép cước thu khách (Lô 1 = 100% CƯỚC VẬN TẢI AUTO, Lô 2..N = 0₫
  + "Ghép xe cùng Bill [Lô 1]") trên Chi phí - Quyết toán (và mọi surface) KHÔNG
  có đường nào tách nhóm lại. Staging f056944f tái hiện: dòng merge hiện note
  nhưng 0 nút tách (`qa/…/staging-repro-ui-driver.log` 2/2 PASS, read-only).
- **FIX (UI)**: `UnmergeRevGroupAction` dùng chung — `<button type="button">`
  "Tách nhóm", aria-label "Tách nhóm ghép cước thu khách — lô [Số Bill]",
  `DisabledActionTip` gate (aria-disabled + aria-describedby lý do "Nhóm ghép đã
  chốt kế toán — không thể tách nhóm.", KHÔNG `disabled` attr — pattern FB-093b,
  handler guard), confirm bằng `ConfirmDialog` chung. Render trên MỌI dòng thuộc
  rev group: Chi phí - Quyết toán (ô CƯỚC VẬN TẢI (AUTO), cạnh note ghép) +
  `/accounting/chot-debit` (ô Thông số container, cạnh "(Ghép cùng Bill X)" —
  wire thêm `lcl.revGroupId`, query đã có sẵn). Wire đúng endpoint sẵn có
  `POST /api/shipments/lcl/unmerge-group` (`unmergeLclGroup` REV) — KHÔNG có
  path unmerge thứ hai. Role law đã verify: ADMIN/MANAGER/DISPATCHER/CUS/
  ACCOUNTANT ⊇ merge counterpart (CUS + kế toán đều tách được).
- **FIX (BE — trong path unmerge sẵn có)**: `unmergeLclGroup` chiều REV trả
  tiền về trạng thái trước ghép + dọn note ghép (`restoreRevPreMergeMoney`):
  trip live ⇒ `revenue ← revenueOriginal` + clear stamp "Ghép cước cùng Bill…"
  (lô rời read channel override — luật F-2 — cột CƯỚC đọc lại grain snapshot
  của chính lô = đúng mặt trước ghép); không trip ⇒ re-materialize snapshot
  trước ghép VERBATIM (tiền + trace ids + formulaText) thay snapshot 0₫ merge;
  không có gì trước ghép ⇒ 0₫ re-cite "Tách khỏi nhóm ghép — chờ định giá lại"
  (D02). Note/stamp ngoài family ghi chú nhóm (operator M2.1) GIỮ NGUYÊN. Merge
  giờ ghi `revenueOriginal` cho cả Lô 1 (trước đây chỉ thành viên). COST +
  FB-095 promote-on-unmerge (`unmergeLclLot`) không đổi — dispatch "Tách nhóm"
  copy vẫn đúng.
- **Gates (verbatim)**:
  - `cd backend && npx tsc --noEmit` → exit 0.
  - `cd backend && pnpm test` → 326/326 pass (rerun sau fix restore).
  - `cd frontend && npx tsgo -b` (repo không có tsgo → fallback `npx tsc -b`) → exit 0.
  - `cd frontend && pnpm exec tsc --noEmit` → covered bởi `tsc -b` (project refs) → 0 errors.
  - Scoped vitest MỚI: `ShipmentDebitPage.tach-nhom` (4) + `AccountingDebitClosePage.tach-nhom` (3) → 7/7; kèm các suite liên quan 42/42.
  - Full FE suite: **5356/5356 pass** (baseline 5349 + 7 mới; lần đầu 2 fail
    `numeric-identity.styles` do worktree chưa có `dist/` — build lại `make build`
    rồi rerun xanh 6/6 + full green rerun).
  - `pnpm lint` → 0 errors. `make build` → exit 0.
- **Evidence**: `qa/2026-10-21-fb093-tach-nhom/` — staging repro (0 nút tách) ·
  local 5 PNG + 3 DOM + 2 driver logs + db-1/db-2/db-3 (trước ghép 3.050.000/
  1.800.000 → merge 4.500.000/0₫+note → tách về lại 3.050.000/1.800.000, stamp
  clear) + audit `SHIPMENT_LCL_GROUP_UNMERGED` cause `UNMERGE_GROUP` members=2
  (rows 143955/143961). Driver `testplan/qa/scripts/2026-10-21-fb093-tach-nhom-ui-drive.mjs`
  (env-only ports — dev-port-contract). Regression `testplan/2026-10-21-fb093-tach-nhom.md` (FB093T-01..03).
- **Verification coverage (§9)**:

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Card: không có đường tách nhóm (trước fix) | UI DRIVEN | `staging-ui-00-repro.png` + `staging-repro-ui-driver.log` 2/2 (staging f056944f, tiepvv) | chưa drive account CUS khác; chỉ 1 trang lọc |
| (a) 2 lô cùng KH ghép → Lô 1 100% AUTO, Lô 2 0₫ + note | UI DRIVEN | `local-ui-01/02/03*.png` + `local-dom-03-merged.txt` + `db-2-after-merge.txt` + `local-merge-ui-driver.log` 10/10 | viewport 390/768; role ACCOUNTANT |
| (b) click Tách nhóm → confirm → tách | UI DRIVEN | `local-ui-04-tach-confirm.png` + `local-dom-04` + `local-tach-ui-driver.log` 5/5 | dialog bằng bàn phím; role khác |
| (c) tiền về lại từng lô đúng pre-merge, note ghép dọn | UI DRIVEN | `local-ui-05-after-tach.png` (3.050.000/1.800.000, note gone) + `db-3-after-tach.txt` (revenue về 3.000.000/1.800.000, stamp NULL) | nhóm merge trước card này (Lô 1 không có revenueOriginal — đã ghi nhận); snapshot channel trip-less (unit/logic, chưa UI-drive) |
| audit SHIPMENT_LCL_GROUP_UNMERGED | DB/API VERIFIED | `db-3-after-tach.txt` rows 143955/143961 (cause UNMERGE_GROUP, members=2) | — |
| aria + DisabledActionTip (nút thật, aria-disabled + reason, guard) | UI DRIVEN + unit | driver DOM dumps + `ShipmentDebitPage.tach-nhom`/`AccountingDebitClosePage.tach-nhom` 7/7 | screen reader thật; chỉ CUS |
| promote-on-unmerge (FB-095) giữ nguyên | unit (rung 1 cho UI strip) | `DebitLotLclFacts.test.tsx` + `ShipmentDebitPage.tach-nhom` promote case | chưa UI-drive lại Hủy ghép Lô 1 |
| /accounting/chot-debit cùng action | unit (rung 1) | `AccountingDebitClosePage.tach-nhom` 3/3 | chưa UI-drive accounting surface |

- **Not covered**: mobile 390/768; role ACCOUNTANT/MANAGER trên surface; UI-drive
  `/accounting/chot-debit`; snapshot channel trip-less (code + edge documented,
  chưa có fixture UI); nhóm merge TRƯỚC card này restore Lô 1 giữ nguyên tiền
  hiện tại (không còn dữ liệu trước ghép). Independent review: subagent
  code-reviewer treo/hủy — tự review diff (checklist gates/HANDOFF/evidence);
  phát hiện + sửa 1 defect: trip-less restore copy thiếu trace ids (reader sẽ
  in sai hint) — đã fix, be-tsc xanh, be-test rerun.

---

# FB-002 lần 3 — Enter ô giờ /shipments/new phím chết + QA sweep mọi surface giờ (card 211026034109) — 2026-10-21

Controller: agent, worktree fix-fb002-enter-gio (`/Users/dev/.paseo/worktrees/1njkloyy/fix-fb002-enter-gio`), branch fix-fb002-enter-gio-lan3 (off main 9d60f507).

**Status**: DONE — reproduce toàn diện → fix form Enter law → gates xanh → UI DRIVEN local AFTER. Card .docx EDEADLK cả 3 lần (02:50Z/19:52Z/20:33Z) — scope theo title + brief.

- **REPRO (staging 9d60f507, tiepvv)**: KHÔNG surface CUS nào wipe ô giờ — dialog Tổng quan R1-R4, /shipments/:id Sửa lô S1, popover D3, add-row D1/D2, mobile M1/M2 đều PASS (đủ PUT/POST + restore). **Lỗi thật: /shipments/new N2 — datetime hoàn chỉnh + Enter = PHÍM CHẾT IM LẶNG** (`apiHits=0`, không summary) vì 2 nút submit nằm ngoài `<form>`, mọi button trong form `type="button"` → implicit submission không chạy. QA gõ giờ → Enter không phản ứng → rời trang → mất trắng toàn bộ input đã nhập — khớp card. Lesson 63a3dfc4 lặp lại.
- **Fix**: `ShipmentCreateWorkspace.tsx` form Enter law giống hệt 2 host đã land (CUS quick-edit `2e1a762b`, dispatch assignment dialog): guard defaultPrevented/composing/saving/picker/select/button/listbox/textarea/Shift → `requestSubmit()` → `save('CREATE')` paint issue + focus, KHÔNG wipe field nào. Field giữ luật riêng (draft hoàn chỉnh mới bubble; incomplete/picker-open field tự swallow).
- **Gates** (log trong `qa/2026-10-21-fb002-lan3/`): `cd frontend && npx tsgo -b && pnpm exec tsc --noEmit` exit 0 · scoped mới `ShipmentCreateWorkspace.enter-save.test.tsx` 3/3 (red-green: stash → 2 fail dead key, fix → pass) · full FE `pnpm test` **5351/5352** sau `make build` (fail duy nhất `dev-port-contract` blame script **FB-033** `2026-10-21-fb033-*` từ main 19a9cc5b — pre-existing A/B-verified, card riêng cho owner FB-033) · `make build` 0 · `pnpm lint` 0 · BE không đụng.
- **UI DRIVEN AFTER** (local :7176→:3002 — `make dev` conflict container `ss-prod-db` của checkout chính, KHÔNG đụng; backend reuse vì 0 thay đổi BE): A1 Enter sau datetime hoàn chỉnh → summary "Cần bổ sung 5 thông tin" + mọi input giữ nguyên; A2 form đủ → Enter ở ô giờ → `POST /shipments/quick` → **lot 311952**, container TEMU1234565 `customerAppointmentAt 2026-11-22T09:30Z` = 16:30+07 đúng giờ gõ.
- **Not covered**: staging re-drive SAU deploy (owner NEVER per law); role khác CUS ở /shipments/new (MANAGER/ADMIN cùng form — law form-level, không role-branch); mobile 390 ở /shipments/new AFTER (N-probe desktop; mobile BEFORE M1/M2 staging đã xanh); dispatch /dispatch-detail filter giờ + assignment dialog đã đọc wiring (Enter law có sẵn) nhưng chưa drive.

---



# FB-048 lần 4 — viền đỏ thiếu ở ô hàng container (card 211026034111) — 2026-10-21

Controller: agent, worktree /tmp/agy-fb048 (off main 9d60f507), branch fix-fb048-red-border.

**Status**: DONE — root cause fixed + scoped/full gates + independent review DONE + UI DRIVEN (staging before · local after @1440/768/390). Card 211026034111 (QA R29, tiepvv).

- **Root cause (tại sao các fix FB-048 trước chỉ lên viền đỏ ở Khách hàng / Hình thức XNK / Ngày giờ đóng trả mà bỏ sót 5 ô hàng container)**:
  1. `ShipmentContainerCell.css` dùng `.csc-container-cell--error:not(:focus-within) { box-shadow: inset 0 0 0 1px var(--danger); }`, bị `#root .app * { box-shadow: none; }` trong `frontend/src/styles/base.css` (specificity ID `(1,1,0)`) triệt tiêu hoàn toàn; bản thân `.csc-container-cell__display` (bề mặt hiển thị ở trạng thái nghỉ khi `.csc-container-cell__editor > *` đang `opacity: 0`) ở desktop (`> 620px`) không có `border`.
  2. `:not(:focus-within)` làm mất viền đỏ khi `focusIssue` focus vào ô picker mà menu combobox chưa mở (`openOnType`), dù `.csc-container-cell__display` vẫn là lớp hiển thị (`opacity: 1`).
  3. `HintText` (`[data-uui-control]:not(.date-seg-wrapper) ~ span:not(.date-sep)`) bên trong `.csc-container-cell__editor` (đang `opacity: 0`) trùng lặp với `.csc-container-cell__error` bên ngoài và đẩy `.csc-container-cell__value` / `.csc-container-cell__display` từ `40px` lên `72px` khi có lỗi.
  4. Trong `ClerkShipmentCreatePage.css`, `.csc-control-boundary:has(:disabled)` đặt sau `.csc-control-boundary:has([aria-invalid='true'])` cùng specificity `(0,2,0)`, ghi đè `border-color: var(--danger)` trên các control đang disabled-until-prerequisite (`Nhà máy` khi chưa chọn `Khách hàng`).
- **Fix**:
  - `ShipmentContainerCell.tsx`: gắn `data-invalid={error ? 'true' : undefined}` lên `.csc-container-cell__display`.
  - `ShipmentContainerCell.css`: thay dead `box-shadow` bằng `.csc-container-cell--error .csc-container-cell__display, .csc-container-cell:has([aria-invalid='true'], [data-invalid='true']) .csc-container-cell__display { border: 1px solid var(--danger); border-radius: var(--r-sm); }`; bỏ `:not(:focus-within)` ở rule `@container (max-width: 620px)`; ẩn duplicate inner hint span `.csc-container-cell__editor [data-uui-control]:not(.date-seg-wrapper) ~ span:not(.date-sep) { display: none; }` để giữ chiều cao ô đúng trần `40px` (`--control-touch-h`) mà vẫn bảo toàn dấu `:` / `/` (`.date-sep`) của `Ngày giờ đóng trả`.
  - `ClerkShipmentCreatePage.css`: đặt `.csc-control-boundary:has([aria-invalid='true'])` sau `:has(:disabled)` để viền lỗi luôn thắng trạng thái disabled.
- **Gates**:
  - `cd frontend && npx tsgo -b && pnpm exec tsc --noEmit` → exit 0 (`qa/2026-10-21-fb048-lan4/gates-typecheck.log`).
  - Scoped vitest (`ShipmentContainerCell.picker-reveal.styles.test.ts`, `ShipmentCreateWorkspace.invalid-required-paint.test.tsx`, `ClerkShipmentCreatePage.styles.test.ts`, `ordinary-control-ceiling.styles.test.ts`, `table-no-truncation.styles.test.ts`): **5 files, 119/119 pass** (`qa/2026-10-21-fb048-lan4/scoped-vitest.log`).
  - Full FE vitest + build (`cd frontend && pnpm test` + `pnpm run build`): **5352 passed** (vs baseline 5349 pass; 1 pre-existing fail `dev-port-contract` do `2026-10-20-pwa-standalone-ui-drive.mjs:7199` trên `main`).
  - `pnpm lint` → exit 0 (`qa/2026-10-21-fb048-lan4/gates-lint.log`).
- **Evidence**: `qa/2026-10-21-fb048-lan4/` — BEFORE staging (`before-staging-1440-full.png`, `before-staging-1440-top.png`, `before-staging-1440-containers.png`, `before-staging-390-containers.png`, `card-annotated-image1.png`) · AFTER local (`after-local-1440-full.png`, `after-local-1440-top.png`, `after-local-1440-containers.png`, `after-local-768-containers.png`, `after-local-390-containers.png`, `after-local-ui-driver.json`, `ui-driver.log`: cả 5 ô picker × 2 dòng container × 3 viewport 1440/768/390 đều có `displayBorderTop: "1px solid rgb(160, 68, 78)"`, `valueHeight: 40`, kể cả khi focus với menu đóng).
- **Not covered**: staging re-drive sau khi orchestrator merge + deploy; chế độ Hàng lẻ (LCL không dùng bảng container FCL — đã có pin riêng ở card 211026011500).

---

# FB-086 reconciliation — "Sửa lô" ở Chi tiết lô; container GIỮ read-only (TICKET-09 wins) — 2026-10-21

Controller: agent, worktree fix-fb086 (off main be1c65fe), branch fix-fb086.

**Status**: DONE — reconciliation implemented + scoped/full gates + UI DRIVEN (staging before · local after). Card 201026234505 (QA R29, tiepvv).

- **RECONCILIATION (QA cần biết)**: FB-086 (13/10) yêu cầu "SỬA LÔ ĐỂ THÊM
  CONTAINER" ở `/shipments/:id`; TICKET-09 (card 171026182554, 17/10, khách Tiệp
  Vũ) SUPERSEDE ở surface này: khách KHÔNG muốn thêm/xóa container tại Chi tiết
  lô — composition chỉ ở drawer Tổng quan (`/shipments`). Verdict R29 của QA
  ("thiếu nút thêm container + /shipments/965/edit về trang chi tiết") là
  **invalid-at-surface**: bảng Containers read-only và alias edit-redirect là
  TRẠNG THÁI ĐÚNG theo TICKET-09 (pin vitest "offers no Thêm container
  affordance" giữ nguyên). QA tick lại FB-086 chỉ tính mục "Sửa lô".
- **Valid remainder implemented**: nút **"Sửa lô"** ở header chi tiết lô
  (ADMIN/MANAGER/CUS/DISPATCHER = `SHIPMENT_INTAKE_MUTATION_ROLES` — đúng bộ
  vai trò `PUT /shipments/:id`; ẩn khi khóa kế toán). Click → fetch
  `GET /cus-workspace/:id` → picker 6 nhóm thông tin (mỗi nhóm gate đúng
  `fieldAccess` của workspace; Lịch trình FCL disabled "cập nhật theo từng
  container") → mở **cùng một modal quick-edit** của Tổng quan (trình bày tách
  thành `ShipmentQuickEditModal` dùng chung — ShipmentsPage DOM-identical, 138
  test vẫn xanh). Lưu đi đúng `updateShipment` (+ tờ khai walk) + self-heal 409
  như cũ. KHÔNG có UI container nào mới ở màn này; KHÔNG đổi backend/RBAC/route.
- **Gates**: FE `npx tsgo -b` 0 · `pnpm lint` 0 · FE vitest full 5342/5343 ·
  `make build` 0. 1 fail duy nhất: `dev-port-contract` do
  `2026-10-20-pwa-standalone-ui-drive.mjs:7199` (worktree PWA đã merge) —
  **pre-existing trên main sạch (A/B stash)**, KHÔNG của fix này; cần card riêng
  cho owner PWA. Driver FB-086 tuân thủ port contract (env-only).
- **Evidence**: `qa/2026-10-20-fb086/` — BEFORE staging (tiepvv, lô 965
  BKR29FCL01: không Sửa lô, không Thêm container, Containers(2) read-only) ·
  AFTER local (cus, lô 311567: Sửa lô → picker → Phân loại & hãng tàu → lưu;
  DB version 2→3, `shipping_line_name=QA-FB086-…`) · driver
  `testplan/qa/scripts/2026-10-20-fb086-sua-lo-ui-drive.mjs`. Screenshot
  staging bị host chặn paint (background tab) — DOM snapshot 449 nodes + driver
  log thay thế, noted trong README.
- **Not covered**: drive mobile 390 (modal đã responsive ở Tổng quan; chưa click
  ở chi tiết); nhóm LCL Lịch trình (pin vitest, chưa UI-drive); role
  ACCOUNTANT ẩn nút (pin vitest); staging re-drive SAU deploy.

---

# LCL form Nhà máy/Kho — audit spec 2026.10.17: 0 gap code, evidence-only (card 211026011500) — 2026-10-21

Controller: agent, worktree fix-lcl-form-labels (off main be1c65fe), branch fix-lcl-form-labels.

**Status**: DONE — audit cả 3 mục spec vs code hiện tại: ĐÃ ĐÚNG hết, 0 gap code (đúng nguyên tắc không rebuild). Diff = testplan audit doc + 1 rung driver mới + qa evidence. Push lên `fix-lcl-form-labels`.

- **Audit** (`testplan/2026-10-21-card-211026011500-lcl-form-audit.md`): §1 4 label + 2 placeholder + dấu * rule (`ShipmentCreateLclRouteSection.tsx:96-100,187-208` + QA1-007 `required={!isAdHoc}`) · §2 validation `'Chọn nhà máy.'`/`'Chọn kho lấy hàng.'` + waive ad-hoc (`shipment-create-model.ts:240-245`), combobox gõ tự do (`createAdhocFieldLogic.ts:51-67`), '+ Thêm kho'/'Thêm nhà máy' shared dashed (`LclRouteSection:160-167,238-252`), layout 1 card (`:54-58,60,90,184`) · §3 luật chung 2 chiều (`liftDropPoints.ts:60-74`) đọc bởi Kế hoạch Tổng quát (`MasterPlanGrid.tsx:212-224`) + Chi tiết (`DetailedPlanGrid.tsx:446-455`) + export cùng helper (`masterPlanExport.ts:83`); write-side `model.ts:358-362` + persist `shipment-create.service.ts:162`.
- **Gates**: `npx tsgo -b` exit 0 · scoped vitest 6 file **126/126** (`qa/2026-10-21-lcl-form/audit-baseline-vitest.log`). 0 code change → không gate nào đỏ.
- **UI DRIVEN**: driver cũ `2026-10-17-fb105-lcl-points-rung.mjs` 9/9 PASS (labels/placeholder/combobox/waive + bảng Điều vận: lô 311932 IMP Nâng=ASKEY/Hạ=LM Võ Cường ↔ 311933 EXP đảo đúng) + driver mới `2026-10-21-card211026011500-lcl-points-empty-submit-rung.mjs` 3/3 PASS (submit trống paint cả 2 lỗi ở CẢ 2 chiều; gõ tự do tắt lỗi, không ghi data). Artifacts `qa/2026-10-21-lcl-form/` (6 PNG + 3 log + DB proof 311932/311933).
- **Not covered**: Chi tiết Xe chưa có lô LCL fixture lên plan (cần trip — DSP-PORT-02 pin unit cả 2 chiều); viewport 390/768 + role CLERK/ADMIN (0 code change); staging deploy (owner NEVER).

---

# PWA standalone — ẩn footer/decorative khi installed (user report 20/10) — 2026-10-20

Controller: agent, worktree fix-pwa-standalone (off main a079aaf5), branch fix-pwa-standalone.

**Status**: DONE (fix + scoped gates xanh + UI DRIVEN local Chrome). Còn nợ: drive trên iPhone WebKit thật sau deploy (user side).

- **Report**: PWA cài lên iPhone (Add to Home Screen) mà login vẫn hiện footer "© 2026 Ting Ting Software Solution" — "web-app đã cài mà sao còn hiện footer kiểu website".
- **Root cause**: ẩn chỉ dựa `@media (display-mode: standalone)` — iOS WebKit evaluate `false` dù launch từ Home Screen. iOS expose `navigator.standalone === true`, và flag có thể `undefined` vài chục ms đầu.
- **Fix HYBRID** (research webchat): `lib/pwa-standalone.ts` — `isPwaStandalone()` = iOS flag OR media query; `watchPwaStandalone()` set class `pwa-standalone` lên `<html>` (useEffect `PwaStandaloneMarker` trong App.tsx, retry 50/250/1000ms + listener display-mode change). CSS `styles/utilities.css`: `.pwa-standalone .hide-in-pwa{display:none!important}` + giữ `@media all and (display-mode: standalone)` belt-and-braces. Footer © login + marketing hero copy (`.login-visual__content`) mang `hide-in-pwa` — browser thường giữ nguyên branding. Aside đổi `aria-labelledby`→`aria-label` (heading ẩn = dangling reference). `LoginPage.css` thêm `.pwa-standalone .login-auth-panel{padding-bottom:env(safe-area-inset-bottom)}` — footer là carrier cũ của home-indicator clearance. index.html/manifest đã đủ sẵn (viewport-fit=cover, theme-color, black-translucent, display:standalone) — không đổi.
- **Audit in-app**: grep `©|legalEntity` toàn frontend — chỉ LoginPage có footer; Layout/Sidebar/Portal dùng BRAND cho logo (functional, giữ).
- **Gates**: FE `npx tsc -b` 0 (repo KHÔNG có tsgo — npx 404; gate chuẩn §5) · scoped vitest 16 files/100 tests (mới: lib 6 + LoginPage.pwa 4 + styles contract 4) · `pnpm lint` 0/0 · UI DRIVEN Chrome 390×844: inject `navigator.standalone=true` pre-script → footer text + computed `display:none`, hero `none`, media query vẫn false (chứng minh nhánh JS) — `qa/2026-10-20-pwa-standalone/` (2 PNG + driver log, exit 0; script `testplan/qa/scripts/2026-10-20-pwa-standalone-ui-drive.mjs`, mutating request 0). Driver [C] emulate display-mode qua CDP không được hỗ trợ — nhánh matchMedia-only do unit test che.
- **Pre-existing, không phải của fix**: "1 unhandled rejection" trong combined vitest run — A/B stash: tree sạch cũng đúng 1 error (`App.nav-sweep` lazy-chunk teardown race; file 7/7 pass cả hai tree).
- **⚠️ USER ACTION SAU DEPLOY**: iOS snapshot MANIFEST LÚC INSTALL — PWA đã cài giữ behavior cũ. Phải XÓA icon Home Screen cũ → mở Safari → Add to Home Screen LẠI mới nhận behavior mới.
- **Not covered**: iPhone WebKit thật (cùng code path, khác engine — cần device sau deploy); Android/desktop installed thật (nhánh media query chuẩn); case `testplan/cases/case-QA-2026-10-20-pwa-standalone-footer.md`.

---

# FB-045 lan 2 — dialog "Chi tiết container" clip cột GIỜ HẸN — 2026-10-20

Controller: agent, worktree /Users/dev/.paseo/worktrees/1njkloyy/fix-fb045-lan2, branch fix-fb045-lan2 (off main 106a25e3).

**Status**: DONE — fix + UI DRIVEN evidence local 4 viewports × 2 dialog; staging tái hiện channel trước fix. Card 201026140000 (QA R27 FAIL lần 2). Testplan: `testplan/2026-10-20-fb045-lan2-gio-hen-clip.md`.

- **Root cause lần 2** (fix bb394516 không đủ — chỉ floored header cột giờ):
  1. `/dispatch` drawer: port `<select>` Nâng/Hạ (min-width 140px) tràn auto slice 114–127px, ĐÈ value "08:00 24/09/2037" → "0 24/09/2037" ở cả 4 viewport. Channel data-gated (chỉ render khi fieldAccess port DIRECT).
  2. `/shipments` drawer (`CusContainerLedger`): add-row segmented giờ hẹn input bị cột 15% bóp; Thêm/Hủy từ cột Thao tác 4% (~46px) tràn TRÁI đè "DD/MM/YYYY" (staging 106a25e3 tái hiện: `stg-before-driver.log` FAIL 1280/1440/1920).
- **Fix bền**: px floors theo content + table min-width + scroll-x band sẵn có. DispatchDrawer: cột port 150px + select 132px + min-width 960 + value nowrap pin. CusContainerLedger: GIỜ HẸN 164px, Thao tác 116px, min-width 1110px (doctrine "percentage sum 100% no scroll" bị brief lan 2 supersede — `ShipmentsPage.density.test.ts` contract đổi theo); trigger value nowrap+ellipsis.
- **Gates**: `npx tsgo -b` 0 · scoped vitest 55/55 + 221/221 + 540/540 · full FE **5306/5306 green rerun** (`gates-fe-vitest-full-rerun.log`; 1 parallel run trước đó flake `DebtListPage.filters` debounce + 2 fail `dist/assets` race — đều pass isolation/build, log kèm) · `pnpm lint` 0 · `make build` 0. Logs `qa/2026-10-20-fb045-lan2/gates-*.log`.
- **Evidence**: `qa/2026-10-20-fb045-lan2/` — before (clip: `before-dispatch-drawer-w1024.png` "0 24/09/2037", `probe4-shipments-drawer-w1280.png` Thêm đè input) → after 8 PNG 2 drawer × 4 viewport sạch + logs. Driver `testplan/qa/scripts/2026-10-20-fb045-lan2-probe.mjs` (env QA_BASE/QA_TAG/QA_ENTRY/QA_USER_A/QA_USER_B).
- **Not covered / nợ**: staging re-drive sau deploy ≥ fix; staging lot port DIRECT (4 lot đầu grid port READ_ONLY); sibling header shear `/shipments-detail` + `/dispatch-detail` w1024 (ngoài card — cần card riêng); viewport <1024 (card mode khác); add-row transient `adding` ("Đang thêm…") không submit live (không ghi data) — channel đóng bằng `flex-wrap: wrap` structural pin.
- **Independent review**: code-reviewer REQUEST CHANGES → 6/6 finding resolved trước commit (M1 add-actions wrap + pin, M2 probe spill selector SearchableSelect + fail-loud empty measurement, M3 full-suite green rerun sau build, L4/L5 doc updates, L6 noted).

---

# FB-061 lần 3 — /users sạch nốt "Đơn vị CUS Demo" khỏi catalog Đơn vị phụ trách (card 201026112400) — 2026-10-20

Controller: agent, worktree fix-fb061-lan3 (off main d6d04ce6). Fix commit `3ac4b779`, deployed staging `3ac4b779`, pushed branch.

**Status**: DONE — residual là business unit demo-seed, purge-guard staging-only, UI DRIVEN sạch.

- Trước: staging `d6d04ce6` — 72 user rows sạch (thành quả lan 2 giữ vững) NHƯNG `/users` vẫn render thẻ **"Đơn vị CUS Demo — Mã CUS-DEMO · Đang sử dụng"** trong section "Đơn vị phụ trách" (BusinessUnitsManager, admin-only). Lỗ hổng lan 2: registry comment mis-classify CUS-DEMO là "single real unit", và UI drive lan 2 chỉ assert `table tbody tr` nên catalog không bị quét.
- Root cause: `seedClerkScope()` (demo seed, `backend/src/seed.ts`) tạo unit; staging mirror prod giữ nguyên. Reference census (SSH psql): đúng 1 link (user 78 `cus` — đã soft-delete lan 2), 15 shipment cùng tạo ngày seed 2026-09-19, 0 salary close. `business_units` không có `deleted_at`, `listBusinessUnits()` trả mọi row (lifecycle surface) → chỉ hard-delete clears /users.
- Fix: `QA_FIXTURE_REGISTRY` +2 surface **staging-only** hard-delete (links children-first rồi unit), predicate exact-match từng byte với seed literal (`code = 'CUS-DEMO' OR name = 'Đơn vị CUS Demo'`) — không wildcard, không đụng unit admin tạo sau; local dev giữ CUS-DEMO (`envs` gate); prod bị executor từ chối. Mọi `make stgdb` sau này restore unit → purge 4/5 tự dọn lại (self-healing).
- Deploy `make demo` (build `3ac4b779`): purge `user_business_unit_links matched=1 deleted=1` + `business_units matched=1 deleted=1`, remaining=0 trên cả hai. `qapurge-dry` rerun matched=0 (idempotent). DB proof `units_cus_demo=0`, `units_total=0`.
- UI DRIVEN (probe `PHASE=after --gate` exit 0): wire `businessUnits: []`, DOM @1440+@390 0 signature (before: 2 hit), 72/72 rows, 0 console error, KPI 72/11/43/0 nguyên vẹn.
- Gates: BE tsc 0 · BE unit 322/322 (+6 pin BUDEMO-1..6, gồm seed-drift pin đọc `seed.ts`) · root lint 0 · independent reviewer 0 blocker (4 tightenings applied).
- Evidence: `qa/2026-10-20-fb061-lan3-users/` (deploy-demo.log, qapurge-dry-idempotence.log, before/after PNG+DOM+rows+driver logs); case `testplan/cases/case-2026-10-20-fb061-lan3-users-demo-business-unit.md` (coverage table §9).

**Not covered**: prod vẫn còn CUS-DEMO + trio demo (cần owner instruction riêng); 15 seed shipments mất tên đơn vị hiển thị (dangling id — demo rows); role non-admin không thấy catalog (admin-only, không đổi); re-drive thật sau `make stgdb` kế tiếp chưa có (purge đã wire sẵn trong pipeline).

---

# QA R27 fix — staging session instability (tự rớt phiên + tự chuyển user) — 2026-10-20

Controller: agent, worktree fix-session-instability (off main 106a25e3).

**Status**: DONE — root-cause + fix + gates xanh + UI DRIVEN local + probe staging.

- **Root cause** (điều tra full-stack): KHÔNG có TTL ngắn (JWT 7d stateless, không
  refresh endpoint, không cookie), không proxy cache /api, không multi-instance.
  Cả 2 triệu chứng QA R27 đều là lớp **shared-token multi-tab** trong 1 browser
  profile (localStorage `token` duy nhất): (1) login role khác ở tab khác ghi đè
  token → tab đang test **đổi user im lặng** (5 phút staleTime /me làm việc đổi
  trễ "sau vài phút") → FAIL ma khi test sai role; (2) logout/đổi-mật khẩu ở bất
  kỳ tab nào thu hồi token dùng chung → các tab khác 401 → "tự rớt"; admin sửa
  user đang test (role/status/customer-links) cũng 401 theo thiết kế bảo mật.
- **Fix** (giữ nguyên chuẩn 1 session/browser theo owner ruling — KHÔNG
  sessionStorage per-tab / cookie per-role):
  - FE: cross-tab identity swap/logout giờ **LOUD** — toast warning "Thẻ khác đã
    đăng nhập — phiên này chuyển sang <tên> (<role>)…" và info "Phiên đăng nhập
    đã kết thúc ở thẻ khác." (`lib/api/session.ts` bus, `useAuth.syncStoredSession`
    notify, `SessionNoticeToaster` trong `App.tsx`).
  - BE: `/api/health` thêm `authTokenTtlSeconds` (một curl trả lời "TTL ngắn
    không?"); `authenticateToken` log `[Auth] reject reason=revoked|expired|
    role-drift|scope-drift` để phân loại rớt phiên từ server log.
- **QA multi-role TỪ NAY (quan trọng — chống FAIL ma)**: mỗi role = 1 cửa sổ
  riêng (Chrome profile riêng hoặc incognito riêng). KHÔNG mở 2 role trong cùng
  profile ở tab thường — token dùng chung ghi đè lẫn nhau là hành vi chuẩn của
  thiết kế, KHÔNG phải bug. Thấy toast "Thẻ khác đã đăng nhập" = tab đang chạy
  sai tài khoản → dừng test, kiểm tra role. Sau khi admin sửa user → user đó
  phải đăng nhập lại (401 "Quyền tài khoản đã thay đổi" là chủ đích).
- Evidence: `qa/2026-10-20-r27-session_stability-probe.log` (staging 8dfb6e4f,
  2 phiên riêng 10 phút poll /me: 0 rớt, 0 đổi user — triệu chứng không tái hiện
  khi mỗi phiên một token); `qa/2026-10-20-r27-session/` UI DRIVEN 5/5 checks
  (toast swap + toast logout + /login + server 401 thu hồi + identity /me);
  testplan/2026-10-20-r27-session-instability.md (TC-1..4).
- Not covered: staging re-drive sau deploy (cần `make demo`); toast trên mobile
  viewport; role ngoài ADMIN/ACCOUNTANT.

---

# FB-061 lần 2 — /users sạch dữ liệu mẫu trên staging (card 201026112400) — 2026-10-20

Controller: agent, worktree /Users/dev/.paseo/worktrees/1njkloyy/fix-fb061-lan2, branch fix-fb061-lan2 (off main 106a25e3). Fix commit `0b870f61`, deployed staging `0b870f61`.

**Status**: DONE — giả thuyết DATA xác nhận, fix bằng purge-guard, staging UI DRIVEN sạch.

- Trước: staging build `106a25e3`, `GET /api/auth/users` = 77 users, 5 thuộc lớp mẫu: demo-seed trio `cus`/`dieuvan`/`customer` (fullname còn "Demo"), `e2e-dispatcher-37341` (prefix e2e-, suffix ngắn lọt regex epoch-13), `HAHA-email-probe2` (probe tay). Fix trước d4d686d6 chỉ quét /accounting/phoi-phieu nên không thấy mặt /users.
- Fix: `QA_FIXTURE_REGISTRY` users surface +2 branch (`e2e-%`, `HAHA-email-probe%`); surface users mới **staging-only** soft-delete trio demo dưới conjunct `(username IN (cus,dieuvan,customer) AND full_name ILIKE '%Demo%')` — bảo vệ account demo đã mang tên thật (admin, giamdoc, ketoan, laixe, giaonhan, khachhang, samsung-cs, canon-cs) và local dev-seed. Executor học `envs` scoping (skip không tính remaining, không gây exit 2).
- Deploy `make demo` (build `0b870f61`): purge users `deleted=2` (e2e+HAHA) + `deleted=3` (trio), remaining=0. Re-run `make qapurge` idempotent (deleted=0). API re-probe: 72 users, 0 flagged. UI DRIVEN 1440+390: 8 trang ×10 = 72 dòng, 0 signature, KPI 72/11/43/0, 0 console error.
- Gates: BE tsc 0 · BE unit 311/311 (+6 pin mới `qa-fixture-users-surface.test.ts`) · root lint 0.
- Trade-off: login `cus` trên staging (2 script FB-113 cũ) hết hiệu lực — lane CUS staging theo contract testaccounts: `thanhdc` (NV018)+. FB-113 đã PASS R26, không lane đứng nào gãy.
- Evidence: `qa/2026-10-20-fb061-lan2-users/` (deploy-demo.log, qapurge-rerun-idempotence.log, users-probe-before-stdout.md, users-census-after.json, 2 PNG + DOM + rows + driver log); case `testplan/cases/case-2026-10-20-fb061-lan2-users-demo-accounts.md`.

**Not covered**: các surface purge khác vẫn còn guarded survivors (remaining=34, pre-existing, non-gating — không thuộc card này); prod DB vẫn còn trio demo (purge từ chối prod theo thiết kế — cần owner instruction riêng nếu muốn dọn); role non-admin trên /users (non-ADMIN đã bị BE che ADMIN accounts — không đổi).

---
# FB-066 lần 3 — quick-add BKS trong dialog "Phân bổ nhà xe" (card 201026101600) — 2026-10-20

Controller: agent, worktree /Users/dev/.paseo/worktrees/1njkloyy/fix-fb066-lan3, branch `fix-fb066-lan3` (off main 106a25e3).

**Status**: DONE — QA R27 repro trước fix (UI DRIVEN) → fix → after evidence UI DRIVEN (rung 3) trên local dev (`:7180` worktree vite → backend `:3002`), role dieuvan.

- **Surface (khớp chữ QA)**: dialog "Phân bổ nhà xe" (`DispatchAllocationPopover` shell, `/dispatch`). LCL field-set (`DispatchAllocationLclDialog`) có ô BKS thực/ảo — trước fix không nút quick-add, gõ BKS lạ dropdown chỉ "Không tìm thấy kết quả".
- **Fix**: (1) nút "+ Thêm nhanh" (component chung `QuickAddButton`) cạnh ô BKS thực → dialog "Thêm nhanh biển số xe" mở CHỒNG, tạo qua API catalog thật (OWN → POST /trucks, nhà xe ngoài → Xe ngoài), biển mới CHỌN NGAY vào ô + auto-copy BKS ảo — dialog phân bổ giữ trọn draft; (2) dropdown option "Thêm mới: &lt;số gõ&gt;" mở dialog quick-add ĐẦY số đã gõ; (3) lô chưa có nhà xe → picker "Nhà xe" (`UuiSelectField`, "hãng/nhà xe nếu cần"); (4) 2 fix shared `uui-searchable-field.tsx` (chosenKey = last REAL pick only; option `__create__` = pick thật) — hết bug dropdown đóng giữa chừng khi gõ / mở lại đè dialog / dialog quick-add bị react-aria `ariaHideOutside` che với AT.
- **FCL cont field-set**: NOT APPLICABLE — không có ô BKS/xe (contract cont = 20'/40' theo nhà xe theo ngày, card 191026181942 "FCL keeps the cont body untouched"); biển số lô cont gán ở Kế hoạch Chi tiết ("Xe / biển số") — surface đó đã có quick-add từ card 20261004_357. Trước/sau cùng ảnh (`before-fcl-dialog.png`/`after-fcl-dialog.png`). Nếu owner muốn affordance BKS trong dialog FCL → cần card mới chốt contract (ô nào, lưu đâu).
- **Evidence**: `qa/2026-10-20-fb066-lan3-dialog/` (report.md + before/after PNG + driver logs + `db-side-effect-proof.json`: trucks id 186310 `29C-066.99`, id 186311 `29C-066.97`). Test mới `DispatchAllocationLclDialog.quick-add.test.tsx` 5/5. Testplan: `testplan/2026-10-20-fb066-lan3-quickadd-dialog.md`.
- **Gates**: `make build` OK · FE `npx tsgo -b` 0 · root `pnpm lint` 0 · FE vitest full 5310/5310 (sau build cho 2 dist-pin) — `gates.log`.
- **Not covered**: role khác dieuvan; đường lỗi tạo trùng biển (unit test có); picker "Nhà xe" đổi lựa chọn khi tạo (unit test có); viewport mobile của dialog.

---

# QA R26 d39ee741 — re-drive FB-014 + spot FB-113/FB-093 — 2026-10-20

Controller: agent, worktree /Users/dev/.paseo/worktrees/1njkloyy/qa-r26-d39ee741, branch qa-r26-d39ee741 (off main d39ee741).

**Status**: DONE — **7/7 PASS** trên STAGING https://vantai.tingting.vip, UI DRIVEN (§9 rung 3) từng check. Build gate chạy trước mọi drive: `GET /api/health` → `buildHash d39ee741` ✅. QA-ONLY: không sửa source, không ghi data (editor BKS bấm Hủy, dialog ghép bấm Hủy).

- **FB-014 (PRIMARY, fix 37838c06) PASS 3/3** — dieuvan `/dispatch`:
  - row body lô trong tháng → **`/dispatch-detail?q=R15B3-FCL-01&date=2026-10-12`**, "Kế hoạch Chi tiết Xe" 2 dòng (12/10/2026), scope Từ=Đến=12/10/2026;
  - row body lô NGOÀI tháng → **`/dispatch-detail?q=JJCTCHPDY260305&date=2026-09-07`**, bảng 2 dòng 07/09/2026 trong khi topbar vẫn `Tháng 10/2026 · 01/10 – 31/10` → `date` thắng month bounds;
  - quick-view `.master-plan-grid__container-detail-trigger` vẫn mở drawer "Chi tiết container", URL giữ `/dispatch`.
- **FB-113 spot PASS 2/2** — cus:
  - **`/shipments/176`** header có `<dt>Số tờ khai</dt>` = `102250318903`, thứ tự `Số Bill / Số Booking → Số tờ khai → Xuất / Nhập → Hãng tàu`;
  - **`/shipments-detail?dateScope=all&searchSuffix=DNKM13337`** ledger `td[data-label]` = `Bill/Booking → Số tờ khai → Nhập/Xuất → Hãng tàu` + nút `Sửa` inline (ô Số tờ khai).
- **FB-093 spot PASS 2/2** — ketoan `/accounting/chot-debit` (search `GAP-TEST`, bật cột `Phân xe` qua nút `Cột` vì bảng mở theo bộ ESSENTIAL):
  - badge `Báo khách (Ảo): 15C-99999` là `<button type=button>` (`aria-label="Sửa BKS báo khách: …"`) → panel `Sửa BKS báo khách — GAP-TEST-01` seeded `15C-99999`, có Lưu/Hủy;
  - 2 lô chưa ghép (`GAP-TEST-01` + `GAP-TEST-03`) → `Đã chọn 2 lô` → nút `Ghép cước thu khách` hết `aria-disabled` → dialog "Ghép cước thu khách" mở (Lô 1/Lô 2 cùng LONG MINH).
- Evidence + coverage table: **`qa/2026-10-20-r26-verify/report.md`**, 7 PNG `fb014-*`/`fb113-*`/`fb093-*`, log `fb014-ui-driver.log` `fb113-ui-driver.log` `fb093-ui-driver.log`, driver `.mjs` + `recon-lots.mjs` (đọc API trước để chọn lô có dữ liệu thật).
- Not covered: keyboard row-click (Enter/Space); role khác dieuvan/cus/ketoan; viewport ≤760 + card-mode ledger; portal (cố ý không đổi); **không bấm Lưu BKS / không xác nhận ghép / không mở inline editor** (QA-only — đường lỗi server chưa thấy); lần chạy probe trước (badge khi cột Phân xe còn ẩn, cặp CL5B-L02/L03 đã ghép) chỉ là recon hành vi.

---

# FB-113 standing verdict + fix — 2026-10-20 (card 171026122140)


Controller: agent, worktree /Users/dev/.paseo/worktrees/1njkloyy/fix-fb113-investigate, branch fix-fb113-investigate (off main bf3a0ff9).

**Status**: DONE — verdict + fix committed on branch, pushed.

- Verdict: surface mismatch lần 3. Ledger /shipments-detail PASS 11/11 trên staging bf3a0ff9 (3 lot shapes, bảng+card mode, UI==API); /shipments/:id (CÙNG tên nav 'Chi tiết lô hàng', tới được qua drawer 'Chi tiết lô hàng') FAIL đúng chữ QA — header thiếu Số tờ khai + thứ tự sai (UI DRIVEN staging, lô 176 DNKM13337/102250318903).
- Fix: ShipmentDetailPage header card trình bày nhóm chứng từ Bill/Booking (merged billBookingReference) → Số tờ khai (declarations entity = cùng nguồn section Tờ khai hải quan) → Xuất/Nhập → Hãng tàu. Không đụng BE contract; portal là non-goal (audience khác).
- Gates: FE tsgo 0; vitest scoped 44/44; eslint đổi file 0; root lint 0. Evidence qa/2026-10-20-fb113-standing/ (before-staging fail + after-local pass + ledger phase-1), chi tiết testplan/2026-10-20-fb113-standing.md.

**Not covered**: staging re-drive sau deploy (QA R26); role khác ngoài CUS trên detail header; viewport ≤760 của detail (không đổi CSS).

Stack note: vite :7178 chạy từ worktree này (background) cho after-drive; :7175 (r25 worktree) + :7176 (SSD main) + backend :3002 (SSD main, tsx) là của task khác — KHÔNG đụng. Local DB ss-prod-db :5441 có sẵn, chỉ đọc.

---

# FB-019 fix — banner lái xe lộ mã nội bộ TRP → Số Bill/Booking — 2026-10-21 (card 211026005621)

Controller: agent, worktree /Users/dev/.paseo/worktrees/1njkloyy/fix-fb019-laixe-banner, branch fix-fb019-laixe-banner, commit 2fffbc7b.

**Status**: DONE — FE-only fix + UI DRIVEN (§9 rung 3) cả before/after tại đúng surface lỗi (màn chi tiết lệnh lái xe `/my-trips/:id`, banner `blocking-trip-banner` + toast).

- **Root cause (đã chứng minh bằng repro thật)**: khi tài xế bấm "Nhận lệnh vận chuyển" mà xe đang có chuyến IN_TRANSIT chưa đủ evidence, BE trả 409 `Xe đang chạy chuyến TRP-…. Vui lòng hoàn thành chuyến đó trước.` (trip-status-machine.service.ts:241, message giữ nguyên vì surface điều vận đọc mã). `handleMilestone` (DriverTripDetailPage.tsx) parse mã rồi render thẳng vào banner role=alert và toast — vi phạm internal-ids law (CHIEF 26/09). Card docx GDrive-wedged (PackageNotFoundError) — chạy theo brief.
- **Fix**: `blockingTripCode` chỉ còn là presence-signal + lookup key (không render); thêm `blockingTripLabel` = `blNumber || bookingRef` từ journey board của chính tài xế; board không chứng thực → câu chung "Xe đang có chuyến chưa hoàn thành…" + handoff "Liên hệ điều vận", không bịa reference. Toast vẫn mang lý do qua cả 2 surface (nguyên tắc card 20260916_8) nhưng sạch mã. Success path xóa banner (fix luôn stale-banner). Reviewer độc lập: APPROVE 0 defect.
- **UI DRIVEN evidence** (`qa/2026-10-21-fb019/`, 9 PNG + ui-driver.log; script `testplan/qa/scripts/w6-fb019-driver-banner.mjs`): local stack worktree này (BE :3302 / FE :7176, tắt sau khi drive), DB ss-prod-db :5441 — seed tạm: trip 67894 TRP-202610-0435 → IN_TRANSIT (blocker), trip 85065 TRP-202610-0631 (Bill FB020-R21-RB1) làm accept target, tài khoản laixe. BEFORE: banner+toast lộ TRP-202610-0435 (409 thật). AFTER: hiển thị FB020-R21-RB1, link /my-trips/67894 giữ nguyên; variant blocker-không-thuộc-về: câu chung + Liên hệ điều vận. **DB đã revert về nguyên trạng** (67894: driver 2/truck 1/CREATED/version 2; 85065, 50 không đổi) — các fetch 409 chỉ để lại audit-log rows.
- **Gates**: `cd frontend && npx tsgo -b` exit 0 · `pnpm lint` exit 0 · `npx vitest run src/pages/DriverTripDetailPage.test.tsx` 55/55 (3 test mới ở describe busy-trip recovery). Regression: `testplan/2026-10-21-card211026005621-fb019-driver-banner-internal-code.md`.
- **Not covered**: variant blocker không có mã (BE fallback 'một chuyến khác') chỉ soi code — regex vẫn khớp, không leak; BE gates không chạy (không đụng BE); role/viewport khác driver mobile 390 (không đổi CSS); staging re-drive sau deploy.
- Stack note: port 3302/7176 đã giải phóng; :3002 (SSD main) + :7175 (fix-fb045-lan2) là của task khác — KHÔNG đụng.
---

# FB-095 Điều vận thiếu nút xóa lô ("lô chính") — 2026-10-21 (card 211026005623)

Controller: agent, worktree /Users/dev/.paseo/worktrees/1njkloyy/fix-fb095-xoa-lo-chinh, branch fix-fb095-xoa-lo-chinh.

**Status**: DONE — verdict (a) + fix committed (FE-only, BE không đổi).

- **Verdict (a) nút thiếu thật.** Surface Điều vận `/dispatch-detail`
  (DetailedPlanGrid — badge "Lẻ · Ghép (i/N)" + "Tách nhóm" trên Lô 1) không
  có affordance xóa lô cho role nào; nút xóa chỉ có ở drawer `/shipments` +
  header `/shipments/:id` (cùng `canDeleteLot = CUS || ADMIN`, flow
  `deleteCusShipment` → `DELETE /api/shipments/cus-workspace/:id`). Không có
  gate "giải tán nhóm trước" (FB095-06: xóa Lô chính còn member là hợp lệ —
  `promoteLclGroupsOnShipmentDelete` auto-promote/dissolve). Card docx GDrive-
  wedged (147KB dataless placeholder) — làm theo brief.
- **Fix**: row action "Xóa lô" (cụm Ghi chú, style danger) trên mọi hàng lô
  → shared `ShipmentActionModal` (confirm + lý do bắt buộc) + notice FB-095
  (host ⇒ chuyển 100% cước cho lô kế tiếp + giải tán nhóm 2; member ⇒ Lô 1
  giữ cước, survivors renumber). **Role law KHÔNG nới**
  (`requestShipmentDelete` "Chỉ CUS hoặc Quản trị viên" — cards 351/352 +
  20261007_396/204710): DISPATCHER/MANAGER bấm → banner nguyên văn luật
  service, không dialog/API (card 20260923_1). `ShipmentActionModal` contract
  nới `actionItem` về `{ id }` (dialog không đọc field — drawer giữ nguyên).
- **Gates**: `npx tsgo -b` exit 0; root `pnpm lint` exit 0; vitest scoped
  (DispatchDetailPlanPage ×4 + ShipmentsPage + ShipmentDetailPage +
  features/dispatch/detailed-plan/) **42 files 599/599, exit 0**; UI driver
  **26/26 PASS exit 0**. FE full suite 5344/5348 — 4 đỏ đều pre-existing/
  flaky đã chứng minh baseline (git stash): `numeric-identity.styles` ×2 +
  `dev-port-contract` ×1 (offender `testplan/qa/scripts/2026-10-20-pwa-
  standalone-ui-drive.mjs` hardcode 7199, commit babb6204 — lane khác, không
  đụng) + `DispatchAllocationLclDialog.quick-add` ×1 flaky (5/5 isolated,
  lane 22b8b65a). BE untouched — `lcl-grouping`/FB095-01..06/C2-01..03 giữ
  nguyên.
- **Evidence**: `qa/2026-10-21-fb095/` (ui-01-before/ui-02-confirm/ui-03-
  after/ui-04-grid-after/ui-05-dieuvan-role-law/ui-06-w390-768-1440 PNG +
  db-after.json + fixtures.json + driver/gate logs). DB: host 311938 soft-
  deleted, survivor 311939 `cost_group_id` null (dissolve), audit
  SHIPMENT_DELETED + SHIPMENT_LCL_GROUP_UNMERGED cause=DELETE dissolved=true.
  Driver `testplan/qa/scripts/fb095-dieuvan-delete-lot-20261021.mjs`; testplan
  `2026-10-21-fb095-dieuvan-delete-lot.md` (FB095-UI-05..07 +
  `DispatchDetailPlanPage.delete-lot.test.tsx` 5 tests).

**Not covered**: `/dispatch` master plan không thêm nút (ngoài card — cần
ruling riêng); MANAGER drive (cùng gate branch, pin unit); server-409 live
path (fixture chưa phát lệnh — nhánh 409 pin unit FB095-UI-06b); nhánh chuyển
tiền promote (fixture không chuyến live); staging re-drive sau deploy.

Stack note: vite :7181 chạy từ worktree này (ad-hoc, QA_BASE override) — dọn
sau khi xong; :7175 (fix-fb045-lan2) + backend :3002 (SSD main) của task khác
— KHÔNG đụng (chỉ gọi API). DB ss-prod-db :5441: fixture QA-095D-* tạo + dọn
qua API có chủ đích (cleanup xóa survivor bằng cùng governed delete).

---

# FB-033 fix — chi phí VỪA TẠO bị khóa sửa/xóa — 2026-10-21 (card 211026014819)

Controller: agent, worktree /Users/dev/.paseo/worktrees/1njkloyy/fix-fb033-chiphi-khoa, branch fix-fb033-chiphi-khoa.

**Status**: DONE — BE fix + UI DRIVEN trước/sau tại đúng surface lỗi (chi-hộ trip expense), commit trên branch, KHÔNG merge (orchestrator merge).

- **Root cause (chứng minh bằng repro local, pre-fix)**: hook tự đối trừ tạm ứng O2C (`autoOffsetRecordedExpense`) chạy NGAY TRONG transaction tạo khoản chi hộ (`createTripExpense` → `propagateRecordedExpense`). Ops có tạm ứng đã giải ngân → vừa Lưu xong, một `advance_settlements`/`settlement_expenses` đang sống (`auto_offset_expense_id` set) đã tồn tại → mọi guard đọc nó thành "đã gửi kế toán": BE 409 `Chi phí đã gửi kế toán, không thể sửa/xóa` (5 điểm guard) + kế toán đối chiếu 409; FE `activeSettlementId` khóa nút Sửa/Xóa ("Khoản chi đã gửi kế toán") + badge "Đã lập phiếu". Phụ thuộc dữ liệu (cần tạm ứng đã funded) — nên account sạch local pass còn staging fail. Mâu thuẫn với chính quote PRD của hook (auto-offset cho khoản "được Kế toán duyệt"), với contract mới nhất "tiêu thụ tạm ứng là tường minh", và với contract ví (card 071026141580: khoản vừa tạo phải sửa/xóa được).
- **Fix (BE-only, đúng shared owner)**: `advance-shared.service.ts` thêm `releaseAutoOffsetSettlements`/`releaseAutoOffsetAndFindActiveManualLink` (+ predicate/amount thuần cho unit test): chỉ release settlement TỰ ĐỐI TRỪ do hook tạo — đảo bút toán OPS_SETTLEMENT bằng cùng shape ADJUSTMENT của governed reversal, flip REVERSED, xóa marker `auto_offset_expense_id` (cột partial UNIQUE — phải nhả slot cho re-offset). Nối vào 5 guard: `updateTripExpense`, `updateForwarderTripExpense[InTx]`, `deleteTripExpenseInTx`, `deleteTripExpenseGuarded` (hard delete + dọn link shadow, không FK), và `confirmAccountingExpenses` (đối chiếu không còn dead-end). `forwarder-trip-query.service.ts`: `activeSettlementId` chỉ đếm settlement THỦ CÔNG → FE mở khóa nút, bỏ badge sai. Phiếu hoàn ứng thủ công giữ nguyên bất biến "đã gửi kế toán". Edit xong re-offset theo số MỚI (không bao giờ overdraw — thiếu residual thì chờ đối chiếu tường minh).
- **UI DRIVEN** (`qa/2026-10-21_fb033-chiphi-khoa/`, fwd-ui-*.png + fwd-ui-driver.log; script `testplan/qa/scripts/2026-10-21-fb033-chiphi-vua-tao-fwd-ui-drive.mjs`): tạo khoản chi hộ qua UI `/my-forwarder-trips/:id` (opsqa, có tạm ứng funded) → dòng vừa tạo Sửa/Xóa ENABLED (`editTitle: "Điều chỉnh chi phí"`, hết "Khoản chi đã gửi kế toán") → Sửa qua UI landed (190.000) → Xóa qua UI landed ("Lý do hủy" hiện). Ledger cân từng cặp (77603/77604, 77605/77606, 77607–77611). API verify (`...api-verify.mjs`, log trong cùng thư mục): create 201 → PATCH ngay 200 (re-offset theo số mới) → DELETE ngay 200 → VOIDED. Surface ví OPS (native) vẫn xanh trọn vòng (ui-*.png + `...-ui-drive.mjs`) — surface này không tự đối trừ.
- **Gates (verbatim)**: BE `npx tsc --noEmit` 0 lỗi · BE `npx tsx --test --test-concurrency=1 src/tests/fb033-auto-offset-release.test.ts` 4/4 · BE `pnpm test` 330/330 · `pnpm lint` 0 lỗi · `make build` OK · FE `tsgo -b`/`tsc -b` 0 (không đụng FE/shared). Regression: `testplan/2026-10-21-card211026014819-fb033-chiphi-vua-tao-bi-khoa.md`. Unit pin: `backend/src/tests/fb033-auto-offset-release.test.ts`.
- **Not covered**: staging re-drive sau deploy (QA R-next); sửa dòng legacy TRIP qua ví OPS chỉ verify mức API; DRIVER surface (không có auto-offset — settlementMethod khác); review độc lập bị treo (>11 phút) — orchestrator chỉ thị commit không chờ.
- **Fixture residual (dev DB)**: tạm ứng funded cho `opsqa` (8138/8139, RECORDED, reason "FB-033 repro/verify tạm ứng") — consumption đã nhả hết; các khoản chi hộ test đều VOIDED.
- Stack note: BE :3303 / FE :7177 của lane này (đang chạy); :3002/:7175/:7176 là của task khác — KHÔNG đụng. DB local ss-prod-db :5441.

# FIX CHI PHÍ lần 2 — 6 mục spec 19/10 + 3 mục §c (PRD) — 2026-10-21

Controller: agent, worktree `1njkloyy/fix-accounting-fix2`, branch
`fix-accounting-fix2` (off main `56a5d509`). Spec `19.10 - FIX CHI PHÍ.docx`;
bố cục mockup đọc từ `docs/prd/PhanHeKeToan.md` (session không vision — ghi
rõ trong qa README). Stack riêng FE `:7185` / BE `:3012` (lane khác giữ
7175/3002); DB chung `ss-prod-db:5441`. Staging KHÔNG đụng.

**Status**: verify-first 9 mục → 6 mục ĐÃ ĐÚNG (1,3,4*,5,6,7,8,9 — *item 4
thêm "-- Ngày … – …" vào heading) → item 2 LÀ PHẦN FIX: sweep `grouped`
(+`signed` nơi FB-100) 23 ô tiền trên ~20 file + `tabular-nums` trên shared
money primitives (`.money`/`.num`/`.record-table .num`/`.ds-field--money
input`) + nới `font-family-contract.test` (font Be Vietnam Pro chưa có tnum —
đo bằng fontTools, ghi qa README; declaration inert tới khi đổi typeface).
Evidence + coverage bảng §9: `qa/2026-10-21-accounting-fix2/` (drivers
`qa/scripts/2026-10-21-accounting-fix2-*.mjs`). Item 6 Xuất debit: UI DRIVEN
PASS (banner + downloadWillBegin + xlsx 9922B PK + `billing_documents#16191`)
— bug "không xuất được" gốc (idempotency-key >100 ký tự) đã land từ trước.
Item 7 khớp số tuyệt đối 2/2 thời điểm (127.000.000 / 126.850.000). §c ghi
nhận: cơ chế duyệt là NÚT (không phải cột tick Ngày duyệt như PRD mô tả) —
không đổi bề mặt owner-landed; số âm hiện có dấu đỏ + nhãn theo ruling
141026230770.

- **Gates**: lint 0 (r1+r2) · FE tsc 0 · FE suite (xem qa log cuối) · make
  build ✓ (r1+r2) · BE không đụng (không BE gate). Regression pins:
  `money-format-sweep.chiphi2` CP2-M1..M6, report-section heading,
  font-contract. **Review độc lập R1** (code-reviewer): REQUEST_CHANGES →
  fix hết — 2 ô per-liter decimal revert raw (giá dầu gốc, ngưỡng VNĐ/lít),
  refund field bỏ className double-chrome (F2 verify UI
  `02-f2-refund-field-1440.png`), treasury +signed, nits.
- **Nợ/lưu ý**: (1) các ô đơn giá VND/lít step 0.01 (payables-fuel-invoices)
  GIỮ NGUYÊN — grouped bỏ decimal, đổi sẽ sai số; (2) 2 input disabled
  BillingDocumentBuilder đổi sang hiển thị formatCurrency; (3) QA note
  `2026-10-21-lcl01-lan2-repro.mjs` đổi ví dụ cổng 3016→3002 cho qua dev-port
  contract (file của lane khác, chỉ sửa comment).

---

# LCL-01 lan 2 — overview/detail không đồng bộ, shape container-row chưa có ngày (card 211026180528) — 2026-10-21

Controller: this agent, worktree `1njkloyy/fix-lcl01-lan2`, branch `fix-lcl01-lan2`
(off main `9aab78d2`). Commit `ddf45946`, pushed origin. Staging READ-ONLY suốt lane.

**Status**: DONE — verify-first trên build 9aab78d2 → root cause → fix → gates →
review độc lập (land as-is) → commit+push. Staging KHÔNG deploy (owner recut wave).

- **QA lot (diff probe)**: staging probe toàn bộ page, 6 account (5 CUS + admin),
  đúng 1 lô rớt: **133 / SHP-2610-00069** — QA Vũ Văn Tiệp tạo 17:09 (`POST
  /shipments` body `{customerId}` → cargo_mode NULL) + 2 cont 20' chưa hẹn ngày
  17:11 (fixture DRI-03; owner addendum xác nhận). Card wedge 18:05 = lô này.
- **Root cause**: `containerDayTriageCondition` (lan 1) chỉ miễn container-less
  LCL. Row CÓ container mà triage day `coalesce(appointment, EDD)` = NULL không
  match range nào → bị mọi date arm drop khi Tổng quan (không date scope mặc định)
  vẫn liệt kê.
- **Fix**: arm thứ ba `isNull(containerTransportDateSql())` — row không có triage
  day đi ngoài day-triage bất kể cargo shape; arm lan 1 + dateArms giữ nguyên.
  Nulls-first sort arm của board sống lại (unscheduled lên đầu).
- **Gates**: be-tsc 0 · scoped 35/35 · BE unit 347/347 · BE test 335/335 · lint 0 ·
  pin 6/6 (3 cũ + 3 mới). BEFORE repro failures=2 → AFTER 8/8 (qa/2026-10-21-lcl01-lan2/).
- **Nợ/lưu ý**: (1) commit message có lỗi gõ "зерка" (cosmetic, không amend theo
  luật append-only); (2) bất đối xứng cố ý còn lại: Tổng quan với filter ngày TỰ
  CHỌN vẫn ẩn lô undated — đã ghi case doc, ngoài scope; (3) staging re-verify sau
  deploy thuộc owner; UI click-through 390px chưa drive (evidence cấp API theo
  brief); (4) QA lot 133 để nguyên cho DRI-03 (KHÔNG dispatch).

---

# DIS-08 lan 2 — container identity weight law (card 211026180428) — 2026-10-21

Controller: agent, worktree `fix-dis08-lan2` (off main `9aab78d2`), branch
`fix-dis08-lan2`. Previous HANDOFF owners (FB-066 quickadd, R29F FB-093) đều
DONE — replaced per protocol.

**Status**: DONE — root-caused, fixed, verified UI DRIVEN 15/15 (390/768/1440),
gates green, review APPROVE. Commit trên branch; push theo brief.

---

# Quote-frame CREATE fail-im-lặng (card 221026040742) — 2026-10-22

Controller: agent, worktree `fix-quote-create` (off main `839d0577`).

**Status**: DONE — root-caused, fixed, verified UI DRIVEN, gates green,
review pending-at-write (see qa/2026-10-22-quote-create/).

**Symptom (QA 22/10)**: Config → Báo giá → tạo khung: submit mà list trống,
không thấy lỗi → không có khung → không set lag NEWEB được.

**Exonerated (evidence, not guesses)**: BE create handler + tx (POST 201
`{"id":2520}` với đúng dialog payload; 45/45 `quotations.create` idempotency
rows committed trên DB local); React-Query keys/refetch (list tự refetch
không cần F5); shared schema (dialog payload accepted nguyên trạng).

**Root cause**: dialog chặn submit ở FE (Zod fail hoặc native
`form.checkValidity()` fail) nhưng chỉ set per-field hint nhỏ — không có
dialog-level Alert → operator tin form đã gửi (fail-im-lặng). Hai lớp thực tế
bơm đúng triệu chứng (reproduced UI DRIVEN): KH combobox gõ rồi thoát không
chọn; ngày draft chưa hoàn chỉnh (`22/10/26`) hiển thị đầy nhưng state rỗng.
Bonus bug: lag bỏ trống → lỗi gán nhầm vào "Ngày hiệu lực".

**Fix** (`QuotationCreateDialog.tsx`): state `attempted` + dialog-level Alert
"Chưa tạo được báo giá — chưa gửi gì đi. Kiểm tra: <trường>." khi submit bị
chặn; attribution đúng trường cho lag rỗng. KHÔNG weaken validation.

**Tests**: `QuotationCreateDialog.test.tsx` MỚI — RC-QC-CREATE-1..4 (4/4);
page tests 13/13 giữ green; regression doc
`testplan/cycles/2026-10/2026-10-22-quote-create-silent-fail.md`.

**Gates**: lint 0 · FE tsc 0 · FE full 709 files/5459 tests green · BE tsc 0
· BE 724 tests green · `make build` ok (qa/2026-10-22-quote-create/gates.txt).

**UI DRIVEN chain (qa/2026-10-22-quote-create/)**: block-loud (A/B, 0 POST) →
fix-date → Alert biến mất → POST 201 → list +1 KHÔNG F5 → frame strip lag=1 →
preview-rate lag A/B: lag=1 dùng kỳ ≤21/10 (period 2 @27620), lag=0 dùng kỳ
22/10 (period 1719 @33500) — lag áp dụng đúng. QA data dọn sạch (cleanup.txt).

**Nợ/lưu ý**: (1) chuỗi NEWEB-lag retest trên staging theo owner (local đã
pass); (2) "KH mới" trong brief diễn giải là khung MỚI cho KH có sẵn terms
(customer 1 — KH có freight_rate_terms route NEWEB local) — nếu ý là tạo
customer record mới thì preview-rate sẽ MANUAL (thiếu terms), đã ghi trong
báo cáo; (3) khung 2518/2519 "QA R32 lag-probe" của QA (đã deleted trước đó)
không đụng.

# HANDOFF — fix-tiepvu2-off2 (TiepVu 22/10-2, cards 261022213755a/b/c)

- Owner/controller: session OpenCode GLM-5.3, worktree
  /Users/dev/.paseo/worktrees/1njkloyy/fix-tiepvu2-off2, branch `fix-tiepvu2-off2`
  (off main, không tạo branch mới).
- Last updated: 2026-10-22 ~23:30. STATUS: DONE — implement + tests + UI DRIVEN
  cả 3 item + gates green + independent review APPROVE; commit + push theo brief.
- (a) Driver e-POD ảnh TÙY CHỌN (owner ruling docx: "optional, not compulsory"):
  BE `trip-pod.service.ts` — `ready` của getDriverCompletionEvidenceStatus chỉ
  còn milestone (bỏ required-pod-files + submitted-pod); submitPod bỏ 409 hồ sơ
  bắt buộc. FE — DriverTripPodPage bỏ gate !podReady, copy tùy chọn;
  TripPodSubmission "bắt buộc"→"Tùy chọn/Chưa có"; sticky bar detail đổi wording.
  UI DRIVEN: trip 194126 hoàn thành 0 ảnh, POST 200, DB COMPLETED + 0 pod
  submission + 4 mốc tự ghi.
- (b) Search kho GLC: root cause là typing exact-label → onCustomValue resolve
  id → sync effect set chosenKey → react-aria coi là pick → đóng menu giữa
  chừng ("gõ GLC không ra, LC lại thấy"). Fix shared owner
  `uui-searchable-field.tsx`: typedCustomTextRef — typing passthrough không bao
  giờ được adopt làm pick (clear trên pick/clear/blur/__create__). UI DRIVEN
  truoc (menu đóng tại GLC) / sau (GLC/Glc/glc/GL đều mở + option, pick commit).
- (c) Badge NHẬP LẺ/XUẤT LẺ: directionLabel nhận cargoMode/isLotLevel — list CUS
  (cus-direction-badge), ledger lot-level row, detail header "Xuất / Nhập".
  House primitive giữ nguyên (classification = information, không pill mới);
  UUI PRO consulted (base/badges) — ghi trong qa README.
- Gates: lint 0 · BE tsc 0 · BE tests 397+338 pass · FE tsc -b 0 · tsgo 0 ·
  FE FULL 5497/5497 (4 runs, 1 run có 1 fail đơn lẻ không xác định được tên —
  output bị cắt; 3 run sau green tuyệt đối) · make build OK.
- QA evidence: `qa/2026-10-22-tiepvu2/` (README + screenshots truoc/sau +
  driver logs + DB proof). Cleanup: kho QA GLC (id 27165) soft-deleted;
  trip 194126 driver_id restore 42966, giữ COMPLETED (side-effect QA dứt
  khoát, append-only), planned_start_at còn giá trị QA 2026-10-20.
- Review: code-reviewer APPROVE — 4 minor đã fix hết (clear ref ở __create__,
  gate hint theo accountingLock, 3 stale comments, formatting test).
- Nợ/lưu ý: (1) ảnh docx không vision-analyze được (gemini CLI IneligibleTier,
  không có API key) — behavior lấy từ text docx, đã ghi giới hạn; (2) nit chưa
  làm: class `.trip-pod__required` giờ mang text "Tùy chọn" (đổi tên class đụng
  CSS/pins, thuần cosmetic); (3) 1 FE run có 1 fail lạ không tái hiện (xem trên).

---

# HANDOFF — fix-lcl-kho-chung (card 261022093245)

- Owner/controller: this session (OpenCode, worktree
  /Users/dev/.paseo/worktrees/1njkloyy/fix-lcl-kho-chung).
- Last updated: 2026-10-22 ~10:45.
- Goal: LCL "Kho lấy hàng (CFS/Cảng)" list từ danh mục chung, không lọc theo
  khách. STATUS: DONE — commit 57f692d5 pushed to origin/fix-lcl-kho-chung.
- Scope: BE `GET /operational-sites?scope=shared` + drop customer-scope guards
  on the warehouse point (fulfillment snapshot + intake dispatch validate;
  factory keeps customer-scope). FE create form reads shared catalog; payload
  labels resolve via union; hint reword; "+ Thêm kho" kept.
- Non-goals: FCL port pickers, cus-workspace, ports-catalog merge into the kho
  dropdown (id spaces differ — deliberately not mixed).
- Files owned: shipment-intake.service.ts, shipment-fulfillment.service.ts,
  core.routes.ts (operational-sites GET), shipmentClient.ts,
  ShipmentCreateWorkspace.tsx, ShipmentCreateLclRouteSection.tsx + tests.
- Preserved: user's trunk backend on :3002 untouched; worktree QA stack
  (3003/7177) stopped after evidence; docker network pool full — worktree
  `make dev` fails on network create, run backend/frontend directly instead.
- QA artifacts: qa/2026-10-22-lcl-kho-chung/ (before/after API, UI driver
  before/after + screenshots, gates.log). Regression case:
  testplan/cases/case-QA-2026-10-22-lcl-kho-chung.md (all R1–R6 verified;
  R1/R2 UI DRIVEN rung 3, shipment 312533 SHP-2610-19366 on shared kho 442).
- Gates: lint 0, BE tsc 0, BE tests pass (unit 4/4 new + integration 338/338),
  FE tsc -b 0, FE full suite green (numeric-identity needs dist — built),
  make build OK. All on final code state.
- Blockers/next: none. Possible follow-up: UI hiển thị owner-khách của từng
  kho trong dropdown (hiện chỉ tên kho) nếu owner muốn.


---

# CUS tờ khai inline + sync · sửa/thêm cont hết lỗi (cards 261022095235a/b, Zalo 20:03 + ruling 09:50 22/10) — 2026-10-22

Controller: this agent, worktree `1njkloyy/fix-cus-tokhai-cont`, branch
`fix-cus-tokhai-cont` (off main 839d0577).

**Status**: DONE — repro-first: API flows add/đổi/xóa cont trên lô data bẩn
ĐÃ XANH từ các card trước (probe 13/13); gap thật = (1) /shipments/:id không
còn nút Thêm/Xóa cont (TICKET-09 gỡ 17/10 — ruling 09:50 22/10 BẬT LẠI,
supersede, FB-112 mở lại), (2) editor số cont workboard dead-end 400 không
gợi ý sửa. Cả hai đã fix + tờ khai click-to-edit đưa vào ledger chia sẻ.

- **Card A (261022095235a)**: cột "Số tờ khai" MỚI trên `CusContainerLedger`
  (drawer Tổng quan + /shipments/:id) — click-to-edit, Enter lưu ngay qua
  container-line command = law FB-109 auto-copy (chỉ cont còn trống,
  divergence cho phép, toast theo declarationSync); nút Copy 1-call
  (copy-declaration). KHÔNG phát minh law mới — BE không đổi.
- **Card B (261022095235b)**: `/shipments/:id` host CHÍNH
  `CusContainerLedger` (writer roles ADMIN/MANAGER/CUS/DISPATCHER, chưa lock,
  chưa COMPLETED/CANCELED; reader giữ section đọc) → Thêm/Xóa container hoạt
  động TỪ màn chi tiết; remove 409 có recovery (parity add r19); workboard
  editor số cont có ISO hint + "Đổi thành <số>" 1 chạm (giống add-row
  191026100000).
- **Gates (sau review fixes)**: root lint 0 · FE `tsgo --noEmit` 0 + `tsc -b`
  0 · **FULL FE 5467/5467 TOÀN XANH** · `make build` OK. BE/src không đổi →
  BE gates không đụng.
- **Evidence**: `qa/2026-10-22-cus-tokhai-cont/` — pre-fix driver (hasAdd:false
  @detail), api-repro-dirty-flows, sync-probe 13/13 (R2/R3/R2b/cross-lot
  409/cardB), post-fix driver 15/15 UI (rung 3: screenshots + DB proof qua
  psql), resp-sweep 12/12 @390/768/1440 (cell hiển thị, không page-overflow,
  scroll nằm trong band), drawer-fanout 6/6 (sau review fix HIGH#1); probe
  `qa/scripts/2026-10-22-tokhai-cont-sync-probe.mjs`; regression
  `testplan/2026-10-22-card261022095235ab-tokhai-containers.md` (TOKHAI-R1…R9
  + mục review đã xử lý).
- **Review độc lập**: code-reviewer DONE_WITH_CONCERNS → 4 finding (HIGH
  drawer sibling stale, MEDIUM disable-blur, MEDIUM LCL dead card, LOW
  !line-throw/idempotency) — TẤT CẢ đã fix + test + verify rung 3.
- **Env verify**: BE worktree :3005 + FE :7178 (VITE proxy 3005), DB chung
  :5441 (ss-prod-db), role cus. Port 3002/7175 thuộc checkout main — không đụng.

---

# R32 báo giá UI spec verify (card 221026040542) — 2026-10-22

Controller: this agent, worktree fix-quote-ui-spec (off main cae84f8d), branch fix-quote-ui-spec.

**Status**: DONE — verify-first, **0 src change cần thiết**: QA verify-fail
"không có UI báo giá" là SAI — 14/14 mục checklist BaoGia.md CÓ tại
`/config/quotations`. UI DRIVEN 29/29 + gates xanh + evidence + commit/push.
(Prepend theo quy ước stacked log; lịch sử các lane trước giữ nguyên bên dưới.)

- **Đối chiếu field-by-field** (`qa/2026-10-22-quote-ui/README.md`): khung giá
  (tên mẫu/giá dầu tham chiếu/ngày hiệu lực/làm tròn NONE-THOUSAND-TEN_THOUSAND)
  · lưới 10 hạng/tuyến (6 lẻ + 4 cont, nhãn từ `QUOTATION_GRID_COLUMNS`, seed
  đủ 12 mã chuẩn trong `vehicle_size_classes`) · mỗi ô 3 giá trị (Hệ số input +
  Lít dẫn xuất + Giá cos, thiếu giá hiện "Thiếu giá" đúng ruling 2) · nút
  Nhập xlsx (preview→Ghi nhận/Huỷ, Huỷ không ghi vết 2→2) + Xuất xlsx (6590B
  khớp API) + per-version Xuất xlsx + Xem payload chỉ đọc.
- **KHÔNG đụng lag field**: hiển thị "Trễ N ngày" từ `freight_rate_terms`;
  `fuelPriceLagDays` do lane song song thêm — đã ghi trong evidence là sắp có.
- **UI DRIVEN 29/29** (`qa/drivers/2026-10-22-quote-ui-drive.mjs` →
  `qa/2026-10-22-quote-ui_ui-driver.log`, 1440×1000, admin): API identity
  30 cell = 3 tuyến × 10 mã; DB proof `qa/2026-10-22-quote-ui_db-proof.txt`.
- **Gates**: FE `tsgo --noEmit` 0 + `tsgo -b` 0 · scoped vitest config pages
  236/236 · **FULL FE 5454/5454** (run 1 fail 2 chỉ vì worktree chưa build —
  test pin production CSS cần dist; sau `pnpm build` toàn xanh) · root lint 0.
  0 src change → BE gates không đụng. (Shared `npm test` có 2 fail fifoAging
  pre-existing tại cae84f8d — debt aging, ngoài scope, không thuộc gates.)
- **Testplan case**: `testplan/2026-10-22-card221026040542-quote-ui-spec.md`
  (QA-BG-UI-1…5).
# QA R32 — Báo giá ENGINE WIRING + fuelPriceLagDays khung giá — 2026-10-22

Controller: this agent, worktree `1njkloyy/feat-quote-engine-wiring`, branch
`feat-quote-engine-wiring` (off main `cae84f8d`). Closes
`testplan/cases/case-QA-2026-10-22-quote-engine-wiring.md` (QA R32 "không
engine", spec BaoGia.md §2 + CuocPhiPhuPhiDau.md §2/§7).

**Status**: DONE — verify-first: engine wiring đã có sẵn ở trunk từ R31 (8
call site qua `lockShipmentFreightRate`); lane bổ sung (1) lag là thuộc tính
KHUNG giá, (2) endpoint preview-rate cho QA, (3) test pin công thức + căn cứ.

- **fuelPriceLagDays khung giá**: column `quotations.fuel_price_lag_days`
  (int ≥0, NOT NULL DEFAULT 1 = import-lag NEWEB; migration
  `20261022090000` + journal idx 152, đã áp dev 5441, backfill an toàn) +
  zod `quotationCreateSchema` + `QuotationView`; create/update/get/list +
  import commit ghi lag khung qua `resolveImportedFuelLag`; FE
  QuotationCreateDialog (default 1) + strip "Thông tin khung" trên
  QuotationConfigPage hiển thị + sửa được (draft-on-blur, số rác không lưu).
- **Engine theo khung hiệu lực**: `resolveQuotationHints` trả frame nguồn
  (id/tên/effectiveDate/lag); lag tra giá dầu = `effectiveFuelLagDays(frame,
  terms)` — khung THẮNG, terms fallback (khách chưa có khung giữ nguyên hành
  vi seed NEWEB lag 1). Formula mapping comment code→C/E/F/G/H/J/K trong
  engine header.
- **Preview-rate (QA probe)**: `POST /api/quotations/preview-rate`
  {customerId, factoryId|routeId, hạng, ngày} → J/H/K + liters + nguồn frame;
  non-material-write + ACCOUNTANT/ADMIN như import preview; nhà máy =
  operational_sites FACTORY → route canonical.
- **Pure wiring core**: `freight-lot-basis.ts` (không db) —
  `classifyLotPricingBasis` (đủ/thiếu căn cứ LOCK/SKIP, giữ nguyên hành vi
  lockShipmentFreightRate gồm LCL-lock-at-dispatch và 409 MISSING_WEIGHT ở
  dispatch) + `effectiveFuelLagDays`; unit-test đầy đủ.

**Evidence** (`qa/2026-10-22-quote-engine/`, backend worktree port 3009, dev
DB 5441, account ketoan): case1 đủ căn cứ NEWEB CONT40 2026-09-20 → AUTO
E=91, J=4.182.000, H=889.744, K=5.071.744 + frame nguồn #1 lag 1 (khớp bảng
§6.1); case2 thiếu điều khoản → MANUAL 0/0/0 + formula chỉ thiếu căn cứ
(không bịa số); case3 khung lag 71 → target 07-11 → H=354.664, K=4.536.664
(khớp §6.2 — chứng minh lag KHUNG điều khiển engine, terms vẫn lag 1); case4
dọn frame tạm xong quay lại đúng case1; case5 factoryId 27004 → route 1 cùng
K. Driver log + JSON mỗi case.

**Gates**: root lint 0 · be-tsc 0 · BE unit 386/386 + full BE (unit+
integration) 0 fail · shared touched-file tests 25/25 (10 fail fifoAging là
pre-existing trên main, ngoài scope) · fe tsc -b 0 · scoped quotation FE
27/27 · **full FE suite 708 files / 5.455 tests 0 fail** · make build 0.

# HANDOFF — feat-gomhang-be (card 261023110000, spec khách 23/10 "Điều chỉnh luồng Gộp hàng lẻ")

- Owner/controller: this session (worktree `/Users/dev/.paseo/worktrees/1njkloyy/
  feat-gomhang-be`, branch `feat-gomhang-be` off main). Last updated: 2026-10-23.
- Scope: CHỈ BACKEND (shared schemas/services/routes/BE tests) — FE grid/lane
  redesign là wave sau (FE đang sở hữu detailed-plan lane riêng); FE tsc chỉ
  smoke (0 errors) chứ không sửa FE.

**RULING (bắt buộc giữ khi làm tiếp): ruling 21/10 (thu per-lot đơn giá×SL)
vẫn là DEFAULT — mỗi lô LCL = 1 chuyến riêng với Loại xe thu/Giá cước thu/BKS
báo khách của chính lô đó (per-lot outputs, `setLclLotRevClass`). 100/0 CHỈ
trong nhóm CUS gộp CHỦ ĐỘNG (rev_group): Lô 1 = 100% cước thu nhóm, Lô 2..N =
0₫ + tag "Ghép thu cước cùng Lô 1" — đã ghi PRD (lane docs).** Tách nhóm rev
group dùng luật FB-093 (100/0-era): tách cả nhóm ⇒ tiền về pre-merge
(`restoreRevPreMergeMoney`); tách Lô 1 ⇒ chuyển 100% cho Lô kế ("Đón cước
chính"); 1 thành viên về riêng ⇒ giữ cước hiện tại + lý do chờ định giá lại
(`restateRevLeaverMoney`). ĐIỀU VẬN (cost_group) giữ nguyên luật 1 dòng/chuyến
(Lô 1 = 100% cước trả ĐVVC, members 0₫).

## Thay đổi chính (spec 261023110000)

1. **Tách nhóm xác nhận**: `cost_group_id` (ĐV) vs `rev_group_id` (CUS) độc
   lập hoàn toàn — patch builders `lcl-grouping-law.ts`
   (`costGroupMemberPatch`/`revGroupMemberPatch`) là seam thuần + test chốt
   không rò cột giữa 2 chiều. Không migration phá dữ liệu cũ.
2. **ĐV popup = đúng 4 trường** (Loại xe tính cước trả ĐV · Nhà xe · BKS thực ·
   Cước trả ĐVVC blank=auto/nhập tay=override): `assignLclCostGroupSchema`
   XÓA `billingTruckNo`/`billingTruckNos` (BKS-báo-khách-ảo là concept CUS;
   unknown keys bị strip nên FE cũ vẫn chạy). **THÊM/SỬA**: endpoint mới
   `POST /api/shipments/lcl/cost-group/update` (`updateLclCostGroup`,
   membership cố định, resubmit 4 fields, freightCost omitted = re-trace).
3. **Cước trả ĐVVC nhập tay sống tới phát lệnh** (defect class thật: assign
   xảy ra TRƯỚC khi có trip nên giá trị rơi rụng): cột mới
   `shipments.cost_group_freight_manual` (migration
   `20261023120000_lcl_cost_group_freight_manual.sql`, nullable, không
   backfill) — assign/update ghi, `applyLclCostGroupFreightToNewTrip` ưu tiên
   nó hơn bảng giá, FB-095 promote chuyển nó theo vương miện như cước trả.
4. **CUS per-lot outputs** (`setLclLotRevClass`): Loại xe thu (optional) +
   Giá cước thu `freightRevenue` (auto tra bảng giá theo loại+ngày; nhập tay
   override — manual bỏ qua trace entirely). BKS báo khách per-lot =
   `updateLclTruck` với `billingTruckNo: null` = XÓA (BLANK).
5. **BKS fallback (BLANK ⇒ BKS thực ĐV đã gán, lên Debit Note)**:
   `effectiveBillingPlate` (shared, pure — LCL only; non-LCL giữ GAP-3 "không
   in BKS thực"). Dùng ở: draft render (`buildTripRenderData`), freeze Debit
   (`shipment-cost-lock` 2 paths — vật hóa BKS reported vào frozen lot), legacy
   frozen path (`billing-export-shared`).
6. **Gộp CUS (rev_group)**: validation cùng KH về pure law
   (`findRevCustomerConflict`/`assertSameRevCustomer`, 400 liệt kê đủ lô+KH) ·
   nhóm nhận Loại xe thu nhóm + BKS báo khách chung (blank = giữ per-lot,
   KHÔNG copy BKS thực vào field CUS) + Cước thu Lô 1 `freightRevenue`
   (blank=auto, nhập tay=override) · 100/0 + tag `LCL_REV_MERGE_TAG`
   ('Ghép thu cước cùng Lô 1') = stamp + field trên API (`LclGroupWire
   .revMergeTag` ở list-summaries + `revMergeTag` trong merge result members).
   `updateLclTruckSchema.billingTruckNo` nullable (null=clear).

- **Independent review (code-reviewer) = REQUEST-CHANGES → đã fix hết
  findings trước commit**: C1 (tách cả nhóm restore nhầm `revenueOriginal`
  first-override + bịa 0₫ trần) ⇒ capture "trạng thái trước ghép" riêng
  `trip_financial_state.revenue_pre_group(_captured)` (migration
  `20261023130000_lcl_rev_pre_merge_capture.sql`; captured NULL ⇒ khôi phục
  NULL "Chưa xác định"; nhóm legacy không capture ⇒ fallback luật cũ); H1
  (payload SỬA 1 trường wipe Nhà xe + manual) ⇒ `updateLclCostGroup` PARTIAL
  thật + `freightCost` 3-state (number=manual, null=auto, omitted=giữ nguyên);
  M1 (promote fallback trộn kênh) ⇒ snapshot fallback chỉ khi leaver KHÔNG có
  trip; M2 (frozen doc cũ render lại BKS live) ⇒ revert path legacy về luật cũ
  (fallback chỉ vật hóa lúc freeze cho doc mới); + L1–L8 (stale tag promotee,
  refine test uuid, pins wiring/call-sites, testplan filename, copy).

## Tests (BE unit-only)

- `backend/src/tests/unit/lcl-gop-hang-split-law.test.ts` — 2 nhóm độc lập
  (patch builders), validation cùng KH, BKS fallback, wire contract (ĐV 4
  trường, strip billing, schema các lệnh, tag constant).
- `backend/src/tests/unit/lcl-gop-hang-money-wiring.test.ts` — 100/0 từng
  nhóm (COST+REV), auto-tra vs override (cả 2 chiều + sống tới phát lệnh),
  tách nhóm (promote/restore/restate), ĐV không viết BKS báo khách, default
  per-lot 21/10 giữ nguyên. (Thay file `lcl-rev-perlot-money-wiring.test.ts`
  đã xóa — pin luật 21/10 cho merge path nay bị spec 23/10 supersede.)
- `material-write-registry-exhaustive.test.ts`: + entry
  `cost-group/update` (audit `SHIPMENT_UPDATED` + action `cost-group-update`).

## Environment / còn nợ

- Dev DB :5441 (ss-prod-db) đã chạy migration mới (additive nullable).
- FE: `AssignTruckGroupDialog`/`LclGroupTruckEditDialog`/`MergeRevGroupDialog`
  còn gửi field cũ (billing) — server strip, UI chỉnh ở FE wave; FE cần
  hiển thị `revMergeTag` + per-lot `freightRevenue` + nút SỬA 4 trường nhóm ĐV.
- Chưa UI-drive (BE-only brief; rung 0 cho UI claims). `customer-debt-summary`
  fallback copy "Ghép cước cùng Bill X" và Debit Note "Ghép xe cùng Bill" giữ
  nguyên (out of spec scope).

# HANDOFF — fix-filter-lcl-day (card 231026000252, ticket 261022201006b)

- Owner/controller: this session (worktree `/Users/dev/.paseo/worktrees/1njkloyy/
  fix-filter-lcl-day`, branch `fix-filter-lcl-day`). Last updated: 2026-10-23.
- Goal: "FILTER NGÀY LỌT lô LCL" — lot K547238574983 (LCL, transportDate
  2026-10-17) survived the 23/10..23/10 filter on Chi tiết while Tổng quan
  filtered it away. Owner law: **undated = luôn hiện; dated = phải qua filter
  như lô cont**; giữ đồng bộ LCL-01 (SAME filter → same lots on both surfaces).
  STATUS: DONE — fix + tests + real-data QA + UI rung-3 + full gates green,
  independent review in flight at handoff time (commit lands after verdict).
- Root cause: `containerDayTriageCondition` (cus-workspace-sql.service.ts)
  lane-1 blanket escape for container-less LCL rows (added for LCL-01) exempted
  DATED LCL lot rows from the day triage entirely ("bỏ qua bộ lọc ngày hoàn toàn").
- Fix — one law, three shared implementations:
  1. `containerDayTriageCondition`: 2 arms now (null-day passthrough +
     dateArms). A lot row's day is its EDD leg of
     `coalesce(appointment VN, EDD)`; dated rows pass the filter.
  2. `shipmentTransportDateCondition` (Tổng quan + list-summaries deliveryDate
     arm = core.routes master-plan): null-day passthrough in BOTH arms (EXISTS +
     container-less) so undated lots show under every filter. Card
     261022201006b's Z-leak gate (`not exists (containers)` on the EDD leg) kept.
  3. `filterContainersByDateRange` (container-date-filter.ts, scoped-count twin):
     keeps rows resolving to no day — counts never contradict rows (2 old pins
     flipped to the new contract, cited to the card).
- Tests: 4 named cases (LCL dated in-range / LCL dated out-range / LCL undated /
  cont dated) in colocated `backend/src/services/container-date-filter.test.ts`
  (pre-ruling location; pure unit) + SQL-contract pins rewritten in
  `backend/src/tests/unit/cus-container-day-triage.test.ts` and
  `backend/src/tests/unit/shipment-transport-date-condition.test.ts`.
- Evidence `qa/2026-10-23-filter-lcl-day/`: repro before 19/27 (8 FAIL = defect,
  incl. real lot on Chi tiết 23/10) → after 27/27; UI rung-3 17/17 (both screens,
  screenshots + DOM + scoped requests + DB proof); tiepvu-filter-ui rerun 7/7
  (driver has 7 checks — brief said 8); boundary probe 13/13; lcl01-lan2-repro
  5/7 — the 2 FAILs are ONE dated-2099 fixture under Chi-tiết's default lens,
  superseded by req 2 (see case doc Supersession note).
- Supersession (read before claiming "phá LCL-01"): the old LCL-01 repro's
  "dated LCL lot visible on CHI TIẾT default lens" checks ARE requirement 2's
  target behavior reversed — dated = phải qua filter (acceptance: fixture dated
  2026-10-17 under 23/10 filter → 0 kết quả). Same-filter sync verified by the
  new driver's SYNC checks; undated-always is the discoverability anchor.
- Gates: root lint 0 · be-tsc 0 · BE full 338/338 · fe tsgo 0 + `tsc -b` 0 ·
  FE full 5489/5489 (711 files) · make build 0 · boundary probe 13/13 ·
  scoped date-filter tests 26/26. dev-port-contract 11/11 (one driver-comment
  port hardcode fixed in the new repro driver).
- Local env: BE worktree :3008 + FE :7181 (VITE_API_PROXY_TARGET 3008), DB :5441
  (ss-prod-db = staging mirror; real lot K547238574983 = id 124 / SHP-2610-00064,
  booking_ref column). Demo `cus` user CREATED (local-only, customer_id=1,
  testaccounts.txt demo stand-in) because the staging mirror has no CUS demo
  account (prod has none by design) — needed for the tiepvu UI rerun. Trunk
  :3002/:7175 untouched.
- Not covered / limits: `filterContainersByDateRange` undated-keep changes scoped
  count cells + dispatch master-plan totals to match visible rows (by design,
  not separately UI-swept); FE default-lens asymmetry (Tổng quan bare vs Chi
  tiết today-lens) unchanged — identical to cont lots ("như lô cont"); customs
  cutoff (`dateFrom/dateTo` on /api/shipments) deliberately untouched.

# HANDOFF — fix-kho-search-race (TiepVu22Oct-3: gõ GLC đè pick bị ăn ký tự)

- Owner/controller: this session (worktree
  /Users/dev/.paseo/worktrees/1njkloyy/fix-kho-search-race, branch
  `fix-kho-search-race` off main 19140823).
- Last updated: 2026-10-23.
- Goal: search kho lấy hàng (danh mục chung) — khách báo gõ đủ "GLC" không
  ra, gõ "LC" lại thấy (TiepVu22Oct-3 / TiepVu22Oct-4.docx image4).
  STATUS: DONE — fix + unit tests (red-green) + Playwright UI driven
  (truoc/sau, delay 0/120/400ms, final green trên build cuối) + gates +
  independent review (code-reviewer DONE_WITH_CONCERNS → 2 findings fix
  trong changeset: dropoff-port sweep + commitEnterMatch session-end;
  1 finding từ chối có lý do — blur-resync sẽ wipe free-text FB-105);
  landing via trunk commit `fix(cus): search kho — chặn race stale-response,
  gõ full 'GLC' ra kết quả (TiepVu22Oct-3)` + push theo instruction của
  owner.
- Điều tra (repro-first, `qa/2026-10-23-search-glc-race/`): KHÔNG có
  server-side search theo keystroke (network log chỉ mount-time
  `?scope=shared` + `?customerId=1`); không có ngưỡng ≤2/≥3 ký tự. Lỗi còn
  sót trên main sau 261022213755b: gõ ĐÈ lên ô kho đã có pick — keystroke
  đầu làm onCustomValue clear id (value id → '') và sync effect trong
  `uui-searchable-field.tsx` chạy `setInputValue('')` ăn mất chữ vừa gõ
  ("GLC" → ô còn "LC"). Symptom "GLC → menu đóng" của khách trùng dạng
  pre-fix 261022213755b (ảnh chụp trước khi fix deploy); field trống đã
  xanh trên main — residual là path gõ đè, đã fix bằng typing-session law:
  khi typedCustomTextRef live, sync effect không đè inputValue; luật
  chosenKey (fromLiveTyping) giữ nguyên.
- Files: `frontend/src/features/shipments/create/uui-searchable-field.tsx`
  (+26/−8: typing-session guard + commitEnterMatch session-end),
  `frontend/src/features/shipments/create/ShipmentCreateContainerRow.tsx`
  (sweep: allowsCustomValue cho Cảng hạ, twin Cảng nâng), test mới
  `uui-searchable-field.typing-session.test.tsx` (8 tests, 2 fail trên code
  cũ — red-green proof), testplan case
  `testplan/cycles/2026-10/2026-10-23-tiepvu3-kho-search-stale-race.md`.
- Env verify: FE worktree :7176 (proxy chung BE :3002, đã tắt sau QA); trunk
  :3002/:7175 chạy từ main checkout. DB :5441 có kho GLC id 27166 (tạo cho
  repro, GIỮ LẠI để regression tái chạy).
- Gates: root lint 0 · FE `tsc -b` 0 · `make build` 0 · FE full vitest FINAL
  712 files / 5497 tests ALL PASS (2 run đầu: 2 fail thiếu dist ở worktree
  mới — xanh sau build; 1 flake KT-16 ShipmentFinanceForm dưới tải — xanh
  scoped 4/4, không import module bị đổi) · scoped searchable-field 23/23 ·
  create-feature 224/224.
- Non-goals: không đổi exact-match semantics của warehouseCustomText
  (owner ruling 261022213755b passthrough); không thêm server search;
  UuiSelectField/finance form không thuộc changeset.
# HANDOFF — fix-tiepvu-rb2 (cards 261022201006b/c, TiepVu 22/10 evening)

- Owner/controller: this session (worktree
  /Users/dev/.paseo/worktrees/1njkloyy/fix-tiepvu-rb2, branch `fix-tiepvu-rb2`
  off main 39e40fc1).
- Last updated: 2026-10-22 ~22:15.
- Goal: (b) "Lọc theo ngày trên CUS vẫn trả lô ngày khác" +
  (c) "App lái xe bỏ hiển thị mã chuyến" (REQ-07 cũ). STATUS: DONE —
  independent code-reviewer verdict READY_WITH_CONCERNS, all 5 findings
  resolved (strict date grammar + 400 at the route, end-exclusive VN-day
  bound, coalesce-law regex pin in tests, dead CSS removed, comment anchors
  fixed); landing via the trunk commit titled `fix(cus,driver): filter ngày
  đúng VN timezone + bỏ mã chuyến màn lái xe (TiepVu 22/10, cards
  261022201006b/c)`.
- Card B root causes (probe-first, `qa/scripts/2026-10-22-tiepvu-filter-boundary-probe.mjs`
  — before 8/13 with 4 leak FAILs → after 13/13):
  (1) lot-level date filter OR-ed `expectedDeliveryDate` unconditionally —
  reappointed lots leaked back under their old EDD day (fixture lot Z). Fix =
  `shipmentTransportDateCondition` in `cus-workspace-sql.service.ts` (EDD is
  the day only for container-less lots; else union of per-container
  `coalesce(appointment VN date, EDD)` — same law as the Chi tiết triage);
  used by CUS workspace shipment-mode AND `list-summaries` deliveryDate arm.
  (2) `GET /shipments?dateFrom&dateTo` compared `customsCutoffAt` (timestamptz)
  to a UTC-day window (`new Date('YYYY-MM-DD')`) — leaked/dropped rows at the
  00:00/23:59 VN boundary. Fix = `businessZoneDayStartInstant`/
  `businessZoneDayEndInstant` in `container-date-filter.ts` (VN-day window).
  FE param format was already YYYY-MM-DD — no FE change for card B.
- Card C: trip-code display removed from `/my-trips` cards, `/my-trips/:id`
  fact grid (Thông tin lệnh), and `/my-penalties` meta (sweep). `tripCode`
  KEPT on wire/DB (board matching in DriverTripDetailPage untouched).
  `driverTripCodeLabel` (REQ-07) deleted with its tests as dead code.
- Non-goals: card 261022201006a (tờ khai) — trùng scope lane
  `fix-cus-tokhai-cont` đang chạy, không thuộc changeset này. Also spotted
  same-class comparison on the dispatch handoff queue
  (`date(dispatch_handoffs.vehicle_needed_by)` in dispatch-planning-queries) —
  different screen/owner, NOT in this card; open a follow-up card if wanted.
- Env verify: BE worktree :3006 + FE :7179 (VITE proxy 3006), DB chung :5441
  (ss-prod-db); trunk :3002/:7175 and tokhai lane :3005/:7178 untouched.
  Worktree stacks can stay up or be killed after the session.
- Gates: root lint 0 · BE tsc 0 · BE tests 338/338 · FE tsgo 0 + `tsc -b` 0 ·
  FULL FE 710 files/5473 tests (after `vite build` — numeric-identity needs
  dist) · `make build` OK.
- QA artifacts: `qa/2026-10-22-tiepvu-b-c/` (probe before/after logs, UI
  driver logs + screenshots for BOTH cards, DB proofs, gates.log). Regression
  cases with results: `testplan/2026-10-22-card261022201006b-cus-date-filter.md`,
  `testplan/2026-10-22-card261022201006c-driver-trip-code.md`.
- Blockers/next: none. Review informational (pre-existing, NOT this diff):
  `CONTAINER_SORT_SQL.transportDate` / `containerMissingBitsSql` still give an
  FCL-undated container a NULL sort/completeness date while the filter law
  counts it under the lot's EDD day — pre-existing divergence worth a card if
  the owner wants full single-sourcing. Same-class date comparison on the
  dispatch handoff queue (`date(dispatch_handoffs.vehicle_needed_by)` in
  dispatch-planning-queries) — different screen/owner, NOT in this card.

---

# HANDOFF — fix-uui-select-modal (card 221026123031)

- Owner/controller: this session (OpenCode, worktree
  /Users/dev/.paseo/worktrees/1njkloyy/fix-uui-select-modal, branch
  `fix-uui-select-modal` off main 5c917db5).
- Last updated: 2026-10-22 ~13:35.
- Goal: "UuiSelectField listbox không click được trong modal (blocker tạo khung
  giá)". STATUS: DONE — nhưng KẾT LUẬN LÀ FALSE POSITIVE, không có bug sản phẩm.
  Product code KHÔNG đổi; main đã được verify E2E tạo khung giá OK (KH chọn
  được, `201 POST /api/quotations` id 2526/2527, list refetch, DB proof).
- Root cause chuỗi sai của repro cũ: (1) `[role="option"]` trần trúng row của
  `ul[role=listbox].quotation-frames__list` (trang, dưới scrim modal — chặn
  click là ĐÚNG); (2) thiếu "Ngày hiệu lực"; (3) fill() tràn vào segment DD của
  ô ngày segmented. Giả thuyết z-index BỊ BÁC BỎ: react-aria useOverlayPosition
  hardcode inline `zIndex: 100000` cho popover portalled — luôn trên --z-modal.
- Fix thật (đúng defect class — QA harness): driver chuẩn
  `qa/scripts/2026-10-22-uui-select-modal-driver.mjs` (scope option vào
  `.ds-uui-select__popover`, type ngày theo digits, đủ trường bắt buộc);
  testplan/cases/case-QA-2026-10-22-uui-select-modal.md; evidence
  qa/2026-10-22-uui-select-modal/.
- Gates (trên tree final = main + QA files): FE scoped 282/282, tsc -b 0,
  lint 0, vite build OK, FULL FE 710 files/5481 tests PASS (sau build dist —
  numeric-identity cần dist như HANDOFF trước đã ghi).
- Blockers/next: none. Lưu ý: đã revert sạch sửa z-index popover.tsx thử trong
  phiên (no-op thua inline style của react-aria) — không được đem lại.

---

# HANDOFF — fix-lcl-kho-chung (card 261022093245)

- Owner/controller: this session (OpenCode, worktree
  /Users/dev/.paseo/worktrees/1njkloyy/fix-lcl-kho-chung).
- Last updated: 2026-10-22 ~10:45.
- Goal: LCL "Kho lấy hàng (CFS/Cảng)" list từ danh mục chung, không lọc theo
  khách. STATUS: DONE — commit 57f692d5 pushed to origin/fix-lcl-kho-chung.
- Scope: BE `GET /operational-sites?scope=shared` + drop customer-scope guards
  on the warehouse point (fulfillment snapshot + intake dispatch validate;
  factory keeps customer-scope). FE create form reads shared catalog; payload
  labels resolve via union; hint reword; "+ Thêm kho" kept.
- Non-goals: FCL port pickers, cus-workspace, ports-catalog merge into the kho
  dropdown (id spaces differ — deliberately not mixed).
- Files owned: shipment-intake.service.ts, shipment-fulfillment.service.ts,
  core.routes.ts (operational-sites GET), shipmentClient.ts,
  ShipmentCreateWorkspace.tsx, ShipmentCreateLclRouteSection.tsx + tests.
- Preserved: user's trunk backend on :3002 untouched; worktree QA stack
  (3003/7177) stopped after evidence; docker network pool full — worktree
  `make dev` fails on network create, run backend/frontend directly instead.
- QA artifacts: qa/2026-10-22-lcl-kho-chung/ (before/after API, UI driver
  before/after + screenshots, gates.log). Regression case:
  testplan/cases/case-QA-2026-10-22-lcl-kho-chung.md (all R1–R6 verified;
  R1/R2 UI DRIVEN rung 3, shipment 312533 SHP-2610-19366 on shared kho 442).
- Gates: lint 0, BE tsc 0, BE tests pass (unit 4/4 new + integration 338/338),
  FE tsc -b 0, FE full suite green (numeric-identity needs dist — built),
  make build OK. All on final code state.
- Blockers/next: none. Possible follow-up: UI hiển thị owner-khách của từng
  kho trong dropdown (hiện chỉ tên kho) nếu owner muốn.


---

# CUS tờ khai inline + sync · sửa/thêm cont hết lỗi (cards 261022095235a/b, Zalo 20:03 + ruling 09:50 22/10) — 2026-10-22

Controller: this agent, worktree `1njkloyy/fix-cus-tokhai-cont`, branch
`fix-cus-tokhai-cont` (off main 839d0577).

**Status**: DONE — repro-first: API flows add/đổi/xóa cont trên lô data bẩn
ĐÃ XANH từ các card trước (probe 13/13); gap thật = (1) /shipments/:id không
còn nút Thêm/Xóa cont (TICKET-09 gỡ 17/10 — ruling 09:50 22/10 BẬT LẠI,
supersede, FB-112 mở lại), (2) editor số cont workboard dead-end 400 không
gợi ý sửa. Cả hai đã fix + tờ khai click-to-edit đưa vào ledger chia sẻ.

- **Card A (261022095235a)**: cột "Số tờ khai" MỚI trên `CusContainerLedger`
  (drawer Tổng quan + /shipments/:id) — click-to-edit, Enter lưu ngay qua
  container-line command = law FB-109 auto-copy (chỉ cont còn trống,
  divergence cho phép, toast theo declarationSync); nút Copy 1-call
  (copy-declaration). KHÔNG phát minh law mới — BE không đổi.
- **Card B (261022095235b)**: `/shipments/:id` host CHÍNH
  `CusContainerLedger` (writer roles ADMIN/MANAGER/CUS/DISPATCHER, chưa lock,
  chưa COMPLETED/CANCELED; reader giữ section đọc) → Thêm/Xóa container hoạt
  động TỪ màn chi tiết; remove 409 có recovery (parity add r19); workboard
  editor số cont có ISO hint + "Đổi thành <số>" 1 chạm (giống add-row
  191026100000).
- **Gates (sau review fixes)**: root lint 0 · FE `tsgo --noEmit` 0 + `tsc -b`
  0 · **FULL FE 5467/5467 TOÀN XANH** · `make build` OK. BE/src không đổi →
  BE gates không đụng.
- **Evidence**: `qa/2026-10-22-cus-tokhai-cont/` — pre-fix driver (hasAdd:false
  @detail), api-repro-dirty-flows, sync-probe 13/13 (R2/R3/R2b/cross-lot
  409/cardB), post-fix driver 15/15 UI (rung 3: screenshots + DB proof qua
  psql), resp-sweep 12/12 @390/768/1440 (cell hiển thị, không page-overflow,
  scroll nằm trong band), drawer-fanout 6/6 (sau review fix HIGH#1); probe
  `qa/scripts/2026-10-22-tokhai-cont-sync-probe.mjs`; regression
  `testplan/2026-10-22-card261022095235ab-tokhai-containers.md` (TOKHAI-R1…R9
  + mục review đã xử lý).
- **Review độc lập**: code-reviewer DONE_WITH_CONCERNS → 4 finding (HIGH
  drawer sibling stale, MEDIUM disable-blur, MEDIUM LCL dead card, LOW
  !line-throw/idempotency) — TẤT CẢ đã fix + test + verify rung 3.
- **Env verify**: BE worktree :3005 + FE :7178 (VITE proxy 3005), DB chung
  :5441 (ss-prod-db), role cus. Port 3002/7175 thuộc checkout main — không đụng.

---

# R32 báo giá UI spec verify (card 221026040542) — 2026-10-22

Controller: this agent, worktree fix-quote-ui-spec (off main cae84f8d), branch fix-quote-ui-spec.

**Status**: DONE — verify-first, **0 src change cần thiết**: QA verify-fail
"không có UI báo giá" là SAI — 14/14 mục checklist BaoGia.md CÓ tại
`/config/quotations`. UI DRIVEN 29/29 + gates xanh + evidence + commit/push.
(Prepend theo quy ước stacked log; lịch sử các lane trước giữ nguyên bên dưới.)

- **Đối chiếu field-by-field** (`qa/2026-10-22-quote-ui/README.md`): khung giá
  (tên mẫu/giá dầu tham chiếu/ngày hiệu lực/làm tròn NONE-THOUSAND-TEN_THOUSAND)
  · lưới 10 hạng/tuyến (6 lẻ + 4 cont, nhãn từ `QUOTATION_GRID_COLUMNS`, seed
  đủ 12 mã chuẩn trong `vehicle_size_classes`) · mỗi ô 3 giá trị (Hệ số input +
  Lít dẫn xuất + Giá cos, thiếu giá hiện "Thiếu giá" đúng ruling 2) · nút
  Nhập xlsx (preview→Ghi nhận/Huỷ, Huỷ không ghi vết 2→2) + Xuất xlsx (6590B
  khớp API) + per-version Xuất xlsx + Xem payload chỉ đọc.
- **KHÔNG đụng lag field**: hiển thị "Trễ N ngày" từ `freight_rate_terms`;
  `fuelPriceLagDays` do lane song song thêm — đã ghi trong evidence là sắp có.
- **UI DRIVEN 29/29** (`qa/drivers/2026-10-22-quote-ui-drive.mjs` →
  `qa/2026-10-22-quote-ui_ui-driver.log`, 1440×1000, admin): API identity
  30 cell = 3 tuyến × 10 mã; DB proof `qa/2026-10-22-quote-ui_db-proof.txt`.
- **Gates**: FE `tsgo --noEmit` 0 + `tsgo -b` 0 · scoped vitest config pages
  236/236 · **FULL FE 5454/5454** (run 1 fail 2 chỉ vì worktree chưa build —
  test pin production CSS cần dist; sau `pnpm build` toàn xanh) · root lint 0.
  0 src change → BE gates không đụng. (Shared `npm test` có 2 fail fifoAging
  pre-existing tại cae84f8d — debt aging, ngoài scope, không thuộc gates.)
- **Testplan case**: `testplan/2026-10-22-card221026040542-quote-ui-spec.md`
  (QA-BG-UI-1…5).
# QA R32 — Báo giá ENGINE WIRING + fuelPriceLagDays khung giá — 2026-10-22

Controller: this agent, worktree `1njkloyy/feat-quote-engine-wiring`, branch
`feat-quote-engine-wiring` (off main `cae84f8d`). Closes
`testplan/cases/case-QA-2026-10-22-quote-engine-wiring.md` (QA R32 "không
engine", spec BaoGia.md §2 + CuocPhiPhuPhiDau.md §2/§7).

**Status**: DONE — verify-first: engine wiring đã có sẵn ở trunk từ R31 (8
call site qua `lockShipmentFreightRate`); lane bổ sung (1) lag là thuộc tính
KHUNG giá, (2) endpoint preview-rate cho QA, (3) test pin công thức + căn cứ.

- **fuelPriceLagDays khung giá**: column `quotations.fuel_price_lag_days`
  (int ≥0, NOT NULL DEFAULT 1 = import-lag NEWEB; migration
  `20261022090000` + journal idx 152, đã áp dev 5441, backfill an toàn) +
  zod `quotationCreateSchema` + `QuotationView`; create/update/get/list +
  import commit ghi lag khung qua `resolveImportedFuelLag`; FE
  QuotationCreateDialog (default 1) + strip "Thông tin khung" trên
  QuotationConfigPage hiển thị + sửa được (draft-on-blur, số rác không lưu).
- **Engine theo khung hiệu lực**: `resolveQuotationHints` trả frame nguồn
  (id/tên/effectiveDate/lag); lag tra giá dầu = `effectiveFuelLagDays(frame,
  terms)` — khung THẮNG, terms fallback (khách chưa có khung giữ nguyên hành
  vi seed NEWEB lag 1). Formula mapping comment code→C/E/F/G/H/J/K trong
  engine header.
- **Preview-rate (QA probe)**: `POST /api/quotations/preview-rate`
  {customerId, factoryId|routeId, hạng, ngày} → J/H/K + liters + nguồn frame;
  non-material-write + ACCOUNTANT/ADMIN như import preview; nhà máy =
  operational_sites FACTORY → route canonical.
- **Pure wiring core**: `freight-lot-basis.ts` (không db) —
  `classifyLotPricingBasis` (đủ/thiếu căn cứ LOCK/SKIP, giữ nguyên hành vi
  lockShipmentFreightRate gồm LCL-lock-at-dispatch và 409 MISSING_WEIGHT ở
  dispatch) + `effectiveFuelLagDays`; unit-test đầy đủ.

**Evidence** (`qa/2026-10-22-quote-engine/`, backend worktree port 3009, dev
DB 5441, account ketoan): case1 đủ căn cứ NEWEB CONT40 2026-09-20 → AUTO
E=91, J=4.182.000, H=889.744, K=5.071.744 + frame nguồn #1 lag 1 (khớp bảng
§6.1); case2 thiếu điều khoản → MANUAL 0/0/0 + formula chỉ thiếu căn cứ
(không bịa số); case3 khung lag 71 → target 07-11 → H=354.664, K=4.536.664
(khớp §6.2 — chứng minh lag KHUNG điều khiển engine, terms vẫn lag 1); case4
dọn frame tạm xong quay lại đúng case1; case5 factoryId 27004 → route 1 cùng
K. Driver log + JSON mỗi case.

**Gates**: root lint 0 · be-tsc 0 · BE unit 386/386 + full BE (unit+
integration) 0 fail · shared touched-file tests 25/25 (10 fail fifoAging là
pre-existing trên main, ngoài scope) · fe tsc -b 0 · scoped quotation FE
27/27 · **full FE suite 708 files / 5.455 tests 0 fail** · make build 0.
