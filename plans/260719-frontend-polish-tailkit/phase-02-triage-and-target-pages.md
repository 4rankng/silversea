---
phase: 2
title: Triage and target pages
status: completed
priority: P2
effort: 2h
dependencies:
  - 1
---

# Phase 2: Triage and target pages

## Overview

Collapse the Phase 1 audit into a **prioritized adoption list of at most 6 items**, each tied to a concrete page or surface where it will land. User signs off here before any code is written.

## Requirements

- **Functional:** produce `targets.md` with ≤6 ranked adoption items: primitive name, source Tailkit identifier, target NEPO location, target pages, expected user-visible improvement, retokenization cost.
- **Non-functional:** every item has a measurable improvement (a11y attribute added, loading state added, mobile layout fixed, etc.) — not "looks prettier".

## Architecture

Pure planning. Output is markdown + an `AskUserQuestion` signoff.

## Related Code Files

- Read (for impact analysis): the largest page CSS files — `pages/DebtDetailPage.css` (excluded from edits, used only to understand current polish level), `pages/DashboardPage.css`, `pages/FleetPage.css`, `pages/TruckTiresPage.css`, `pages/config/debit-note-template-editor.css`, `components/agent/agent.css`.
- Read: `frontend/src/pages/LoginPage.tsx` (only marketing-package candidate).
- Create: `plans/260719-frontend-polish-tailkit/targets.md`

## Implementation Steps

1. **Score each UPGRADE/MISSING from audit.md** on three axes:
   - *User impact* (how many users / how often) — 1-5.
   - *Engineering cost* (retokenization + integration) — 1-5 (5 = cheap).
   - *Blast radius* (how many pages touched, regression risk) — 1-5 (5 = small radius).

2. **Pick the top 6 by `impact × cost × radius`.** Tentative candidates expected from the codebase read (to be confirmed by Phase 1):
   - **Empty/loading states** — `EmptyState` already exists but only one variant; Tailkit `a-c-empty-states-05/06` add placeholder-card previews. Cheap win.
   - **Skeleton variants** — `Skeleton.tsx` ships 5 variants; Tailkit has richer table/list/card skeletons with shimmer tuning. Likely `KEEP`.
   - **Toast / Alert variants** — daisyUI-backed `Alert` exists; Tailkit has dismissible, multi-action, inline-alert patterns worth comparing.
   - **Command palette / quick-add** — currently absent. Tailkit has `a-c-menus-*` and `a-o-overlays-*` candidates. Optional, higher cost.
   - **Data-table column visibility / density toggle** — `design-system/DataTable` is solid; Tailkit table examples often bundle toolbar + density + column toggle. Possible UPGRADE.
   - **Login page polish** — `LoginPage.tsx` is the only marketing-surface candidate; Tailkit `m-*` auth sections could lift split-screen layout. Borderline.
   - **Form field affordances** — `forms/TextField.tsx` etc. are minimal; Tailkit form components add better error/helpText layout. Possible UPGRADE.

3. **For each picked item, write a target block:**
   ```md
   ### T1: Rich empty states with placeholder previews
   - Source: `a-c-empty-states-05`, `a-c-empty-states-06`
   - Target: `frontend/src/components/shared/EmptyState.tsx` (extend, not replace)
   - Lands on: TripListPage, FleetPage, ExpenseListPage, AuditLogPage
   - Improvement: shows a faded preview of what content will look like (cards/rows), instead of plain icon+text.
   - Retokenization cost: low — uses surface/ink/line tokens only.
   - Estimated effort: 1.5h
   ```

4. **Identify the demo page.** Pick the single highest-impact page to land first in Phase 5 (likely `DashboardPage` or `TripListPage`). This is where the user will *see* the polish.

5. **User signoff via `AskUserQuestion`.** Present the 6-item list and let the user trim/reorder. Do not proceed to Phase 3 without explicit signoff.

## Success Criteria

- [ ] `targets.md` exists with ≤6 items, each scored and tied to file paths.
- [ ] User has signed off (or revised) the list via `AskUserQuestion`.
- [ ] At least one item is a *MISSING* (new capability), not just an upgrade — guarantees the plan delivers net-new value.
- [ ] No target lands on `DebtDetailPage` or `PayableDetailPage` (sibling-plan exclusion).

## Risk Assessment

- **Risk:** user wants "polish everything" and the list balloons past 6. *Mitigation:* hard cap; defer overflow to a follow-up plan and say so explicitly.
- **Risk:** picked items all turn out to be cosmetic. *Mitigation:* require at least one a11y or loading-state improvement per cycle.
