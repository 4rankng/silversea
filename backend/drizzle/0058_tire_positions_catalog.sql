CREATE TABLE IF NOT EXISTS "tire_positions" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(64) NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp,
  CONSTRAINT "tire_positions_name_unique" UNIQUE("name")
);--> statement-breakpoint

INSERT INTO "tire_positions" ("name", "sort_order")
VALUES
  ('Trước trái', 10),
  ('Trước phải', 20),
  ('Sau ngoài trái', 30),
  ('Sau ngoài phải', 40),
  ('Sau trong trái', 50),
  ('Sau trong phải', 60),
  ('Lốp dự phòng', 70)
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint

INSERT INTO "tire_positions" ("name", "sort_order")
SELECT DISTINCT trim("position"), 1000
FROM "tires"
WHERE "position" IS NOT NULL
  AND trim("position") <> ''
ON CONFLICT ("name") DO NOTHING;
