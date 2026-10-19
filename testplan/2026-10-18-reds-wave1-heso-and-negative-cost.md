# Red-at-base wave 1 — heSo surcharge + card 197 negative-cost suites (regression case)

Case ID: TC-REDSW1-01 (cluster A) / TC-REDSW1-02 (cluster B)
Feature: backend suite health at base `8fc1bcf5` — 44 failures, wave 1 scoped to
`heso-surcharge.test.ts` (5/5 red) and `card197-negative-cost-totals.test.ts` (5/10 red).

## Diagnosis (verified, not inferred)

### Cluster A — TC-REDSW1-01
NOT a freight-rate formula change. The engine (`resolveFreightRate`) was correct:
`fuel_price_periods` is a GLOBAL table and the engine prices at the LATEST period
≤ transport date. The suite pinned fixed fixture dates (period `2026-09-01` @ 29.940,
transport `2026-09-15`), and a stray dev-DB row (`id=207`, `unit_price=30000`,
`effective_from=2026-09-09`, present in no seed and no test source) outranked the
fixture. Arithmetic proof: `30000 − 17842.5926 = 12157.4074`; ×20ℓ = **243148**
(AC1 actual), ×1.1 → **267463** (AC2 actual), ×64ℓ = **778074** (AC3 actual) — the
exact reds. Suspects `488b007f` / `8f3a42e8` are exonerated (Δ is exactly +60đ/ℓ,
i.e. a price substitution, not a formula edit).

### Cluster B — TC-REDSW1-02
Three INTENDED product contracts shipped after card 197's suites were written;
the fixtures encoded the older truth:
1. Card 20261005 (`2a64156f`): `expenseAccountingCreateSchema` gained a REQUIRED
   `shipmentId` anchor → the validator test's `createBase` no longer parsed.
2. Card 20261005_373 (`2a64156f`, "lần 2"): `getPhoiPhieuTienDuong` rows key
   `sourceId` on `expense_accounting_sources.id` (the "Từ chối" 404 fix), not the
   driver-cost id → the "still listed" assertion keyed on the wrong id.
3. Card 141026230720 (`030e8e42`): duplicate-entry guard 409s an unconfirmed
   same-type+scope save; `mkPriorExpense` deliberately creates that exact scenario
   → the three save-path tests bounced before reaching the invariants they pin.

Service invariants (negative cost ⇒ 0 receivable; negative override refused by
name; totals exclude negative rows) are INTACT — `receivableForCost`,
`receivableForDerivedCharge`, `assertReceivableNotNegative` untouched.

## Fix
Test-side only, both suites updated to the shipped contracts with cited commits:
- `heso-surcharge.test.ts`: owns an unoccupied far-future fuel-period window
  (the `fuel-period-envelope` pattern), dates relative to a verified-free window;
  all worked-number assertions unchanged.
- `card197-negative-cost-totals.test.ts`: `createBase` carries `shipmentId`;
  road-fee listing assertions key on the accounting-source id; the three
  save-path calls carry the guard's documented `duplicateConfirmed` override.

## Repro
1. `cd backend && pnpm exec tsx --test src/tests/heso-surcharge.test.ts src/tests/card197-negative-cost-totals.test.ts`
   at base `8fc1bcf5` against the shared dev DB containing stray period id=207.

## Expected
- heso-surcharge: 5/5 pass with the card's worked numbers (241948 / 266143 / 774234 / 696811 / 1100864).
- card197: 10/10 pass.
- `npx tsc --noEmit` 0; `pnpm lint` 0.

## Evidence
- `qa/2026-10-18_reds-wave1_backend-tests.txt` (15/15 pass, exit 0)
- `qa/2026-10-18_reds-wave1_tsc.txt`, `qa/2026-10-18_reds-wave1_lint.txt` (exit 0)

## Not covered / follow-up (out of wave-1 scope)
- `surcharge-rounding.test.ts` fails with the SAME stray-period root cause
  (its fixture also pins 2026-09-01/2026-09-15); needs the same hermetic-window
  treatment in a later wave.
- Full 44-failure sweep; DB hygiene for leftover `fuel_price_periods` rows
  (56 far-future leftovers from other suites; id=207 near-past) — no rows were
  deleted by this wave (shared state, other suites may read them).
