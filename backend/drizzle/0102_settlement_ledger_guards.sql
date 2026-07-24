DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ledger"
    WHERE "txn_type" = 'FORWARDER_SETTLEMENT'
    GROUP BY "txn_type", "txn_id", "entity_type", "entity_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate FORWARDER_SETTLEMENT ledger rows require manual append-only reconciliation before migration';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_forwarder_settlement_once_idx"
  ON "ledger" USING btree ("txn_type", "txn_id", "entity_type", "entity_id")
  WHERE "ledger"."txn_type" = 'FORWARDER_SETTLEMENT';
