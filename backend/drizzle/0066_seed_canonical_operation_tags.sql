-- 2026-09-10 ticket a6cb2543 (Replace the tags): the dispatch task-tag pool
-- becomes the canonical 14-tag operation set, verbatim and in this exact
-- order (no translation, no diacritic changes — breve GẮP, dot-below HẠ).
-- Rows whose normalized label already exists (e.g. "Đặt đầu") are updated to
-- the canonical uppercase label + display order and stay active. Every other
-- active row is DEACTIVATED (never deleted — historical notes keep their
-- text; parseNote degrades unmatched segments to manual text per the pool
-- contract). Dispatcher-added labels after this seed list after the
-- canonical set (display_order null).
ALTER TABLE "dispatch_task_tags" ADD COLUMN "display_order" integer;
--> statement-breakpoint
INSERT INTO "dispatch_task_tags" ("label", "normalized_label", "display_order") VALUES
  ('HẾT HẠN', 'hết hạn', 1),
  ('ĐẢO VỎ', 'đảo vỏ', 2),
  ('ĐẶT ĐUÔI', 'đặt đuôi', 3),
  ('ĐẶT ĐẦU', 'đặt đầu', 4),
  ('KIỂM HÓA', 'kiểm hóa', 5),
  ('QUAY ĐẦU', 'quay đầu', 6),
  ('GỬI VỎ BÃI ĐĂNG KHOA', 'gửi vỏ bãi đăng khoa', 7),
  ('QUÁ TẢI', 'quá tải', 8),
  ('ĐẢO HÀNG', 'đảo hàng', 9),
  ('HẠ VỎ ICD QUẾ VÕ', 'hạ vỏ icd quế võ', 10),
  ('GẮP VỎ ICD QUẾ VÕ', 'gặp vỏ icd quế võ', 11),
  ('GẮP VỎ BÃI ĐĂNG KHOA', 'gặp vỏ bãi đăng khoa', 12),
  ('HẠ VỎ BÃI TRI PHƯƠNG', 'hạ vỏ bãi tri phương', 13),
  ('GẮP VỎ BÃI TRI PHƯƠNG', 'gặp vỏ bãi tri phương', 14)
ON CONFLICT ("normalized_label") DO UPDATE SET
  "label" = EXCLUDED.label,
  "display_order" = EXCLUDED.display_order,
  "is_active" = true;
--> statement-breakpoint
UPDATE "dispatch_task_tags" SET "is_active" = false
WHERE "display_order" IS NULL AND "is_active" = true;
