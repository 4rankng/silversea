ALTER TABLE "customers" ADD COLUMN "short_name" varchar(255);--> statement-breakpoint
ALTER TABLE "operational_sites" ADD COLUMN "short_name" varchar(255);--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "short_name" varchar(255);