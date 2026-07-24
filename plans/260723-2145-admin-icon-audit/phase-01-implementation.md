# Phase 01 — Admin icon implementation

## Context

Authenticated visual inspection covered all static admin routes plus representative trip, fleet, customer, supplier, debt, expense, settlement, and config detail routes.

The asset registry already contains distinct artwork for most domains. The remaining gaps are seven concepts:

- Company profile
- Trip-expense rules
- Equity ownership
- Tire management and tire positions
- Trailers
- Audit history
- Active customers

## Files

- `frontend/public/assets/icons/46-*.png` through `55-*.png`
- `frontend/src/components/AssetIcon.tsx`
- `frontend/src/data/searchRegistry.ts`
- `frontend/src/data/searchRegistry.test.ts`
- Relevant config and page-header components identified by the route audit

## Implementation

1. Generate transparent PNG icons using the existing navy, green, and mint visual language.
2. Register the assets through `AssetIcon`; do not introduce another icon map.
3. Correct config-card and global-search assignments at `searchRegistry.ts`.
4. Match page and detail headers to the same semantic assignment.
5. Replace misleading existing assignments with existing assets where possible.

## Validation

- Focused search-registry test
- Frontend test suite
- Frontend production build
- UI contract check and `git diff --check`
- Authenticated desktop pass of all affected routes
- Representative mobile pass for config, fleet tires, settlement, and finance

## Constraints

- Preserve route guards, API behavior, selectors, interaction footprints, and current layouts.
- Preserve unrelated worktree changes.
- Keep sidebar Lucide navigation unchanged.
- Do not create decorative wrappers, shadows, or redundant labels.
