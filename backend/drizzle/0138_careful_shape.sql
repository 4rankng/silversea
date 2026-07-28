CREATE TABLE "payment_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_id" varchar(100) NOT NULL,
	"customer_id" integer NOT NULL,
	"received_amount" numeric(15, 0) NOT NULL,
	"allocated_total" numeric(15, 0) NOT NULL,
	"unapplied_amount" numeric(15, 0) NOT NULL,
	"allocation_method" varchar(20) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_receipts_received_amount_nonneg_check" CHECK ("payment_receipts"."received_amount" >= 0),
	CONSTRAINT "payment_receipts_allocated_total_nonneg_check" CHECK ("payment_receipts"."allocated_total" >= 0),
	CONSTRAINT "payment_receipts_unapplied_amount_nonneg_check" CHECK ("payment_receipts"."unapplied_amount" >= 0),
	CONSTRAINT "payment_receipts_amount_consistency_check" CHECK ("payment_receipts"."received_amount" = "payment_receipts"."allocated_total" + "payment_receipts"."unapplied_amount"),
	CONSTRAINT "payment_receipts_allocation_method_check" CHECK ("payment_receipts"."allocation_method" in ('OLDEST_DUE', 'EXPLICIT'))
);
--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN "payment_receipt_id" integer;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD COLUMN "allocation_order" integer;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_receipts_receipt_id_uniq" ON "payment_receipts" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "payment_receipts_customer_created_idx" ON "payment_receipts" USING btree ("customer_id","created_at");--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_receipt_id_payment_receipts_id_fk" FOREIGN KEY ("payment_receipt_id") REFERENCES "public"."payment_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocations_receipt_order_uniq" ON "payment_allocations" USING btree ("payment_receipt_id","allocation_order") WHERE "payment_allocations"."payment_receipt_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocations_receipt_target_uniq" ON "payment_allocations" USING btree ("payment_receipt_id","target_type","target_id") WHERE "payment_allocations"."payment_receipt_id" is not null;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount_positive_check" CHECK ("payment_allocations"."amount" > 0);--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_order_positive_check" CHECK ("payment_allocations"."allocation_order" is null or "payment_allocations"."allocation_order" > 0);
