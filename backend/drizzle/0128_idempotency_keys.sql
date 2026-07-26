CREATE TABLE "idempotency_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint" varchar(100) NOT NULL,
	"idempotency_key" varchar(100) NOT NULL,
	"entity_type" varchar(50),
	"entity_id" integer,
	"payload_hash" varchar(64) NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_endpoint_key_uniq" ON "idempotency_keys" USING btree ("endpoint","idempotency_key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_entity_idx" ON "idempotency_keys" USING btree ("entity_type","entity_id");