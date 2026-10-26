# SIL-504 — Badge hàng lẻ + text rợp cell Tổng quan hàng hóa

- **Ticket:** SIL-504 `[CUS][UX] Tổng quan: phân biệt HÀNG LẺ vs CONT — badge NHẬP LẺ/XUẤT LẺ (hoặc icon LẺ) + sửa text 'Không có hàng lẻ chọn ngay đã chọn'`
- **Reported:** CUS 26/10 (ảnh ticket: /shipments, filter Tháng 10/2026, các row LOG COM hàng lẻ)
- **Branch:** `fix-504-lcl-badge` (base `main` @ `6d53c4c0`)

## Bug 1 — Text rợp cell Tổng quan hàng hóa (row hàng lẻ)

**Repro:**
1. Đăng nhập CUS, mở `/shipments`.
2. Bật filter khoảng ngày (vd `01/10 – 31/10` hoặc preset Tháng hiện tại).
3. Nhìn row hàng LẺ chưa có appointment trong khoảng lọc (vd lot LCL 272/319/338 ở dev DB).

**Actual (build trong ảnh ticket):** cell `Tổng quan hàng hóa` in nhãn dài
`Không có hàng lẻ chạy ngày đã chọn` xuống 3 dòng — chữ quấn `"chạy ngày đã" / "chọn"` đọc thành
`"...chọn ngay đã chọn"` (chữ rợp/khó đọc), kèm cân nặng bên dưới.

**Expected:** nhãn rỗng ngày của hàng lẻ là chữ ngắn `Chưa chọn hàng lẻ` (quyết định owner 26/10 —
phương án "hidden" không chọn vì cell vẫn phải giải thích vì sao chỉ còn cân nặng khi filter ngày
đang bật). Row cont giữ nguyên `Không có cont chạy ngày đã chọn`.

## Bug 2 — Badge cột Phân loại phân biệt hàng lẻ với cont

**Repro:** `/shipments` (cột `Phân loại & hãng tàu`) và `/shipments-detail` (cột `Nhập/Xuất`),
so sánh row hàng lẻ cạnh row cont.

**Actual trong ảnh ticket:** row hàng lẻ chỉ hiện `Nhập` — giống hệt row cont, không phân biệt được.

**Expected:** row hàng lẻ hiện `Nhập lẻ` / `Xuất lẻ` trên cùng badge direction (card
261022213755c — owner ruling: classification là thông tin, không thêm chrome thứ hai); row cont
giữ `Nhập` / `Xuất`.

**Trạng thái:** 4fadceb5 (22/10) đã sửa 2 label helper (`cusUtils.directionLabel(direction,
cargoMode)` + `shipment-container-ledger-utils.directionLabel(direction, isLotLevel)`) — ảnh ticket
chụp build cũ hơn mốc đó. Lane này KHÔNG đụng lại 2 helper; việc của lane là (a) quét consumer sót
— bắt được `cusExport.mapCusWorksheetRow` gọi `directionLabel(item.direction)` thiếu cargoMode →
file xuất vẫn ghi `Nhập` cho lô lẻ trong khi màn hình hiện `Nhập lẻ` (sửa kèm), và (b) UI-drive
chứng minh 2 trang hiển thị đúng pattern sau khi land.

## Phạm vi câm lặng

- Không đụng cell render vùng LCL của `/shipments-detail` mà lane SIL-503 (cell dead tờ khai/phân xe)
  đang sở hữu — 2 lane khác file render (`ShipmentContainerLedger.tsx` của 503 vs `cusUtils.ts`/`cusExport.ts`
  của lane này); lane này không sửa `ShipmentContainerLedger.tsx`.
- Không đổi wording FCL `Không có cont chạy ngày đã chọn`, không đổi drawer FactCell "Hình thức XNK"
  (drawer đã phân biệt qua title chip `Hàng LCL` từ SIL-485).

## Kiểm chứng

- Unit: `cusUtils.signals.test.ts` (label mới), `CusShipmentRow.cus-cards.test.tsx` (R3 + badge pins),
  `cusExport.test.ts` (pin direction theo cargoMode trong file xuất).
- UI drive 1440: `/shipments` row lẻ cạnh row cont (badge + text ngắn, filter ngày bật),
  `/shipments-detail` lot-row cạnh cont-row (badge) — screenshot + DOM assert.
