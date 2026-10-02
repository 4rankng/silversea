-- Card 20260921_13: per-trip phoi (phôi phiếu) take-over metadata for the
-- accountant chi-ho detail dialog. Additive; fresh-replay safe.
ALTER TABLE "trip_financial_state" ADD COLUMN "phoi_taken_date" date;
ALTER TABLE "trip_financial_state" ADD COLUMN "phoi_take_status" varchar(30);
