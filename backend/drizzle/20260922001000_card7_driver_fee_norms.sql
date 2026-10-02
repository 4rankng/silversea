-- Card 20260921_7 — driver road/allowance fee norms (định mức) as CONFIG
-- DATA. Amounts are the defaults the FE pre-fills; drivers may override the
-- actual amount. All norms are cost_group DRIVER_ROAD — road fees never bill
-- the customer (AC1). Codes mirror the retired-at-FE-layer static suggestion
-- constants for continuity; the customer's per-route road norms (AC6) are
-- deliberately absent until supplied.
CREATE TABLE IF NOT EXISTS "driver_fee_norms" (
  "id" serial PRIMARY KEY,
  "code" varchar(50) NOT NULL UNIQUE,
  "label" varchar(120) NOT NULL,
  "amount" numeric(15, 0) NOT NULL,
  "cost_type" varchar(30) NOT NULL,
  "cost_group" varchar(20) NOT NULL DEFAULT 'DRIVER_ROAD',
  "status" varchar(20) NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
INSERT INTO "driver_fee_norms" (code, label, amount, cost_type)
VALUES
  ('LIFT_DROP_ALLOWANCE', 'Phụ cấp nâng/hạ Lạch Huyện, TIL, Hateco', 50000, 'LIFT_DROP_ZONE'),
  ('NIGHT_RETURN', 'Trả đêm', 100000, 'ROAD_ALLOWANCE'),
  ('TURNAROUND', 'Chạy hàng quay đầu', 100000, 'ROAD_ALLOWANCE'),
  ('OVERLOAD', 'Chạy hàng quá tải', 200000, 'ROAD_ALLOWANCE'),
  ('ICD_RELOCATION', 'Đảo chuyển ICD/Đăng Khoa', 200000, 'ROAD_ALLOWANCE'),
  ('SUNDAY', 'Chạy hàng chủ nhật', 200000, 'ROAD_ALLOWANCE'),
  ('SHIFT', 'Lưu ca', 200000, 'ROAD_ALLOWANCE'),
  ('SPECIAL_CONTAINER', 'Cont 45''HC / Cont lạnh', 200000, 'ROAD_ALLOWANCE')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint
