CREATE INDEX "ledger_entity_entity_idx" ON "ledger" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "trips_status_idx" ON "trips" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trips_departure_date_idx" ON "trips" USING btree ("departure_date");--> statement-breakpoint
CREATE INDEX "trips_customer_departure_idx" ON "trips" USING btree ("customer_id","departure_date");