# Shipments release production review

## Verdict

**APPROVE — no production blocker found in the current uncommitted release diff.**

## Findings

No critical, high, or medium findings.

### Low — race coverage is probabilistic rather than barrier-controlled

`backend/src/tests/trip-ledger-completion.test.ts` starts cancellation before the
stale direct edit with `Promise.allSettled`, but it does not use a barrier to
force each relevant lock interleaving. The focused test passing 10/10 plus the
full 2,119-test backend suite is strong release evidence, and the static lock
trace below proves the reviewed pair is ordered, so this does not block this
release. A future hardening change could make the test deterministic.

## Concurrency trace

- `updateTripFigures` now acquires the transaction-scoped
  `lockTripFinancialAuthority(6118, tripId)` advisory key before
  `assertTripShipmentAccountingUnlocked`, then locks the trip row:
  **trip authority -> shipment -> trip**.
- Governed cancellation enters `applyTripGovernanceAction`, acquires the same
  trip authority and locks the trip row before `transitionTripStatus` checks
  the parent shipment: **trip authority -> trip -> shipment**.
- The two reviewed contenders cannot hold conflicting row locks while waiting
  on one another: only the winner of the shared advisory key can proceed to
  the shipment/trip rows. The loser waits on the authority without holding the
  shipment row. PostgreSQL transaction advisory locks are re-entrant within
  the governing transaction, so nested calls do not add a reverse edge.
- Before this diff, the direct edit used **shipment -> trip authority**, which
  could cycle against cancellation's **trip authority -> trip -> shipment**.
  Moving the authority acquisition before the shipment check removes that
  observed cycle without changing mutation payloads, authorization,
  optimistic-version checks, response schemas, or domain errors.
- `trip-status-machine.service.ts` and
  `shipment-accounting-lock.service.ts` are unchanged. Their row-lock behavior
  remains shipment-before-trip for ordinary lifecycle writes; this diff adds no
  new caller that holds a shipment row and subsequently requests trip authority.

## Broader release diff

- The CUS workspace changes match the active exception-first plan: derived
  schedule/vehicle readiness, explicitly page-scoped counters, dense responsive
  rows/cards, drawer-based versioned transport-date editing, and distinct
  running/locked state treatment.
- The list response additions are additive and implemented consistently across
  shared schema exports, backend projection, frontend consumption, and tests.
  No migration, new endpoint, RBAC expansion, finance-authority change, unsafe
  raw SQL, or secret was introduced.
- Transport-date editing reuses the existing authenticated, role-gated,
  optimistic and accounting-lock-guarded `PUT /shipments/:id` path. UI
  editability is narrower than server authority and successful filtered saves
  close the drawer before reload.
- Readiness data is derived from already-batched support queries; no per-row
  query or unbounded endpoint was added. The live-trip-per-fulfillment unique
  index makes the container assignment projection unambiguous.
- The small trip lock-order fix is outside the presentation plan's original
  file list but is justified release-gate remediation for the reproduced full
  backend-suite deadlock; no unrelated product behavior was added.

## Evidence reviewed

- `git diff --check` — passed.
- `qa/2026-08-13_trip-cancel-edit-lock-order_focused-test.log` — focused race
  passed 10/10, exit 0.
- `qa/2026-08-13_shipments-release_backend-test.log` — 2,119/2,119 passed,
  exit 0.
- `qa/2026-08-13_shipments-release_e2e.log` — 398 passed, 0 failed, 31 skipped,
  exit 0.
- Static trace of:
  `backend/src/services/trip-mutations.service.ts`,
  `backend/src/services/adjustment-governance.service.ts`,
  `backend/src/services/trip-status-machine.service.ts`,
  `backend/src/services/shipment-accounting-lock.service.ts`, and
  `backend/src/services/trip-financial-authority-lock.service.ts`.
- Full current diff reviewed across backend/shared/frontend/tests/plan files.

Status: DONE
Summary: The concurrency fix removes the observed deadlock edge and the complete shipment release diff has no production-blocking finding.
Evidence: Focused race 10/10, backend 2119/2119, E2E 398 passed/0 failed, git diff --check, and static lock-graph review.
Concerns/Blockers: Low-only: the race test is scheduler-driven rather than barrier-controlled; no release blocker.
