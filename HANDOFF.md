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
