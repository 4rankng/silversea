-- Add missing dispatch task tags from customer feedback (2026-09-07).
-- "Trả vỏ" and "Giao thẳng" were requested but not seeded in 0058.
-- ON CONFLICT keeps re-runs safe.
INSERT INTO "dispatch_task_tags" ("label", "normalized_label") VALUES
	('Trả vỏ', 'trả vỏ'),
	('Giao thẳng', 'giao thẳng')
ON CONFLICT ("normalized_label") DO NOTHING;
