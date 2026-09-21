# Design System

The `src/design-system/` folder is the canonical home for cross-cutting UI
primitives. Pages should import from here rather than reaching into
`components/UI` or rolling their own.

## Import surface

```ts
import {
  // Primitives
  Pagination, DataTable, EmptyState,
  TextField, SelectField, NumberField, CrudFormModal,

  // Hooks
  useDebouncedValue, useToken, useAuthedQuery, useMonthRoute,
  useTableQueryState, useSalaryPeriod,
} from '@/design-system';
```

## What's where

| Folder | What lives here |
|---|---|
| `Pagination.tsx` | Page navigation: windowed numbers, prev/next, optional summary line |
| `DataTable.tsx` | Generic table with desktop + mobile card render, loading, empty, pagination |
| `EmptyState.tsx` | Title / description / illustration / action block |
| `forms/TextField.tsx` | Labelled input with prefix/suffix/error/help text |
| `forms/SelectField.tsx` | Labelled select |
| `forms/NumberField.tsx` | Numeric input that emits `number | ''` to onChange |
| `forms/CrudFormModal.tsx` | Modal-wrapped CRUD form with render-prop children |
| `hooks/useDebouncedValue.ts` | Debounce any value |
| `hooks/useToken.ts` | Centralised localStorage JWT access |
| `hooks/useAuthedQuery.ts` | `useQuery` wrapper that 401s to `logout()` |
| `hooks/useMonthRoute.ts` | URL-state-backed month selector (replaces `MonthProvider`) |
| `hooks/useTableQueryState.ts` | All-in-one state for paginated list pages |
| `hooks/useSalaryPeriod.ts` | Re-export of the salary-period query |

## Responsive navigation and overlays

- The app shell uses 8px phone and 12px tablet outer insets, with safe-area protection. Each full-bleed driver screen owns its single inset; the shell does not add another layer.
- Generic button defaults have low specificity. A shared control's explicit touch height and type hierarchy must survive the global responsive stylesheet.
- Journey state switches use the shared `Tabs` primitive, including arrow/Home/End navigation and one keyboard tab stop. Related driver jobs share one enclosing boundary and row separators.
- `DataTable` keeps its scrollable table on small screens unless a real `mobileRender` is provided. Interactive controls inside a row perform their own action without opening the row.
- `Pagination` uses a bounded previous/page-entry/next control on a small canvas. Pages must not hide middle children or replace its responsive sizing.
- Drawers and dialogs keep title and actions visible while their body scrolls. Safe-area spacing belongs to the overlay stylesheet at every viewport size, with compact phone padding.
- The driver account menu is one flat, labelled dialog on phone/tablet, with a visible close action, trapped focus, internal scrolling, and focus return to its trigger. Desktop uses the sidebar menu.
- Motion must respect reduced-motion preferences and must not delay the appearance or hit area of actions.

## When to add a primitive here

Add a primitive to `design-system/` when:

1. The same JSX shape is duplicated in 3+ files.
2. The component has no business logic of its own (it accepts data via props).
3. The component can be reasonably tested in isolation.

**Don't** add a primitive here if:

- It's specific to one feature (use `features/X/components/` instead).
- It depends on auth context, a specific query hook, or specific domain types.
- It's a layout shell for a particular page.

## When to use a primitive

Use a design-system primitive when the page needs that pattern. The
following list maps pages to their target primitives:

| Page | Use these primitives |
|---|---|
| `TripListPage` | `DataTable`, `Pagination`, `useTableQueryState`, `useDebouncedValue`, `EmptyState` |
| `CustomersPage`, `SupplierListPage`, `DebtListPage`, `PayableListPage` | Same as above |
| `FleetPage`, `ConfigPage` | `CrudFormModal`, `TextField`, `SelectField`, `NumberField` |
| `AuditLogPage` | `DataTable` with `useInfiniteQuery` pattern |
| `LoginPage` | `TextField` |

The migration from per-page implementations to primitives is incremental.
Migrate one page at a time; the primitives are designed to be drop-in
replacements for the most-copied snippets, not a full rewrite.

## Untitled UI source

Untitled UI React components live under `src/components/untitled-ui/` and are
retrieved with the pinned version-8 workflow in
[`untitled-ui.md`](./untitled-ui.md). Use those accessible source primitives as
the component layer, then compose them through the product-specific design
system and feature modules above.

## Control density contract

Control size is owned by the shared primitive, never by page CSS:

| Variant | Desktop use | Desktop height | Narrow-screen minimum |
|---|---|---:|---:|
| `sm` | Operational filters, data-entry workspaces, table toolbars, compact utility actions | 34px | 44px |
| `md` | Forms and ordinary page actions | 40px | 44px |
| `xs` button | Low-emphasis inline utilities | 28px | 44px |

The canonical CSS tokens are `--control-compact-h`, `--control-default-h`, and
`--control-touch-h`. Pages may arrange controls and set widths, but must not
override their height, internal padding, font size, or icon size. Choose the
semantic `size` prop instead. This keeps legacy controls and Untitled UI inputs,
selects, and buttons on the same rhythm across routes.

Field typography is shared too: compact and ordinary fields use 12px for
typed values, placeholders, selected values and options on every device.
Field labels and supporting metadata use 11px. Density follows the PM
reference of Moomoo, with clear action hierarchy informed by Grab. Page styles must
not override that type scale with `font`, `font-size`, or `line-height`; correct
the shared Untitled UI primitive when a compact field is inconsistent. Dense
operational forms should choose `sm` as a complete semantic variant instead of
recreating dispatch typography or geometry in page CSS.

### Coarse-pointer touch floor (44px on every input device)

Width-based breakpoints miss coarse-pointer tablets. An iPad at 768px or 1024px
hits the desktop layout (>= 768px), but the user's finger is still a coarse
pointer that needs the 44px touch target. Pointer-based media queries catch this
class of device regardless of viewport width:

```css
/* Compact by default. Coarse pointers (touch + coarse stylus) get the touch
   floor; desktop mice (fine pointer) keep the compact density contract. */
.btn { min-height: var(--control-compact-h); }      /* 30px on desktop */
@media (pointer: coarse) {
  .btn { min-height: var(--control-touch-h); }     /* 44px on touch */
}
```

Two contract-pinned implementations:

- `src/components/Button.css` — `.btn` / `.btn--sm` / `.btn--icon` raise to
  `var(--control-touch-h)` under `(pointer: coarse)`. Width is pinned too —
  icon buttons get `width: var(--control-touch-h)` so the hit area is square.
- `src/styles/operational-density.css` — `.ds-uui-select--operational` keeps
  compact geometry on desktop and raises select triggers to the touch floor on
  coarse pointers; the value text (`button > span p`, `[role='group'] span p`)
  inherits the same type-step. This is the pattern that closed the
  2026-09-09 /payables 36px-vs-44px fuel-invoice triggers gate-blocker.

### Pattern: pointer-based, never width-based, for touch floors

- DO use `@media (pointer: coarse) { min-height: var(--control-touch-h) }` on
  every operational control, trigger, button, and tappable surface.
- DO NOT use `@media (max-width: 1023px)` (or any width cutoff) as the touch
  floor trigger — it leaves iPad/desktop tablet users at 30-34px compact
  geometry, which fails the 22:40 standard at any coarse-pointer width.
- DO ship both contracts together: the compact base rule AND the coarse-pointer
  override. The override must use `min-height`, not `height`, so a longer
  label still pushes the control taller.

The Button.css and operational-density.css coarse-pointer rules are pinned by
`src/components/control-density.styles.test.ts`,
`src/styles/operational-density.styles.test.ts`, and
`src/features/fleet/TruckFormModal.styles.test.ts`. Any new operational
control must grow a matching style-contract test that pins both the compact
base AND the coarse-pointer override.

## Responsive pairing rules for card grids

When a desktop data table collapses into a card view at narrow viewports, the
narrow-viewport layout MUST pair cells across a 2-column grid and let long
content (multi-line text, action buttons, full-width cells) span the full
card. The pattern, lifted from the 2026-09-09 space-utilisation audit and
pinned by the `record-table` + master-plan contract tests:

```css
/* Card-band pairing (tablet, 600-900 container width). */
@container (min-width: 600px) and (max-width: 900px) {
  .row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  /* Default: pair cells two-up across the row. */
  .cell + .cell { border-top: 0; }                  /* reset sibling rules */
  .cell:nth-child(2n)  { border-inline-start: 1px solid var(--line); }
  .cell:nth-child(n+3) { border-top: 1px solid var(--line); }

  /* Full-span overrides for cells that don't pair (long content). */
  .cell--action,
  .cell--notes,
  .cell--full {
    grid-column: 1 / -1;
    border-inline-start: 0;
  }
}

/* Phone band, same content. Pairing becomes 2-up with full-span rows for the
   primary identity and footer; long content always spans full width. */
@container (max-width: 599px) {
  .row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cell:nth-child(-n + 3),
  .cell:nth-child(6),
  .cell:nth-child(8),
  .cell--action { grid-column: 1 / -1; }
}
```

### Hard rules

1. **Mirror the full-span list across every band that pairs.** If the ≤599px
   band explicitly spans cells 1, 2, 3, 6, 8, and `--action`, the 600-900px
   band must span the same cells (or a compatible subset). A full-span rule
   that lives in only one band produces half-width rows with stray dividers
   in the band that misses it — exactly the master-plan `Ghi chú` bug
   reported 2026-09-09 (commit `5324b1ad` fixed this by mirroring the ≤599px
   rule into the 600-900px band).
2. **Long content ALWAYS spans full width, even in a 2-col band.** Multi-line
   notes, action triggers, identity cells, and any cell whose content reads
   "lonely" at half width must declare `grid-column: 1 / -1`. A two-up pair
   with one half-width empty neighbour is a visual bug — the cell looks
   "floating" and creates a stray half-width divider under the previous full
   row.
3. **Touch surfaces inside full-span cells MUST keep the 44px floor.** A
   `min-height: 44px` on the notes trigger (or any text-role button inside a
   full-span cell) grounds the empty/short state to the action-cell rhythm
   and preserves the design-system's reserved touch target
   (commit `9376ac1b` added this to `MasterPlanGrid.css`).
4. **Reset the inline-start when forcing full width.** A `grid-column: 1 / -1`
   cell with the default `border-inline-start: 1px solid var(--line)` will
   draw a 1px line on the card's left edge (the `:nth-child(2n)` rule still
   matches it). Override with `border-inline-start: 0` whenever you force a
   full span, or the cell looks like it has a divider on its outer edge.
5. **Prefer `:nth-child` over `:last-child:nth-child(odd)` for full-span
   rules.** Display:none siblings shift parity but DO NOT shift
   `:nth-child`; the orphan-parity trap documented in
   `.agentsroom/memory/global/pitfalls/css-grid-orphan-parity-trap.md`
   catches this. The master-plan full-span list is `:nth-child(-n+3),
   :nth-child(6), :nth-child(8), --action` — explicit positions, not parity.

### Reference commits (pairing rules proven on the program)

- `874bf1bb` — dispatch 44px date shortcuts on phone plan filters
- `38f4884d` — /trips data table restored from 1024px up
- `7eab78d3` — /shipments toolbar filters collapse two-up on tablets
- `f511cbbf` — /dashboard bento tiles pair on tablet widths
- `7d33df48` — /dispatch-detail card view uses tablet width
- `a9d3427d` — record-table 2-up pairing moved into the WHOLE card band
- `5324b1ad` — master-plan `Ghi chú` cell spans full width in the 600-900px
  band (the user-reported tablet bug, `qa/2026-09-09_master-plan-600-900-notes-fix.log`)

## Operational table color contract

Tables are decision surfaces, so body text uses the neutral foreground scale
(`--fg-1`, `--fg-2`, `--fg-3`) rather than decorative hues. Category labels
such as import/export, carrier type, and allocation use the neutral badge
treatment. Reserve semantic color for a real operational condition: forest for
active/completed work, bronze for attention needed, and oxblood only for a
cancelled record, validation error, or an overdue deadline. Never introduce a
blue, indigo, or orange badge simply to distinguish categories.

## Selection and emphasis contract

Selection is not workflow status. A selected view, filter, date scope, row, or
choice uses a neutral surface plus one ink-coloured structural cue: a border, an inset edge,
stronger label, and—when a user is choosing an option—a check, radio, or
checkbox. Do not turn the entire control or card green, blue, or another soft
semantic colour merely to show it is active.

Keep these meanings separate:

| State | Use | Visual treatment |
|---|---|---|
| Selection | Current tab, filter, mode, or chosen record | Neutral surface; border or 2px edge; stronger label; explicit indicator when required |
| Workflow | Draft, ready, completed, cancelled | Domain-labelled badge; semantic colour only when the state itself has that meaning |
| Risk | Late, missing, blocked, mismatch | Named warning/error plus a restrained strip or icon beside the affected record |
| Hover | Pointer affordance | Quiet neutral surface or border change only |
| Focus | Keyboard location | Separate visible focus ring; never rely on the selected-state styling |

Use the shared `Tabs` variants for view changes. `plain` tabs use a neutral
border and inset ink edge; `bordered` tabs use the existing underline. Brand
colour belongs to focus and domain status, not to persistent selection. For
compact filters, the existing dark `FilterBar` pill remains the deliberate
high-contrast selection pattern. Keep status badges, alerts, and compact
exception context semantic, but do not reuse their soft fills for selection.

## Combined date + time display contract

Whenever the UI shows a date and a time together, display **time first, date
after, in 24-hour format**: `HH:mm DD/MM/YYYY` (e.g. `14:30 20/08/2026`).
Date-only cells render `DD/MM/YYYY` padded. Never render a 12-hour
AM/PM clock, never drop the year in a table column, and never rely on the
browser locale to format a native
`datetime-local`/`time` input — locale rendering cannot be forced and
produces 12h clocks on en-US browsers (2026-09-09 customer report). The
compact `d/M/yy` table shape was withdrawn 2026-09-21 (card 20260921_23,
operator report: five datetime styles app-wide, three in one column).

- Inputs: use the design-system 24h datetime text input
  (`BufferedUuiDateTimeInput` / `useBufferedDateTimeValue`, placeholder
  `HH:mm DD/MM/YYYY`). The app renders the string, so the format is
  guaranteed in every browser. The stored value stays the ISO local shape
  `YYYY-MM-DDTHH:mm`.
- Display cells: format through the lib helpers so text, tables, and inputs
  agree — `formatDateTime24` (local-ISO values) and `formatDateTimeShort`
  (timestamps), both emitting `HH:mm DD/MM/YYYY`; `formatDate` emits the
  padded `DD/MM/YYYY` for date-only cells (all in `frontend/src/lib/format.ts`).
  Never call `toLocaleString`/`Intl` inline for a combined
  date-time: field order is engine-dependent (Node renders vi-VN time-first,
  Chrome date-first), which a hard format requirement cannot depend on.

This contract is pinned by `useBufferedDateTimeValue.test.tsx`.

## Size-consistency scale (cross-page coherence)

A page that pairs correctly but LOOKS off is not done (PM standard 2026-09-09,
NOTES.md 02:05). "Off" includes any of the size-consistency violations below;
QA enforces per criterion with computed-style + screenshot evidence.

### One control-height per context

Sibling controls in the same view share the SAME computed height. A toolbar
with three 30px triggers and one 44px search input is a size-consistency
violation — the search reads as a different class of control even when its
role is identical to the others. The 36px-vs-44px class of bug reported on
/payables fuel-invoice toolbar (2026-09-09, commits `1c29895a`,
`58cf20b1`, `564eec8c`, `989e1e0b`) is exactly this violation.

Implementation: one CSS variable per context, swapped by breakpoint.

```css
:root { --filter-control-h: var(--control-compact-h); } /* 30px desktop */
@media (max-width: 767px) { :root { --filter-control-h: var(--control-touch-h); } }
@media (pointer: coarse) { :root { --filter-control-h: var(--control-touch-h); } }

/* Every control in the same toolbar reads the same token. */
.fuel-invoices-toolbar__select,
.fuel-invoices-toolbar .payables-toolbar__search input { min-height: var(--filter-control-h); }
```

The single-source-of-truth rule applies to inputs, selects, buttons, search
fields, popover triggers, and any other interactive control. **Do not** mix
`var(--control-compact-h)` and `var(--control-touch-h)` across siblings in
the same view; pick the right context token and use it everywhere.

Pinned by `src/styles/global-sizing-contract.styles.test.ts`,
`src/styles/filter-density.test.ts`,
`src/components/control-density.styles.test.ts`.

### One type scale

Font sizes come from the design-system steps (`--fs-xs`, `--fs-sm`,
`--fs-md`, `--ops-table-*`). No arbitrary sizes in page CSS. Labels,
values, captions, and metadata step consistently WITHIN a card AND ACROSS
sibling cards/pages. Randomly larger headings or shrunken values are a
violation.

Use semantic roles from `styles/tokens.css`; sizes stay stable across device
widths. This is the final PM decision of 14 September 2026 and supersedes the
intermediate 13px compact / 14px default / 16px touch proposal in earlier QA
reports. Those reports preserve historical evidence, not current sizing rules.
Wrap or rearrange content instead of shrinking the same role on phones.

| Role | Token | Size |
| --- | --- | ---: |
| Caption, metadata | `--text-caption-size` | 11px |
| Field label | `--text-label-size` | 11px |
| Dense record value | `--text-data-size` | 12px |
| Body, button and action label | `--text-body-size`, `--text-control-size` | 12px |
| Compact desktop field | `--text-control-compact-size` | 12px |
| Touch field value, selected text and options | `--text-input-touch-size` | 12px |
| Section heading | `--text-section-size` | 14px |
| Dialog / drawer heading | `--text-dialog-title-size` | 16px |
| Page heading | `--text-title-size` | 18px |
| Principal metric | `--text-metric-size` | 20px |

`--fs-*`, Untitled UI's utility theme and `--ops-table-*` resolve to this same
scale. Table primary/supporting values are 12px; headers and metadata are 11px.
Use weight, color and spacing for emphasis rather than fractional font sizes.
Page headings use weight 700, sections and metrics 600, labels 500–600 and
body text 400. Keep line heights around 1.3 for headings and 1.4–1.5 for text.

Typed values, placeholders and selected values inherit the same control size.
Dropdown menus keep option text aligned with their trigger's size variant.
Do not apply a root-scoped miniature font rule to input, select or label
descendants. The PM selected 12px primary text and 11px secondary text across device
sizes. This replaces inconsistent 11px, 13px, 14px and 16px values within
equivalent fields. Preserve browser pinch zoom; mobile Safari may zoom a
focused field with text below 16px, so physical-device focus behavior remains
an explicit verification item.

Page styles must NOT override the type scale with `font`, `font-size`, or
`line-height` on shared Untitled UI primitives. If a compact field is
inconsistent, correct the primitive, not the page.

### No oversize components

No control, button, or chip inflated beyond its role. A filter trigger is
not a hero button; a chip is not a CTA; a label is not a value. Density
stays even across a view. **Verify** by sampling three sibling components
in a view and checking their computed heights against the established scale.

### Cross-page coherence

The same component type (filter bar, card header, table toolbar, chip, badge)
must LOOK identical (size, radius, spacing, type) wherever it appears.
`/payables`, `/expenses`, `/config/*`, portal pages, and dispatch surfaces
all read as one product. The reference chrome:

- **Filter trigger** — `min-height: var(--filter-control-h)`,
  `border-radius: var(--r-sm)`, `--control-compact-font-size`.
- **Card** — `border-radius: var(--app-radius-md)`, 1px `var(--line)` border,
  `var(--surface)` background, 8-10px gap between rows.
- **Chip** — pill, 4px vertical / 8-10px horizontal padding, 11px font,
  neutral foreground, `--radius-xs` to `--r-sm` corner radius.
- **Divider** — `1px solid var(--line)`, no decorative strokes.

QA's "all baseline audits complete" sweep (2026-09-09) verified cross-page
coherence on the dispatch/finance/portal/stragglers clusters at
390/768/1024/1180/1366. New pages inherit the chrome from
`src/design-system/` primitives (see "When to add a primitive") and
`src/styles/` shared stylesheets (`record-table.css`,
`operational-density.css`, `table-sort.css`). Do not roll your own.


## Verifier lesson: pre-deploy bundle check (PM standard 2026-09-09)

**A fix in the local build is not a fix in production.** The program shipped a
master-plan `Ghi chú` cell fix at commit `5324b1ad` and a polish commit at
`9376ac1b`; both passed `vite build` and contract tests locally. The first
QA re-sweep at vantai.tingting.vip still showed the bug because staging was
serving the pre-fix bundle hash (`MasterPlanPage-Bx9sxB1c.css`). The build
flushed; the deploy hadn't landed. The verifier caught the gap, but the
agent that wrote the fix should have caught it first.

### Standing rule for any pre-wave commit

Before declaring a frontend commit done — especially when the wave is already
running and the commit rides the same deploy — verify the served bundle
matches the local build:

```js
// From the browser console on the page the fix touches.
const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
const masterPlan = links.find(l => l.href.includes('MasterPlanPage'));
const text = await (await fetch(masterPlan.href, { cache: 'no-store' })).text();
const hasRule = text.includes('nth-child(8)') && /min-width:\s*600px/.test(text);
console.log({ bundleFile: masterPlan.href.split('/').pop(), hasRule });
```

If the bundle hash hasn't flipped to the new commit's hash, the deploy is
behind — push harder or escalate. The bundle filename includes a content
hash (Vite `[name]-[hash].css`); if the fix changes CSS content, the hash
MUST change on the next deploy. Same hash after a push means the deploy
hasn't run yet.

### When the fix is JSX-only or behavior-only

The hash check still applies — anything that changes the bundle output (CSS
rules, component sizes, dependency imports) will flip the hash. Use this as
a one-line sanity check after every `git push` while a wave is in flight:

```sh
git rev-parse HEAD                                # local head
git ls-remote origin prod | cut -c1-7            # remote head
# If they differ, push missed. If they match, ask fullstack about deploy.
```

### Why this exists

The 2026-09-09 ship was the first wave that ran in messaging mode across five
parallel lanes. The pre-commit hook auto-stages everything in the shared
checkout (see AGENTS.md), so file attribution is fragile; the deploy is owned
by fullstack and staged from a temp worktree at the pushed HEAD. The local
tree's `vite build` is a necessary but not sufficient gate — only the served
bundle on staging confirms the fix is in the wave the QA gate sweeps.

Reference incident: `qa/2026-09-09_master-plan-600-900-notes-fix.log`
(post-commit verification section). Pinned by future contract: any agent
who commits a frontend fix while a wave is in flight MUST run the served-
bundle check before responding "done" to the team.


### Operational polish refinements (15 September 2026)

- SummaryRail uses two columns through tablet widths and one horizontal strip on desktop. Values use the 14px section scale; long amounts wrap instead of clipping.
- FormGroup owns a single 6px label/control gap. Do not add label margins inside it. Help and validation feedback must be linked to the actual control; custom field adapters forward standard aria-invalid and aria-describedby attributes.
- Phone dialog fields share the 32px phone token across native input and select adapters. Multiline notes retain their own height; primary save/cancel actions retain their separate action sizing.
- Operational page/list entrances are short fades for new, visible, independent surfaces: 160–180ms duration and at most 80ms delay. A poll or filter update must not hide records that are already being read. Respect reduced motion and avoid nested animation targets.
- Empty states use a neutral, compact surface without a decorative inner card. Omit decorative record previews on phones; retain the message and recovery action.
