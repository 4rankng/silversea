-- ports.code uniqueness becomes partial: only real codes on live rows are
-- unique. The plain unique index turned a legacy empty-string row into a
-- landmine — every create with an empty/absent code collided with it and
-- surfaced as a raw 500 (NULLs never collide in a PG btree; '' did).
UPDATE ports SET code = NULL WHERE code = '';
--> statement-breakpoint
ALTER TABLE ports DROP CONSTRAINT IF EXISTS ports_code_unique;
--> statement-breakpoint
DROP INDEX IF EXISTS ports_code_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ports_code_unique
  ON ports (code) WHERE code IS NOT NULL AND code <> '' AND deleted_at IS NULL;
