ALTER TABLE "driver_incidental_costs" ADD COLUMN "receipt_storage_key" varchar(255);--> statement-breakpoint
ALTER TABLE "operational_sites" ADD COLUMN "drop_fee_invoice_name" varchar(255);--> statement-breakpoint
ALTER TABLE "operational_sites" ADD COLUMN "drop_fee_invoice_address" text;--> statement-breakpoint
ALTER TABLE "operational_sites" ADD COLUMN "drop_fee_tax_code" varchar(40);--> statement-breakpoint
ALTER TABLE "operational_sites" ADD COLUMN "cleaning_invoice_name" varchar(255);--> statement-breakpoint
ALTER TABLE "operational_sites" ADD COLUMN "cleaning_invoice_address" text;--> statement-breakpoint
ALTER TABLE "operational_sites" ADD COLUMN "cleaning_tax_code" varchar(40);