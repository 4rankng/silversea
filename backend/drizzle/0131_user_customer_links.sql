CREATE TABLE "user_customer_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_customer_links" ADD CONSTRAINT "user_customer_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_customer_links" ADD CONSTRAINT "user_customer_links_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_customer_links_user_customer_uniq_idx" ON "user_customer_links" USING btree ("user_id","customer_id");--> statement-breakpoint
CREATE INDEX "user_customer_links_user_idx" ON "user_customer_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_customer_links_customer_idx" ON "user_customer_links" USING btree ("customer_id");
--> statement-breakpoint
INSERT INTO "user_customer_links" ("user_id", "customer_id")
SELECT "id", "customer_id"
FROM "users"
WHERE "customer_id" IS NOT NULL
ON CONFLICT ("user_id", "customer_id") DO NOTHING;
