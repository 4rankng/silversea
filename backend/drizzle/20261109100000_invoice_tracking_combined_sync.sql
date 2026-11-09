-- SIL-762 (id 883) — Bảng Theo dõi hóa đơn kết hợp: tự động đồng bộ khi tích
-- [Kết hợp], trạng thái mặc định "Chưa lấy HĐ", nút Lưu và Ẩn.
--
-- Trước: invoice_tracking chỉ nhận dòng kế toán gõ tay (bắt buộc trip_id và
-- invoice_number). Khi CUS/Điều vận tích [Kết hợp] trên lô, các container
-- KHÔNG tự đổ sang bảng — kế toán phải nhập từng dòng.
--
-- Sau: cột mới cho phép dòng tự động đồng bộ từ lô:
--   * trip_id nullable        — dòng sync từ lô chưa có chuyến nào.
--   * invoice_number nullable — dòng mới đồng bộ ở trạng thái "Chưa lấy HĐ"
--                               (chưa có hóa đơn; số hóa đơn điền sau).
--   * container_number        — số container của dòng (từ shipment_containers);
--                               null trên dòng cũ = tiếp tục suy ra từ chuyến.
--   * sync_source             — 'AUTO_COMBINED' đánh dấu dòng máy tạo; dòng
--                               kế toán gõ tay giữ null để sync không đụng.
--   * no_invoice              — tích "Không lấy hóa đơn" (nút Lưu và Ẩn).
--   * hidden_at / hidden_by   — Lưu và Ẩn: ẩn khỏi danh sách làm việc, còn
--                               vết lịch sử (ai, lúc nào) tra được qua bộ lọc.
--
-- Migration viết tay theo tiền lệ 20261107170000_driver_timesheet_day_source:
-- chuỗi snapshot drizzle/meta đã hỏng từ trước nên `drizzle-kit generate`
-- không dùng được cho repo này. Dòng cũ giữ nguyên giá trị (no_invoice=false,
-- hidden_at NULL) — không restatements, re-run an toàn nhờ IF NOT EXISTS.
ALTER TABLE "invoice_tracking" ALTER COLUMN "trip_id" DROP NOT NULL;
ALTER TABLE "invoice_tracking" ALTER COLUMN "invoice_number" DROP NOT NULL;
ALTER TABLE "invoice_tracking" ADD COLUMN IF NOT EXISTS "container_number" varchar(50);
ALTER TABLE "invoice_tracking" ADD COLUMN IF NOT EXISTS "sync_source" varchar(20);
ALTER TABLE "invoice_tracking" ADD COLUMN IF NOT EXISTS "no_invoice" boolean DEFAULT false NOT NULL;
ALTER TABLE "invoice_tracking" ADD COLUMN IF NOT EXISTS "hidden_at" timestamp with time zone;
ALTER TABLE "invoice_tracking" ADD COLUMN IF NOT EXISTS "hidden_by" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_tracking_shipment_container_idx" ON "invoice_tracking" ("shipment_id","container_number");
