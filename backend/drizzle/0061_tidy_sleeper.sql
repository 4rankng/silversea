CREATE TABLE "dispatch_task_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" varchar(80) NOT NULL,
	"normalized_label" varchar(80) NOT NULL,
	"created_by" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_task_tags_normalized_label_unique" UNIQUE("normalized_label")
);
--> statement-breakpoint
-- Seed the six operational defaults so the tag pool is the single source
-- from day one (user decision 2026-09-07). ON CONFLICT keeps re-runs and
-- environments where the table pre-exists safe.
INSERT INTO "dispatch_task_tags" ("label", "normalized_label") VALUES
	('Đặt đầu', 'đặt đầu'),
	('Đặt đuôi', 'đặt đuôi'),
	('Đảo vỏ', 'đảo vỏ'),
	('Gửi bãi', 'gửi bãi'),
	('Lấy vỏ ICD đi đóng', 'lấy vỏ icd đi đóng'),
	('Di động', 'di động')
ON CONFLICT ("normalized_label") DO NOTHING;
