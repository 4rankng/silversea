ALTER TABLE "trailers" ALTER COLUMN "created_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "trailers" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "trailers" ALTER COLUMN "updated_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "trailers" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "trailers" ALTER COLUMN "deleted_at" SET DATA TYPE timestamp;--> statement-breakpoint
CREATE INDEX "trips_trailer_id_idx" ON "trips" USING btree ("trailer_id");