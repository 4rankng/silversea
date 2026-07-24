# Trip Detail Page — Bento Layout Redesign

**Date:** 2026-06-13
**Status:** Approved
**Page:** `/trips/:id` (TripDetailPage)

## Goal

Reorganize the trip detail page from a vertical stack into a two-zone bento grid layout. Reduces vertical scrolling, improves visual hierarchy, and matches the bento grid style recently applied to TripListPage and DispatchPage hero cards.

## Current State

The page renders as a vertical stack:
1. TripHeader (title + status + actions)
2. KpiStrip — 4 equal columns (Revenue, Cost, Profit, Margin)
3. Detail Grid — 3 equal columns (BasicInfo, Financial, Fuel)
4. ServiceCostsCard — full width
5. JourneyCard — full width
6. ExternalCarrierCard — conditional, full width
7. PhotosCard — conditional, full width
8. Notes — conditional, full width

Problems: excessive vertical scrolling, KPIs disconnected from the trip info, financial detail buried below the fold.

## Design: Two-Zone 4-Column Bento

### Zone 1 — "At a Glance"

4-column grid. KPIs + BasicInfo at top, Journey below for immediate visual impact.

```
Desktop (≥1024px):
┌────────┐┌────────┐┌────────┐┌────────────┐
│Revenue ││  Cost  ││ Profit ││ BasicInfo  │
│ (1col) ││ (1col) ││(1col✨)││  row-span-2│
└────────┘└────────┘└────────┘│            │
┌──────────────────────────────┘            │
│  Journey (map+legs)        3-col span    │
└───────────────────────────────────────────┘
```

Grid assignments:
- Revenue KPI: `col 1, row 1`
- Cost KPI: `col 2, row 1`
- Profit KPI (accent): `col 3, row 1`
- BasicInfoCard: `col 4, row span 2`
- JourneyCard: `col 1–3, row 2`

### Zone 2 — "Financial Detail"

4-column grid. Financial P&L gets 2-column span for readability.

```
┌───────────────────────┐┌────────┐┌────────────┐
│ Financial (P&L)       ││  Fuel  ││  Service   │
│ 2-col span            ││        ││  Costs     │
└───────────────────────┘└────────┘└────────────┘
┌───────────────────────┐┌────────────────────────┐
│ External Carrier *    ││ Photos *               │
└───────────────────────┘└────────────────────────┘
┌──────────────────────────────────────────────────┐
│ Notes *                                          │
└──────────────────────────────────────────────────┘
```

Grid assignments:
- FinancialCard: `col span 2`
- FuelCard: `col span 1`
- ServiceCostsCard: `col span 1`
- ExternalCarrierCard: `col span 2` (conditional)
- PhotosCard: `col span 2` (conditional)
- Notes: `col span 4` (conditional, full width)

### Responsive Behavior

| Breakpoint | Zone 1 | Zone 2 |
|---|---|---|
| ≥1024px | 4-col bento | 4-col bento |
| 641–1023px | 2-col: KPIs 2x2, BasicInfo full, Journey full | 2-col: Financial full, Fuel+Service side-by-side, Photos+External full |
| ≤640px | 1-col stack | 1-col stack |

## Files Changed

| File | Change |
|---|---|
| `TripDetailPage.tsx` | Reorder JSX into two `<section className="bento-zone-N">` wrappers |
| `TripDetailPage.css` | Replace `kpi-strip` and `detail-grid` with bento grid classes + span utilities |
| `KpiStrip.tsx` | Refactor: render individual KPI cards as direct children (remove outer `<section>` wrapper) so they become grid items |
| `BasicInfoCard.tsx` | No structural change — gets `row-span-2` via parent CSS or wrapper div |
| `JourneyCard.tsx` | No structural change — gets `span-3` via parent CSS or wrapper div |
| `FinancialCard.tsx` | No structural change — gets `span-2` via parent CSS or wrapper div |
| `FuelCard.tsx` | No change |
| `ServiceCostsCard.tsx` | No change |

## CSS Architecture

New bento utility classes in TripDetailPage.css:

```css
.bento-zone-1,
.bento-zone-2 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}
.span-2 { grid-column: span 2; }
.span-3 { grid-column: span 3; }
.span-4 { grid-column: span 4; }
.row-2  { grid-row: span 2; }
```

Existing `.kpi` card styles are preserved — they become grid children naturally.

## KPI Strip Refactor

Current KpiStrip renders 4 KPIs inside a `<section className="kpi-strip">` wrapper. In the bento layout, individual KPI cards need to be direct grid children of `.bento-zone-1` to accept grid placement.

**Approach:** KpiStrip receives a `renderKpi(index)` prop or exposes individual KPI components, OR the parent page renders each KPI directly. Simplest: KpiStrip keeps its current API but the parent wraps the result in a fragment, or KpiStrip renders a fragment instead of a section.

Chosen: KpiStrip renders a `<React.Fragment>` instead of `<section className="kpi-strip">`. The parent wraps each KPI in a `<div>` with appropriate span classes if needed. Since all 4 KPIs are 1-col, no span classes needed — they're natural grid children.

## Constraints

- Preserve all existing card components and their props
- No `!important` (project convention)
- Use design tokens (`var(--fs-*)`, `var(--line)`, etc.)
- VND formatting unchanged
- Animation classes (`.anim .d1`–`.d6`) preserved, timing adjusted for new order
- ExternalCarrierCard, PhotosCard, Notes remain conditional
