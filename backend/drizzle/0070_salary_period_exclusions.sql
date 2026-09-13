-- 2026-09-11 (MC-4 followup): exclusions previously lived as APPROVED rows in
-- governance_actions; that table is dropped by 0068. Approved exclusions are
-- durable feature state (readiness gates + follow-up completion read them), so
-- they move into their own table. Historical staged/approved governance rows
-- are not carried over — re-enter exclusions after the migration.
CREATE TABLE IF NOT EXISTS salary_period_exclusions (
  id serial PRIMARY KEY,
  period varchar(7) NOT NULL,
  driver_id integer NOT NULL,
  reason text NOT NULL,
  handling_mode varchar(30) NOT NULL,
  target_period varchar(7),
  note text,
  requested_by integer NOT NULL,
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  followup_status varchar(20) NOT NULL DEFAULT 'PENDING',
  followup_completed_at timestamp with time zone,
  followup_completed_by integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS salary_period_exclusions_period_idx ON salary_period_exclusions (period);
CREATE INDEX IF NOT EXISTS salary_period_exclusions_driver_idx ON salary_period_exclusions (driver_id);
