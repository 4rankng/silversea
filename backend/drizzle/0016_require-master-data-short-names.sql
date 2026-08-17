ALTER TABLE "customers" ALTER COLUMN "short_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "operational_sites" ALTER COLUMN "short_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "routes" ALTER COLUMN "short_name" SET NOT NULL;