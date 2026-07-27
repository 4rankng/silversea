# Phase 1 — Diagnose, fix, and verify

## Scope

- `frontend/src/lib/api/photo.ts`
- focused regression tests for photo URL normalization
- QA evidence under `qa/`

## Non-goals

- No deployment.
- No upload/storage schema change.
- No changes to trip data or unrelated product-wide QA work.

## Gates

- [x] Reproduction evidence captured.
- [x] Regression test fails before the fix and passes after it.
- [x] Frontend typecheck and tests pass.
- [x] Root lint and build pass.
- [x] Independent review approves the scoped diff.
- [x] `pnpm context:check` passes.
