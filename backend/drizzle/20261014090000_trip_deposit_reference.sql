-- Card 20261005 — "Cược" Bill/Book trên màn hình phơi phiếu.
--
-- Kế toán ghi số Bill/Book mà lái xe được giao để đi cược, gắn với chính lô
-- hàng được chọn từ ô gợi ý (không tạo cột mới ở hồ sơ khách hàng). Hai cột
-- nullable: NULL = chưa nhập cược. deposit_shipment_id là app-level FK →
-- shipments.id (theo convention của trips.shipment_id), không thêm ràng buộc
-- DB để tránh RESTRICT khi lô bị tombstone.
ALTER TABLE "trips" ADD COLUMN "deposit_shipment_id" integer;
ALTER TABLE "trips" ADD COLUMN "deposit_bill_number" varchar(100);
