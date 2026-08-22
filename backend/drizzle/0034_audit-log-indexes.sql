-- The audit log grows on every governed write. Entity-correlation lookups
-- (entity_type + entity_id) and user-scoped audit queries previously scanned
-- the whole table — these indexes keep them O(log n) as the table grows.
CREATE INDEX IF NOT EXISTS "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");
