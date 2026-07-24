---
date: 2026-07-11
type: ship
status: verified
area: settlement-workflow
merge-target: main
---

# Settlement remediation ship session

## Outcome

The customer settlement remediation is ready to merge to `main`. Accountants can correct settlement expenses and linked advances, see readiness grouped by trip and container, and finalize a balanced settlement once. Settled links are excluded from later claims, rejected links become reusable, concurrent claims are serialized, and finalization creates exactly one immutable ledger posting. Debit-note corrections use append-only receivable adjustments, while Ops receives correction and approval notifications. Legacy accountant-checked records remain actionable.

## Release hardening

- Repaired historical migrations so a fresh database can replay the full chain safely, then added migration `0103` for the required `unaccent` extension and missing truck inspection column.
- Fixed seed ordering by assigning drivers to trucks only after truck records exist.
- Isolated backend tests by running suites serially and tightened environment-dependent cases so they do not leak state across the full run.
- Brought the frontend under the strict 600-line source-file budget by extracting focused presenters, forms, dialogs, tables, hooks, and helpers without changing public behavior.
- Pinned `undici` to the compatible `~7.28.0` release line and refreshed the lockfile.

## Verification

- Settlement workflow: 10/10 passed; billing coverage: 20/20 passed.
- Backend: 407/407 tests passed across 74 suites.
- Frontend: 112/112 tests passed across 17 files.
- Lint completed with zero findings.
- Strict frontend build passed across 2,333 modules, with every checked source file at or below 600 lines.
- Shared, backend, frontend, and root production builds passed.
- A fresh database completed the full migration sequence and seed successfully.

## Ship decision

The verified changes are intended for direct integration into `main`. Database deployment must preserve migration order, and the append-only settlement ledger safeguard remains the authority if historical duplicate postings require reconciliation.
