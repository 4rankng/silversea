-- SIL-923 — Đề nghị điều chỉnh lô đã khóa chi phí: người khóa lô nhưng không
-- có quyền mở khóa (nhóm CUS) gửi đề nghị kèm lý do; bộ mở khóa (Quản trị ·
-- Giám đốc · Kế toán) thấy đề nghị và xử lý bằng việc mở khóa lô (mở khóa
-- giải quyết mọi đề nghị PENDING của lô). Idempotency-Key chống ghi trùng.
CREATE TABLE IF NOT EXISTS "shipment_cost_adjust_requests" (
	"id" serial PRIMARY KEY,
	"shipment_id" integer NOT NULL,
	"cost_lock_id" integer NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(16) NOT NULL DEFAULT 'PENDING',
	"requested_by" integer NOT NULL,
	"requested_at" timestamp with time zone NOT NULL DEFAULT now(),
	"resolved_by" integer,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"idempotency_key" varchar(120) NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS "shipment_cost_adjust_requests_pending_idx" ON "shipment_cost_adjust_requests" ("shipment_id") WHERE status = 'PENDING';
