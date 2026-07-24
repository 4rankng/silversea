# Design Guidelines

> **Audience:** Frontend developers implementing or reviewing UI. For code conventions, see [Code Standards](code-standards.md). For component-level trip-detail design, see the memory entry [trip-edit-page-design](../.claude/projects/-Users-dev-Documents-projects-nepocorp/memory/trip-edit-page-design.md).

## Typography

Two self-hosted fonts, zero Google CDN:

| Font | Usage | Source |
|------|-------|--------|
| **Be Vietnam Pro** | All text, UI labels, body copy, headings | Self-hosted TTF in repo |
| **JetBrains Mono** | Numeric data, tabular figures, code | Self-hosted TTF in repo |

Do not add new fonts. Do not reference Google Fonts CDN.

## Color System

The TransTing brand palette centers on an emerald shell and primary actions, with a unified emerald-and-white route-T mark and signal green as an accent. Preserve the existing flat surfaces and semantic status colors; the rebrand is a token and identity shift, not a glossy visual overhaul.

| Token | Color | Use |
|-------|-------|-----|
| `--sidebar` / `--sb-bg` | `#005A2D` | Deep emerald sidebar and shell surfaces |
| `--color-primary` / `--brand` / `--accent-2` | `#005A2D` | Deep emerald primary CTA and selected states |
| App mark | `#005A2D` / `#FFFFFF` | Emerald tile with a single white route-T silhouette |
| `--brand-2` / `--accent` | `#10B956` | Signal green secondary brand color |
| `--success`, `--warning`, `--danger`, `--info` | Semantic palette | Status and validation feedback only |

The checked-in ImageGen master at `frontend/assets-source/transting-logo-master.png`
is the visual source for all raster sizes. Regenerate the app, PWA, favicon, and
transparent sidebar assets with `pnpm --dir frontend run generate:brand`; the
brand contract verifies dimensions, palette boundaries, transparency, and the
route stem at small sizes. ImageMagick 7 (`magick`) is required for generation
and the brand/UI contract checks. PWA maskable variants use additional padding
to keep the route-T inside the platform safe zone.

- Status colors follow the `statusStrip` convention (see below).
- CTA buttons stay subtle and flat; avoid heavy or glossy treatment.

## Brand Copy

Use the approved Vietnamese positioning copy on external-facing brand surfaces:

- Tagline: `Vận tải thông minh. Doanh nghiệp vững mạnh.`

## statusStrip Component

Every status display across the application (desktop and mobile) uses the **3x20px status strip** component.

- Renders as a thin horizontal color bar indicating entity status.
- Colors map to trip/entity statuses (CREATED, IN_TRANSIT, COMPLETED, LOCKED, CANCELED).
- Appears on list rows, detail pages, and mobile views consistently.
- Custom CSS class: `.status-strip` with status-specific color variants.

**Rule:** If you display a status, use the `statusStrip` component. Never render a full-height colored background or a plain text badge for status.

## Money Display

Use the `<Money>` component for all currency values:

| Aspect | Convention |
|--------|-----------|
| Currency sign | Dong sign rendered as **subtitle-sized** unit |
| Number format | Full number by default, compact on narrow cards |
| Zero/negative | Show with proper sign handling (double-negative gotcha: `- (-amount)` = positive) |
| Precision | VND: no decimal places in display. Internal calculations at 2dp via `round2dp()`. |

See [money-subtitle-unit-convention](../.claude/projects/-Users-dev-Documents-projects-nepocorp/memory/money-subtitle-unit-convention.md) for the full specification and edge cases.

## Data Display Rules

### No Truncation

Never truncate column values. Instead, use one of:

- **Wrap** -- let long text wrap to multiple lines
- **Tooltip** -- show truncated preview on hover with full text in tooltip
- **Card layout** -- use a card instead of a table row for entities with long fields

### No Raw IDs

Never show raw database IDs in UI text. Always display meaningful business labels:

| Instead of... | Show... |
|---------------|---------|
| `Trip #42` | Customer name + route + date |
| `Driver ID: 7` | Driver full name |
| `Truck 3` | License plate |

### No `!important`

Never use `!important` in CSS. Use page-scoped selectors (each page has its own CSS file) for specificity control.

## Empty States

All empty-state illustrations route through `frontend/src/lib/emptyIllustrations.ts` via `resolveEmptyIllustration(categoryName)`.

- 4 PNG illustrations: `empty-1` (trips), `empty-2` (fleet), `empty-3` (ops), `empty-4` (finance).
- To add a new empty-state category, add the category name to the resolver's `CATEGORY_BY_NAME` map.
- Do not create new `empty-*.svg` files -- the resolver routes to the existing PNG set.

## Trip Detail & Edit Page Design

### Layout

- **Detail page:** 2-column body layout. Main content area (1.6fr) + sticky right rail (1fr).
- **KPI strip:** `variant="rail"` for the right rail placement.
- **Mobile:** Columns stack vertically with reorder via `tdp-r/m` CSS order classes.

### Card System (Bento Layout)

- **Edit page:** 6-card bento layout with single-column form.
- **Finance card:** Stacked vertically within the bento.
- **Color scheme:** deep emerald shell and primary CTAs, with a white route-T mark and signal green accents.

### Buttons

- **Cancel/secondary:** `Huyc bo` (cancel) -- standard secondary button.
- **Action/primary:** Subtle, never heavy. Follows the "sore in the eye" principle.

## Mobile-First Roles

Two roles require mobile-first responsive design:

| Role | Vietnamese | Mobile Priorities |
|------|-----------|-------------------|
| DRIVER | Lai xe | Trip list (compact), earnings summary, penalty history. Large touch targets. Minimal text entry (read-only). |
| FORWARDER | Giao nhan | Trip list (compact), container/seal entry form, advance fund management. Form inputs optimized for phone keyboard. |

### Responsive Strategy

- Breakpoints via Tailwind responsive utilities.
- `useObservedWidth` hook for JS-driven layout decisions.
- Page-scoped CSS with mobile overrides via media queries.

## Dashboard Charts

- Dashboard charts show **running/cumulative amount** over time.
- Chart label: "Doanh thu" (not "Xuot huong doanh thu" or "Revenue Trend").
- Use Recharts for all chart rendering.

## Notification Bell

- Located in the topbar actions area.
- Displays unread badge count.
- Dropdown with notification list + mark-all-read button.
- Web Push toggle (on/off) for browser notifications.

## Chatbot Drawer

- Slides in from the right side of the screen.
- Real-time communication via Socket.io.
- Supports agent directives: navigate to page, highlight element, start guided tour.
- Messages rendered with markdown support.

## Tour Engine

- Curated walkthroughs scoped to user role (`toursForRole`).
- Triggered by chatbot response, the starter checklist, or the persistent **Hướng dẫn sử dụng** library in the topbar.
- Uses Driver.js for element spotlight and step-by-step guidance.
- Progress is written through to the onboarding API and cached locally by tour id + catalog version; outdated local steps never resume a changed tour.
- Opening or viewing a guide never completes a checklist item. A work item completes only after its matching product-success event; an orientation/reference item completes only after its own guide is finished.
- For enabled office-role onboarding, the library remains available from the topbar after the checklist is dismissed or completed.

## Accessibility

- Semantic HTML elements (not just divs).
- ARIA labels on interactive elements.
- Keyboard navigation support.
- Color contrast compliance for status indicators.

## File Organization

```
frontend/src/
  design-system/     Token definitions, theme configuration
  styles/            Global CSS + page-scoped CSS files
  components/
    shared/          Cross-feature shared components
    agent/           Chatbot drawer, message list, directives
    billing/         Debit-note, statement components
    charts/          Recharts wrapper components
    config/          Config page components
    trip/            Trip-related shared components
  features/          Feature-scoped component directories
    dashboard/
    dispatch/
    fleet/
    penalties/
    tires/
    trip-detail/
    trips/
    users/
  lib/               Utilities (format, date, api, route, maps, etc.)
```

## Anti-Patterns

| Don't | Do Instead |
|-------|-------------|
| Truncate long text | Wrap, tooltip, or card layout |
| Use `!important` | Page-scoped CSS selectors |
| Show raw DB IDs | Business labels (name, plate, route) |
| Add new Google Fonts | Use existing Be Vietnam Pro + JetBrains Mono |
| Heavy CTA buttons | Subtle, understated action buttons |
| Full-height status backgrounds | `statusStrip` 3x20px component |
| New empty-*.svg files | Add category to `resolveEmptyIllustration` |
| `Dong` as same-size text | `<Money>` with subtitle-sized unit |

## Related Documents

| Document | Purpose |
|----------|---------|
| [Code Standards](code-standards.md) | TypeScript, CSS, and API conventions |
| [Codebase Summary](codebase-summary.md) | Frontend directory map |
| [System Architecture](system-architecture.md) | Request lifecycle and data flow |
| [Product Overview](project-overview-pdr.md) | User personas and module map |
