# ADR 0043 — Tailkit MCP is a reference catalog, not a dependency

- **Status:** Accepted
- **Date:** 2026-07-19
- **Relates to:** plan `plans/260719-frontend-polish-tailkit/` (Phases 1–6)
- **Parts touched (Phase 4 of plan):** `frontend/src/design-system/{Tabs,Sparkline,EmptyState}.{tsx,css}`,
  `frontend/src/components/shared/{Banner,CommandPalette}.{tsx,css}`,
  `frontend/src/components/UI.tsx` (`KPI` trend extension),
  `frontend/src/components/KpiCard.css`, `frontend/src/design-system/index.ts`,
  `frontend/src/components/shared/index.ts`, `frontend/src/pages/DashboardPage.tsx` (Banner + EmptyState).

## Context

The NEPO frontend is a mature React 19 + Vite 6 + Tailwind v4 + daisyUI 5 application.
At the time of this ADR it ships:

- A hand-crafted NEPO theme in `frontend/src/styles/tokens.css` mapping forest-green /
  signal-green brand tokens into both `:root` and the daisyUI `nepo` theme.
- daisyUI 5 loaded with `prefix: "d-"` (`tokens.css:8-13`) so its component classes
  (`.btn`, `.badge`, `.modal`, `.input`) cannot collide with NEPO's own custom classes
  of the same name.
- Three layers of UI primitives — `components/UI.tsx`, `components/shared/`,
  `design-system/` — covering KPIs, panels, tables, forms, modals, drawers, toasts,
  skeletons, alerts, tooltips, breadcrumbs, pagination.
- ~38,500 lines of co-located CSS across 129 files. Animations powered by `anime.js`
  with `prefers-reduced-motion` handling throughout.

A **Tailkit MCP** was made available to the project (`mcp__tailkit__*` tools). Tailkit
is a shadcn-flavoured component catalog (~646 components across Application UI,
Marketing, Ecommerce) that returns copy-in source snippets via
`mcp__tailkit__get_component_code` in HTML / React / Vue / Alpine.

A full audit (`plans/260719-frontend-polish-tailkit/audit.md`) compared every NEPO
primitive against its Tailkit nearest-neighbour. Result: **23 of ~30 primitives
scored KEEP**. NEPO's `Modal`, `Drawer`, `Toast`, `Skeleton` family, and `DataTable`
are *strictly better* than their Tailkit equivalents (anime.js spring physics, dedupe
logic, loading skeletons, mobile card render). Tailkit adds value only in 7 narrow
spots — 5 of which were adopted (see Decision).

## Decision

**Tailkit is a reference catalog, not a dependency.**

Concretely:

1. **No new npm dependency.** Tailkit snippets are copy-in source only. They are
   retokenized against `frontend/src/styles/tokens.css` `var(--*)` tokens before
   landing in the repo. No `components.json`, no `cn()` helper, no shadcn CLI.
2. **The daisyUI `d-` prefix stays.** Tailkit uses unprefixed `.btn`/`.badge`/`.input`
   classes that *would* resolve to NEPO's custom classes (not Tailkit's intent) if
   adopted naively. Adopted snippets use only utility classes or NEPO tokens, never
   Tailkit component classes.
3. **Mandatory retokenization.** Every adopted snippet must replace:
   - Tailwind v3 palette classes (`bg-gray-50`, `text-secondary-600`, `border-secondary-200`, …)
     with `var(--*)` tokens.
   - All `dark:*` variants — NEPO is light-only (`tokens.css:22`).
   - Heroicons (`hi-outline` / `hi-solid` / `hi-micro` / `hi-mini`) with `lucide-react`.
   - Hardcoded button markup with `<Btn>` from `components/UI.tsx`.
   The universal translation table lives in
   `plans/260719-frontend-polish-tailkit/porting-notes.md`.
4. **The grep guardrail is machine-checkable.** Production code under
   `frontend/src/components/shared/` and `frontend/src/design-system/` must return
   zero matches for `(bg|text|border|ring)-(gray|slate|zinc|neutral|stone|secondary)-[0-9]`,
   `dark:`, and `hi-(outline|solid|micro|mini)`. Run this before merging any
   Tailkit-inspired work:
   ```bash
   grep -rnE '(bg|text|border|ring)-(gray|slate|zinc|neutral|stone|secondary)-[0-9]' \
     frontend/src/components/shared frontend/src/design-system
   grep -rn 'dark:' frontend/src/components/shared frontend/src/design-system
   grep -rn 'hi-outline\|hi-solid\|hi-micro\|hi-mini' \
     frontend/src/components/shared frontend/src/design-system
   ```
5. **Adopted primitives land in the existing layers, never a parallel library.**
   Five targets shipped under this rule:
   - **T1** — `design-system/EmptyState.{tsx,css}` extended with a `preview="cards|rows|list"`
     variant (inspired by `a-c-empty-states-05`).
   - **T2** — `design-system/Sparkline.{tsx,css}` hand-rolled SVG (inspired by
     `a-c-statistics-11`); `KPI` extended with a `trend` prop.
   - **T3** — `components/shared/Banner.{tsx,css}` persistent dismissible banner
     (inspired by `a-c-banners-01`).
   - **T4** — `components/shared/CommandPalette.{tsx,css}` Cmd/Ctrl+K palette
     (inspired by `a-c-command-palettes-07`).
   - **T5** — `design-system/Tabs.{tsx,css}` shared tabs over daisyUI `.d-tabs`,
     DRYing the inline `role="tab"` markup in 5 pages.

## Consequences

**Positive:**

- Filling polish gaps (empty states with previews, persistent banners, sparkline
  trends, Cmd+K navigation) no longer requires a design from scratch — search the
  MCP, retokenize, ship.
- No new runtime dependency. No bundle-size regression (DashboardPage migration
  added ~60 bytes gzipped to `index.js`).
- The grep guardrail makes the retokenization rule verifiable in code review and CI.
- Future devs can self-serve via `docs/frontend/tailkit-usage-guide.md`.

**Negative:**

- Retokenization cost is real: ~30–60% of every adopted snippet's lines must be
  rewritten. The Tailwind v3 → v4 + daisyUI `d-` prefix + Heroicons → lucide
  translation is non-trivial for non-trivial snippets.
- Marketing/Ecommerce Tailkit packages (`m-*`, `e-*`) are mostly irrelevant to an
  internal logistics tool — only the Application UI package sees regular use.
- Without discipline, copy-in source drifts from upstream Tailkit improvements.
  Acceptance: we treat snippets as one-time inspiration, not maintained forks.

## When to revisit

Open a new ADR if any of these change:

- The team decides to consolidate on shadcn CLI wholesale (`components.json`,
  `cn()` helper, Radix-only primitives). That would supersede this decision.
- NEPO adds dark mode (`tokens.css:prefersdark:false` flips). At that point `dark:`
  variants in adopted snippets become desirable, not forbidden.
- A chart-heavy feature lands where hand-rolled SVG (T2 Sparkline) is no longer
  enough. Re-evaluate adding a chart library as a separate decision.

## References

- Plan: `plans/260719-frontend-polish-tailkit/plan.md`
- Audit: `plans/260719-frontend-polish-tailkit/audit.md`
- Retokenization table: `plans/260719-frontend-polish-tailkit/porting-notes.md`
- Usage guide: `docs/frontend/tailkit-usage-guide.md`
