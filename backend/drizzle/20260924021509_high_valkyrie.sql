CREATE TABLE "debit_settlement_round_lots" (
	"round_id" integer NOT NULL,
	"shipment_id" integer NOT NULL,
	CONSTRAINT "debit_settlement_round_lots_round_id_shipment_id_pk" PRIMARY KEY("round_id","shipment_id")
);
--> statement-breakpoint
CREATE TABLE "debit_settlement_rounds" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"direction" varchar(3) NOT NULL,
	"carrier_key" varchar(60) NOT NULL,
	"period_key" varchar(7) NOT NULL,
	"round_no" integer NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"amount" numeric(15, 0) NOT NULL,
	"vat_rate" integer NOT NULL,
	"ghi_chu" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "debit_settlement_round_lots_shipment_unq" ON "debit_settlement_round_lots" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "debit_settlement_rounds_pair_unq" ON "debit_settlement_rounds" USING btree ("customer_id","period_key","round_no","direction");--> statement-breakpoint
CREATE INDEX "debit_settlement_rounds_period_idx" ON "debit_settlement_rounds" USING btree ("period_key");