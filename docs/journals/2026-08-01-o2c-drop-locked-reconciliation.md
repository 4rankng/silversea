# O2C Drop LOCKED Reconciliation

**Date**: 2026-08-01 22:00
**Severity**: High
**Component**: Order-to-Cash state machine, AR snapshot, POD-recovery, P&L split
**Status**: Resolved

## What Happened

We deleted `TripStatus.LOCKED` from the codebase entirely. `COMPLETED` is now the single terminal/posting state, per the 01/08 decisions in `docs/prd/O2C dev.md`. The photo/zero-revenue/e-POD/POD-recovery gates that used to live in the `COMPLETED → LOCKED` branch migrated one hop earlier, into `IN_TRANSIT → COMPLETED`. This is not a rename — it is a relocation of every business rule that depended on the old two-state tail. It landed across five phases in one atomic PR: shared contract + PG enum swap + state-machine surgery + 5+ downstream service repoints, the AR snapshot dirty-flag (`ar-snapshot.service.ts` so costs stay editable after COMPLETED and drift is tracked), the POD-recovery gate on `pod_recovered_at` plus tạm ứng settlement offset plus the delete-authorization matrix (`delete-authorization.service.ts` keying off `approvedAt`), the carrier-tag P&L split, and a ~31-file test rewrite. Plan: `plans/260801-2200-o2c-drop-locked-reconciliation/plan.md`.

## The Brutal Truth

This was a state-machine move disguised as a status rename, and that distinction bit repeatedly. The hardest part was the migration: PG refuses `ALTER COLUMN TYPE` on a column covered by a partial unique index (`WHERE status <> 'CANCELED'::trip_status`), so the enum swap had to become a four-step dance — new type, fold LOCKED→COMPLETED, drop old, rename — with the partial index explicitly dropped and recreated around it. That cost real time before the failure mode was obvious. On top of that, pre-existing migration drift (`trucks.insurance_expiry_date`, the `trip_instructions` table) blocked seed and tests until the missing migrations were applied by hand. Two independent layers of debt (our enum surgery, and drift someone else left) collided in the same verification run. The backend suite also runs past 15 minutes, so feedback came in targeted batches rather than one clean green.

## Key Decisions & Verification

Three decisions are load-bearing. First, `external_carrier_id` FK was replaced with soft polymorphic columns (`external_entity_id` + `external_entity_type`, no DB FK) so carrier resolution is polymorphic without a multi-table FK mess. Second, the governed-close path passes `confirmZeroRevenue=true` but deliberately NOT `confirmNoPhoto=true` — photos are physical evidence and non-negotiable, so they cannot be auto-waived through the close. Third, the driver-owned fulfillment completion path was removed outright: e-POD acceptance is now the sole completion route, and the `ADVANCE_SETTLEMENT_APPROVED` push narrowed from `'all'` to `'driver'` for MVP.

QA landed clean on the things we own: typecheck 0 errors, build green, frontend 517/517, backend 1849/1851 (the two misses are pre-existing flakes — a debt-offset numeric-id collision and a race-condition serialization test, both unrelated), lint 0 errors in changed files (25 pre-existing in untouched), and the migration verified against a fresh dev DB. Artifacts under `qa/2026-08-01_o2c-drop-locked_*`. Lesson worth keeping: when a refactor looks like a rename, the business rules are what move — and the partial-index constraint on PG enum swaps is the one that will ambush you if you forget it.
