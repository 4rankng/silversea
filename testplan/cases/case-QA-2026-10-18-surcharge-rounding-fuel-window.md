# Case QA-2026-10-18-surcharge-rounding-fuel-window — card 20260922_60 suite reddened by a global fuel-period leftover

Reported as: "MAIN IS RED — backend surcharge rounding regression, 4 failures in
`surcharge-rounding.test.ts`; suspect window 09420a7f..692522c1 (c99ce894 /
692522c1)."

## Reproduce (pre-fix defect)

1. Local dev stack up (`make dev` ports; Postgres :5441), shared built.
2. `cd backend && npx tsx --test src/tests/surcharge-rounding.test.ts`
3. Expected (card 20260922_60): 5/5 pass — surchargeRaw 241948; TEN_THOUSAND →
   240000; THOUSAND → 242000; NONE raw == charged; latest quotation ≤ transport
   date supplies the mode.
4. Actual: 4 failures, every failing assertion reads `actual: 243148,
   expected: 241948` (or 243000/242000 downstream) — the RAW surcharge, not the
   rounding.

## Root cause

No code regression. `git diff 09420a7f..692522c1 -- backend/src shared/src`
touches zero pricing/quotation paths; `git log -S roundHalfAwayFromZero /
surchargeRounding` over the window is empty; the test file is unchanged since
7fe0b76b; the pure-function probes pass.

The suite seeded its fuel period at a FIXED date (29940 @ 2026-09-01) and read
it back at fixed transports (2026-09-15/16/20). `fuel_price_periods` is a
global table on the shared dev DB, and the engine (correctly) prices fuel at
the LATEST live period ≤ transport date. A QA-session leftover row
(`id=207, unit_price 30000, effective_from 2026-09-09`, empty `source_note`,
created 2026-09-29, referenced by `quotation_fuel_approvals` so undeletable)
outranked the fixture: (30000 − 17842.5926) × 0.1 × 200 = 243148.148 — the
exact observed value. The green-at-base/red-at-window bisect was confounded by
dev-DB state, not by c99ce894 or 692522c1.

Identical prior incident + fix precedent: `heso-surcharge.test.ts` (card
20260922_59) comment — "a leftover 30000 @ 2026-09-09 once moved every worked
number by +60đ/ℓ and reddened the whole suite at base" — fixed by the
fuel-period-envelope pattern.

## Fix (direction b — engine and card semantics intact, test fixture ownership corrected)

Port the fuel-period-envelope pattern from `heso-surcharge.test.ts` into
`surcharge-rounding.test.ts`: pick an unoccupied far-future window [P, P+19]
at runtime (verified against the live table, never by deleting rows), seed the
fuel period at P, transport/quotation dates at P+14 / P+15 / P+19. Every test
name and every assertion value is unchanged — the worked numbers
(Δ 12.097,4074 = 29.940 − 17.842,5926) are exactly the card's.

## Expected behavior after fix

Standalone `surcharge-rounding.test.ts` green with the 30000 @ 2026-09-09 row
still present in the dev DB; full backend suite no longer reddened by any
foreign fuel period inside the old fixed window.
