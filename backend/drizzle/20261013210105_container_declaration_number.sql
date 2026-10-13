-- Card 261013200312 (dev-lead ruling 2026-10-13): số tờ khai becomes
-- PER-CONTAINER entry. CUS enters/edits the number per cont (divergence
-- allowed), with a copy affordance that repeats it onto the lot's still-empty
-- containers. The shipment_declarations ENTITY (globally-unique numbers,
-- documents flow, finance exports) is unchanged and stays a separate concern:
-- its unique index could never hold the same number on N rows, so the
-- per-cont operational value lives as an attribute of the container row.
ALTER TABLE "shipment_containers" ADD COLUMN "declaration_number" varchar(50);
