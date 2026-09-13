-- 2026-09-11 maker-checker removal (MC-4): shipment finance confirmations and
-- charge-proposal billing-link decisions were governance_actions rows; they are
-- real domain records (confirmation ids are referenced by accounting locks and
-- custody), so they move to their own table as the governance queue is dropped.
CREATE TABLE IF NOT EXISTS shipment_finance_actions (
  id serial PRIMARY KEY,
  shipment_id integer NOT NULL,
  action_kind varchar(60) NOT NULL,
  shipment_version integer NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'APPROVED',
  reason text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  delta_snapshot jsonb,
  maker_id integer NOT NULL,
  maker_role varchar(20) NOT NULL,
  checker_id integer,
  checker_role varchar(20),
  checked_at timestamp with time zone,
  approver_id integer,
  approver_role varchar(20),
  approved_at timestamp with time zone,
  applied_at timestamp with time zone,
  application_result jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Composite index for the dominant query path: shipment-confirmation lookups
-- filter by shipment_id first, then narrow by action_kind and status. Mirrors
-- the schema declaration in backend/src/db/schema/shipments.ts:346 so that
-- drizzle-kit does not regenerate a divergent migration. Also covers the
-- shipment_id-only path (referenced by shipment-accounting-lock.test.ts:331-333
-- and shipment-routes.test.ts:431-432) via the left-most column rule.
CREATE INDEX IF NOT EXISTS shipment_finance_actions_shipment_kind_idx
  ON shipment_finance_actions (shipment_id, action_kind, status);
