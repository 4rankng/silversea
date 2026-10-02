-- Card 20260921_6 — driver lot-cost classification rides the shared fee
-- catalog. Classification is DATA: requiresInvoice types are the invoiced
-- class (receivable after accountant confirm, invoice number mandatory at
-- entry), all other types never charge the customer. The card's names are
-- seeded so drivers pick from the catalog, never free-type a class.
ALTER TABLE "driver_incidental_costs" ADD COLUMN "expense_type_code" varchar(50);--> statement-breakpoint
INSERT INTO "forwarder_expense_types"
  (code, name, requires_invoice, status, billing_label)
VALUES
  -- invoiced class (phải thu khách sau khi KT phôi phiếu tích xác nhận)
  ('SANITATION', 'Phí vệ sinh', TRUE, 'ACTIVE', 'Phí vệ sinh'),
  ('YARD_STORAGE', 'Phí lưu bãi', TRUE, 'ACTIVE', 'Phí lưu bãi'),
  ('STORAGE_FEE', 'Phí lưu kho', TRUE, 'ACTIVE', 'Phí lưu kho'),
  -- no-invoice class (không bao giờ vào phải thu; phí khác tính doanh thu xe)
  ('WAREHOUSE_LABOR', 'Chi công nhân tại kho', FALSE, 'ACTIVE', NULL),
  ('CONTAINER_WELD', 'Hàn cont', FALSE, 'ACTIVE', NULL),
  ('TIRE_WEIGH', 'Cân lốp', FALSE, 'ACTIVE', NULL),
  ('CONTAINER_SWAP', 'Đảo vỏ', FALSE, 'ACTIVE', NULL),
  ('TWO_POINT_DROP', 'Đóng/trả 2 điểm', FALSE, 'ACTIVE', NULL),
  ('CARGO_RESTACK', 'Đảo hàng', FALSE, 'ACTIVE', NULL),
  ('FORKLIFT_DANGKHOA', 'Phí xe nâng hạ đăng khoa', FALSE, 'ACTIVE', NULL)
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint
