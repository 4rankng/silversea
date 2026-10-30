# SIL-604 (id 707) — Band Loại hàng + Ngày giờ đóng trả supersize trong form tạo lô

- Ticket: SIL-604 (board SIL, id 707, priority HIGH, báo cáo 30/10/2026, build 8f376365
  staging, screenshot khung đỏ đính ticket).
- Surface: `/shipments/new` (ClerkShipmentCreatePage), band đầu tiên `#shipment-section-mode`
  — fieldset Loại hàng (FCL/Lẻ) + field "Ngày giờ đóng trả cho tất cả cont" (FCL) /
  "Ngày giờ đóng trả" (LCL). Mọi role có quyền tạo lô; lane fix drive bằng ADMIN.
- Nghi nguyên nhân: regression từ đợt SIL-587 (id 687, SplitDateTimeField thay
  "Ngày giao hàng") — xác nhận ĐÚNG hướng nhưng cơ chế cụ thể là 2 luật layout, không
  phải bản thân field 687.

## Bug (trước fix — qa/2026-10-30_sil604_ui-modeband-1307-before.png, đo 1307×800)

1. Desktop 1307: card mode cao **238px** (stretch equal-height với card Nhận diện lô
   238px) trong khi nội dung chỉ ~105px trên 2 hàng — khoảng trắng chết trên/dưới control
   (vi phạm §10.8.2 data-dense). Đây là tàn dư của SIL-596/598: equal-height siblings +
   `align-content: center` để "cân đối" card stretch.
2. Nội dung band wraps thành 2 hàng trong cột 4fr hẹp (~393px content): Loại hàng một
   hàng, datetime một hàng — không đạt "controls một hàng đồng baseline".
3. Mobile 390: field datetime cao **260px** cho ~60px control — root cause:
   `.csc-bulk-appointment .csc-uui-field { flex: 0 1 260px }` (width basis của layout
   flex-row cũ) rơi vào trục CHIỀU CAO khi `.csc-bulk-appointment` đổi
   `flex-direction: column` ở ≤640px.

## Root cause (cơ chế)

- (1) `#shipment-section-mode { grid-area: 1/1/2/2; align-self: stretch; align-content:
  center }` trong onescreen ≥1280 — card bị kéo lên cao bằng identity dù chỉ có 2 control.
- (2) cột 4fr (~421px) buộc band wrap; không thể "một hàng" trong cột hẹp.
- (3) flex-basis px áp nhầm trục trong flex container column-direction (≤640 media block).

## Expected sau thay đổi

1. ≥1280: band mode là row RIÊNG full-width, content-sized — card ~83px (59px control
   line + 12px card padding ×2), identity xuống row dưới full-width. Không stretch, không
   khoảng trắng trong/trên/dưới card; page @1280×800 vẫn vừa 1 viewport (không scrollbar).
2. Controls MỘT hàng đồng baseline: legend Loại hàng + segmented + HH:mm + DD/MM/YYYY
   (+ chip copy) trên cùng một line, đáy control thẳng hàng (flex-end).
3. Mobile 390: field datetime cao đúng nội dung (~65-72px: label 18 + gap 4 + segments
   44 touch), full-width; segmented stack bên trên. Bulk group không grow lấp line.
4. Không phá SIL-587/687: field datetime hoạt động đúng (segments, combined picker,
   required mark LCL, Enter law) — toàn bộ test 687 giữ nguyên pass.

## Regression lock

- `ShipmentCreateWorkspace.onescreen.styles.test.ts`: pin mới
  `#shipment-section-mode { grid-area: 1 / 1 / 2 / 3; align-self: start; }` +
  NOT-match `stretch`/`align-content`/cột 2 trên mode; workspace 1 cột.
- `ClerkShipmentCreatePage.styles.test.ts`: pin `align-items: flex-end` cho
  `.csc-mode-band__row`; pin nhóm bulk `flex: 0 1 auto` (không grow); pin phone block
  reset `flex: 0 0 auto; width: 100%` cho cả 2 specificity tier của `.csc-uui-field`.

## Verification (rung)

- Rung 3 UI DRIVEN, driver `qa/scripts/ui-sil604-modeband-measure.mjs` (zero-mutation:
  chỉ GET, không submit): đo `#shipment-section-mode` + children tại 1307×800 và
  390×844, before/after artifact `qa/2026-10-30_sil604_*`.
- Kỳ vọng after @1307: modeCard ≈ 83px (không phải 238), row ≈ 59px; @390: bulkField
  ≈ 65-72px (không phải 260).

## Kết quả đo thật (after — qa/2026-10-30_sil604_measure-after.json + ui-driver-after.log)

- @1307×800: modeCard **83px** (238 trước), row **59px** MỘT hàng, baseline: segmented
  bottom 188 vs segment inputs 187 (1px); identity 238px full-width row riêng.
- @390×844: bulkField **73px** (260 trước — label 18 + gap 4 + segments touch 44),
  modeCard 171px.
- @768×1024: band 97px, row 73, oneBaseline true; vScroll chấp nhận theo SPEC SIL-499
  (luật 1-viewport chỉ áp ≥1280).
- @1280/1307/1440×800: **không scrollbar dọc** (scrollH = clientH = 800) — SIL-499 giữ.
- Error-jitter (deepseek consult): LCL rest vs LCL error — segmented top 154→154
  @1307 VÀ @768 (moved: false), error "Nhập đủ giờ và ngày hợp lệ." position=absolute
  — error KHÔNG tham gia baseline.
- Zero-mutation: 35 API calls, 0 non-GET (mọi driver run).

## Consult provenance (owner routing 30/10)

- Untitled UI PRO `search_components` (application: form-01/02-modal, date-picker-modal,
  input-field-modal; foundations): không có pattern band segmented + datetime một-hàng
  baseline. Tailkit `search_components` (a-c-form-elements-01/07/10, form-input-groups-01):
  dense inputs label-above, không có connected-segmented band. → Chọn house primitives
  (segmented card 20260922_31 + SplitDateTimeField 687) + baseline law flex-end.
- Deepseek second opinion (`webchat`, 30/10): "Approve with reprieve" — risk duy nhất
  đáng xử lý: error line không được tham gia flex baseline → đã pin absolute + lane
  `:has()`; single-column collapse approved (Baymard: giảm skip-field); 83px chấp nhận
  (content-driven, không shrink input).

## Not covered

- FCL-mode error-jitter (chỉ drive LCL error — FCL cùng cơ chế pin, field cùng class).
- Cross-browser khác Chrome (implicit col-2 của grid `/3` chỉ probe Chrome; QA house
  target là Chrome).
- Data-entry flow submit thật (driver zero-mutation theo §7 — mutation đã có suite
  create-page test + workflow test phủ).

