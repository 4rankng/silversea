# Integration-suite ordering contract

Written 2026-09-16 by the BE1 lane (order-dependence triage, lead-assigned).
Scope: `backend/src/tests/*.test.ts` serial runs (`--test-concurrency=1`).

Gate status (lead ruling, 2026-09-16): the full serial run is **advisory** until this pollution class is resolved; per-step scoped suites are the blocking gate.

## Evidence (2026-9-16, serial runs)

| Symptom | Isolated | Full serial run | Notes |
|---|---|---|---|
| transport-expense "reversal ledger count 3≠1" | PASS | FAIL (one run) | passes isolated; fails only in specific orders |
| q23-upload photo-replay pair (`status undefined ≠ SUCCEEDED`) | 7/7 PASS | PASS (in the 517✔ run) | fails in some combined orders |
| auth-session-revocation / comprehensive (lead-named) | not yet isolated | reds under load | 4-suspect combined run was green |

Isolated vs combined divergence runs in BOTH directions (some red only in full runs, some green in full runs but red in scoped combos) — the polluter is **sequence-dependent**, not a fixed pair.

## Mechanism

All integration suites share one dev database. `withTestCleanup` deletes the rows a suite registered, but nothing deletes what a crashed suite left, or non-row state: durable-job leases, Redis keys, advisory-lock keys, sequence counters. `processDueDurableEffectJobs(limit, {now})` returns a worker-scoped result set, so an assert that reads the worker's return (`processed.find(id)`) can observe `undefined` whenever any other due job (including one a prior suite left locked or due) displaces it — the observed `undefined ≠ 'SUCCEEDED'` class. Serial execution prevents in-run concurrency but not leftover state, so serial ≠ deterministic.

## Contract (binding for new tests)

1. Every suite deletes what it creates — rows, durable jobs, leases, Redis keys.
2. Asserts on table properties must be scoped by per-test unique keys (suffix-keyed); never table-global counts.
3. Durable-effect asserts re-fetch the job by id from the DB as the truth read; treat the worker's return set as a hint only.
4. No suite may leak RUNNING leases; sweep or delete them in after().
5. Redis keys are suffix-keyed and flushed in after().
6. Full serial run is advisory; scoped suites are the blocking gate until the class is fixed.

## Follow-ups (proposed cards)

- q23-upload-idempotency: switch `processed.find(id)` asserts to re-fetch-by-id (mechanical; shrinks the flake class).
- Maintenance CLI to sweep stale leases/Redis keys from the shared dev DB before gate runs.
- Isolation runs for auth-session-revocation + comprehensive to place them on the polluter/victim map.
- Last resort only: per-file schema isolation.
