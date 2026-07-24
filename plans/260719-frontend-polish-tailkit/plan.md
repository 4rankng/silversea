---
title: Polish frontend with Tailkit + shadcn patterns
description: >-
  Use the Tailkit MCP catalog as a design reference to identify polish gaps in
  the NEPO frontend and surgically adopt higher-quality primitives — without
  forking the existing NEPO design system or rewriting working pages.
status: pending
priority: P2
effort: 2-3 days
branch: main
tags:
  - frontend
  - design-system
  - polish
  - tailkit
  - shadcn
  - tailwind
  - daisyui
blockedBy: []
blocks: []
created: '2026-07-19'
createdBy: 'ck:plan'
source: skill
---

# Polish frontend with Tailkit + shadcn patterns

## Overview

The user wants to know how the **Tailkit MCP** (a shadcn-style component catalog exposing ~646 components via `mcp__tailkit__*` tools, available in HTML/React/Vue/Alpine) can help **polish the existing frontend**.

**Honest starting position (verified):** the NEPO frontend is *not* a greenfield app waiting for a component library. It already has:

- **React 19 + Vite 6 + Tailwind v4** (via `@tailwindcss/vite`, no `tailwind.config.js`).
- **daisyUI 5** integrated with `prefix: "d-"` so daisyUI classes cannot collide with the custom `.btn/.badge/.modal/.input` — `frontend/src/styles/tokens.css:8-13`.
- **A hand-crafted NEPO theme** mirroring forest-green/signal-green brand tokens into both `:root` and the daisyUI `nepo` theme — `frontend/src/styles/tokens.css:18-60`, `:68-296`.
- **Three layers of UI primitives already in place:**
  - `components/UI.tsx` — KPI, PageHeader, Panel, Card, Btn, Toolbar, FilterPill, StatusPill, PlateTag, Badge, FormGroup, Modal, Drawer, ConfirmDialog.
  - `components/shared/` — Spinner, LoadingOverlay, ErrorBoundary, Toast, Skeleton (5 variants), EmptyState, EmptyIllustration, ClickableCard, Tooltip, Alert, Breadcrumbs (the last three are daisyUI-backed).
  - `design-system/` — DataTable, Pagination, EmptyState, form fields (TextField, SelectField, NumberField, CrudFormModal), and hooks (useDebouncedValue, useToken, useTableQueryState, useMonthRoute, useSalaryPeriod, useMonthlyQuery, useAuthedQuery).
  - `components/ui/` — Radix DropdownMenu + Select.
- **129 CSS files / 38,517 lines** of co-located, page-scoped styling. Pages already have polished hero sections (TripHero, EarningsHero), KPI rows, filter bars, and responsive mobile cards.
- **Dependencies already chosen:** TanStack Query + Table, Radix UI primitives, lucide-react, Leaflet, anime.js, driver.js.

**Conclusion the plan must respect:** Tailkit/shadcn is not a *replacement* here. It is a **reference catalog** + a **source of surgical upgrades** for the weakest surfaces. Wholesale adoption would (a) fork the design system, (b) collide with daisyUI class names even with the `d-` prefix if CSS variables diverge, (c) throw away 38k lines of working CSS, and (d) violate YAGNI/KISS.

The plan therefore operates in three modes, in order:

1. **Reference mode** — pull Tailkit patterns into a side-by-side comparison to *find polish gaps* the team may not see because they're close to the code.
2. **Surgical adoption** — lift specific Tailkit snippets, retokenize them against `var(--*)` NEPO tokens, and add them as new primitives in `design-system/` or `components/shared/` — never as a parallel library.
3. **Documentation** — write an ADR + a "when to reach for Tailkit" guide so the team can self-serve after this plan ships.

## Tailkit MCP — what it actually offers

Available tools (already wired into this session):

| Tool | Purpose |
|---|---|
| `mcp__tailkit__browse_catalog` | Drill packages → categories → subcategories → components. |
| `mcp__tailkit__search_components` | Free-text search; returns identifiers like `a-c-statistics-10`. |
| `mcp__tailkit__get_component_code` | Fetch code in `html` / `react` / `vue` / `alpine`. **This is the workhorse.** |
| `mcp__tailkit__get_component_suggestions` | Curated page-type bundles (landing, dashboard, auth, ecommerce, settings, blog). |
| `mcp__tailkit__get_latest_components` | Newest additions — useful for trend check. |

Catalog scope: **Application UI (`a-*`, 394)**, **Marketing (`m-*`, 232)**, **Ecommerce (`e-*`, 20)**. For this app (internal logistics tool), only `a-*` is relevant day-to-day; `m-*` is a stretch (login screen only).

**Crucial fit note:** Tailkit ships **Tailwind v3-era utility classes** (e.g. `bg-gray-50`, `dark:` variants). The NEPO app runs **Tailwind v4** with `@theme` tokens and a daisyUI layer. Adopted snippets must be **retokenized** — replace hardcoded Tailwind palette classes with `var(--surface)`, `var(--ink)`, `var(--line)`, etc. from `tokens.css`. This is the single biggest integration cost and is called out in every adoption phase.

## Phases

| Phase | Name | Status | Effort |
|-------|------|--------|--------|
| 1 | [Audit & catalog](./phase-01-audit-catalog.md) | ✅ Completed | 3h |
| 2 | [Triage and target pages](./phase-02-triage-and-target-pages.md) | ✅ Completed | 2h |
| 3 | [Component mapping & spike](./phase-03-component-mapping-spike.md) | ✅ Completed | 4h |
| 4 | [Adopt Tailkit patterns](./phase-04-adopt-tailkit-patterns.md) | ✅ Completed | 6h |
| 5 | [Migrate polish primitives](./phase-05-migrate-polish-primitives.md) | ✅ Completed | 6h |
| 6 | [Visual QA & docs](./phase-06-visual-qa-docs.md) | ✅ Completed | 3h |

**Sequencing logic:**

- Phases 1–3 are **research/spike** — they produce a prioritized list of adoption targets but ship zero production code. Do not skip even though they feel like overhead; without them, Phase 4–5 will sprawl.
- Phase 4 is the **design-system layer** — retokenized Tailkit patterns land as new primitives in `design-system/` or `components/shared/`, with storybook-style demo pages.
- Phase 5 is the **page layer** — swap the weakest surfaces on real pages to the new primitives.
- Phase 6 is **QA + docs** — visual diff, responsive check, and an ADR so future devs know the rule.

## Dependencies

- No blocking unfinished plan exists under `./plans/`. The sibling plan `260719-debt-period-summary` touches `DebtDetailPage` / `PayableDetailPage` — **do not** touch those two pages in Phase 5 until that plan ships, to avoid merge conflicts. They are explicitly out of scope here.
- Backend is untouched. No schema, API, or audit-log changes.
- No new runtime dependencies are allowed by default. Tailkit snippets are **copy-in source**, not an npm package. Any exception (e.g. a charting library) requires explicit approval in Phase 2.

## Acceptance Criteria

- A documented **audit artifact** (`docs/ui-polish-audit.md` or plan-local `audit.md`) listing every NEPO primitive, its Tailkit nearest-neighbor, and a verdict: *keep as-is / upgrade / no equivalent needed*.
- A **prioritized adoption list** (max ~6 items) signed off by the user before Phase 4 starts.
- Every adopted Tailkit snippet is **retokenized** to NEPO `var(--*)` tokens — no `bg-gray-*`, `text-slate-*`, or hardcoded hex survives in shipped code.
- Every new primitive lives in `design-system/` or `components/shared/` and is **re-exported from the barrel** (`design-system/index.ts` or `components/shared/index.ts`). No page imports Tailkit-flavored classes directly.
- No regression in existing pages — Phase 6 visual diff + `pnpm test` + `pnpm build` must pass.
- An **ADR** (`docs/adr/ADR-XXXX-tailkit-as-reference-catalog.md`) records: Tailkit is a reference catalog, not a dependency; daisyUI `d-` prefix stays; retokenization is mandatory.
- `DebtDetailPage` and `PayableDetailPage` are **not modified** by this plan (owned by sibling plan).

## Scope Boundary

**In scope:**
- Catalog research, gap analysis, prioritized adoption list.
- Surgical retokenized adoption of ≤6 primitives.
- Documentation (audit doc + ADR).
- Visual QA on touched pages at the four NEPO breakpoints (420 / 640 / 1023 / 1100 px — see `tokens.css:264-269`).

**Out of scope:**
- Replacing daisyUI, Radix, or any existing primitive wholesale.
- Introducing shadcn CLI / `components.json` / `cn()` helper as a parallel system. (We borrow *patterns*, not the shadcn toolchain.)
- Any backend, schema, or shared-types change.
- Marketing/Ecommerce Tailkit packages except possibly login page polish.
- The two pages owned by `260719-debt-period-summary`.
- Dark mode (NEPO theme is light-only — `tokens.css:22`).

## Key Risks

- **Design-system fork.** Lifting Tailkit snippets naively creates a second visual language. *Mitigation:* Phase 4 hard rule — retokenize or reject. CI-visible grep for `bg-gray-`, `text-slate-`, `dark:` in `frontend/src`.
- **Scope creep.** "Polish" is open-ended; devs may keep finding things to upgrade. *Mitigation:* hard cap of 6 adoption items, signed off in Phase 2.
- **Tailwind v3 → v4 friction.** Tailkit examples use v3 idioms (`dark:bg-...`, `ring-offset-...`). Some need rewriting. *Mitigation:* Phase 3 spike surfaces these before any production code lands.
- **daisyUI `d-` prefix collision.** Tailkit uses `.btn`, `.badge`, `.input` etc. — these *will* resolve to NEPO's custom classes, not Tailkit's intent. *Mitigation:* never rely on Tailkit's component classes; only use its utility classes, retokenized.
- **Bundle size.** Adding many primitives inflates the CSS. *Mitigation:* Phase 6 runs `pnpm size-check` (`scripts/check-size.mjs`) before close.
- **Conflict with sibling plan.** Touching `DebtDetailPage`/`PayableDetailPage` while `260719-debt-period-summary` is open causes merge pain. *Mitigation:* explicit exclusion in Scope Boundary.

## Cross-Plan Dependency Detection

| Plan | Scope overlap | Relationship |
|---|---|---|
| `260719-debt-period-summary` | `DebtDetailPage.tsx`, `PayableDetailPage.tsx` | This plan **avoid** those two files. No `blockedBy`/`blocks` edge needed because the avoidance is one-sided and self-contained. |

No other unfinished plans under `./plans/`.
