# 2026-10-18 BE reds cluster B — gate summary (verbatim)

Branch: `fix-be-reds-phoi-e2e-rb1` (base `20d4cb27`). Cards: QA-AUDIT-PHOI-11,
card 20261005_373 (lần 2), FB-038 family (ticket 111026105630 / card
171026121100), card 181026185900 (lint stray).

## Commands and exit status (final tree)

| Gate | Command | Result | Exit | Log |
|---|---|---|---|---|
| Backend typecheck | `cd backend && pnpm exec tsc --noEmit` | 0 errors | 0 | (silent) |
| Frontend typecheck | `cd frontend && pnpm exec tsc -b` and `pnpm exec tsc --noEmit` | 0 errors | 0 | `_gates-fe-tsc.log` |
| Root lint | `pnpm lint` | 0 errors | 0 | `_gates-lint.log` |
| Context manifest | `pnpm context:check` | `Context manifest valid: v1, 8 profiles, 25 context paths.` | 0 | — |
| Full BE suite | `cd backend && pnpm test` | see below | 1 (8 pre-existing other-cluster reds remain) | `_full-suite-final.log` |

## Test counts, verbatim

Base (red-before, `_full-suite-base.log`):
- unit: `ℹ tests 305` / `ℹ pass 305` / `ℹ fail 0`
- integration: `ℹ tests 3352` / `ℹ pass 3335` / `ℹ fail 17`
  (cluster B's five: QA-AUDIT-PHOI-11 CATALOG/NORM/LEGACY + E2E Trip dispatch
  lifecycle + E2E Financial operations cascade)

Targeted red-before (`_targeted-red-base.log`):
- `ℹ tests 20` / `ℹ pass 15` / `ℹ fail 5` (the five cluster-B reds)

Targeted green-after (`_targeted-green.log`):
- `ℹ tests 20` / `ℹ pass 20` / `ℹ fail 0`

Full gate run 1 (`_full-suite-after.log`):
- integration: `ℹ tests 3352` / `ℹ pass 3342` / `ℹ fail 10`
  (cluster B green; surfaced TC-REDSB3 — advance-draft-recovery order-fragile
  audit read, green in isolation 8/8, fixed by deterministic `orderBy(asc(id))`;
  q11-salary-post-close ×2 and tool-executables-import-inert flipped green
  state-sensitively)

Full gate run final (`_full-suite-final.log`):
- unit: `ℹ tests 305` / `ℹ pass 305` / `ℹ fail 0`
- integration: `ℹ tests 3352` / `ℹ pass 3344` / `ℹ fail 8`

Final 8 reds = strict subset of the base 17 (other clusters' waves, untouched):
- `dispatch-fulfillment.test.ts` FB-018 (PLATE_DEFERRED_CONFIRM) — dispatch cluster
- `photo-trip-scope.test.ts` AC1 + AC3 (404≠200) — photo-authz cluster
- `q23-field-operations-idempotency.test.ts` (404≠200) — q23 cluster
- `quotation-entity.test.ts` ×4 (heSo/surcharge worked numbers) — surcharge/
  chiphispec cluster (live worktrees `fix-surcharge-rounding-rb3` /
  `fix-chiphispec-gaps-rb1`)

Zero new reds vs the base set. Cluster B (PHOI-11 ×3 + E2E ×2) green; CUS
suites (`cus-*`, `*-cus-read`, `cross-customer-isolation`) green in all runs.

## Scope note
Test-side only: `comprehensive.test.ts`, `expense-source-remediation.test.ts`,
`advance-draft-recovery.test.ts`, `cus-lcl-undated-parity-d6.test.ts` (unused
import for the root-lint gate). No product code changed. No skip/stub/blanket
mask: every fixture change rides the shipped contract's own documented keys.
