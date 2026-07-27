# Q22 Slice 1 authority-catalog implementation

**Date:** 2026-07-27  
**Scope:** executable shared vocabulary only

## Delivered

- Added `shared/src/governance/source-authority.ts`.
- Added `shared/src/governance/source-authority.test.ts`.
- Added focused QA evidence at
  `qa/2026-07-27_q22-source-authority_shared-test-typecheck.log`.

The typed catalog exhaustively keys these accepted authority links:

1. Shipment customer/cargo/container facts → trip plan/snapshot.
2. Trip actual/revenue facts → DRAFT debit note.
3. Trip revenue → accounts receivable before debit-note issuance.
4. Approved expense status/amount → cost reporting.
5. Approved expense status/amount → DRAFT debit note.
6. Issued debit-note receivable due → accounts receivable.
7. Receipt/allocation → paid and outstanding.

Approved ancillary expenses intentionally map to `COST_REPORTING`, not
transport `TRIP_COST`. This preserves the verified product boundary in which
ancillary buy/sell does not change transport `totalCost/grossProfit`. The
sell-side DRAFT debit-note dependency remains explicit.

## Policy behavior

- Before the relevant lock/issue milestone, mutable dependencies permit
  `RECOMPUTE`.
- After dispatch, shipment-derived trip state permits `VERSION`.
- After lock/issue, financial dependencies permit `ADJUST`; immutable issued
  receivables and recorded receipts/allocations also permit `REVERSE`.
- Pending and rejected expenses are excluded through the required
  `APPROVED_ONLY` discriminator.
- Unknown source/dependent pairs, actions, and lifecycle phase strings fail
  closed.
- The catalog contains no financial formulas, ledger posting, persistence, or
  mutation behavior.

## Scope boundary

- The implementation worker did not edit `shared/src/index.ts` while Q17 owned
  that surface. After Q17 released it, the controller exported the catalog and
  types through the package barrel and verified the integration.
- Did not edit shipment schemas/types, backend schema, services, routes,
  frontend files, or migrations.
- Did not duplicate `computeTripTotals`, billing line builders, or ledger
  authorities.

## QA

Final focused command:

```text
cd shared
npx tsx --test src/governance/source-authority.test.ts && npx tsc --noEmit
```

Result: exit 0; 6/6 focused tests passed; shared typecheck passed.

An earlier combined shell command produced a path-only failure after the
focused test passed because it attempted `cd shared` twice. The exact failure,
classification, corrected rerun, and final reruns are preserved in the QA
artifact.

## Independent review

The first independent review verified exhaustive coverage, the corrected
cost-reporting boundary, absence of formula duplication, and no Q17 scope
violation. It found one blocking fail-open edge: an unknown lifecycle phase
received post-milestone permissions. The implementation now validates both
phase literals explicitly and returns no actions otherwise, with regression
coverage. The review also identified the optional expense discriminator; it
was replaced with a discriminated union requiring `APPROVED_ONLY` exactly for
approved-expense policies.

The deferred `shared/src/index.ts` export is now complete. Controller evidence:
`qa/2026-07-27_q22-source-authority_barrel-integration.log`.

Independent re-review found no remaining blockers. Its evidence is saved at
`qa/2026-07-27_q22-source-authority_review.md`.

Status: DONE
Summary: Q22 Slice 1 now has a typed, exhaustive, fail-closed source-authority catalog with focused tests and green shared typecheck.
Concerns/Blockers: No slice blocker.
