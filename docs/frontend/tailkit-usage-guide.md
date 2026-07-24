# Tailkit MCP — Usage Guide

This guide tells you **when and how** to reach for the Tailkit MCP when polishing
the NEPO frontend. Read alongside [ADR 0043](../adr/0043-tailkit-as-reference-catalog.md),
which records the architectural decision.

## TL;DR

**Tailkit is a reference catalog, not a dependency.** Search it for inspiration,
copy snippets via `mcp__tailkit__get_component_code`, retokenize against NEPO
`var(--*)` tokens, ship as a primitive in `design-system/` or `components/shared/`.
Never install it as an npm package.

## The five MCP tools

| Tool | When to use |
|---|---|
| `mcp__tailkit__search_components` | Free-text search. Returns identifiers like `a-c-empty-states-05`. Relevance is uneven — fall back to `browse_catalog` when search misses. |
| `mcp__tailkit__browse_catalog` | Drill `packages → categories → subcategories → components`. Use when you know the family (e.g. "show me all empty-state variants") but not the exact name. |
| `mcp__tailkit__get_component_code` | **The workhorse.** Fetches the snippet in `html` / `react` / `vue` / `alpine`. Prefer `tech: "html"` for retokenization (less React boilerplate to strip). |
| `mcp__tailkit__get_component_suggestions` | Curated bundles by page type (landing, dashboard, auth, settings). Useful for greenfield pages. |
| `mcp__tailkit__get_latest_components` | Newest additions. Useful for trend-check; rarely needed day-to-day. |

Only the **Application UI** package (`a-*`) is relevant to NEPO. The Marketing
(`m-*`) and Ecommerce (`e-*`) packages target external websites.

## When to reach for Tailkit

Reach for the MCP when **all three** are true:

1. You're building or extending a UI primitive (empty state, banner, chart card,
   wizard, command palette, etc.).
2. You want to see "what good looks like" before designing from scratch.
3. The primitive will land in `design-system/` or `components/shared/` (not inline
   in a page).

**Do NOT reach for it** when:

- The primitive already exists. Check the audit table below first.
- The change is page-specific styling. Tailkit snippets are generic; retokenizing
  them for a one-off page is more expensive than writing the page CSS directly.
- You need dark mode (NEPO is light-only — `tokens.css:22`).
- The snippet would require a new runtime dependency. The default is zero new deps.

## What's already in NEPO (do not duplicate)

The following primitives already exist and are at parity or **strictly better**
than their Tailkit equivalents. Don't reach for Tailkit for these.

| Family | NEPO location | Tailkit verdict |
|---|---|---|
| Modal | `components/UI.tsx` `Modal` | KEEP — anime.js spring physics + Esc/Enter + reduced-motion |
| Drawer | `components/UI.tsx` `Drawer` | KEEP — same |
| Toast | `components/shared/Toast.tsx` | KEEP — dedupe logic + spring entrance |
| Alert (inline) | `components/shared/Alert.tsx` | KEEP — daisyUI-backed |
| Skeleton family | `components/shared/Skeleton.tsx` | KEEP — 5 variants |
| DataTable | `design-system/DataTable.tsx` | KEEP — loading skeletons + mobile cards + pagination |
| Tooltip | `components/shared/Tooltip.tsx` | KEEP — daisyUI-backed |
| Breadcrumbs | `components/shared/Breadcrumbs.tsx` | KEEP — daisyUI-backed |
| Form fields | `design-system/forms/*.tsx` | KEEP — typed, integrated with `FormGroup` |
| Pagination | `design-system/Pagination.tsx` | KEEP |
| Radix Select / DropdownMenu | `components/ui/` | KEEP — Radix is the right a11y primitive |
| Layout (sidebar + topbar) | `components/Layout.tsx` | KEEP — forest-green sidebar is brand-defining |
| KPI / PageHeader / Panel / Card / Btn / StatusPill / Badge / FilterPill / PlateTag | `components/UI.tsx` | KEEP |

## Mandatory retokenization

Every adopted snippet must be retokenized before shipping. The universal
translation table:

| Tailkit class | NEPO token |
|---|---|
| `bg-white` | `var(--surface)` |
| `bg-gray-50`, `bg-secondary-50` | `var(--surface-2)` |
| `bg-gray-100`, `bg-secondary-100` | `var(--surface-3)` |
| `bg-emerald-700` (primary fill) | `var(--accent-2)` or `var(--brand)` |
| `bg-emerald-50` (tint) | `var(--accent-soft)` |
| `text-gray-900`, `text-secondary-800` | `var(--ink)` |
| `text-gray-700`, `text-secondary-600` | `var(--ink-2)` |
| `text-gray-500`, `text-secondary-500` | `var(--ink-3)` |
| `text-emerald-500/600/700` | `var(--accent-2)` or `var(--accent-ink)` |
| `text-rose-500`, `text-red-500` | `var(--danger)` |
| `border-gray-200`, `border-secondary-200` | `var(--line)` |
| `border-gray-300`, `border-secondary-300` | `var(--line-2)` |
| `shadow-sm` | `var(--sh-sm)` |
| `shadow-lg`, `shadow-xl` | `var(--sh-lg)` |
| `rounded-lg` | `var(--r)` |
| `rounded-xl` | `var(--r-lg)` |
| `text-2xl font-bold` | `var(--fs-2xl)` / `var(--fw-bold)` |
| `transition duration-150 ease-out` | `transition: all var(--t-normal)` |
| `z-60` (banner) | `var(--z-sticky)` |
| `z-90` (palette backdrop) | `var(--z-overlay)` |

**Always strip:** `dark:*` variants (NEPO is light-only).

**Always swap:**

- Heroicons (`hi-outline` / `hi-solid` / `hi-micro` / `hi-mini`) → `lucide-react`.
  Common mappings: `hi-user-group` → `Users`, `hi-plus` → `Plus`, `hi-x` → `X`,
  `hi-check-circle` → `CheckCircle`, `hi-arrow-up` (rotated 45°) → `ArrowUpRight`,
  `hi-magnifying-glass` → `Search`, `hi-command-line` → `Terminal`.
- Hardcoded button markup (`<button class="bg-emerald-700 …">`) → `<Btn variant="primary" icon={…}>`.

## The grep guardrail (run before merging)

```bash
# All three must return zero lines for new/modified files in the two landing zones.
grep -rnE '(bg|text|border|ring)-(gray|slate|zinc|neutral|stone|secondary)-[0-9]' \
  frontend/src/components/shared frontend/src/design-system
grep -rn 'dark:' \
  frontend/src/components/shared frontend/src/design-system
grep -rn 'hi-outline\|hi-solid\|hi-micro\|hi-mini' \
  frontend/src/components/shared frontend/src/design-system
```

## Where adopted primitives land

Two landing zones, decided per primitive:

- **`design-system/`** — generic, framework-grade primitives (typed columns,
  generic props, no domain logic). Use for data display (DataTable, Tabs,
  Sparkline, EmptyState).
- **`components/shared/`** — app-grade primitives that may carry NEPO domain
  flavor (Vietnamese labels, currency, status pills). Use for Banner,
  CommandPalette, Toast, Alert.

Rule of thumb: if it takes generic `T` data → `design-system/`. If it takes
NEPO-specific props → `components/shared/`.

**Always re-export from the appropriate barrel** (`design-system/index.ts` or
`components/shared/index.ts`). Pages import from barrels, never from individual
files.

## Worked example

Goal: add a persistent dismissible banner for "Kỳ lương đã khoá" notices.

1. **Check NEPO first.** `components/shared/Alert.tsx` exists but is inline-only.
   Real gap — proceed.
2. **Search Tailkit.** `mcp__tailkit__search_components("banner")` →
   `a-c-banners-01..08`.
3. **Fetch.** `mcp__tailkit__get_component_code(identifier="a-c-banners-01", tech="html")`.
4. **Retokenize.** `bg-emerald-700` → `var(--accent-2)`, `text-emerald-50` →
   `var(--fg-on-brand)`, drop all `dark:*`, swap `hi-x` → `X` (lucide-react),
   z-index `z-60` → `var(--z-sticky)`.
5. **Land.** Create `components/shared/Banner.{tsx,css}`. Add to
   `components/shared/index.ts`.
6. **Grep guardrail.** Verify zero forbidden classes in the new files.
7. **Consume.** Migrate one page (e.g. DashboardPage) to use it. Don't migrate
   every page in the same PR — keep blast radius small.

See `plans/260719-frontend-polish-tailkit/` for the full worked plan including
five primitives shipped end-to-end under this rule.
