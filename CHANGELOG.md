# Changelog

## 2026-10-30 — fix(ux): SIL-599 (id 699) — tách bạch "tuổi nợ" (aging band) và "quá hạn hợp đồng" (KPI) trên /debt

QA Glint: trang `/debt` tự mâu thuẫn — pill tiêu đề "2 quá hạn", dòng khách
"Nợ quá hạn / 6 ngày", nhưng thẻ band ghi "0 ₫ · 0 KH quá hạn"; chi tiết
`/debt/:id` ghi "Còn nợ trong hạn" + "CHƯA ĐẾN HẠN" 100%. Cùng chữ "quá hạn"
bị dùng cho 2 cách tính; nhãn band "QUÁ HẠN 1–30 / 31–90 / TRÊN 90 NGÀY"
khoác lên dữ liệu TUỔI NỢ (cắt 0–30 / 31–60 / 61–90 / trên 90 — ruling 29/10
SIL-580 R3 + card 061026221213) — sai cả khái niệm lẫn khoảng ngày. Thẻ
"Trong hạn" còn nhấp nháy count-up trung gian (4.796.430 → 4.972.918 →
5.500.000 ₫) rồi mới chốt.

Quyết định Pattern A (webchat gemini 30/10): tách biệt rõ hai khái niệm —
gộp mọi nhãn về "tuổi nợ" (Pattern B) sẽ mất tín hiệu cảnh báo nợ xấu.

Fix:
- Band AR = TUỔI NỢ từ ngày ghi nhận: nhãn "Tuổi nợ 0–30 / 31–60 / 61–90 /
  trên 90 ngày" (`aging.ts` tách `AR_AGING_RANGES` / `AP_AGING_RANGES`).
- "Quá hạn" CHỈ dùng cho KPI quá hạn hợp đồng (processingDueDate ??
  originalDueDate ?? đến hạn tại ngày ghi nhận, cut >0): chip "N quá hạn",
  trạng thái "Nợ quá hạn", cột "Quá hạn N ngày". Mỗi từ một nghĩa; quy tắc
  giải thích bằng tooltip (`AGE_RULE_TIP` / `OVERDUE_RULE_TIP`) trên CẢ 2 mặt.
- Pill `/debt/:id` nói sự thật: "Còn nợ quá hạn · N ngày" / "Còn nợ trong
  hạn" / "Đã thanh toán đủ" — tính bằng shared `computeFifoAging` →
  `maxOverdueDaysOf` trên cùng population + FIFO với KPI /debt (review
  finding 1: `unpaidTrips` pre-FIFO có thể mâu thuẫn list rows).
- Band figures ổn định (C4): "—" khi totals chưa tải (pattern band
  /payables), giá trị CUỐI hiện nguyên khối khi có dữ liệu — bỏ count-up +
  fake zeros.
- AP (`/payables`, PayableDetailPage) giữ nguyên ngữ nghĩa due-status
  (cuts 0/30/90) — chỉ đổi tên import (`AP_AGING_RANGES`); re-anchor AP cần
  ticket riêng (out-of-scope SIL-580).

Tests: `DebtListPage.band.test.tsx` (C1 nhãn band đúng khoảng tuổi, C2 một
định nghĩa "quá hạn" + tooltip cả 2 mặt, C4 "—"/giá trị cuối atomic),
`debt-payable-aging.test.tsx` (C1 grid chi tiết AR = tuổi nợ, C3 pill 3
trạng thái + tooltip), cập nhật pin filters/sort/export theo nhãn mới + bỏ
mock count-up/reduced-motion chết. Case:
`testplan/2026-10-30-sil599-debt-labels-tuoi-no.md`.

## 2026-10-30 — fix(ux): SIL-597 (id 697) — ô "Ngày giờ đóng trả" trong bảng Thông tin hàng value-first, hết lộ khung input

QA Glint: cột NGÀY GIỜ ĐÓNG TRẢ của từng container trên `/shipments/new`
hiển thị trực tiếp 2 khung nhập liệu (HH:mm + DD/MM/YYYY) trong ô, khác cột
SỐ CONTAINER bên cạnh (nhãn + giá trị, không lộ khung input).

Nguyên nhân: ô này là host duy nhất còn bật mode `alwaysVisible`
(`--persistent`) của ShipmentContainerCell — CSS mode này `display:none` lane
display và ép editor opacity 1 mọi lúc.

Fix: bỏ `alwaysVisible` (prop + class + rule CSS `--persistent` — clean
cutover, không còn consumer). Ô đi theo đúng value-first reveal contract của
các ô cùng bảng: trạng thái nghỉ = nhãn (`data-label "Ngày giờ đóng trả *"`)
+ giá trị `formatContainerAppointment` ("HH:mm DD/MM/YYYY") hoặc placeholder
"Chọn ngày giờ"; kích hoạt ô → editor datetime hiện ra (focus vào segment).
Mobile ≤620px giữ nguyên phone-record rule (editors shown continuously).

Tests: `ShipmentCreateWorkspace.appointment-display.test.tsx` (C1–C4: nghỉ
hiển text + không `--persistent`; activate đưa focus vào editor; giá trị sau
nhập đọc được trong display lane; CSS contract editor ẩn mặc định + reveal,
không còn rule forced-frame). Sửa pin lạc hậu: `ClerkShipmentCreatePage.test.tsx`
(assert `--persistent` → assert display lane "09:30 20/08/2026"),
`invalid-required-paint.test.tsx` (bỏ nhánh `--persistent` chết trong helper).
Case: `testplan/2026-10-30-sil597-appointment-cell-value-first.md`.

## 2026-10-30 — fix(cus): SIL-595 (id 695) — drawer CUS render giờ hẹn đóng/trả theo ICT (GMT+7), không còn lệch 7 giờ

QA Glint: cột "Đóng / trả" và "Lịch cont" của drawer CUS (`CusLotView`) hiển
thị giờ hẹn lệch 7 giờ so với giá trị nhập (ví dụ nhập 14:30 → hiện "07:30").

Nguyên nhân: `formatTimeShortDate` cắt chuỗi naive trên regex không anchor —
khi `customerAppointmentAt` là instant (`toISOString()`, hậu tố Z), formatter
lấy thẳng chữ số UTC rồi ghép "ICT" nhãn, tạo ra giờ sai + nhãn sai.

Fix: formatter nhận diện zone suffix (Z/±HH:MM) → render wall-clock ICT,
không đổi fallback naive. Theo đúng pattern sẵn có
(`driver-trip-model.formatDateTime` đã instant-aware từ trước). Sweep audit:
các formatter naive còn lại đều được feeding giá trị naive hoặc convert trước
— class lỗi đóng tại shared owner.

Tests: `CusLotView.appointment-tz.test.tsx` (113 dòng) — 3 pin đỏ→xanh
(instant Z render ICT, naive fallback giữ nguyên, "Lịch cont" line đúng);
`shipment-operations.test.ts` +C2b (naive có giây giữ contract; offset '+0000'
vẫn là instant — review finding 4); scoped 8→9 green.
Case: `testplan/2026-10-30-sil595-drawer-appointment-utc.md`.
Review độc lập (code-reviewer 30/10): regex nhận diện zone mở rộng
`[+-]\\d{2}:?\\d{2}` (colon-less offsets) — fix forward trong commit này.
Provenance: formatter fix + tests land qua fleet salvage auto-commit `ca9dedd1`
(append-only); commit này mang attribution + review fix + UI evidence.

## 2026-10-30 — fix(cus): SIL-594 (id 694) — giá trị vừa lưu hiển thị ngay sau save + API transport no-store chống stale read-after-write

QA Glint (build c2d740c5): lưu ô SỐ TỜ KHAI trên /dispatch-detail xong ô vẫn
hiện giá trị cũ; chỉ khi tải lại trang / tìm kiếm lại mới thấy giá trị mới
(cùng họ triệu chứng với drawer Chi tiết container / xóa container — SIL-555).
Người dùng có thể tưởng lưu thất bại và lưu trùng.

Nguyên nhân (evidence 30/10 — local c2d740c5, chromium + webkit, dev + prod
bundle, backend cùng commit): backend write-commit-read hoàn toàn tươi (probe
API ngay sau write trả giá trị mới trên cả 3 endpoint); wiring FE đúng
(`onSaved` → `refresh` → refetch → setItems, requestId guard). Khe hở thật:
(a) ô hiển thị 100% từ row prop nên giá trị vừa lưu chỉ xuất hiện SAU refetch;
(b) transport GET không khai báo cache policy (`cache:'default'`, response
không Cache-Control) — refetch cùng URL sau write có thể bị browser session
cache (Safari/WebKit) hoặc proxy trung gian replay bytes cũ; đúng cơ chế
"reload/re-search là hết stale" (reload = revalidate, search = đổi cache key).

Fix (một nguồn sự thật — "giá trị vừa lưu là sự thật hiển thị"):

- **Transport** (`lib/api/client.ts`): mọi API request mang `cache: 'no-store'`.
- **Server** (`middleware/api-no-store.ts`, mount trên `/api`): mọi response
  API trả `Cache-Control: no-store` — chặn proxy/browser cache end-to-end.
- **Cell** (`DispatchDeclarationCell`): save-echo từ chính kết quả save server
  đã xác nhận — ô hiện giá trị vừa lưu NGAY, tự xóa khi row prop mang giá trị
  khác (refetch/external value luôn thắng); đổi row thì echo không rò sang.

Tests: `api.test.ts` pin `cache:'no-store'` + download GET ·
`DispatchDeclarationCell` 3 pin SIL-594 (hiện ngay sau save, clear → «Chưa có
tờ khai» ngay, server value thắng khi refetch land) + 3 lifecycle pins (C5
double-save race, C6 row-swap leak, C7 external wins) + contract update
assertion seed editor theo giá trị vừa lưu · BE unit `api-no-store` (header +
next + wiring scan mount trước mọi route). Red-at-base → green.
Review độc lập (code-reviewer 30/10, 6 findings): echo key cả 2 giá trị bị
thay (rapid re-save), guard echo theo rowKey chống leak sang row đổi, 3
lifecycle pins, wiring scan, download GETs no-store — tất cả fix forward trong
commit này.
Provenance: phần lớn code land qua fleet salvage auto-commit `ca9dedd1` +
fixture `c6853cce` (agent idle giữa các gate run — append-only, không rewrite);
commit này mang attribution ticket + review fixes + UI evidence.
Evidence: `qa/2026-10-30_sil594_*` (driver log + screenshots + API identity).

## 2026-10-28 — fix(cus): SIL-548 (id 615 QA-FAIL round 3) — editor «Sửa cước thu khách» prefill từ giá trị ĐÃ LƯU + khóa editor trên lô ĐÃ ghép

QA Glint (comment 2360, build 3b2c3bd8): BKS save PASS (không đụng). Hai lỗi:

1. **Prefill sai (regression)** — lưu Xe 5T + 1.600.000 thành công (row +
   /shipments-debit DOANH THU đúng) nhưng mở lại editor: ô giá TRỐNG (cả sau
   reload), cùng session còn hiện class CŨ (Xe 10T). Root cause: editor seed
   từ `row.revVehicleClassCode` (row cache cũ — cùng session chưa refetch) và
   giá nhập tay KHÔNG CÓ nguồn seed nào (`useState('')` cứng) — cả wire lẫn
   save-response đều không được đọc lại.
2. **Lô đã ghép vẫn sửa được** — K1K42452354 «Ghép (2/2)» mở editor sửa được
   toàn bộ, không hint tách nhóm. Root cause: lock đọc `revGroupId` trên row;
   wire Chi tiết lô hàng KHÔNG mang `costGroupId` nên lô ghép chiều TRẢ đọc
   như chưa ghép; unit pin cũ tiêm thẳng field vào fixture nên không bắt được.

Fix (một nguồn sự thật — "editor luôn seed từ dữ liệu đã lưu mới nhất"):

- **Wire** (`shipmentCusContainerFlatRowSchema` + `buildLotFlatRow`): row mang
  thêm `costGroupId` (nhóm ghép chiều trả) + `revFreightManual` (giá nhập tay
  ĐÃ LƯU — đọc qua kênh tiền settlement (`loadRevManualPriceByLot`,
  `revManualPrice` trong `lcl-effective-freight`): note vocabulary
  `isRevManualPriceNote` phân biệt giá nhập tay vs auto-trace; null = auto →
  ô giá trống «Bỏ trống = tự tra»). Assembly kênh snapshot TRÍCH từ debit
  summary vào `revenue-override-read.service` (`loadFreightSnapshotChannelByLot`)
  — 1 luật đọc dùng chung, không kênh song song.
- **Editor** (`LotRevFactsEditor`): seed class từ override-aware code + giá từ
  `revFreightManual`; save response (`freightManual`/`vehicleClassCode`) ghi
  vào self-healing map (luật plate editors) nên reopen CÙNG SESSION thấy giá
  trị vừa lưu; dirty = thay đổi so với seed (prefill không tự trang bị Lưu);
  xoá giá + Lưu = «Bỏ trống = tự tra» (gửi lại class hiện tại để BE tra lại).
- **Lock** (`revOutputGroupLock` — dùng chung Chi tiết + /shipments-debit
  strip): lô đã ghép BẤT KỲ chiều nào (rev «Ghép thu» hay cost «Ghép») →
  editor khóa + hint tách nhóm (Hủy ghép) trước.

Tests: `ShipmentContainerLedger.sil548-rev-facts` (fixture parse qua wire
schema thật + 4 pin mới: reopen cùng session, prefill sau reload, auto-trace
trống, clear-to-auto; case lock mở rộng cả 2 chiều nhóm) · `DebitLotLclFacts`
+1 pin cost-group · BE unit `sil548-rev-prefill-lock` (note vocabulary +
channel precedence + wire source pin) · pin `lcl-unmerge-revert-r39` theo
assembly đã trích. Regression: `testplan/2026-10-28-sil547-548-549-cus-gop-hang.md`
(REG-SIL548-REV-PREFILL, REG-SIL548-GROUP-LOCK).

Not covered: strip /shipments-debit giữ luật prefill riêng («giá bị tiêu khi
lưu») — chưa nối `revFreightManual` vào wire debit; UI DRIVEN rung 3 do QA
retest trên staging.

## 2026-10-28 — fix(driver): SIL-535 chặn mã chuyến lọt lên app lái xe (copy thông báo + tên tệp e-POD)

SIL-535 (ruling PRD ManHinhLaiXe §3.1, card 261022201006c): "Mã chuyến KHÔNG
hiển thị trên app lái xe — danh sách lẫn chi tiết lệnh… chuỗi mã thô
(`TRP-…`, `SHP-…`) không hiển thị. Field mã giữ nguyên ở DB và API payload."

`6a633ed6` (22/10) đã gỡ dòng "Mã chuyến" khỏi thẻ lệnh + lưới chi tiết và
`56f0a775` (27/10) xác minh thẻ lệnh sạch. Sweep toàn driver surface của lane
này tìm ra 2 KHE còn lại, cùng thuộc ruling (chuỗi mã thô lọt lên màn lái xe):

- **Khe A — copy thông báo (bell + /notifications)**: stripper cũ
  (\`/\\s*TRP-\\d{6}-\\d+\\s*/g\`) chỉ khớp shape chuẩn \`TRP-YYYYMM-NNNN\`.
  Backend ghép message thô từ \`trip.tripCode\` (\`trip-command.service.ts:62\`,
  \`dispatch-planning-utils.service.ts:471\`,
  \`adjustment-governance.service.ts:532,593\`), còn DB mang nhiều shape khác
  (audit 21/10 \`testplan/2026-10-21-req07-tripcode.md\`: \`TRP-YYYY-MM-NNNN\` từ
  \`seed-dashboard.ts\`, legacy \`TRP-C12-53-…\`, \`CN-…\`, \`BULK-TR-…\`) — shape
  nào không khớp regex lọt NGUYÊN VĂN vào copy driver đọc được.
- **Khe B — tên tệp e-POD**: \`backend/src/seed/seed-trips.ts:550\` đặt tên tệp seed
  = \`\${trip.tripCode}-\${fileType}\`; \`TripPodSubmission.tsx\` render
  \`file.originalFileName\` thẳng vào text + \`aria-label\` + \`alt\` + tên file tải
  xuống (\`link.download\`) → mã nội bộ lọt lên màn lái xe.

Fix: module mới \`frontend/src/lib/internalCode.ts\` — owner DUY NHẤT của "chuỗi này là
mã nội bộ" (nhận diện + strip mọi shape; \`CN-\` phân biệt mã với "Lô CN-09" trong
địa chỉ bằng nhóm dash-digit). Consumer: \`notificationText.ts\` (copy thông báo),
\`TripPodSubmission.tsx\` + \`DriverTripPodPage.tsx\` (tên tệp e-POD + toast).
UI-only — DB + API payload GIỮ NGUYÊN field mã; màn desktop/điều phối/kế toán
GIỮ NGUYÊN hiển thị mã (không đụng).

Gates: lint 0 lỗi · tsgo -b 0 lỗi · FE scoped 367/367 · FE full 5647 (25 fail
PRE-EXISTING ở \`ShipmentDebitPage*\` — lane SIL-538, đã verify KHÔNG LIÊN QUAN:
cùng 25 fail khi stash sạch trên \`origin/main\`) · \`make build\` EXIT=0.
UI DRIVEN @390px (rung 3, driver \`dvthuc\`, \`qa/2026-10-27_sil535-trpcode/\`):
\`/notifications\` + \`/my-trips/:id/pod\` before → FAIL (mã lộ) → after → PASS
(16/16 assertion, exit 0).

## 2026-10-24 — fix(lcl,dispatch): QA R39 residuals — FB-138 xe tải rule, FB-127 field order, FB-141 BKS clear, FB-145 unmerge rate revert

4 card QA R39 retest (231026162327 / 231026163927×3, testplan/cases/
case-QA-2026-10-23-fb1*.md; artifacts qa/2026-10-24-gomhang-r39/). Design
direction 24/10 (Gemini consult + Untitled UI PRO, chủ duyệt).

- **FB-138 dropdown Loại xe có Xe tải**: các lớp xe tải 1.25T…15T chỉ sống
  trong DEMO seeder dev/staging — staging prod-mirror (chạy migration) không
  có ⇒ dropdown chỉ 4 options Cont. Migration mới `20261024090000_lcl_truck_
  tonnage_classes.sql` hội tụ catalog (idempotent, cùng pattern card58). Dropdown
  Loại xe (ĐV Gán xe nhóm · CUS Gộp xe thu khách · strip per-lot) render
  grouped menu 2 section header "XE TẢI (TẤN)" / "CONTAINER" (RAC ListBoxSection,
  KHÔNG segmented). Đang giữ Đội xe nội bộ mà đổi sang lớp xe tải ⇒ reset nhà xe
  + warning dưới field (không giữ ID mồ côi).
- **FB-127 Số Bill/Booking TRƯỚC Hình thức XNK** (TIEPVU-21, thắng card
  261023093200): "Nhận diện lô" chia 2 cụm divider — "Chứng từ & định danh"
  (Khách hàng · Bill/Booking · Hãng tàu · tờ khai) / "Phân loại nghiệp vụ"
  (Hình thức XNK · Tuỳ chọn). Gate blNumber XOR bookingRef giữ nguyên. Rule
  ghi docs/prd/TaoMoiLoHang.md: thứ tự field chốt theo luồng chứng từ giấy,
  đổi cần approval Lead Ops.
- **FB-141 BKS báo khách để trống = hợp lệ**: schema cho ''/null qua (service
  normalize `|| null` — clear ⇒ fallback BKS thực); FE gửi null khi trống,
  placeholder ghost = BKS thực, hint "Mặc định dùng BKS thực tế nếu để trống".
  Sweep sibling: Phân bổ nhà xe (ĐV) clear BKS ảo giờ cũng gửi null.
- **FB-145 Tách nhóm hoàn cước per-lot**: BE gỡ `revVehicleClassId` của nhóm
  khỏi mọi lô khi tách CẢ NHÓM (flow Tách nhóm CUS; survivor unmerge-theo-lô
  giữ luật C-1) + response trả `vehicleClassId` cho nút [Hoàn tác]. Read rule
  gom về MỘT pure helper `lcl-effective-freight.ts`: citation nhóm
  ("chờ định giá lại", member-zero tail) trên lô ĐÃ TÁCH đọc "Chưa xác định",
  không bao giờ in 0₫ stale (cả debit summary lẫn chốt-debit Kế toán). FE:
  invalidate + skeleton cell cước tới khi bảng mới về; toast "Đã tách nhóm
  cước thành công" + [Hoàn tác] sống ~6.5s re-merge đúng thứ tự + loại xe.

Gates: BE unit 338 pass (`lcl-unmerge-revert-r39.test.ts` mới — pure rule +
wire + source pins), FE full 5542 pass, tsc BE/FE 0, lint 0, `make build` OK,
Playwright before/after 2 phase 0 fail (rung 3, artifacts kèm folder).

GP-03 sweep (audit £100, 24/10 chiều): **xóa ô "BKS báo khách (ảo)" khỏi
dialog "Phân bổ nhà xe" của ĐV** (spec 23/10 §1 — violation sót sau khi
exclusion zone master-plan hết hiệu lực): payload ĐV giờ chỉ
`{shipmentId, actualTruckNo}`; billing của CUS giữ nguyên qua lần write ĐV
("omitted ⇒ untouched"). Test absence theo pattern AssignTruckGroupDialog +
rung-3 driver `qa/scripts/2026-10-24-gp03-sweep.mjs` (0 fail). Auto-copy
ảo↔thực phía ĐV bỏ hẳn (auto-copy logic chỉ còn ý nghĩa phía CUS).

## 2026-10-23 (chiều 2) — fix(lcl,dispatch): gomhang hygiene — CUS bar tấn/CBM, tag gọn, dọn BKS ảo sót, 400-path UI, card status/touch polish

Các dòng còn lại sau wave 60d0c576 (testplan/2026-10-23-gomhang-polish.md,
GP-01…GP-06). Không đụng `pages/MasterPlanPage*` + `features/dispatch/
master-plan/*` (lane khác sở hữu).

- **GP-01 CUS bar mang tổng tấn/CBM như bar ĐV**: wire `shipment-debit-summary`
  thêm `cargoWeightKg`/`cargoVolumeCbm` (shared schema + BE read-side, cùng cột
  dispatch grids đọc); bar CUS nay in «Đang chọn N lô: Tổng X tấn | Y CBM —
  Lô 1 giữ 100%…» — thành phần không lô nào có số liệu thì BỎ khỏi câu (không
  bịa 0). Đóng deviation (a) của wave trước.
- **GP-02 tag "Ghép thu cước cùng Lô 1" gọn**: `shipment-debit-row__freight-note`
  (desktop row + phone card) 1 dòng, truncate + `title` = toàn văn — nghĩa theo
  wire giữ nguyên (không đổi text); strip NHÓM GHÉP (`debit-lot-lcl-facts__groups
  em` "Ghép cùng Bill X") cùng luật 1 dòng + tooltip.
- **GP-03 hết "BKS báo khách" trong dialog ĐV**: bỏ ô + state + auto-copy +
  `billingTruckNo` khỏi payload ở `LclGroupTruckEditDialog` (Đổi BKS nhóm) và
  inline edit badge menu/row menu `DetailedPlanGrid` («Đổi nhà xe/BKS») — chỉ
  còn BKS thực; validation «sửa BKS thực trước khi lưu». Grep toàn
  `features/dispatch`: các hit còn lại là comment luật (AssignTruckGroupDialog)
  hoặc read-only display (`LclGroupTruckLine` "Ảo:", tooltip badge "Báo khách
  X" — spec §1 cấm NHẬP ở ĐV, không cấm hiển thị); `DispatchAllocationLclDialog`
  (master-plan) còn ô BKS báo khách — để lane đó sửa (out of scope).
- **GP-04 đường server-error gộp CUS khác-KH không im lặng**: gate cùng-KH siết
  đúng luật BE (1 customerId KHÁC NULL duy nhất — lô `customerId` null cũng là
  conflict như `findRevCustomerConflict`, chặn TRƯỚC khi gọi API — guard nằm ở
  CẢ `submit()` lẫn `isDisabled`, hết double-click race); BE 400 → inline
  `role=alert` + error toast (footer line một mình trôi khỏi viewport phone),
  dialog giữ nguyên cho retry.
- **GP-05 card mobile status badge**: chip trạng thái 1 dòng (max-width 42% +
  ellipsis, table giữ wrap cũ qua element-level rule), `title` = nhãn đầy đủ
  (StatusText thêm prop `title`), giữ ≥8px tới nút ⋯ (badge co trước).
- **GP-06 touch target ⋯/tick ≥44px mọi card**: trigger ⋯ `min-width/min-height:
  44px` + `flex-shrink: 0` + wrapper `flex: none` (token `--control-touch-h`
  đang 40px — sàn 44px riêng cho tap target trên card); tick = button 44px, hộp
  vẽ 18px chuyển sang `::before` — gồm compact merge-mode head (đầu card thêm
  tick) và tick FCL dim.
- QA rung 3 (`qa/2026-10-23-gomhang-polish/`, driver `qa/scripts/
  2026-10-23-gomhang-polish.mjs`, 390px, READ-ONLY — DB groups trước/sau
  identity): GP-01 bar đúng số liệu wire («Tổng 2,214 tấn | 9,002 CBM» từ lô
  106+107), GP-05 badge gap 8px/1 dòng/title + ⋯ 44×44, GP-06 tick 44×44 cả
  enabled lẫn dim. Gates: root lint 0 · be tsc 0 · be tests · fe tsc -b 0 ·
  fe tsgo -b 0 · FULL FE green (sau `make build`) · make build 0.

## 2026-10-23 (chiều) — feat(lcl,dispatch): FE gộp hàng on-demand — toggle+checkbox+floating bar + popup ĐV 4 trường + CUS gộp thu 3 trường (spec 23/10, cards 231026123901/902/903)

Wave FE của spec 23/10 (BE đã live 71f1468b) — phủ lên nền grid redesign
23/10 (cards <640px + table min-width), không phá layout mới.

- **Card 231026123901 — UI on-demand**: cột CHỌN mặc định ẨN trên cả ĐV (Kế
  hoạch Tổng quát + Chi tiết Xe) và CUS (Chi phí – Quyết toán); nút
  `[📦 Gộp hàng]` (secondary/outline, `LclMergeModeToggle` house token) trên
  thanh Filter bật mode — nút đổi `✕ Thoát gộp hàng`, hiện cột CHỌN đầu bảng
  (ĐV: chỉ dòng LCL tick được, dòng FCL dim/disable; CUS: mọi dòng tick được
  vì tick phục vụ cả xuất Debit Note — gộp vẫn chỉ tính LCL chưa nhóm).
  Floating bar cố định đáy màn hình (`styles/lcl-merge.css` — 1 stylesheet
  dùng chung 3 mặt): ĐV «Đang chọn N lô: Tổng X tấn | Y CBM — Lô 1 giữ 100%
  cước trả ĐV», CUS «Đang chọn N lô — Lô 1 giữ 100% tiền thu khách» (wire
  quyết toán không mang kg/CBM). Thoát/hoàn tất gộp ⇒ tự ẩn cột + clear
  selection. Mobile 390: tick trên card list + bar fixed.
- **Card 231026123902 — popup Gán xe nhóm ĐV đúng 4 trường**: xóa trường
  «BKS báo khách (ảo)» chung LẪN cụm per-lô (state + auto-copy + wire
  `billingTruckNo`/`billingTruckNos` khỏi client); label cước đổi
  «Cước trả ĐVVC (đ)» (blank = auto tra bảng giá trả). Sau lưu: chip
  «Lẻ · Ghép (i/N)» trên row/card; lô đã nhóm bị khóa tick.
- **Card 231026123903 — CUS thu khách**: per-lot (mặc định, expanded lot)
  đủ 3 outputs — Loại xe thu khách · Giá cước thu khách nhập tay
  (`setLclLotRevClass` nhận `freightRevenue`, gửi đúng output đổi) · BKS báo
  khách (có sẵn, blank = BKS thực). Gộp chủ động: CTA «Gộp xe thu khách» dời
  từ header xuống floating bar, popup 3 trường (Loại xe thu nhóm · BKS báo
  khách chung blank=BKS thực · Cước thu Lô 1 blank=auto qua
  `mergeLclRevGroup.freightRevenue`); validation cùng KH giữ (FE chặn rõ,
  BE 400); lưu rev_group độc lập cost_group — Lô 1 100% thu / lô kia 0₫, tag
  ghép dưới CƯỚC VẬN TẢI (BE in dạng "Ghép cước cùng Bill {Lô 1}") + nút
  «Tách nhóm» trên dòng đã gộp; tách nhóm money-neutral restore; copy
  confirm/toast theo luật 100/0 mới.
- QA rung 3 (`qa/2026-10-23-gomhang-fe/`, driver `qa/scripts/
  2026-10-23-gomhang-fe.mjs`): BEFORE (:7175) chốt defect cũ (checkbox luôn
  hiện, popup còn BKS ảo, 75 tick CUS luôn mở) — AFTER (:7183) 41/41 PASS,
  DB trước/sau identity (nhóm cost+rev đều tạo → tách hết, FINAL null).
  Gates: root lint 0 · fe tsc -b 0 · fe tsgo -b 0 · scoped vitest + FULL FE
  green (sau `make build`) · make build 0. Case testplan/2026-10-23-gomhang-fe.md.

## 2026-10-23 — feat(lcl): BE gộp hàng tách biệt cost_group (ĐV) vs rev_group (CUS) + per-lot CUS outputs (spec 23/10, card 261023110000)

Spec khách 23/10 "Điều chỉnh luồng Gộp hàng lẻ" — CHỈ BE (shared contracts/
services/routes/tests); FE grid là wave sau. Luật tiền mới: **ruling 21/10 (thu
per-lot đơn giá×SL) vẫn là DEFAULT** (mỗi lô = 1 chuyến riêng); **100/0 CHỈ
trong nhóm CUS gộp chủ động** (Lô 1 = 100% cước thu nhóm, Lô 2..N = 0₫ + tag
"Ghép thu cước cùng Lô 1" — field/tag trên API). ĐV giữ luật 1 dòng/chuyến
(Lô 1 = 100% cước trả ĐVVC, members 0₫).

- **Tách nhóm 2 chiều**: `costGroupMemberPatch`/`revGroupMemberPatch`
  (`lcl-grouping-law.ts`, pure) chốt cột 2 chiều không bao giờ rò sang nhau —
  gộp ĐV không kéo CUS và ngược lại. Schema cũ giữ nguyên, không phá dữ liệu.
- **ĐV popup đúng 4 trường + THÊM/SỬA**: `assignLclCostGroupSchema` xóa
  `billingTruckNo`/`billingTruckNos` (BKS-báo-khách-ảo là concept CUS — giữ ở
  CUS per-lot + rev group); endpoint mới `POST /api/shipments/lcl/cost-group/
  update` sửa 4 trường của nhóm đã gán — PARTIAL update thật (bỏ trống = GIỮ
  Nhà xe/biểu giá hiện tại; `freightCost` 3-state: số = nhập tay, null = blank
  auto-trace bảng giá trả nhà xe, bỏ qua = giữ nguyên tiền). Nhập tay "Cước
  trả ĐVVC" sống tới phát lệnh qua cột mới
  `shipments.cost_group_freight_manual` (migration additive nullable, không
  backfill) — trước đây giá trị rơi rụng vì assign xảy ra trước khi có
  trip. FB-095 promote chuyển manual theo vương miện như cước trả.
- **CUS per-lot outputs** (`POST /lcl/rev-class`): Loại xe thu (optional) +
  Giá cước thu `freightRevenue` (auto tra bảng giá theo loại + ngày; nhập tay
  = override thắng auto). BKS báo khách per-lot qua `/lcl/truck` với
  `billingTruckNo: null` = xóa (BLANK).
- **BKS fallback (BLANK ⇒ BKS thực ĐV đã gán, in Debit Note)** —
  `effectiveBillingPlate` (shared, LCL only; non-LCL giữ GAP-3 không in BKS
  thực): áp ở draft render + freeze Debit (vật hóa BKS reported vào frozen lot
  lúc freeze — doc mới). Doc đã xuất từ trước giữ nguyên luật render cũ (không
  retroactive đổi nội dung khách đã nhận).
- **Gộp CUS (rev_group)**: validation cùng KH về pure law
  (`assertSameRevCustomer`, 400 liệt kê đủ lô + KH); nhận Loại xe thu nhóm +
  BKS báo khách chung (blank = giữ per-lot, không copy BKS thực) + Cước thu
  Lô 1 `freightRevenue` (blank=auto, nhập tay=override); 100/0 + tag
  `LCL_REV_MERGE_TAG` = stamp + field `revMergeTag` trên wire. Tách nhóm rev
  group = luật FB-093 (100/0-era): cả nhóm ⇒ tiền về pre-merge; Lô 1 rời ⇒
  chuyển 100% cho Lô kế; 1 thành viên về riêng ⇒ giữ cước + lý do chờ định
  giá lại (`restoreRevPreMergeMoney`/`restateRevLeaverMoney` thay
  `keepRevPerLotMoney` của luật 21/10 merge path). "Trạng thái trước ghép"
  là capture riêng `trip_financial_state.revenue_pre_group(_captured)`
  (migration additive) — không dùng `revenue_original` first-override (đi lệch
  qua các lớp override; NULL trước ghép ⇒ khôi phục NULL, không bịa 0₫).
- Tests BE unit-only: `lcl-gop-hang-split-law.test.ts` (độc lập 2 nhóm,
  validation cùng KH, BKS fallback, wire contract) + `lcl-gop-hang-money-
  wiring.test.ts` (100/0 từng nhóm, auto vs override, tách nhóm) — thay
  `lcl-rev-perlot-money-wiring.test.ts` (pin luật 21/10 cho merge path nay bị
  spec supersede). Gates: be-tsc 0 · BE 428 unit + 338 pass · root lint 0 ·
  fe tsc -b 0 · make build 0.

## 2026-10-22 (tối) — fix(cus,driver): filter ngày đúng VN timezone + bỏ mã chuyến màn lái xe (TiepVu 22/10, cards 261022201006b/c)

TiepVu 22/10 tối: (b) lọc theo ngày trên CUS vẫn trả lô ngày khác; (c) app
lái xe bỏ hiển thị mã chuyến (REQ-07 cũ) — UI-only, GIỮ field DB/API.

- **Card 261022201006b — filter ngày leak (2 root cause, repro-first)**:
  probe 3 ngày liền + biên 00:00/23:59 VN (`qa/scripts/2026-10-22-tiepvu-filter-boundary-probe.mjs`)
  bắt được đúng 2 lỗi so sánh ngày:
  1. **EDD arm vô điều kiện** — lot-level filter OR `expectedDeliveryDate`
     giữa khoảng KHÔNG kèm điều kiện fallback, nên lô đã dời lịch cont sang
     ngày khác vẫn lọt về ngày EDD cũ ("lọc ngày A vẫn trả lô ngày khác" —
     fixture lot Z: EDD day1, cont dời day3). Fix: `shipmentTransportDateCondition`
     (cus-workspace-sql.service) — nguồn sự thật duy nhất cho cả Tổng quan CUS
     và master-plan `deliveryDateFrom/To`: ngày của lô = union ngày
     `coalesce(appointment VN, EDD)` của từng cont; EDD cấp lô chỉ là ngày của
     lô KHÔNG CÓ cont nào. Trùng luật với Chi tiết (containerDayTriageCondition).
  2. **UTC window cho cột timestamptz** — `GET /shipments?dateFrom&dateTo`
     (customsCutoffAt) so với `new Date('YYYY-MM-DD')` = cửa sổ UTC: rớt lô
     00:00–06:59 VN của ngày lọc, lọt lô 00:00–06:59 VN của ngày KỀ SAU
     (biên 23:59/00:00 VN). Fix: `businessZoneDayStartInstant` /
     `businessZoneDayEndInstant` (container-date-filter.ts) — cửa sổ ngày
     Asia/Ho_Chi_Minh 00:00:00.000–23:59:59.999.
  FE param format đã đúng `YYYY-MM-DD` (schema `z.string().date()` + test) —
  không đổi FE cho card này. Test: 2 file unit mới (biên 3 ngày + SQL contract
  của điều kiện lọc). Evidence: probe trước fix 8/13 (đúng 5 dòng leak) → sau
  fix 13/13; UI drive Tổng quan CUS 7/7 (rung 3, screenshots + DB proof).
- **Card 261022201006c — bỏ mã chuyến màn lái xe**: ẩn mã chuyến khỏi
  `/my-trips` (journey card), chi tiết `/my-trips/:id` (fact "Mã chuyến") và
  sweep `/my-penalties` (meta vi phạm). `tripCode` GIỮ nguyên trên wire + DB
  (board matching trong DriverTripDetailPage không đổi). REQ-07 formatter
  `driverTripCodeLabel` thành dead code — xóa cùng tests; tests liên quan
  (DriverTripsPage, DriverTripDetailPage, DriverTaskInfoSections,
  DriverPenaltyPage, driver-display) update theo luật mới (assert vắng mặt).
  Evidence UI drive 13/13 (rung 3: screenshots list/detail/penalties + DB/API
  contract proof `trips.trip_code` còn nguyên).
- **Gates**: root lint 0 · BE tsc 0 · BE tests 338/338 · FE tsgo 0 + `tsc -b` 0
  · FULL FE 710 files/5473 tests (sau `vite build` — numeric-identity cần dist)
  · `make build` OK. Trùng scope card 261022201006a (tờ khai) với lane
  `fix-cus-tokhai-cont` đang chạy — card a không thuộc changeset này.

## 2026-10-22 — fix(lcl): Kho lấy hàng (CFS/Cảng) list từ danh mục chung, không lọc theo khách (card 261022093245)

Zalo khách 22/10 09:31: form tạo lô hàng lẻ, ô bắt buộc "Kho lấy hàng
(CFS/Cảng)\*" chỉ list kho gán cho KHÁCH HÀNG của lô — KH chưa có kho thấy
"Chưa có kho cho khách hàng này", buộc bấm "+ Thêm kho". Nguyên tắc khách:
kho CFS/đóng ghép trả hàng là hạ tầng DÙNG CHUNG — phải hiện từ danh mục
kho/cảng chung (active), KHÔNG cần gán khách; chọn xong lưu như bây giờ.

- **BE**: `GET /api/shipments/operational-sites` nhận thêm `?scope=shared` —
  danh mục kho active MỌI khách (`listSharedWarehouseSitesForIntake`, same
  intake roles + ACCOUNTANT giảm projection); `?customerId=<id>` giữ nguyên
  hành vi cũ; thiếu cả hai hoặc scope lạ → 400 như cũ (pure resolver
  `resolveOperationalSitesListQuery`, unit tests 4 case). Bỏ 2 guard
  customer-scope đang chặn kho thuộc khách khác: `loadSiteSnapshot`
  (shipment-fulfillment — chạy trong quick-create) và validate điểm LCL khi
  submit dispatch (shipment-intake): nhà máy GIỮ customer-scope, kho chỉ cần
  WAREHOUSE + active + live.
- **FE**: dropdown Kho (CFS/Cảng) trên `ShipmentCreateLclRouteSection` đọc
  danh mục chung (`listSharedWarehouseSites`, load on mount + refetch khi tạo
  kho, optimistic merge sau "+ Thêm kho"); payload label resolution qua union
  customer-sites + shared catalog (kéo location đúng cho kho thuộc khách
  khác); hint reword "Chưa có kho trong danh mục" — chỉ khi danh mục chung
  rỗng; nút "+ Thêm kho" giữ nguyên, không còn là cách duy nhất.
- **QA (LOCAL, rung 3)**: KH 25282 (0 kho riêng) — BEFORE (trunk 839d0577):
  dropdown 0 option + hint cũ; AFTER: 13 kho active của 5 khách, tạo lô thật
  với kho chung "ICD Hà Nội" (site 442, khách 4) → shipment 312533 /
  SHP-2610-19366, `pickup_warehouse_site_id=442`, pickup/delivery location giải
  đúng label. Regression case
  `testplan/cases/case-QA-2026-10-22-lcl-kho-chung.md`; evidence
  `qa/2026-10-22-lcl-kho-chung/` (API before/after + UI driver + screenshots).

## 2026-10-21 — fix(accounting): FIX CHI PHÍ lần 2 (spec 19/10) — verify 9 mục + money-format sweep

Verify-first trên build `56a5d509` (spec `19.10 - FIX CHI PHÍ.docx` + 3 mục §c
theo PRD `PhanHeKeToan.md` dòng 107/109/113 — QA brief 21/10). **8/9 mục đã
đúng trên build hiện tại** (ảnh Ops tùy chọn; 2 tab "Tiền đường | Chi phí lô
hàng"; BÁO CÁO THU/TRẢ PHƠI + phiếu thu/chi + drawer lô chưa thanh toán; chốt
debit cột/✓/tick theo Ngày; Xuất Debit Note E2E — bug gốc idempotency-key >100
ký tự đã land trước; PHÊ DUYỆT TẠM ỨNG = giải ngân với khớp số tuyệt đối
fund-book ↔ báo cáo hoàn ứng 2/2 thời điểm; hoàn ứng ÂM có cảnh báo thu lại;
phiếu Ops hiện ngay phía kế toán). **1 mục thiếu → fix**: "TOÀN BỘ trường số
tiền định dạng 1,000,000".

- **FE money-format sweep lan 2** (spec mục 2): 23 ô tiền trên ~20 màn trở
  thành `NumberField grouped` (+`signed` nơi FB-100 cho số âm — Thực chi,
  hoàn lại, điều chỉnh, fuel): ops tạm ứng (modal + panel), treasury số dư
  đầu kỳ, expense create/entry/cash, driver correction + fuel, timesheet lương
  (2 màn), shipment-finance (hóa đơn/phí NCC/cược/đã hoàn), debit-note freight
  override + ngưỡng VNĐ/lít, forwarder expense mua/bán + hoàn lại, tire giá,
  salary payout, app-settings (ngưỡng hạn mức, phụ phí kẹp/kết hợp), penalty
  khấu trừ + mức mặc định, payable payment + hoa hồng, debt nhận tiền, trip
  điều chỉnh, carrier/pricing/fuel config, billing-builder mirrors. Ô đơn giá
  VND/lít `step 0.01` giữ nguyên (grouped bỏ decimal — ghi trong qa README).
- **tabular-nums** (cùng mục): shared money primitives (`.money`, `.num`,
  `.record-table .num`, `.ds-field--money input`) khai
  `font-variant-numeric: tabular-nums`; `font-family-contract.test` nới đúng
  4 file này. Đo fontTools: Be Vietnam Pro (bundle v1.002 + Google v12) digits
  proportional, không `tnum` ⇒ declaration inert tới khi owner đổi typeface
  (tiền lệ = 2 trang debit đã ship từ trước).
- **Review độc lập R1** (code-reviewer, REQUEST_CHANGES → đã xử lý): 2 ô
  per-liter decimal (giá dầu gốc, ngưỡng VNĐ/lít — `numeric(12,4)`) GIỮ RAW
  theo đúng rule decimal; refund field bỏ className wrapper gây double chrome
  (verify UI 1440); treasury số dư đầu kỳ +`signed` (schema signed); nits
  (indent, placeholder ví dụ grouped, comment test).
- **BÁO CÁO THU/TRẢ PHƠI**: heading thêm khoảng ngày "— Ngày … – …" theo
  mockup (2.2).
- **Test pins**: `money-format-sweep.chiphi2` CP2-M1..M6; report-section
  heading; các behavioral pin cũ chuyển sang giá trị grouped ('300.000',
  '950.000', '-250.000'…). dev-port contract: comment ví dụ trong
  `2026-10-21-lcl01-lan2-repro.mjs` 3016→3002 (file lane khác, chỉ doc).
- Evidence + coverage §9: `qa/2026-10-21-accounting-fix2/` (UI DRIVEN items
  3/4/5/6/8, DB/API item 7/9, live-typing item 2 — "1234500 → 1.234.500").
  Regression case: `testplan/2026-10-21-accounting-fix2-chiphi-lan2.md`.

## 2026-10-21 — fix(dieuvan): FB-095 — nút "Xóa lô" cho lô chính trên /dispatch-detail (card 211026005623)

Verdict **(a) nút thiếu thật**: surface Điều vận (`/dispatch-detail` →
DetailedPlanGrid, nơi có badge "Lẻ · Ghép (i/N)" + "Tách nhóm") không có
affordance xóa lô cho bất kỳ role nào — nút xóa chỉ sống ở drawer `/shipments`
và header `/shipments/:id` (cùng `canDeleteLot = CUS || ADMIN`). Không tồn
tại gate "phải giải tán nhóm trước" (giả thuyết verdict (b) bị phủ định —
FB095-06: xóa Lô chính khi nhóm còn member là hợp lệ, promote-on-delete).

- **FE** `DetailedPlanGrid`: row action "Xóa lô" (cụm Ghi chú, style danger)
  raised qua prop `onDeleteLot`; `DispatchDetailPlanPage`: flow xóa existing
  (shared `ShipmentActionModal` confirm + lý do bắt buộc → `deleteCusShipment`
  → `DELETE /api/shipments/cus-workspace/:id`) + notice FB-095 trên confirm
  (xóa Lô chính ⇒ chuyển 100% cước trả ĐV cho lô kế tiếp; nhóm 2 lô giải
  tán; xóa thành viên ⇒ Lô 1 giữ cước, survivors renumber).
- **Role law KHÔNG nới** (`requestShipmentDelete` vẫn "Chỉ CUS hoặc Quản trị
  viên" — cards 351/352 + 20261007_396/204710): DISPATCHER/MANAGER bấm nút →
  banner nguyên văn luật service, không dialog, không API (card 20260923_1 —
  affordance trả lời bằng lý do). Guards nhóm LCL giữ nguyên server-side
  (`promoteLclGroupsOnShipmentDelete`/`assertGroupMutable` — BE không đổi).

Evidence: `qa/2026-10-21-fb095/` (UI DRIVEN rung 3 local — 26/26 PASS exit 0:
ui-01-before/ui-02-confirm/ui-03-after/ui-04-grid-after/ui-05-dieuvan-role-law/
ui-06-w390-768-1440 PNG + db-after.json + driver log), driver
`testplan/qa/scripts/fb095-dieuvan-delete-lot-20261021.mjs`, testplan
`2026-10-21-fb095-dieuvan-delete-lot.md` (FB095-UI-05..07). DB proof: host
soft-deleted, survivor `cost_group_id` null (dissolve), audit
SHIPMENT_DELETED + SHIPMENT_LCL_GROUP_UNMERGED (cause DELETE, dissolved).

## 2026-10-20 — fix(ui): FB-045 lan 2 — dialog "Chi tiết container" hết clip cột GIỜ HẸN ở mọi viewport + lối vào (card 202610140000)

Fix lần 1 (bb394516) chỉ floored header cột giờ hẹn của drawer `/dispatch`;
QA R27 vẫn FAIL vì 2 clip channel còn sống:

- `/dispatch` drawer: port `<select>` Nâng/Hạ (min-width 140px) tràn khỏi auto
  slice 114–127px, đè lên VALUE "HH:mm DD/MM/YYYY" ("0 24/09/2037") ở cả 4
  viewport. Fix: cột Nâng/Hạ own `150px` + select `132px`, table min-width
  960px, value pin nowrap — control hàng xóm không còn tràn.
- `/shipments` drawer (`CusContainerLedger`): add-row segmented giờ hẹn input
  bị cột 15% bóp + nút Thêm/Hủy từ cột Thao tác 4% (~46px) tràn đè lên
  "DD/MM/YYYY". Fix: thay doctrine "percentage sum 100%, no scroll" (bị brief
  lan 2 supersede — contract test cập nhật theo) bằng px floor theo content:
  giờ hẹn `164px`, Thao tác `116px`, table min-width `1110px` + scroll-x band
  sẵn có ("scroll-x hợp lý", không chật cứng); value trigger nowrap + ellipsis.

Evidence: `qa/2026-10-20-fb045-lan2/` (before/after/stg-before logs + PNG 4
viewport × 2 drawer), testplan `2026-10-20-fb045-lan2-gio-hen-clip.md`. Staging
(build 106a25e3 pre-fix) tái hiện channel Thêm/Hủy tràn tại 1280/1440/1920;
staging re-drive sau deploy ≥ fix còn nợ. Pins: DispatchContainerDetailDrawer
.styles.test.ts + ShipmentsPage.density.test.ts (px-floor contract).

## 2026-10-17 (chiều) — fix(fb-107): portal Chi tiết lô 2 dòng Nâng/Hạ hết '—'

Card 171026115820 (P2) — phần portal còn lại của FB-107: `/portal/shipments/:id`
vẫn bind 2 cột dormant `pickup_location`/`delivery_location` → 2 dòng trống với
lô FCL và lô tạo trước FB-105 (trang nội bộ đã đổi nhãn Nâng/Hạ ở đợt 17/10).

- **BE** `toCustomerShipmentDetail` chiếu tiếp fact đã có của
  `getShipmentDetail` (cargoMode, tradeDirection, tên kho CFS, nhà máy hiệu lực,
  tên cảng nâng/hạ từng container) — hiển thị, không migration.
- **FE portal** dùng chung luật `resolveLiftDropPoints` như trang nội bộ
  (`PortalShipmentDetailPage.tsx`).
- **Pin:** `PortalShipmentDetailPage.lift-drop.test.tsx` (mới — nhãn + 3 ca
  binding). Test BE projection `shipment-detail-lift-drop-projection.test.ts`
  **không reintroduce** — owner ruling unit-only (`da4d2f0b`).
- Testplan: `testplan/2026-10-17-card-fb107-nang-ha.md`; staging rung
  `qa/2026-10-17_card171026115820_fb107_staging-driver.log` (4/4 PASS).

## 2026-10-18 — LCL spec 18/10: Gán xe nhóm trên /dispatch, BKS báo khách từng lô, Tách nhóm

Nguồn: `181026145000-yeu-cau-tinh-nang-gan-xe-nhom-hang-le.docx` (Gán xe nhóm
hàng lẻ — Điều vận & Ghép cước). Phần lõi (schema, bảng giá, nhảy tiền
100%/0₫, debit note BKS ảo) đã có; wave này đóng các khoảng UI còn thiếu so
với đặc tả 18/10.

- **FE /dispatch — chọn nhiều lô lẻ + "Gán xe nhóm"** (spec §2.1–2.2):
  `MasterPlanGrid` có cột checkbox đầu dòng cho lô LCL (lô đã ghép bị khóa,
  kèm lý do; FCL không có checkbox). Thanh chọn sticky hiển thị
  "Đang chọn N lô: Tổng X kg | Y CBM", dòng "Lô 1 giữ 100% tiền trả nhà xe"
  kèm Số Bill/Booking của Lô 1, nút "Gán xe nhóm" mở đúng popup của Kế hoạch
  Chi tiết Xe (nút <2 lô aria-disabled + lý do là chữ thật).
- **FE popup — BKS báo khách từng lô** (spec §2.3 trường 3): ngoài ô BKS chung,
  mỗi lô trong nhóm có ô combobox/gõ tay riêng; bỏ trống = dùng BKS chung.
  `AssignTruckGroupDialog` nhận một row contract chuẩn hóa
  (`lclGroupRowFromDetail` / `lclGroupRowFromMasterPlan`) nên cả hai bảng
  Kế hoạch dùng chung một popup.
- **BE — `billingTruckNos`** (`assignLclCostGroupSchema`): mảng
  `{ shipmentId, billingTruckNo }` ghi đè BKS chung cho từng thành viên; entry
  trỏ ra ngoài `shipmentIds` bị từ chối 400 trước mọi ghi.
- **FE Kế hoạch Chi tiết Xe — Tách nhóm** (spec §4): nút "Tách nhóm" cạnh tag
  `Lẻ · Ghép (1/N)` trên dòng Lô 1, xác nhận rồi gọi
  `POST /api/shipments/lcl/unmerge-group` (COST), toast kết quả + refresh lưới.
  Hủy ghép từng lô ở màn Chi phí – Quyết toán giữ nguyên.
- Regression: `MasterPlanPage.lcl-grouping.test.tsx` (checkbox LCL/khóa nhóm,
  tổng kg/CBM, mở popup), `MasterPlanGrid.test.tsx` (cột chọn),
  `AssignTruckGroupDialog.test.tsx` (payload `billingTruckNos`),
  `DetailedPlanGrid.lcl-grouping.test.tsx` (một nút Tách nhóm trên Lô 1),
  `backend/src/tests/lcl-grouping.test.ts` (BKS từng lô + từ chối lô ngoài nhóm).

## 2026-10-17 (tối) — FB-114 verify-fail: hãng tàu mới lưu vào danh mục chung trên server

Nguồn: ticket 171026185348 (verify-fail của 171026122150): fix trước chỉ đổi
label + lưu local form — hãng tàu vẫn mất khỏi dropdown sau reload với mọi
người dùng. Yêu cầu thật: tạo record server-side (danh mục chung).

- **BE** — `POST /api/shipments/shipping-lines` (mount `shipments` → casbin
  `shipments:write`, `requireRoles(SHIPMENT_INTAKE_MUTATION_ROLES)` như
  operational-sites): validate trim/non-empty/≤255, dedupe theo TÊN HIỂN THỊ
  (`shortName || name`, trim + case-insensitive — cùng identity với
  derivation `config.service.ts`, nay trim at read), tạo supplier
  `types ['SHIPPING_LINE']`, bust cache `catalogs:bootstrap`. 201 khi tạo;
  200 idempotent khi tên đã là default (echo casing canonical) hoặc đã là hãng
  tàu ACTIVE (không tạo bản sao — verify bằng đếm row theo display name);
  409 khi tên đang thuộc nhà cung cấp khác loại/INACTIVE; 400 validate.
  Race window đóng bằng `lockApplicationOwnedUniqueness` trên display name
  (advisory lock theo pattern application-owned-uniqueness) — select-then-insert
  serialize theo tên. Audit `ENTITY_CREATED` + entityId/Key của supplier mới,
  declareNonMaterialWrite. Role list single-source: `SHIPMENT_INTAKE_MUTATION_ROLES`
  chuyển lên `@tingting/shared` (pattern `FINANCIAL_ROLES`), routes + service
  cùng import — hết drift.
- **FE** — `applyShippingLine` gọi API TRƯỚC, sau đó mới ghi
  `form.shippingLineName` + merge catalog local (`mergeShippingLine`,
  dedupe case-insensitive) + đóng dialog. Persist fail → dialog giữ nguyên +
  hiện lỗi server (không fake success). Hint dưới ô Hãng tàu cập nhật đúng
  scope: "Danh mục hãng tàu lấy từ Nhà cung cấp loại 'Hãng tàu'. Tên nhập tay
  lưu cùng lô hàng này; dùng nút bút chì để thêm vào danh mục chung." (copy cũ
  "chỉ lưu cùng lô hàng này" thành sai; copy trung gian bị overclaim với
  nhập tay — review S2). UX giữ nguyên: Pencil, tiêu đề dialog "Đặt tên hãng
  tàu cho lô này", dialog body giữ nguyên theo yêu cầu ticket, field vẫn
  free-text cho lô.
- Regression: `backend/src/tests/shipping-line-intake-catalog.test.ts` (7
  test qua mount thật: create → 201 + bootstrap liệt kê + row typed
  SHIPPING_LINE; duplicate/case/default → 200 không nhân bản; empty/>255 →
  400; va chạm NCC khác loại → 409; role matrix 403/401);
  `frontend/src/features/shipments/create/ShipmentCreateWorkspace.shipping-line-persist.test.tsx`
  (persist trước close, dropdown mirror, fail → dialog mở + lỗi). Testplan
  `testplan/2026-10-17-card-fb114-hang-tau-plus.md` case
  `2026-10-17-card-fb114-shipping-line-server-persist`; QA
  `qa/2026-10-17_fb114-persist_*`.
- Migration: KHÔNG tạo — dedupe application-level đủ cho form 1 người bấm;
  unique index trên display name cần clean data trước (để lại nếu owner muốn
  siết race window).

## 2026-10-17 (tối) — FB-038/072 verify-fail 3: gán xe trùng lịch còn 2 đường lưu thầm lặng

Nguồn: docx `171026121100-fb038-072-verifyfail3-overlap-silent` (staging,
dungnv/Điều vận). Điều tra staging read-only: cả 2 fix trước đã trên staging
build; lỗi do 2 shape dữ liệu mà guard còn sót.

- **Holder không container vô hình** — dòng Kế hoạch Chi tiết chưa decompose
  (`shipment_fulfillments.shipment_container_id` NULL, slot theo "Ngày giao"
  của lô; staging: ff 198/199 cùng lô 298): `scanPlanRowHolders` INNER JOIN
  `shipment_containers` làm holder biến mất → gán cùng biển số cho từng dòng
  cùng ngày lưu thầm lặng. Fix: LEFT JOIN — holder không container claim LOT
  window như nhánh Lẻ (luật 061026174603), marker `fallbackSlot` giữ evidence
  yếu ở tier WARN.
- **Chuyến COMPLETED chỉ có ngày vô hình** — trip hoàn thành không planned
  timestamps (staging: trip 117 · BLCUSa24BB, departureDate 01/10) bị mọi scan
  tier-completed bỏ qua vì đòi `isNotNull(planned_start_at)` → "Phân xe lại"
  lên biển đó cùng ngày lưu thầm lặng. Fix: 3 scan
  (`assertResourceAvailability` rig rows, `assertTripRigAvailable`,
  `assertPlanRowRigAvailable`) claim nguyên ngày hiển thị theo luật 12fcf20d
  (coalesce plannedStartAt → departureDate tại Asia/Ho_Chi_Minh) — vẫn
  warn-once `RIG_OVERLAP_COMPLETED` + confirm proceed, không hard-block mới.
- **Giữ nguyên** harmonization 11/10 cho DRIVER tier-completed (date-only
  completed row không chứng minh được tài xế bận — vẫn im lặng); test pin cũ
  vẫn pass. Kẹp/Kết hợp exemption, tier hard active, same-lot warn: không đổi.
- Regression: `dispatch-plan-row-rig-conflict.test.ts` (describe mới 5 test
  container-less cùng lô/khác lô), `trip-overlap-warning.test.ts` (2 test edit
  form + fallback reassign vs completed date-only),
  `dispatch-resource-availability-kep-kethop.test.ts` (T15–T17). Testplan
  `testplan/2026-10-17-card-fb038-overlap.md`; QA `qa/2026-10-17_fb038_*`
  (API rung 2 + UI driven rung 3 qua 'Sửa ô điều phối' với dialog "Vẫn lưu?").

## 2026-10-17 (tối) — FB-105/106/107/108 + FB-006 + QA1-007 + FB-086 (verify-fail lần 2)

Nguồn: docx "Điều chỉnh form tạo lô hàng lẻ" 17/10 + 7 card Kanban TODO
(171026113500 · 171026113510 · 171026113520 · 171026115800 · 171026115810 ·
171026115820 · 171026115830).

- **FB-105 (171026115800, P1)** — hàng lẻ: ô "Kho lấy/trả hàng" nhận lại nguồn
  thật (`operational_sites` WAREHOUSE theo khách đang chọn; `df08bd7c` từng ghim
  về `[]`), label + placeholder đổi theo hình thức XNK (Nhập: "Nhà máy (Điểm
  trả hàng) \*" / "Kho lấy hàng (CFS/Cảng) \*"; Xuất: "Nhà máy (Điểm lấy hàng)
  \*" / "Kho trả hàng (CFS/Cảng) \*"), Nhà máy thành bắt buộc (trừ "Lệnh chạy
  ngoài"), CẢ HAI ô chọn danh mục hoặc gõ text tự do, ô Kho chuyển vào card
  "Điểm vận hành & tuyến". Payload ghi điểm nâng/hạ đúng chiều vào
  `pickup_location`/`delivery_location` (2 cột sẵn có — **không migration**,
  `make db-drift-check` vẫn no-op); BE chấp nhận điểm Kho dạng text
  (`shipment-intake.service`: id hợp lệ HOẶC text, lệnh chạy ngoài vẫn được để
  trống). Điều vận: Kế hoạch Tổng quát + Kế hoạch Chi tiết Xe dùng chung
  `resolveLiftDropPoints` → lô lẻ Nhập Nâng=kho/Trả=nhà máy, Xuất đảo lại;
  FCL giữ cặp cảng container (không đảo).
- **FB-106 (171026115810, P2)** — nút "Tạo lô mới" cạnh "Xóa lô" trên chi tiết
  lô, cùng bộ vai trò với route guard `shipmentCreatorOnly`. Điều hướng
  create→chi tiết đã có từ FB-080 (kiểm chứng trên 3 lô lẻ tạo từ form).
- **FB-107 (171026115820, P2)** — "Nơi nhận"/"Nơi giao" thôi đọc 2 cột
  `pickup_location`/`delivery_location` (luôn trống với lô tạo từ form) và in
  Nâng/Hạ thật; BE bổ sung tên kho (short-name authority) vào payload chi tiết.
- **FB-108 (171026115830, P3)** — cụm "Huỷ / Lưu nháp / Tạo lô hàng" lặp ở cuối
  trang nhờ component dùng chung `ShipmentCreateActions`; biến thể footer tự
  định danh ("(cuối trang)") để 2 cụm không trùng accessible name. Phục hồi
  thanh thao tác cuối trang mà mock 11/10 đã bỏ (chỉ thị 17/10).
- **FB-006 (171026113500, verify-fail 2)** — cell "Nhà máy" của dòng container
  thu gọn thật ngay sau khi chọn: bỏ phụ thuộc `:focus-within` (editor rời
  DOM + a11y tree bằng `visibility`, không đổi bề rộng/chiều cao hàng) và
  `activateCell` không còn tự kích hoạt lại cell do click xuyên portal, nên
  menu vừa đóng không mở lại. Lệnh chạy ngoài giữ editor text tự do.
- **QA1-007 (171026113510, verify-fail 2)** — chip "Bắt buộc: N/M" + panel "Cần
  bổ sung" đọc readiness SỐNG (trước đây chỉ đọc danh sách issue sinh ra lúc
  Lưu → form đủ 3 trường nhận diện báo "3/3"); mẫu số theo hình dạng form (FCL
  catalog 9, LCL catalog 10, ad-hoc 7/5). Panel ưu tiên danh sách của lần Lưu
  vừa rồi khi có, để câu chữ khớp đúng trường đang sơn lỗi (DRAFT: "Chọn khách
  hàng để tạo lô hàng.").
- **FB-086 (171026113520, verify-fail 2)** — mục Containers trên chi tiết lô có
  nút "Thêm container" (dialog số cont/loại/trọng lượng/giờ hẹn → endpoint
  composition sẵn có, tự tải lại chi tiết, cổng hiển thị khớp cổng endpoint);
  container tạo qua form nằm đủ trong payload chi tiết (lô 109609: DB + API +
  màn hình đều 1 container, thêm được container thứ 2).
- **Fix kèm lượt này:** (a) bỏ PUT replay thừa ngay sau khi tạo lô — với lô
  lệnh chạy ngoài PUT đó bị 400 "Khách hàng: Giá trị phải lớn hơn 0" nên tạo lô
  xong mà màn hình vẫn báo lỗi, retry lặp lại lỗi; (b) `USearchableField` không
  còn nuốt `hint` dạng ReactNode → empty-state "Chưa có kho/nhà máy" + link
  thêm mới hiện đúng.

Gates: `fe-tsc` 0 · `be-tsc` 0 · FE **653 file / 5034 test xanh** · BE unit
290/290 + nhóm integration liên quan (intake, dispatch detail plan, detail
projection, list projection) 152/152 xanh (suite BE đầy đủ vượt hạn 40' của
phiên chạy, không tính là gate). E2E trình duyệt thật trên dev stack:
109014/109015 (lô lẻ Nhập/Xuất), 109034/109035 (Nâng/Trả 2 màn điều vận +
Nơi nhận/giao), 109609 (FCL containers + thêm container + Tạo lô mới);
chip 0/9→3/9→10/10; cell nhà máy thu gọn ở trạng thái 2×RAF sau cú chọn.

## 2026-10-17 (chiều) — fix(141026230770) v2: /my-advances hết sinh "Đã ghi nhận" lậu + regression (a)(b)(c)

Ticket 141026230770 (P2, hoapt/kế toán, staging 14/10) tái lập: (a) thiếu nút
"PHÊ DUYỆT TẠM ỨNG", (b) thiếu tick "Xác nhận hoàn ứng", (c) báo cáo toàn số 0
+ không xử lý số âm. Mốc mã giải thích triệu chứng staging: `2a64156f` (sinh
PENDING + cột có dấu) commit 15/10 08:15 — SAU buổi QA 14/10; nút duyệt + tick
còn trễ hơn (16/10). Tái kiểm HEAD còn 1 lỗ thật:

- **(a) `POST /api/forwarder/me/advance-requests`** (trang /my-advances "Ghi
  nhận tạm ứng", route opsOnly) sinh thẳng "Đã ghi nhận" với
  `approvedBy = requester` — không qua phê duyệt, không audit → đúng triệu
  chứng ticket với mọi submit đi qua trang này. Sửa: sinh **PENDING** chờ kế
  toán phê duyệt (CPB-03 "OPS submission is born PENDING" + comment của
  `createAdvanceRequest`: chỉ đường tiền đi cùng giao dịch mới được ghi thẳng
  RECORDED — đường này không có bút toán tiền). Copy trang đổi thành "Gửi yêu
  cầu tạm ứng" cho đúng hành động; chủ yêu cầu hủy được PENDING chưa giao tiền
  (licence CPB-03, trước chỉ có cho RECORDED).
- **(a) regression:** R1 — cả 2 đường Ops submit (wallet + forwarder/me) sinh
  PENDING/approvedBy null/chưa có bút toán (`ops-module-routes.test.ts`,
  `q23-forwarder-create-replay.test.ts`; pin "status-removal" 2026-09-15 bị
  KP-148 supersede viết lại theo luật mới); R2 — nút "Phê duyệt tạm ứng" trên
  dòng PENDING (pin FB-100 hiện hữu); R3 — chủ yêu cầu hủy được PENDING chưa
  giao tiền (`AdvanceDraftActions.test.tsx`).
- **(c) regression:** R4 — yêu cầu đã ghi nhận không bị báo cáo về 0
  (`reconciliation-refund-settle.test.ts`: ĐÃ ỨNG hiện số +
  remainingSigned có dấu). Công thức báo cáo + "Đề nghị thu tiền ứng" giữ
  nguyên theo ruling (pin hiện hữu).
- **(b):** tick Option B đã có trên bề mặt tạo phiếu duy nhất
  `/my-settlements/new` (`055105dc`) — không có delta mã; regression pin hiện
  hữu (R5: `ForwarderSettlementCreatePage`, `advance-settlement-deadlock-order`,
  `SettlementPrintPage`).
- **Red-at-head (ngoài FB-100, sửa để gate xanh):** `ops-module-routes.test.ts`
  — 3 fixture cùng loại + cùng lô khai `duplicateConfirmed: true` (sibling
  sweep guard 141026230720 theo tiền lệ `66f724cc`; guard + 4 pin giữ nguyên)
  + fixture date cô lập rác QA tương lai (2031–2033) dò dỉ trong dev DB.

Dữ liệu legacy trên staging (7 yêu cầu "Đã ghi nhận" auto-apply) là dữ liệu,
không đụng trong code — xem testplan card.

## 2026-10-17 — fix(141026230710): Ops mở được /shipments + khai chi phí mọi lô

Ticket 141026230710 (P1, chỉ thị 17/10, spec T3 — mọi Ops khai chi phí mọi lô,
không chia theo cá nhân/xe). Hai chặn của luồng khai chi phí:

- **Route `/shipments`**: thêm casbin rule `p, OPS, shipments, read`
  (backend) + mở `canReadShipmentRoutes` cho `Role.OPS` (frontend) — hết
  redirect + toast "Bạn không có quyền truy cập trang này." cho Ops. Quyền
  write/delete của shipments giữ nguyên; CUSTOMER/DRIVER vẫn bị chặn.
- **Dialog "Lô này không thuộc xe bạn phụ trách."**: đã bị gỡ từ batch
  open-scope trước (grant per-person + endpoint `write-scope` không còn trong
  nguồn); xác minh lại + pin bằng test
  `backend/src/tests/ops-expense-access.test.ts` — Ops tạo được chi phí trên
  lô không có user-link/gán xe/chi phí cũ, kể cả khi trip của lô gán lái xe
  khác; `assertExpenseOwnerWriteScope` chỉ còn scope DRIVER
  (trips.driverId ↔ drivers.userId).

Regression: testplan/2026-10-17-card141026230710-ops-shipments-view-open.md.

## 2026-10-11 (tối) — /shipments/new: dày đặc hơn, hết lệch nhãn trường

Owner báo trang tạo lô "design too shitty" kèm mock `Tạo lô hàng.html` và yêu cầu
UI/UX dày dữ liệu hơn. Đây là lượt làm dày trên chính bản thiết kế "owner mock
11/10" đã có (không đổi cấu trúc 3 section, không đụng bảng container).

- **Nhãn trường hết lệch hàng** (lỗi thật, đo bằng Chromium): ô "Khách hàng" và
  "Hãng tàu" nằm trong khối trường + nút quick-create; khối này canh đáy
  (`align-items: flex-end`), nên khi một ô cùng hàng có hint ("Chọn Hình thức xuất
  nhập khẩu trước") kéo hàng cao lên thì nhãn của nó tụt xuống ~15px so với các ô
  còn lại. Nay trường kéo dài từ đỉnh hàng (`align-self: stretch`), nút vẫn canh
  đáy cạnh input — nhãn đầu hàng thẳng nhau, quick-create vẫn ở một hàng.
- **Lệnh chạy ngoài rời thanh tiêu đề section**: chip nhập chung dải cờ với "Có
  cược container" (+ "Tiền cược dự kiến" khi bật), nằm cuối hàng Hãng tàu và canh
  đáy bằng input. Thanh tiêu đề trở lại là dải mỏng — hết ô nặng nằm lẻ góc phải.
  Thứ tự DOM cờ giữ nguyên hợp đồng (Lệnh chạy ngoài → Có cược container → Đóng
  kết hợp).
- **Hãng tàu / dải cờ chia lại 5–7 cột** (lưới 12 cột) thay vì 6–6: chip không còn
  ngồi nửa hàng trống.
- **Hai ô ghi chú chung một hàng** ở ≥760px (Ghi chú cho khách hàng | Ghi chú cho
  lái xe); điện thoại vẫn xếp dọc. Section "Lịch & ghi chú" cao 368px → 246px, cả
  trang bớt ~110px chiều dọc.
- **Padding tiêu đề section 16px → 12px**; gỡ slot `actions` (và
  `.csc-section__actions`) của `ShipmentCreateSection` — không còn consumer sau khi
  cờ rời tiêu đề.
- Hợp đồng style cập nhật theo: pin span 5/7, căn đáy dải cờ, lưới ghi chú, và
  `align-self: stretch` của khối trường-nút.

## 2026-10-09 (đêm) — reconciliation: origin/main -> prod (kiểm chứng từng file)

Prod `1a1a227e` → merge commit của `origin/main` (`a71bf718`). Main đi trước 81
commit và chỉ có đúng MỘT khối công việc chưa từng lên prod.

- **Lô hàng ops trên mobile thành card liền khối** (20261009_9, port 6da4f6b7 từ
  main): /ops/orders, /ops/wallet, /ops/fleet-tracking — hàng gộp 2 cột nay có viền
  đủ + bo 12px + nền surface; ô trong hàng nền trong suốt nên khoảng hở không đọc
  thành "block xám rời rạc"; trạng thái ghim chỉ còn MỘT accent — dải status brand 3x20
  ở mép trái; hover wash chỉ bật trên con trỏ tinh (hover+fine), không dính hover
  trên touch. Trước đó hàng chỉ có border-bottom nên nền highlight tràn qua mép phải
  card ở 390px.
- **Nền ghim warn giữ nguyên trên bảng desktop, nhưng không được tràn vào card mobile**
  (quyết định reconciliation): tint warn là diện mạo lâu đời của prod (7fa5ae07,
  c9442b2f chỉ đổi màu theo token) nên không đụng. Nhưng selector desktop
  `.ops-orders__table tbody tr.is-pinned` là 0-2-2, mạnh hơn rule card 0-2-0 — nên
  nếu không reset, thẻ ghim ở 390px vẫn nhuốm warn và mang HAI accent cùng lúc (đã
  đo bằng Chromium thật: computed background = warn 7%). Khối container nay có reset
  riêng ở 0-3-0 đưa nền thẻ về `--surface`, dải status brand là accent duy nhất.
- **7 file conflict còn lại lấy phía prod**: `action-error.ts(+.test)`,
  `TripReassignDialog.tsx`, `DispatchPlanEditorCell.test.tsx`,
  `useDispatchDetailPlan.test.tsx`, `lead-qa-harness.mjs`,
  `qa-20261008-leadqa-batch.mjs` — ở cả hai vế lịch sử prod đều là phần mở rộng của
  main, bản main là trạng thái cũ. Sau hợp nhất cây prod lệch origin/prod đúng 4
  file: 3 CSS ops + `OpsOrdersPage.test.tsx` (pin contract mới) + CHANGELOG này — không
  file nào khác bị lẫn nội dung cũ của main.

## 2026-10-09 (tối) — wave: LCL intake & dispatch rulings, money ₫ one text node

Prod `bc305aec` → `6cfe6620` (staging-verified từng bước: `f04497ac` rung intake LCL 16/16 — 38938c50; `3c32994b` rung money ₫ /finance).

### Shipped

- **"Quy cách đóng gói" hàng lẻ có gợi ý sẵn** (091026180800, a692174b): ô "Quy cách đóng gói" trên form tạo lô LCL giờ là combobox gợi ý Pallet / Roll / Carton / Thùng gỗ / Bao / Can — chọn nhanh hoặc gõ tự do như cũ, giá trị ngoài danh sách vẫn lưu nguyên.
- **Form lô lẻ bỏ hai mốc chỉ dùng cho container nguyên** (091026180700, a9c2d57d): khối "Lịch & ghi chú" của lô hàng lẻ không còn "Hạn hạ container tại cảng" và "Thời điểm trả container" (nghiệp vụ tàu/container nguyên); "Hạn hoàn tất hải quan" và "Ngày giao dự kiến" giữ nguyên. Form FCL không đổi.
- **"Thêm kho lấy hàng" gọn ba trường, mã tự sinh** (091026180600, 1dee5f58): khi tạo lô, CUS thêm kho lấy hàng mới chỉ cần Tên đầy đủ / Tên ngắn / Địa chỉ; mã điểm vận hành tự suy ra. Form đầy đủ (loại điểm, liên hệ, Google Maps) vẫn ở danh mục.
- **Tạo lô xong mở thẳng trang lô mới** (091026180900, f04497ac): sau khi lưu, app chuyển đến trang chi tiết của lô vừa tạo thay vì danh sách xếp theo hàng đợi — CUS thấy ngay lô của mình để tiếp tục theo dõi. Bốn thẻ intake (180600/180700/180800/180900) cùng rung một drive 16/16 (38938c50).
- **App lái xe: hàng nhập hiện đúng điểm hạ** (091026190530, f7da4e65): hàng "Cảng hạ/Hạ" của chuyến IMPORT giờ mang điểm hạ thật của công việc — cảng/bãi hạ container theo dữ liệu điều vận (nơi trả vỏ của dữ liệu cũ còn ghi thì vẫn hiển thị trước); bỏ dòng chết "Chưa có nơi trả rỗng" đứng cạnh "Địa chỉ giao hàng" cùng tên bãi. Rung staging `f8db1eea` (972fbc9b).
- **Lái xe nhận rồi vẫn đổi được xe** (091026190520, 6cfe6620): sau khi lái xe nhận việc, Điều vận vẫn chỉnh được phương tiện — đầu kéo/moóc với xe nhà, nhà xe/biển số với xe ngoài — giữ nguyên lái xe đã nhận; đổi lái xe hoặc chuyển giữa xe nhà ↔ xe ngoài vẫn chỉ trong cửa sổ trước khi nhận (máy chủ từ chối "Lái xe đã nhận việc — chỉ được đổi xe, giữ lái xe.", dialog khóa ô lái xe kèm lý do thấy được).
- **Mọi số tiền một text node, ₫ cách khoảng** (20261009_8, 3c32994b): quét 43 vị trí ₫ còn tách node trên toàn app — số và đơn vị nguyên cụm "1 234 567 ₫" ở mọi màn hình, theo luật 2026-10-06; sổ quỹ Ops khớp số trên đúng một node (c4f92fd1).

## 2026-10-09 (chiều) — wave: iOS mobile viewport

Prod `23998fbd` → staging-verified `ef4c1d63`.

### Shipped

- **Hết khoảng trống chết đáy màn hình trên mobile + modal thành bottom sheet** (20261009_3, ef4c1d63): trang Chi tiết lô hàng nhận fill primitive (trước đây thiếu nên hụt chân ~64px trên phone); editor 'Chỉnh sửa khách hàng và lộ trình' trên bề rộng ≤640px portal thành bottom sheet áp đáy (radius trên 16px, đáy phẳng, padding-bottom max(16px, env(safe-area-inset-bottom)), backdrop mờ, dvh budget) qua MỘT implementation dùng chung cả 7 chế độ sửa; desktop giữ neo tại chỗ. 5 pin đỏ→xanh; rung mobile 390/430: sheet dock bottom=0, trang lấp đầy viewport. Thiết bị iOS/Android thật để owner xác nhận cảm giác cuối.
- **Lỗi lint budget về 0** (8f2791f8): 2 dead local (HrRosterPage sau khi chuyển projection server-side; import thừa sau 93455878); testplan/qa/scripts/** vào nhóm driver-scratch không lint như evidence/qa.

## 2026-10-09 (trưa) — wave: retest round 9

Prod `b1fc317b` → `23998fbd` (staging-verified `fba9f508` → `26d3f1f7` → `45993f90`).

### Shipped

- **Picker mở từ toàn bộ ô ngày giờ (lần 2)** (091026091500, fba9f508): hợp đồng mới của host combinedPicker — click/double-click BẤT KỲ ĐÂU trên thân ô (gồm segment input) mở 'Chọn ngày giờ'; gõ bàn phím giữ caret editing (auto-advance); host không-combined giữ nguyên luật caret 20/09 byte-for-byte. Pin cũ 4da7470f được supersede tường minh. Rung staging: segment click → đúng 1 dialog, gõ 08 + auto-advance, double-click vẫn 1 dialog.
- **Header bảng điều phối một dòng** (091026091550, 26d3f1f7): khôi phục luật nowrap toàn cục trên 2 lưới điều phối — /dispatch 8/8 + /dispatch-detail 9/9 header giữ một dòng ở 1280/1440 (đo Range client-rects). Red-first 4 pin; quét plan-board family.
- **Gỡ kẹt 'lịch trình bị khóa sau lưu'** (091026091510, 45993f90 — MiniMax WIP, lead gate + land theo chỉ đạo 'pick the tickets'): rule 'lot READY phải giữ ngày' giờ chỉ chặn lot CÓ live trip (boundary xoá-lô CTO 2026-09-04); lot do chính editor đưa lên READY có thể hoàn tác về 'Chưa chốt ngày' (revert PENDING_DATE + cancel fulfillment). Red-first lead tự quan sát (revert-test đỏ tại HEAD-service); suite 100/100. Rung staging trên chính lô reporter (TEST-LCL-362): set→200/READY, clear→200/PENDING_DATE. Client CUS giữ self-heal 409 cho conflict thật (lot có trip).

## 2026-10-09 (sáng) — wave: HR roster rulings

Prod `e9339ad1` → `fca551ee` (staging-verified từng bước `3a43b3b1` → `fca551ee`).

### Shipped

- **Danh sách nhân sự chỉ còn lái xe** (20261009_1, owner ruling 09/10 'chấm công chỉ dành cho lái xe' / 'no office staff'): roster lọc đúng role DRIVER — pin test đỏ→xanh + rung staging chứng minh 43 hàng = đúng 43 driver theo API, 0 nhân sự văn phòng.
- **Kế toán đọc được roster** (20261009_2): menu Danh sách nhân sự trỏ tới /auth/users vốn 403 role tài chính — giờ có endpoint đọc riêng GET /auth/users/roster (casbin hr_roster: MANAGER + ACCOUNTANT; projection đúng cột roster, không salary/login; driver-only chặn luôn ở server). Rung: hoapt 200 + 43 hàng render, DISPATCHER 403, admin không đổi.

### Rulings

- Owner 09/10: chấm công driver-only vĩnh viễn — bảng văn phòng đã bỏ 06/10 không quay lại; thẻ gốc 051026231606 đóng kèm ruling.
- 'Phơi phiếu' GIỮ NGUYÊN (lead ruling, owner ủy quyền): thuật ngữ kế toán thật, nhất quán mọi bề mặt.
- OPS không vào /fleet + /expenses: KHÔNG có requirement nào đòi mở — giữ nguyên thiết kế; đóng mục.

## 2026-10-09 (rạng sáng) — wave: retest round 8

Prod `371f297f` → `e9339ad1` (staging-verified từng bước: `443f5c14` → `463712eb` → `e9339ad1`).

### Shipped

- **Placeholder ngày giờ gọn đúng format** (081026230520): ô phân đoạn đọc 'HH:mm' / 'DD/MM/YYYY' — bỏ khoảng trắng thừa quanh ':' và '/' ở đúng một chỗ dùng chung (DateTimeSegments.css), phủ mọi bề mặt dùng segmented dates (form lô, popover hẹn giờ, filter DD/MM/YYYY toàn app). Red-first + đo glyph thật. Verdict 09-25 của FB-062 bị lead thu hồi đúng luật (revocation) — placeholder-spacing đã bị phản chứng; re-verdict đi theo thẻ này.
- **Guard chống double-booking xe phủ cả chuyến đang chạy** (081026230530): chuyến ACTIVE thiếu Giờ kết thúc từng VÔ HÌNH với guard phát lệnh/phân xe lại (đòi đủ 2 mốc giờ) — giờ chiếm xe trong 1 ca 8 giờ từ giờ chạy, đúng luật guard plan-row; cả 3 predicate đầu kéo/rơ-moóc/tài xế. Staging rung lead: tái tạo đúng kịch bản round 8 (seed occupant IN_TRANSIT thiếu end) → reassign 409 'Xe đầu kéo đã bị trùng lịch kế hoạch.', không ghi đột biến.
- **Mọi SĐT trên app lái xe bấm gọi được** (081026230540): SĐT liên hệ trên chi tiết chuyến giờ là tel: link; 4 điểm hiển thị SĐT đi qua MỘT pattern chia sẻ TelLink (strip whitespace trong href, hiển thị giữ nguyên) — chốt luôn 2 bug tiềm ẩn href chứa khoảng trắng.
- **Nút Xuất trên /debt + /profit có toast phản hồi** (081026230550 + đóng luôn regression FB-053 061026174602): 'Đã xuất báo cáo… ra tệp Excel.' đúng pattern /finance + /fleet/productivity — nhất quán toàn app.
- **Ô NGÀY GIỜ ĐÓNG TRẢ mở picker từ toàn bộ thân ô** (081026230510): vùng bấm picker đã co còn ~3px (luật caret-click cố ý 20/09 + fix placeholder thu hẹp khung) — click vùng trống thân ô giờ mở 'Chọn ngày giờ' (lịch + lưới giờ); click segment vẫn là caret đúng luật owner. KHÔNG phải regression từ quét toast/date-filter — round 7 pass là may mắn trúng khung.
- **Dọn seed QA khỏi invoice tracking** (081026230560, data staging): dòng fixture card 376 (NCC QA Lead 0510 / LEAD-QA-376-01) xóa qua API + UI verified sạch + đăng ký census. 2 tài khoản treasury ACB id 6/7 KHÔNG phải seed (tạo 29-09 bởi admin, trước wave seed) — giữ nguyên theo census của lead.

### Closes & rulings

- 20260925_46 (FB-062 gốc): verdict thu hồi 08/10 theo phản chứng round 8 — phần evidence 'không còn native date input' vẫn đúng; thẻ đã đóng lại trên evidence của fix.
- Đóng nhầm-premise: 061026174601 (trần 360px topbar search là thiết kế đã QA PASS, không phải regression), 061026174602 (toast export P&L đã có từ fix lớp này — đóng theo evidence chung).
- Ruling owner 09/10: chấm công CHỈ dành cho lái xe, không nhân sự văn phòng ('no office staff') — thẻ 051026231606 đóng kèm ruling; roster 'Danh sách nhân sự' lọc còn đúng lái xe tách thành thẻ 20261009_1. Còn mở: không còn mục mở — wording 'Phơi phiếu' GIỮ NGUYÊN theo lead ruling 09/10 (owner ủy quyền; thuật ngữ kế toán thật, nhất quán mọi bề mặt, trong thẻ 081026072303).

## 2026-10-08 (tối) — wave: fix-all take-over, retest round 7, VAT config

Prod `b90beff2` → `371f297f` (staging-verified từng bước, cuối tại `371f297f`).

### Shipped

- **Toast lỗi theo chính sách trên toàn app** (20261008_6): 63 site còn echo nguyên body lỗi vào toast (27 file) chuyển hết qua module chính sách action-error — toast phân quyền chỉ khi thao tác thật sự bị từ chối và nêu tên thao tác; abort/race không bao giờ ra toast. Bảng disposition từng site trong card.
- **Kế hoạch chi tiết lọc theo kỳ trên cả hai nhánh** (20261008_7): nhánh điều phối (container chưa phân tách tác vụ) trước đó bỏ qua khoảng tháng của topbar; giờ rows và số gán xe cùng tôn trọng kỳ như nhánh fulfillment, cùng cột ngày (ngày hẹn container theo giờ VN, fallback ngày giao dự kiến của lô).
- **Card 'Chứng từ giao hàng' gọn một hàng trên phone** (081026072302; lead landed theo chỉ đạo 'fix all', credit MiMo): trạng thái closed ở ≤640px giữ title một dòng, nút co giãn thay vì title xuống dòng — 56–62px trên 320–430px (trước đây phình ~80px ở dải hẹp); desktop không đổi.
- **Thuế suất VAT của công ty cấu hình được trong app** (081026104400-511): card mới tại /admin-center (0/5/8/10%; lần đầu chưa cấu hình đề xuất 8%), lưu vào bảng singleton mới (migration idx 138), đọc qua /api/vat-config. QA staging phát hiện và sửa 2 bug thật: GET 500 vì postgres.js trả cột timestamp dạng string, và cache 5 phút không evict sau khi lưu (giờ evict trên mỗi lần lưu thật).

### Non-repro closes (retest round 7)

- **'VI PHẠM T10/2026' dính chữ** (081026072301): không tái hiện ở bất kỳ build nào đo lại (local HEAD + staging, 1440/390) — JSX luôn có dấu cách thật; kết quả round 7 là artifact của phép đo text (nối text node kề nhau không chèn cách). Guard test pin nhãn đủ khoảng trắng.
- **5 item dấu/khoảng trắng bề mặt Kế toán** (081026072303): 4/5 không tái hiện ('Theo dõi hoàn cược' đúng, 'Cố định đội xe' nhất quán banner/legend, dòng chia lợi nhuận đủ khoảng trắng); header 'LỆNH' viết hoa đúng skin header toàn app. Không cần sửa code.

### Mở

- Wording nav 'Phơi phiếu' (081026072303 mục 4): house term dùng nhất quán trên mọi bề mặt (nav, tab, route /accounting/phoi-phieu); đổi hay giữ là quyết định product của owner.

## 2026-10-08 (chiều) — wave: 20261008_1–_5 sweep batch

Prod `7b1d0433` → `b90beff2` (staging-verified at `dc599a82`).

- **Ops wallet — Lịch sử chi phí có số full-set** (_2): 4 tab lọc ('Tất cả 15 / Cần bổ sung 0 / Đã ghi nhận 12 / Đã hủy 3') theo census mới native + legacy trip rows; bucket rỗng hiện 0 thấy được.
- **Mọi nút disabled tự giải thích** (_1): /shipments-debit, popover phân bổ, /dispatch-detail — DisabledActionTip (aria-disabled + lý do reachable hover/focus); sweep xong 2 surface live + 21 pin test.
- **Chip lọc điều phối có số đúng nghĩa union** (_3): 'Chưa gán xe 23 / Đã gán xe 19' — số hàng mỗi chip thực sự hiển thị trong view đang lọc (tap chứng minh 1-1).
- **Toast phân quyền nêu tên thao tác** (_4): không echo body lỗi trần; request abort không đẻ toast phân quyền (live-verified); 403 naming pin bằng test.
- **Tabs đọc số có khoảng trắng** (_5, lead-claimed theo chỉ đạo hoàn thành mọi thẻ): aria-label 'Tất cả 147' thay vì 'Tất cả147'; thị giác giữ nguyên. Cross-lane collision với ZAI trên cùng file được reconcile về một bản labelText-based.

## 2026-10-08 — wave: blocker decisions, ops overview, dispatch export, tab counts

Prod `1e688539` → `8897e3f2` (staging-verified at `a1dc8b1f` + QA rungs).

### Shipped

- **/ops — trang Tổng quan Ops** (card 081026095500): 3 chỉ số (lô chờ xử lý trong ngày giao dự kiến, xe đang chạy, số dư quỹ + yêu cầu chờ duyệt) tổng hợp từ endpoint có sẵn, 3 quick link tới /ops/orders, /ops/fleet-tracking, /ops/wallet. Guard opsOnly giữ nguyên; role khác về home của role đó.
- **/dispatch — Xuất file Excel** (card 081026093510): export data-driven — enabled khi có dữ liệu trong phạm vi lọc hiện tại; disabled kèm lý do thấy được (DisabledActionTip). Tệp `ke-hoach-tong-quat-<ngày>.xlsx` đúng dữ liệu lọc.
- **/shipments — tab trạng thái có số full-set** (card 081026093520): mọi tab (Tất cả / Chưa chốt lịch / Chờ điều xe / Chờ đối soát) hiển thị tổng theo filter từ `statusCounts` của API, không bao giờ lấy số dòng trang đang tải; bucket rỗng hiện 0, không để trống.
- **Năng suất — ô phần trăm một dòng by construction** (card 071026141600): token số+đơn vị là một text node nowrap (`NumericUnit`), header mang đủ nhãn. Hardening — lỗi gốc không tái hiện kể cả trước fix.
- **e-POD — nhãn "N tệp" một text node** (card 071026212510): badge đếm file là một span nowrap; sweep 18 vị trí số+đơn vị dính khả năng vỡ node trên toàn app.

### Rulings & closes (owner ủy quyền lead quyết 08/10)

- **Phát lệnh cần nhà xe** (card 397): chưa gán nhà xe thì KHÔNG có nút Phát lệnh — đúng workflow #359; không phải lỗi. Verified 2 chiều trên fixture tự dựng (assigned có fieldset, unassigned không có).
- Non-repro closes: toast 403 admin trên /customers (212000), search không lọc (205300, lần 2, role admin battery), nav race (093500 — chỉ cửa sổ <300ms nội tại, cold-context hiện skeleton ngay).
