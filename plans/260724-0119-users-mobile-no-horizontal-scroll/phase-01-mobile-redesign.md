# Phase 01 — Mobile Redesign

Status: completed  
Depends on: none

## Objective

Implement the screenshot-informed Users mobile layout without any horizontal scrolling, while preserving desktop presentation and all role-based behavior.

## Source Findings

1. Confirmed overflow: the mobile KPI rule uses `repeat(4, minmax(132px, 1fr))`, creating at least 552px including gaps, then masks the mismatch with `overflow-x: auto`.
2. Likely toolbar overflow: six intrinsic-width filter pills, a spacer, and a search control share the generic `.toolbar`; Users CSS does not establish a mobile wrap/grid, full-width search row, or `min-width: 0`.
3. Likely card overflow: the header combines a 40px avatar, flexible identity, non-shrinking role pill, 44px kebab control, and gaps. The detail area loses another 52px to left padding; email/phone children lack explicit `min-width: 0` and `overflow-wrap`.
4. Growth overflow: the footer generates all numbered pagination buttons in a single flex row. More pages can exceed 320px.
5. Contract mismatch to correct within scope: mobile cards display `StatusStrip` and a duplicate `UserStatusBadge`; design guidance requires the thin strip as the status treatment.

## Implementation

### 1. Structure `UserTable.tsx`

- Preserve the desktop table branch and its 880px internal table minimum; it remains hidden on mobile.
- Add narrow, semantic wrapper classes only where CSS needs stable hooks: filter group, search row, legend, pagination summary, pagination controls, and card identity/action regions.
- Keep the same filter map, callbacks, ARIA pressed state, search behavior, and page reset behavior.
- Keep `StatusStrip` on every mobile card and remove the duplicate mobile `UserStatusBadge`; retain the strip legend using `StatusSwatch`.
- Recompose the mobile card so identity has a true `minmax(0, 1fr)` column, the 44px menu occupies its own column, and the role pill/details flow below rather than competing with long names.
- Do not change `canEditRow`, delete visibility, self-delete disabling, row keyboard activation, or accountant DRIVER-only edit scope.
- Keep the menu anchored to its card/action and constrain it to the available viewport width.
- Make pagination markup eligible to wrap or use a compact current/adjacent-page presentation without changing page state semantics.

### 2. Scope responsive CSS in `users.css`

- Under `@media (max-width: 640px)`, replace the four-column KPI scroller with `repeat(2, minmax(0, 1fr))`; remove horizontal overflow and reduce gaps/padding enough for 320px.
- Give all critical wrappers `max-width: 100%` and all flexible descendants `min-width: 0`; do not apply a global `overflow-x: hidden` bandage.
- Make the toolbar a vertical stack: wrapping role-filter group first, full-width 44px search second. Allow pill labels/counts to stay legible without clipping.
- Use a three-column card header (`40px minmax(0,1fr) 44px`) and place role metadata/details on a following full-width row.
- Remove the 52px detail indent on narrow phones; apply `overflow-wrap: anywhere` to user-provided name, handle, email, and phone content, preserving the no-truncation rule.
- Keep cards, panel borders, Forest Sage/Deep-Luxe tokens, and inherited Be Vietnam Pro. Do not add font imports, shadows, icon wrappers, dependencies, or `!important`.
- Let the footer stack summary above controls at narrow widths; controls wrap/condense inside the panel and remain 44px minimum targets.
- Keep all new rules under `.users-admin-page`/`.users-table-panel` to avoid regressions elsewhere.

## Verification Matrix

| Width | Required result |
|---|---|
| 320px | Two equal KPI columns; wrapped filters; full-width search; long card data stays inside panel; footer/actions fit; zero horizontal scroll. |
| 375px | Same behavior with balanced gutters and no clipped fourth KPI, role pill, menu, or status strip. |
| 390px | Same behavior; 2×2 KPI grid remains aligned and cards use available width without arbitrary max widths. |
| 430px | Same mobile composition; no premature desktop table and no nested horizontal scroller. |

For each width, verify `scrollWidth === clientWidth` on the document and inspect the KPI grid, toolbar, legend, first/last card, open kebab menu, pagination, permission notice, and empty state.

## Functional and Accessibility QA

- Manager/admin: add, edit, permitted delete, current-user delete disabled.
- Accountant: only DRIVER cards editable; no add/delete controls.
- Read-only role: no edit affordance; notice remains readable.
- Keyboard: focus order follows visual order; card activation, filter buttons, search clear, menu, and pagination work with visible focus.
- Touch: all interactive targets are at least 44×44px.
- Content: test very long Vietnamese full name, username, email, phone, plate, inactive user, empty results, and enough results for multiple pages.
- Status: each card retains the 3×20px `StatusStrip`; no status badge or full-height colored card edge.
- Desktop regression: compare at 641, 1024, and 1440px; table columns, sorting, hover/focus behavior, header CTA, and permissions are unchanged.
- Run the repository frontend build, then browser-capture the four required mobile widths.

## Risks and Rollback

- Shared `.toolbar`, `.kpi-grid`, `.m-card`, and `.table-foot` styles can leak; mitigate with page-scoped selectors.
- Removing the duplicate status badge reduces text redundancy by design; the strip legend retains meaning.
- Rollback is a two-file responsive/component revert; no schema, API, or persisted-state impact.
