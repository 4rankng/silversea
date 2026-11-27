-- SIL-1138 (QA 27/11) — "Chỉnh sửa điều phối": tên/SĐT tài xế nhà xe ngoài
-- nhập ở mục "Phát lệnh cho tài xế" phải sống qua "Lưu thay đổi" (PATCH
-- .../plan) và đọc lại khi mở hộp thoại — trước đây chỉ chuyến phát hành
-- (trip_carrier_info) giữ hai giá trị này nên lưu plan rồi mở lại là mất
-- lặng. Hai cột nullable thêm mới, không backfill: dòng chưa nhập là hợp lệ.
-- IF NOT EXISTS = re-run an toàn (house convention, giống 20261127160000_sil1133).
ALTER TABLE "shipment_fulfillments" ADD COLUMN IF NOT EXISTS "planned_external_driver_name" varchar(100);
ALTER TABLE "shipment_fulfillments" ADD COLUMN IF NOT EXISTS "planned_external_driver_phone" varchar(20);
