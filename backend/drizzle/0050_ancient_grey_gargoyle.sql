-- Lean-down: drop two fully-dead tables (first table drops in repo history).
-- Evidence (2026-09-06): zero code references in backend/frontend/shared/e2e
-- (verified by rg across all sources); prod row counts = 0 and 0 (read-only
-- pre-flight). delete_requests = O2C delete-approval queue never wired;
-- fuel_surcharge_configs = per-customer share rates superseded by
-- customers.fuel_surcharge_share_pct + trips.fuel_surcharge_* snapshot
-- columns written by /api/finance/snapshots/fuel-surcharge/recapture.
-- Prod backup ritual: make deploy pg_dumps before drizzle-kit migrate.

DROP TABLE "delete_requests" CASCADE;--> statement-breakpoint
DROP TABLE "fuel_surcharge_configs" CASCADE;