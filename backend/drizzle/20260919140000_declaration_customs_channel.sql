-- Card 20260919_5: customs clearance channel (luồng đỏ/vàng/xanh) at the
-- declaration level. Text-backed applicationEnum (house pattern, mirrors
-- declaration scope); API+schema reject invalid values (zod enum), DB keeps
-- the values open exactly like every other applicationEnum. Nullable —
-- unset channels render '—', never a guessed default.
ALTER TABLE "shipment_declarations" ADD COLUMN "channel" text;
