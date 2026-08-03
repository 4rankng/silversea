CREATE TABLE "financial_reporting_policy_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"effective_from" date NOT NULL,
	"depreciation_method" varchar(30) NOT NULL,
	"allocation_basis" varchar(50) NOT NULL,
	"low_margin_threshold_ratio" numeric(5, 4),
	"governance_action_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_reporting_policy_versions_month_start_check" CHECK (extract(day from "financial_reporting_policy_versions"."effective_from") = 1),
	CONSTRAINT "financial_reporting_policy_versions_depreciation_method_check" CHECK ("financial_reporting_policy_versions"."depreciation_method" = 'STRAIGHT_LINE'),
	CONSTRAINT "financial_reporting_policy_versions_allocation_basis_check" CHECK ("financial_reporting_policy_versions"."allocation_basis" = 'COMPLETED_TRIP_REVENUE_SHARE'),
	CONSTRAINT "financial_reporting_policy_versions_low_margin_threshold_check" CHECK ("financial_reporting_policy_versions"."low_margin_threshold_ratio" is null or ("financial_reporting_policy_versions"."low_margin_threshold_ratio" >= 0 and "financial_reporting_policy_versions"."low_margin_threshold_ratio" <= 1))
);
--> statement-breakpoint
CREATE TABLE "truck_financial_profile_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"truck_id" integer NOT NULL,
	"effective_from" date NOT NULL,
	"acquisition_cost" numeric(15, 0) NOT NULL,
	"residual_value" numeric(15, 0) NOT NULL,
	"in_service_date" date NOT NULL,
	"useful_life_months" integer NOT NULL,
	"monthly_fixed_cost" numeric(15, 0) NOT NULL,
	"governance_action_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "truck_financial_profile_versions_month_start_check" CHECK (extract(day from "truck_financial_profile_versions"."effective_from") = 1),
	CONSTRAINT "truck_financial_profile_versions_acquisition_cost_check" CHECK ("truck_financial_profile_versions"."acquisition_cost" >= 0),
	CONSTRAINT "truck_financial_profile_versions_residual_value_check" CHECK ("truck_financial_profile_versions"."residual_value" >= 0 and "truck_financial_profile_versions"."residual_value" <= "truck_financial_profile_versions"."acquisition_cost"),
	CONSTRAINT "truck_financial_profile_versions_useful_life_check" CHECK ("truck_financial_profile_versions"."useful_life_months" > 0),
	CONSTRAINT "truck_financial_profile_versions_monthly_fixed_cost_check" CHECK ("truck_financial_profile_versions"."monthly_fixed_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "financial_reporting_policy_versions" ADD CONSTRAINT "financial_reporting_policy_versions_governance_action_id_governance_actions_id_fk" FOREIGN KEY ("governance_action_id") REFERENCES "public"."governance_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_reporting_policy_versions" ADD CONSTRAINT "financial_reporting_policy_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_financial_profile_versions" ADD CONSTRAINT "truck_financial_profile_versions_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_financial_profile_versions" ADD CONSTRAINT "truck_financial_profile_versions_governance_action_id_governance_actions_id_fk" FOREIGN KEY ("governance_action_id") REFERENCES "public"."governance_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_financial_profile_versions" ADD CONSTRAINT "truck_financial_profile_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_reporting_policy_versions_effective_from_uniq" ON "financial_reporting_policy_versions" USING btree ("effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_reporting_policy_versions_governance_action_uniq" ON "financial_reporting_policy_versions" USING btree ("governance_action_id");--> statement-breakpoint
CREATE INDEX "financial_reporting_policy_versions_effective_lookup_idx" ON "financial_reporting_policy_versions" USING btree ("effective_from","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "truck_financial_profile_versions_truck_month_uniq" ON "truck_financial_profile_versions" USING btree ("truck_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "truck_financial_profile_versions_governance_action_uniq" ON "truck_financial_profile_versions" USING btree ("governance_action_id");--> statement-breakpoint
CREATE INDEX "truck_financial_profile_versions_lookup_idx" ON "truck_financial_profile_versions" USING btree ("truck_id","effective_from","created_at");