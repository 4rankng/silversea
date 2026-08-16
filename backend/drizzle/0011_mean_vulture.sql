ALTER TABLE "shipments" ADD CONSTRAINT "shipments_document_reference_direction_check" CHECK (
    not ("shipments"."bl_number" is not null and "shipments"."booking_ref" is not null)
    and ("shipments"."trade_direction" is distinct from 'IMPORT' or "shipments"."booking_ref" is null)
    and ("shipments"."trade_direction" is distinct from 'EXPORT' or "shipments"."bl_number" is null)
  );