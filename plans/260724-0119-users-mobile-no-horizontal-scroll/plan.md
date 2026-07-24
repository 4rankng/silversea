# Users Mobile — No Horizontal Scroll

Status: completed  
Date: 2026-07-24  
Scope: screenshot-led responsive redesign of the existing Users page.

## Outcome

Keep the established desktop table and permissions intact while making the complete mobile page usable at 320–430px without horizontal page or nested-section scrolling.

## Evidence

- Screenshot shows the fourth KPI clipped beyond the right edge.
- `users.css` currently sets four mobile KPI columns to `minmax(132px, 1fr)` and enables `overflow-x: auto`; the minimum track width plus gaps cannot fit a phone.
- The toolbar renders six role filters and a search field in one generic toolbar without a users-scoped mobile layout or `min-width: 0` containment.
- Mobile cards keep avatar, long identity, role pill, and a 44px action in one row; details also retain a 52px left indent. Long Vietnamese names/emails can exhaust 320px.
- Pagination renders every page control in one flex group, which can overflow as the user count grows.

## Design Direction

Refined, utilitarian mobile admin UI using existing Forest Sage/Deep-Luxe tokens and inherited Be Vietnam Pro. Prioritize scanability and vertical flow: 2×2 KPI grid, wrapped filter group, full-width search, compact user cards, and wrapping/condensed pagination. No decorative additions.

## Phase

1. [Phase 01 — Mobile redesign](phase-01-mobile-redesign.md)

## Files Expected to Change During Implementation

- `frontend/src/features/users/components/UserTable.tsx`
- `frontend/src/features/users/users.css`

No backend, shared type, route, dependency, or permission changes.

## Guardrails

- Preserve the desktop layout at widths above 640px.
- Preserve `canManage`, `canDelete`, `canEditDriversOnly`, self-delete protection, edit keyboard behavior, filtering, sorting, search, and pagination.
- Keep `StatusStrip` as the sole status treatment on each row/card; no full-height status background or duplicate text badge.
- Use existing tokens and Be Vietnam Pro only; no new dependency, raw design system, `!important`, or unrelated refactor.
- Keep every interactive target at least 44×44px with visible keyboard focus.

## Acceptance

- At 320, 375, 390, and 430px: `document.documentElement.scrollWidth === document.documentElement.clientWidth`; KPI, toolbar, cards, menus, footer, and notices remain fully reachable by vertical scrolling only.
- At all four widths: four KPIs appear in a 2×2 grid; no clipped tile and no horizontal KPI scroller.
- Filters wrap within the panel; search is full width; long Vietnamese names, usernames, emails, phone values, role labels, and plates wrap or shrink without truncation.
- Mobile actions remain permission-correct and operable; status strip remains visible.
- At 641px and common desktop widths, the existing desktop table and header composition are visually unchanged.
- Frontend build passes and browser QA covers populated, empty, long-content, multi-page, manager, accountant, and read-only states.

## Rollback

Revert only the Users component/CSS responsive changes; no data or migration rollback required.
