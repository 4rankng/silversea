ALTER TABLE "trip_pairs" ADD COLUMN "pair_kind" varchar(20) DEFAULT 'KET_HOP' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_pairs" ADD COLUMN "second_salary_stash" numeric(15, 0);