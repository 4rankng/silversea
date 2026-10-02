-- Card 20260919_20 ordering requirement: trips that resolve only through
-- their fulfillment must carry shipment_id BEFORE the debit surfaces narrow
-- to active shipment-linked trips. Without this backfill those trips'
-- expense/freight rows vanish from BOTH document layers at once.
-- Active trips only: a canceled fulfillment-only trip is invisible before
-- AND after the scope change, so leaving it unlinked is lossless.
UPDATE trips t
SET shipment_id = f.shipment_id
FROM shipment_fulfillments f
WHERE t.fulfillment_id = f.id
  AND t.shipment_id IS NULL
  AND t.deleted_at IS NULL
  AND t.status <> 'CANCELED';
