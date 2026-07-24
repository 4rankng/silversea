CREATE INDEX IF NOT EXISTS "expenses_date_idx" ON "expenses" USING btree ("expense_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_supplier_idx" ON "expenses" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_category_idx" ON "expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_vehicle_idx" ON "expenses" USING btree ("truck_id","vehicle_component");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entity_entity_id_idx" ON "ledger" USING btree ("entity_type","entity_id","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entity_txn_timestamp_idx" ON "ledger" USING btree ("entity_type","txn_type","timestamp");
