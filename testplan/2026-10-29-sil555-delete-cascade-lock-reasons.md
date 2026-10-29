# SIL-555 (id 629) — xóa lô cascade container + tách lý do khóa trên nút Xóa

- **Case ID:** case-2026-10-29-sil555-delete-cascade-lock-reasons
- **Ticket:** SIL-555 — "[BUG] Drawer 'Chi tiết container': thiếu nút XÓA CONT…"
- **QA bounce (29/10, build df6047f3/28c3a120):** nút xóa hoạt động nhưng (1) lô K2K4124325234 vẫn còn 2 container thay vì 1 (dòng rác từ đợt kiểm thử trước đọng lại — hệ quả lớp lỗi "state container sống sau thao tác xóa"), (2) khóa chuyến xe không kiểm chứng độc lập được (dòng có chuyến cũng mang tờ khai → disabled không quy được riêng cho chuyến).

## Fix 1 — delete cascade (BE)

`softDeleteShipment` giờ **sweep toàn bộ `shipmentContainers` của lô** trong cùng transaction (sau guard live-trip + khóa kế toán + hủy fulfillment, trước khi soft-delete lô). Cùng lớp hard-delete với remove-per-row (CUS workspace) và quét FCL→LCL (shipment-update). Lô vẫn soft-delete giữ audit trail → một lô đã xóa không còn leaves container state nào phía sau.

Repro class lỗi: xóa lô (hoặc dọn lô test) → container rows của lô vẫn nằm trong DB → "còn sót container" đọng qua các đợt dọn dẹp.

## Fix 2 — tách điều kiện lock (FE drawer)

Nút "Xóa container" đặt `title` liệt kê **từng lý do độc lập**:
- Chỉ có tờ khai: `Cont có tờ khai <số> — gỡ tờ khai trước khi xóa`.
- Chỉ có chuyến: `Container đã gắn chuyến xe — hủy hoặc thay thế lệnh điều xe trước khi xóa` → **khóa chuyến-xe-only giờ kiểm chứng được riêng** (đúng gap QA nêu).
- Có cả hai: title nêu CẢ HAI lý do.

## Test

- BE: `backend/src/tests/unit/shipment-delete-container-cascade.test.ts` (4 case source-scan: cascade tồn tại, thứ tự sau guard live-trip/khóa kế toán/hủy fulfillment, lô vẫn soft-delete).
- FE: `DispatchContainerDetailDrawer.test.tsx` — trip-only reason (mới), both-locks title (mới), SIL-177 declaration-only giữ nguyên, CANCELED trip không khóa, role/lock laws giữ nguyên.

## Manual QA check (staging, sau deploy)

1. Tạo lô test 2 container → xóa lô → hỏi DB: `select count(*) from shipment_containers where shipment_id = <id>` = 0.
2. Drawer chi tiết container: dòng chỉ có chuyến (không tờ khai) → nút disabled + title nêu lý do chuyến xe.
3. Dọn lô K2K4124325234: xóa TEST1234575 + TEST1234596 bằng nút Xóa container (QA sở hữu dữ liệu staging).
