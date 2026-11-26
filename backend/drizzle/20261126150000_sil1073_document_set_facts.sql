-- SIL-1073 (KB Ch3 §3.5.4, Lớp 2) — lịch sử độ đầy đủ bộ hồ sơ chứng từ gốc
-- của lô (Còn thiếu / Đang bổ sung / Đã đủ + Người nhận + Ngày nhận thực tế +
-- danh mục tài liệu còn thiếu cho màn "Nợ chứng từ"). drizzle/meta đã hỏng từ
-- trước; viết tay + re-run an toàn nhờ IF NOT EXISTS (house convention).
CREATE TABLE IF NOT EXISTS "shipment_document_set_facts" (
  "id" serial PRIMARY KEY,
  "shipment_id" integer NOT NULL,
  "shipment_version" integer NOT NULL,
  "status" varchar(20) NOT NULL,
  "missing_documents" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "receiver_name" varchar(160),
  "received_on" date,
  "changed_by" integer NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_document_set_facts_shipment_idx" ON "shipment_document_set_facts" ("shipment_id", "changed_at");
