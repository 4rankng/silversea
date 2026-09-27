# Frontend design system — the map

**Read this before touching UI.** The operator's complaint that started this
document set: *"UI UX are all random piecemeals per page, not consistent,
coherent at all."* The pieces existed — tokens, primitives, contract tests — but
there was no single map, so every page invented its own answer and a later
session could not tell which of the two answers was the law.

Two documents have different jobs:

| Document | Job |
|---|---|
| `docs/design-guidelines.md` | The **law book**: dated rulings with their source and the incident that caused them. Append-only history. |
| `docs/design-system/*` (this set) | The **system**: what exists, which one to use for a job, what is banned, and what enforces it. Kept true to the tree. |

## The four slices

1. [`01-tokens.md`](./01-tokens.md) — colour semantics, type scale, spacing, radii, elevation, motion, density. Where a page must never write a raw value.
2. [`02-controls-and-forms.md`](./02-controls-and-forms.md) — buttons, button groups/segments, inputs, search shells, selects/comboboxes, facets, date/time fields, validation, focus, touch floors.
3. [`03-data-display-and-feedback.md`](./03-data-display-and-feedback.md) — tables vs record cards, cell patterns, badges/chips/counts, filter bars, KPI rails, empty/loading/error surfaces, destructive actions.
4. [`04-layout-navigation-and-overlays.md`](./04-layout-navigation-and-overlays.md) — app shell, page containers, header anatomy, breakpoints and bands, chrome budgets, drawers/modals/popovers, navigation.

## The rule of one answer

Every pattern has exactly **one** sanctioned implementation. A page may size a
shared primitive (phone type scale, width in its own grid cell) but never
restyle its shape, and never re-declare a rule that a shared band already owns —
a page-level rule with higher specificity silently out-ranks the band and that
is how both 2026-09-27 regressions happened (invoice-tracking `nowrap`, route
name clipping; see `docs/design-guidelines.md`).

When you need a look the system does not have: change the **primitive**, then
let every page inherit it. Never a page-local variant.

## Enforcement map

A rule without a check rots. Everything below runs locally; the first three
also gate `git commit` / CI.

| Instrument | Runs | Catches |
|---|---|---|
| `cd frontend && pnpm vitest run` | whole suite | behaviour + the CSS/contract pins in `src/styles/*.styles.test.ts` and each page's `*.test.tsx` (a rule that must exist, a banned declaration that must not) |
| `cd frontend && pnpm check:ui` (`scripts/check-ui-contract.mjs`, `check-brand-contract.mjs`) | on demand / CI | structural UI and brand violations across every CSS file |
| `cd frontend && pnpm size-check` (`scripts/check-size.mjs`) | pre-commit (`structure.guard.test.ts`) | file-size ceilings |
| `cd frontend && pnpm design:drift` | **pre-commit** + on demand | page CSS that adds a raw value: hex colours, off-ladder `border-radius`, raw `box-shadow`/`z-index`, untokenized `transition`, a new breakpoint. Counts may fall, never rise (`frontend/design-drift.baseline.json`) |
| `cd frontend && pnpm design:lock` | on demand (needs the dev server up) | the **rendered** result at a given width: chrome budgets, record heights, clip counts, tap floors, caption floors, relationships, `computed` values that a higher-specificity rule would change — `design-lock/expectations/filters.mjs` holds the filter-strip contract (`rows ≤2`, family `maxWidth`, `matchHeight`). Evidence in `qa/design-lock/` |
| `cd frontend && node role-ui-sweep.mjs` | on demand | every route of every role at 390/768/1440: overflow, clipped values, sub-44 controls, sub-11px text, console/API errors. Evidence in `qa/role-sweep/` |

Why both a suite and a browser lock: the suite proves *behaviour* and that a
rule **exists in a file**; it cannot see which rule **wins** in the browser.
`design-lock` asks the browser for the value that actually won, so it survives
refactors, renames and re-specificity.

## Adding to the system

1. Change the **primitive** (or add one) and its CSS.
2. Update the slice document — one `Use` line, and delete the rows you retired.
3. Add the cheapest check that would fail if someone undid it: a `.styles.test.ts`
   pin for a declaration, a `computed` `design-lock` entry for anything
   visual, a `role-ui-sweep` route for a page-level concern.
4. If the change came from an operator ruling, add the dated row to
   `docs/design-guidelines.md` naming the lock/test that now holds it.

## Open items

The divergence backlog (per-page patterns still to retire, ranked) lives at the
end of each slice document under `## System gaps` / `## Enforcement gaps`.
