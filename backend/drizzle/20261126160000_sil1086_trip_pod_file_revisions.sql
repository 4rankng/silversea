-- SIL-1086 (K2.57) — lịch sử thay thế tệp e-POD đã lưu. Bản ghi append-only:
-- mỗi lần thay file của submission đã nộp/lưu, phiên bản cũ chuyển sang đây
-- (kèm storage key cũ — blob cũ được GIỮ lại để xem/tải lại) cùng ai tải lên,
-- ai thay và lúc nào. drizzle/meta đã hỏng từ trước; viết tay + re-run an toàn
-- nhờ IF NOT EXISTS (house convention, giống 20261126150000_sil1073).
CREATE TABLE IF NOT EXISTS "trip_pod_file_revisions" (
  "id" serial PRIMARY KEY,
  "file_id" integer NOT NULL,
  "submission_id" integer NOT NULL,
  "file_type" varchar NOT NULL,
  "storage_key" varchar(255) NOT NULL,
  "original_file_name" varchar(255) NOT NULL,
  "mime_type" varchar(120) NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "uploaded_by" integer NOT NULL,
  "uploaded_at" timestamp with time zone NOT NULL,
  "replaced_by" integer NOT NULL,
  "replaced_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revision" integer NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trip_pod_file_revisions_file_revision_uniq_idx" ON "trip_pod_file_revisions" ("file_id", "revision");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trip_pod_file_revisions_submission_idx" ON "trip_pod_file_revisions" ("submission_id");
