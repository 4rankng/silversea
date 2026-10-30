# SIL-596 (id 696) — Form tạo lô hàng: khoảng trắng lớn — card Nhận diện lô không lấp grid, band 3 trống sau khi gộp tuỳ chọn

- Ticket: SIL-596 (board SIL, id 696, priority HIGH, báo cáo 30/10/2026, build c2d740c5→f667f55f staging).
- Surface: `/shipments/new` (ClerkShipmentCreatePage ≥1280 onescreen band), role CUS/tiếp viên.
- Evidence gốc: https://bot.tingting.vip/tmpqa/sil-whitespace-create-lot.jpg (Desktop 1307px; URL hết hạn khi lane fix — trả HTML SPA; repro lại local tại cùng viewport).

## Bug

Trên desktop 1307px, form Tạo lô hàng:

1. Card "Nhận diện lô" chiếm ~55% bề rộng trang; bên phải card là khoảng
   trống lớn tới mép phải; dưới card trống cho tới band "Lịch & ghi chú".
2. Nghi nguyên nhân: card Band-3 tuỳ chọn (checkbox Lệnh chạy ngoài / Có cược
   container / Đóng kết hợp) đã gộp vào Nhận diện lô, nhưng grid cũ còn giữ
   cột/cell trống + chiều cao card trong row không kéo giãn theo card cao nhất.

## Root cause (xác nhận bằng code-read trước khi fix)

- SIL-521 (0a20bd1c) retired BAND-4 tờ khai chip strip — trước đây strip nằm
  **cột 2** của `#shipment-section-identity` internal grid (onescreen: "the
  declaration strip owns the narrow column across both rows", SIL-499).
- `ClerkShipmentCreatePage.onescreen.css` vẫn giữ
  `#shipment-section-identity { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr) }`
  và pin `.csc-identity-grid--contact/--refs { grid-column: 1 }` → cột 2
  (~40% bề rộng card) thành **ô grid trống vĩnh viễn** ở mọi viewport ≥1280.
- Cùng lúc identity bị ngắn đi (~120px strip đã xoá) nên cân bằng cao độ
  rail (mode + freight preview) vs identity trong workspace grid 4fr/8fr
  gãy: phần dưới card/rail lộ hàng trắng tới band kế.

## Expected sau thay đổi (§10.8.2 orchestrator: ẩn cột chỉ khi rỗng — không ô grid trống; doctrine data-dense SIL-515)

1. Không còn ô grid trống trong card Nhận diện lô ở ≥1280: các band
   (contact/refs/choices) lấp 100% bề rộng card.
2. Hàng trắng dưới card vùng rail biến mất (collapse tự nhiên) — không dư
   track sau khi phần tử giữ chỗ (strip) đã bị bỏ.
3. Ngân sách SIL-499 giữ nguyên: @1280×800 vẫn không scrollbar dọc; SPEC
   density (band 36, row 48, gap 12, padding 12-16) không đổi.
4. Không vỡ ở 1307 / 1440 / 390 (chuẩn mobile card).

## Regression lock

- `frontend/src/features/shipments/create/ShipmentWorkspace.onescreen.styles.test.ts`
  (đúng: `ShipmentCreateWorkspace.onescreen.styles.test.ts`)
  — pin mới: identity không còn template 2 cột; các band không còn pin
  `grid-column: 1` tạo ô trống.
- Rung-3 driver `qa/drivers/2026-10-30-sil596-whitespace-ui-drive.mjs` — đo
  bounding box identity/bands + screenshot 1307/1440/390 trước & sau fix.

## Review follow-up (independent review 30/10)

- Freight-present ≥1280 (trạng thái chưa từng drive — mọi run chính freight
  null vì pricing engine cần đủ customer+route+type 20ft+ngày): ĐÃ drive bằng
  `qa/drivers/2026-10-30-sil596-freight-present-drive.mjs` — điền YUANFANG +
  20OT + Thuận Thành + 05/11/2026 08:00, freight card (manual) render
  **full-width w=1243 = đúng bề rộng workspace** (không ô trống cột 2),
  schedule đẩy xuống row 3 nguyên trạng; evidence
  `qa/2026-10-30_sil596-freight-present/` + log. Scrollbar overflow 25px
  @1307×800 trong trạng thái này = hình học trước/sau GIỐNG NHAU (row freight
  cộng vào cả hai), ngân sách SIL-499 áp cho form fresh (overflow 0) — đã
  đo, không phải regression.
- Đo đạc: metric `identityDeadColumnPx` không phân biệt before/after (0 cả
  hai) — bằng chứng thật là `identityGridColumns` "470.797px 313.859px" →
  "792.672px"; các sweep sau đọc `gridCols` làm tín hiệu chính.
