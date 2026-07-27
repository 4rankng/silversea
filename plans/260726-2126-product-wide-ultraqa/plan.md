# Product-wide UltraQA

Status: completed with documented product gaps

## Goal

Functionally and visually verify every implemented SilverSea requirement across
all roles, functionalities, and pages, with auditable evidence and fix/retest
cycles for proven defects.

## Scope

- Requirements in `docs/prd/`, interpreted through the authority order in
  `CONTEXT.md`.
- Every current authenticated role, route, navigation entry, and supported
  workflow.
- Desktop, tablet, and mobile visual checks, including overflow, readability,
  action visibility, empty/loading/error states, and role-appropriate access.
- Automated lint, typecheck, test, build, and E2E gates affected by fixes.

## Non-goals

- Treating pending PRD proposals or roadmap-only items as already implemented.
- Deployment, production mutation, or destructive test data operations.
- Unrelated refactors or visual redesign.

## Phases

1. Build a PRD-to-implementation-to-role/page coverage matrix.
2. Establish automated and service baselines.
3. Exercise authenticated functional and responsive visual flows.
4. Diagnose, fix, and re-run failed gates for up to five UltraQA cycles.
5. Independent review, context check, and evidence-backed handoff.

## Acceptance criteria

- Every PRD item is classified as implemented, partial, roadmap, pending
  decision, or not found, with source evidence.
- Every current role and reachable page has a functional/access result.
- Every reachable page has desktop, tablet, and mobile visual evidence.
- All affected automated gates are green, or any genuine environment/product
  blocker is captured with exact evidence under `qa/`.
- No changed surface contains a newly introduced skip, stub, placeholder, or
  unverified fix.

## Reports

- `reports/prd-requirements-matrix.md`
- `reports/route-role-coverage.md`
- `reports/visual-functional-results.md`
- `reports/review.md`
