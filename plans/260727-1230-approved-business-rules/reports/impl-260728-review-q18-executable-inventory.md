# Q18 executable locked-entity inventory

**Status:** DONE
**Owner:** `fix_q18_executable_inventory`
**Date:** 2026-07-28

## Root cause

The prior Q18 inventory duplicated a hand-written entity list, asserted literal
`true` evidence flags, and accepted any assertion anywhere in a referenced test
file. It was therefore possible to remove a concrete terminal-state mutation
guard or the relevant proof assertion while the “exhaustive” test stayed green.

## Fix

- Replaced declaration booleans and proof-file strings with bindings to named
  TypeScript declarations and exact named executable test blocks.
- Bound all 16 reviewed terminal entities to:
  - their concrete state authority;
  - their concrete direct-mutation/governance boundary;
  - an exact test block with handler-specific assertion signatures.
- Bound every governed post-terminal/decision action to the declaration that
  persists `reason`, `beforeSnapshot`, `afterSnapshot`, and `makerId`.
- Bound the shared transition path to `checkerId`, `approverId`, `appliedAt`,
  `ledgerEntryId`, and `applicationResult`.
- Added support for action-kind constants and registered config authorities
  without falling back to whole-file assertion matching.
- Removed the unsupported `Array.prototype.toSorted` use so the test compiles
  under the repository's current TypeScript library target.

## Verification

- Focused Q18 inventory: **5 passed, 0 failed**.
- Backend TypeScript typecheck: **exit 0**.
- Focused ESLint: **exit 0**.
- Scoped diff whitespace check: **green**.

Artifacts:

- `qa/2026-07-28_q18-executable-inventory_backend-test.log`
- `qa/2026-07-28_q18-executable-inventory_backend-typecheck.log`
- `qa/2026-07-28_q18-executable-inventory_lint.log`

Status: DONE
Summary: Q18 coverage is now AST-scoped to concrete handlers and exact executable proof blocks for every inventoried entity and governed action.
Concerns/Blockers: None. The controller should include these files in the independent release re-review and full backend suite.
