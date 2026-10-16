# Case 2026-10-16-FB061-R1 — demo seeders other than `pnpm seed` stayed ungated

Card `141026012010-fb061-verify-fail-seed-data-phoi-phieu` re-reported FB-061:
self-authored seed rows (invoice-tracking / phôi phiếu fixtures) still reach
production-shaped databases.

## Repro

FB-061's fix on 2026-10-14 gated one entrypoint: `pnpm seed` (`src/seed.ts`).
Two other demo seeders self-execute and were never gated:

1. `npx tsx src/seed-dashboard.ts` — inserts trips (via
   `insertTripComposite`), ledger entries and expenses. No `NODE_ENV` check at
   all; with a production `DATABASE_URL` it writes demo rows unchecked.
2. `npx tsx src/seed/seed-demo-freight-pricing.ts` — its own header declares
   `DEMO ... dev + staging ONLY (PM decision D4)` and the Makefile stages it
   that way, yet it self-executes with no production check, so an invented
   contract ladder could be written to production.

Both run `NODE_ENV=production` without `SEED_DEMO_DATA` and still write — the
exact failure mode the card is about, reachable by a single command.

## Root cause

The gate lived inside `seed.ts` rather than in a shared owner, so it covered
one caller instead of the class. The same rule now lives once in
`backend/src/seed/demo-seed-gate.ts` and each demo entrypoint calls it before
its first write.

## Deliberately NOT gated

- `seed-prod.ts` — the sanctioned production path (master data only, no demo
  rows). It deliberately excludes the demo freight-pricing module.
- `seed-cut-catalogs.ts` — a deploy-time catalog cut that the Makefile runs
  over SSH on the server (`Makefile:248`). It writes catalogs, not demo rows,
  and runs in a production-shaped environment; gating it would break every
  deploy. Pinned by a test so the exclusion stays deliberate. If that module
  ever starts writing demo rows it needs an owner decision, not a silent gate.

## Expected

Every self-executing demo seeder refuses `NODE_ENV=production` without
`SEED_DEMO_DATA=true`, before its first write. Dev/test seeding and the
documented staging opt-in are unchanged.

## Pin

`backend/src/tests/unit/seed-demo-gate.test.ts` — a census that discovers
self-executing seed modules by shape (not by name), so a future demo entrypoint
cannot silently reopen the hole, plus targeted pins for the freight-pricing
gate and the catalog-cut exclusion.

Verified failing-before / passing-after: reverting only the two entrypoints
makes 2 pins fail while the 10 pre-existing pins still pass.