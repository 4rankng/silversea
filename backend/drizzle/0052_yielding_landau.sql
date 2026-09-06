-- Lean-down: merge 1:1 shipment_container_charge_facts into
-- shipment_containers (manual charge proposals live on the container row).
-- Property names unchanged so the proposal field-map, checksum shape, and
-- API payloads are untouched; proposalFactId now equals the container id.
-- Prod rows: 0 (2026-09-06 pre-flight) — the UPDATE ... FROM is a no-op
-- safety net for dev DBs that still hold rows.

ALTER TABLE "shipment_containers" ADD COLUMN "charge_proposal_version" integer DEFAULT 1 NOT NULL;-->
--> statement-breakpoint
ALTER TABLE "shipment_containers" ADD COLUMN "charge_outbound_transport_amount" numeric(15, 0);-->
--> statement-breakpoint
ALTER TABLE "shipment_containers" ADD COLUMN "charge_outbound_handling_amount" numeric(15, 0);-->
--> statement-breakpoint
ALTER TABLE "shipment_containers" ADD COLUMN "charge_outbound_incidental_amount" numeric(15, 0);-->
--> statement-breakpoint
ALTER TABLE "shipment_containers" ADD COLUMN "charge_inbound_transport_amount" numeric(15, 0);-->
--> statement-breakpoint
ALTER TABLE "shipment_containers" ADD COLUMN "charge_inbound_handling_amount" numeric(15, 0);
--> statement-breakpoint
UPDATE "shipment_containers" sc SET
  "charge_proposal_version" = f."version",
  "charge_outbound_transport_amount" = f."outbound_transport_amount",
  "charge_outbound_handling_amount" = f."outbound_handling_amount",
  "charge_outbound_incidental_amount" = f."outbound_incidental_amount",
  "charge_inbound_transport_amount" = f."inbound_transport_amount",
  "charge_inbound_handling_amount" = f."inbound_handling_amount"
FROM "shipment_container_charge_facts" f
WHERE f."shipment_container_id" = sc."id";--> statement-breakpoint
--> statement-breakpoint
DROP TABLE "shipment_container_charge_facts" CASCADE;-->
