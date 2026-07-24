---
phase: 5
title: "Migrate polish primitives"
status: completed
priority: P2
effort: 6h
dependencies: [4]
---

# Phase 5: Migrate polish primitives

## Overview

Swap the weakest surfaces on real pages to the new primitives. Touch as few pages as possible — start with the Phase 2 demo page, then expand only where the migration is mechanical.

## Requirements

- **Functional:** at least 2 pages consume at least one new primitive each, with visible improvement (better empty state, loading state, or affordance).
- **Non-functional:** no behavioral regression on touched pages. No API contract change. Mobile and desktop layouts both pass.

## Architecture

Pure refactor: page imports the new primitive from the barrel, swaps the JSX, removes the old inline markup. No backend, no router, no shared-types change.

## Related Code Files

- Modify: `frontend/src/pages/DashboardPage.tsx` (+ .css if needed) — likely demo page.
- Modify: `frontend/src/pages/TripListPage.tsx` or `FleetPage.tsx` — secondary landing for empty-state improvements.
- Modify: `frontend/src/pages/AuditLogPage.tsx` — candidate for DataTable column-visibility if that target shipped.
- Modify: `frontend/src/pages/ExpenseListPage.tsx` — empty-state candidate.
- **Excluded (sibling plan owns):** `DebtDetailPage.tsx`, `PayableDetailPage.tsx`.
- Update: `frontend/src/pages/_designSystemPreview.tsx` — add a "used in production by" note per primitive.

## Implementation Steps

1. **Map each primitive to its consumers.** Grep for current usages of the *old* surface:
   ```bash
   grep -rn "EmptyState" frontend/src/pages
   grep -rn "from '@/design-system'" frontend/src/pages
   ```
   Identify the 2-3 highest-traffic pages per primitive.

2. **Migrate the demo page first.** Pick the Phase 2 demo page (e.g. Dashboard). Replace one surface (e.g. the empty state on the trips panel) with the new primitive. Verify in dev: `cd frontend && npx vite --port 7173`.

3. **Migrate secondary pages.** For each, do the smallest mechanical swap. If a page's old markup is heavily customized, **do not force-migrate** — leave it and note in `targets.md` as "deferred".

4. **Mobile audit per page.** Open at 420px and 640px in dev tools. Confirm: no horizontal scroll, no overflow, tap targets ≥ 44px where applicable, Vietnamese text doesn't truncate badly.

5. **Accessibility spot-check.** For each migrated surface:
   - Empty state: `role="status"` or `aria-live="polite"` if it's a loading outcome.
   - Toast/Alert: dismissable via keyboard, focus returns to trigger.
   - Data table: column-visibility menu is keyboard-naviggable, Escape closes.

6. **Run the test suite.** `cd frontend && pnpm test`. Existing tests must pass; add a test for any primitive that introduced branching logic (e.g. EmptyState with preview variant).

7. **Size check.** `cd frontend && pnpm size-check`. If bundle grew >5% on a single primitive, investigate — likely a Tailwind utility class sneaked in that pulled a new layer.

## Success Criteria

- [ ] ≥2 pages migrated, each visibly improved per Phase 2 targets.
- [ ] `pnpm test` passes (existing + any new tests).
- [ ] `pnpm size-check` passes.
- [ ] No horizontal scroll at 420 / 640 px on migrated pages (manual check).
- [ ] `DebtDetailPage` / `PayableDetailPage` git diff is empty (sibling-plan exclusion respected).

## Risk Assessment

- **Risk:** migration exposes a latent bug in the existing page (e.g. empty state was never reachable because of an upstream condition). *Mitigation:* that's a real bug — log it, don't hide it. Either fix in scope or open a follow-up.
- **Risk:** visual regression on a page nobody migrated (cascade side-effect from CSS changes). *Mitigation:* Phase 4 CSS additions are scoped to new class names; nothing existing is restyled. Phase 6 visual sweep catches anything.
- **Risk:** scope creep into "while I'm here, let me also…". *Mitigation:* one swap per page. Defer everything else.
