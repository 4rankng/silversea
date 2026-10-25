# SIL-478 — /shipments-debit mobile: rows trống (badge + '…' xếp dọc), rebuild grouped rows

- **Case ID:** SIL-478-REG-1
- **Ticket:** plan.tingting.vip SIL-478 (id 537) — [Owner][P0], ảnh `shipments-debit-mobile-truoc.jpg` (391px)
- **Surface:** danh sách thẻ điện thoại của `/shipments-debit` (Chi phí - Quyết toán), ≤640px
- **Role:** CUS (chỉ xem) + ACCOUNTANT/ADMIN (quản lý) — ảnh owner chụp ở 391px

## Reproduction

1. Mở `/shipments-debit` ở viewport phone (≤640px).
2. Nhìn dải danh sách lô dưới dải tổng `Tổng (N lô)`.

## Observed (trước fix — ảnh owner + audit)

- Row chỉ còn badge 'Đang mở' (outline, font lạ) + nút '…' xếp dọc góc phải → row cao gấp đôi; 65–70% trái TRẮNG (không tên KH/tiền/ngày/mã); 1 row highlight sage; contrast washed-out.
- Ảnh owner chụp trên build cũ (staging): lúc đó bảng desktop (`DebitLotTable`, 1348px) render thu nhỏ ở 391px thay vì thẻ điện thoại. Trên build hiện tại (8cea1a6b) thẻ CÓ render nhưng mỗi thẻ ~330px: Bill làm title, KH làm subtitle, 5 dòng fact (phần lớn rỗng khi tiền pending), nút 'Mở chi tiết lô' riêng, 'Chi tiết' disclosure lồng nhau.

## Root cause (P0 data binding — đã verify)

- **Data KHÔNG thiếu:** API `GET /shipments/debit-summary` (local, role cus) trả 208/208 rows có `customerName` + `billOrBookNumber` đầy đủ (probe 25/10) ⇒ không phải bug query phía identity.
- Khoảng trống trong ảnh = bảng desktop bị squeeze ở phone (build cũ) + các fact tiền `null` (chưa xác định) render rỗng trên thẻ label-rỗng.
- Binding thật còn 2 lỗ hổng kiểu: `customerName` khai báo `string` ở FE trong khi shared zod cho phép `null` (LEFT JOIN customers có thể miss) — subtitle có thể rỗng im lặng; và wire **thiếu** `ngày` + `số cont` cho meta line theo verdict ⇒ bổ sung vào BE query.

## Expected (spec verdict 24/10 — owner "IMPLEMENT THEO VERDICT")

- **(a) Row:** grid 2 cột `minmax(0,1fr) auto`, padding 12px, min-height 64px; trái dòng 1 = tên KH 14px/600 (truncate, fallback '—' — không bao giờ trống), dòng 2 = meta 12px `Số Bill/Booking · ngày giao · n cont` (segment thiếu thì drop, không bịa 0); phải cùng baseline = tiền Doanh thu 16px/600 tabular (number | 0 | blank pending) + status chip 24px pill CÓ MÀU (Đang mở #EFF8FF/#B2DDFF/#175CD3; Đã khóa = neutral #F2F4F7/#EAECF0/#344054).
- **(b) Bỏ nút '…'/'Mở chi tiết lô' khỏi row** — tap row mở detail (manager: workspace quyết toán; reader: các fact còn lại). Checkbox chọn vẫn nằm trong row và không kích hoạt tap.
- **(c) Grouped container:** 1 viền 1px #EAECF0, radius 12px, nền trắng, divider hairline giữa các row, không gap/shadow từng row.
- **(d) Badge về UI font nhà** (Be Vietnam Pro), 12px/500, không italic/script.
- **(e) Bỏ highlight sage** — `:active`/selected chỉ `--surface-2`.
- **(f) Data binding:** nếu payload null → fallback '—', không ẩn cả trái; unit test props.

## Fix

- **BE** `shipment-debit-summary.service.ts`: select thêm `expectedDeliveryDate`; gom `SUM(container_count)` trên scope trip active (không deleted/CANCELED — KHÔNG bắt fulfillment, đó là luật tiền) trong chính query trip-count có sẵn; map `deliveryDate`/`containerCount` (null khi lot chưa có trip). Shared zod thêm 2 field `.nullable().optional()` (skew-safe).
- **FE** `shipmentDebit.ts`: `customerName: string | null` (khớp wire — hết nói dối kiểu); thêm `deliveryDate?`/`containerCount?`.
- **FE** `ShipmentDebitRecords.tsx`: map sang `LedgerGroupedList` mới — KH/trên, meta dưới, tiền + chip phải, tap-mở-detail (manager dùng expandedId page; reader state cục bộ), tick luôn hiện với canManage.
- **FE** `components/shared/LedgerGroupedList.tsx` + `.css`: pattern grouped rows dùng chung (container 12px, divider hairline, row grid, chip 24px theo `--chip-*` tokens mới trong `tokens.css`, :active/selected `--surface-2`, pager 20/trang). Không đụng `LedgerRecordList` (6 consumer khác giữ nguyên).

## Regression coverage

- FE scoped vitest: `ShipmentDebitRecords.test.tsx` (viết lại + mới: P0 null-KH→'—', meta drop segment, chip tone, tap-mở, tick không kích hoạt tap, BD-01/03 F-2 lane law trên mặt expanded), `LedgerGroupedList.test.tsx` mới (phone-only, keyboard, checkbox tách tap, pager, CSS pins 24px/999/12px/token, tokens pin), `ShipmentDebitPage*.test.tsx` (14 files/144+ pass), tsgo 0 lỗi.
- BE unit: `shipment-debit-summary-row-meta.test.ts` mới (source pin + schema parse; active-scope KHÔNG có fulfillmentId) — 491 pass, tsc 0 lỗi.
- Screenshots trước/sau 390/768 (cus + admin) + DOM probe: `qa/2026-10-25-sil478/`, driver `qa/scripts/2026-10-25-sil478-debit-mobile-shots.mjs`.
