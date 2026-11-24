-- Ruling PM/PO 24/11 (SIL-923, KB Ch.10 §10.1.5): luồng ticketing
-- [Đề nghị điều chỉnh] bị loại bỏ (Scope Creep, ngoài SRS V6.0) — xóa luôn
-- bảng trạng thái của nó. Lô đã khóa mở trực tiếp qua [Mở khóa lô]
-- (POST /api/shipments/:id/unlock) với lý do bắt buộc + audit log.
DROP TABLE IF EXISTS "shipment_cost_adjust_requests";
