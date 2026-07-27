CREATE TABLE "settlement_expense_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"settlement_id" integer NOT NULL,
	"settlement_expense_id" integer NOT NULL,
	"trip_expense_id" integer NOT NULL,
	"sequence" integer NOT NULL,
	"source_version" integer NOT NULL,
	"before_snapshot" jsonb NOT NULL,
	"after_snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"adjusted_by" integer NOT NULL,
	"adjusted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	CONSTRAINT "settlement_expense_adjustments_sequence_check" CHECK ("settlement_expense_adjustments"."sequence" > 0),
	CONSTRAINT "settlement_expense_adjustments_source_version_check" CHECK ("settlement_expense_adjustments"."source_version" > 0),
	CONSTRAINT "settlement_expense_adjustments_reason_check" CHECK (length(btrim("settlement_expense_adjustments"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "settlement_expense_adjustments" ADD CONSTRAINT "settlement_expense_adjustments_settlement_id_advance_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."advance_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_expense_adjustments" ADD CONSTRAINT "settlement_expense_adjustments_settlement_expense_id_settlement_expenses_id_fk" FOREIGN KEY ("settlement_expense_id") REFERENCES "public"."settlement_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_expense_adjustments" ADD CONSTRAINT "settlement_expense_adjustments_trip_expense_id_trip_expenses_id_fk" FOREIGN KEY ("trip_expense_id") REFERENCES "public"."trip_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_expense_adjustments" ADD CONSTRAINT "settlement_expense_adjustments_adjusted_by_users_id_fk" FOREIGN KEY ("adjusted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_expense_adjustments" ADD CONSTRAINT "settlement_expense_adjustments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "settlement_expense_adjustments" (
	"settlement_id",
	"settlement_expense_id",
	"trip_expense_id",
	"sequence",
	"source_version",
	"before_snapshot",
	"after_snapshot",
	"reason",
	"adjusted_by",
	"adjusted_at",
	"approved_by",
	"approved_at"
)
SELECT
	se."settlement_id",
	se."id",
	se."trip_expense_id",
	1,
	1,
	se."original_snapshot",
	se."adjusted_snapshot",
	se."adjustment_reason",
	se."adjusted_by",
	se."adjusted_at",
	CASE WHEN aset."status" = 'APPROVED' THEN aset."approved_by" ELSE NULL END,
	CASE WHEN aset."status" = 'APPROVED' THEN aset."approved_at" ELSE NULL END
FROM "settlement_expenses" se
INNER JOIN "advance_settlements" aset ON aset."id" = se."settlement_id"
WHERE se."adjustment_reason" IS NOT NULL
	AND length(btrim(se."adjustment_reason")) > 0
	AND se."adjusted_by" IS NOT NULL
	AND se."adjusted_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_expense_adjustments_link_sequence_uniq" ON "settlement_expense_adjustments" USING btree ("settlement_expense_id","sequence");--> statement-breakpoint
CREATE INDEX "settlement_expense_adjustments_settlement_idx" ON "settlement_expense_adjustments" USING btree ("settlement_id","adjusted_at");--> statement-breakpoint
CREATE INDEX "settlement_expense_adjustments_expense_idx" ON "settlement_expense_adjustments" USING btree ("trip_expense_id","adjusted_at");
