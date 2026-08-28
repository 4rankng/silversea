# Silversea product design guidelines

## Bringing an existing page into the sizing contract

Pages like `/credit-overrides` (`CreditOverrideQueuePage.css`) predate the
token system and hardcode raw pixel values that don't even exist on the
scale — `font-size: 22px` / `17px` have no `--fs-*` equivalent, and control
heights of `24px`/`38px`/`64px` sit between the real control tokens instead of
on one of them. This is why pages feel randomly sized against each other:
each page invented its own numbers instead of reading from the same source.
Use this as the conversion procedure whenever you touch a pre-token page —
don't do a repo-wide sweep in one PR, convert the file you're already in.

1. **Audit the file first**, don't eyeball it:
   ```bash
   grep -nE "font-size:\s*[0-9]+px|(^|[^-])height:\s*[0-9]+px|padding:\s*[0-9]+(px| [0-9]+px)" frontend/src/pages/<Page>.css
   ```
   Every match is a candidate — classify each as type scale, control height,
   or spacing before touching anything.
2. **Map raw font-size to the nearest semantic token**, never the nearest
   number. Round to the *role*, not the pixel:
   - Table/ledger header → `var(--ops-table-header-size)` (11px)
   - Table/ledger supporting text → `var(--ops-table-supporting-size)` (12px)
   - Table/ledger bold primary value → `var(--ops-table-primary-size)` (13px)
   - Status pill / badge text → `var(--fs-status-pill)` (11px)
   - Body / form text → `var(--fs-xs)` (12px) or `var(--fs-sm)` (14px)
   - KPI number → 20px bold per the global sizing contract (24/28px only for
     a genuine hero display number, not a denser secondary stat)
   - Page/section heading → `var(--fs-lg)`/`var(--fs-xl)`/`var(--fs-2xl)`
   A raw value that doesn't obviously map to one of these is itself the bug —
   it means the element's role was never decided. Decide the role, then pick
   the token for that role.
3. **Map raw control heights to the nearest control token**, not the nearest
   number: `--filter-control-h` (toolbar/filter controls), `--control-default-h`
   (40px general form controls), `--control-compact-h` (34px in-card/row
   actions). A control sized between two tokens (e.g. today's 38px) is
   evidence it was never assigned a role — assign it one (is this a filter
   control or a form control?) rather than splitting the difference.
4. **Map raw spacing/padding to `--space-*`** (`xs` 4 / `sm` 8 / `md` 12 /
   `lg` 16 / `xl` 24 / `2xl` 32 / `3xl` 48). If a padding value doesn't land
   on one of these, round to the nearest and verify nothing visually breaks —
   it won't, because these values already encode the rhythm every converted
   page reads correctly at.
5. **Convert in one pass per file, then screenshot-diff it.** Partial
   conversion (some rules tokenized, others left raw) is worse than doing
   nothing, because it hides which values are still real drift under a false
   sense that the file was addressed.
6. **`pnpm --dir frontend check:ui` now guards font-size token drift.** The
   contract script flags any raw `font-size: Npx` under `frontend/src/pages/`
   whose value is not on the type-token scale (10 = dense-metadata floor,
   11/12/14/16/18/20/24 = `--fs-*` equivalents, 13 =
   `--ops-table-primary-size`). A value off that scale means the element's
   role was never decided — assign the role and use the token. Raw **heights**
   are still not machine-scanned (too many legitimate non-control geometry
   values); the control-height rule above stays a per-file audit when you
   touch a page.

## Customer-facing shipment identifiers

Customer-facing screens, exports, notifications, and API projections must use
identifiers that customers already recognize from their documents:

1. Show the Bill/B/L or Book number as the primary shipment identifier.
2. If Bill/Book is unavailable, use the booking reference; shipment detail may
   then fall back to the declaration number.
3. Use `Chưa có số Bill/Book` when none of those references exists.
4. Never display or return internal shipment codes such as `SHP-2608-00016`
   or internal enum values to a `CUSTOMER` audience.
5. Scoped numeric IDs may remain in routes and API payloads as technical
   linkage, but they must never be rendered or promoted as business labels.
6. Internal operational roles may use internal codes when they materially help
   reconciliation or support, but the customer-recognized Bill/Book reference
   remains the prominent label on mixed-audience surfaces.

Enforce this rule at both boundaries: customer API projections omit internal
identifiers, and UI tests assert that internal codes are absent from rendered
customer content.

## Dense operational workspaces

- High-volume ledgers may opt out of the global reading-width cap and use the
  full app canvas while retaining shell padding and responsive behavior.
- Do not cap the height of a normal paginated master table. Let the page own
  vertical scrolling; add an inner scroller only for an intentionally
  independent, bounded workspace such as a map or side-by-side queue.
- In dense ledger cells, keep metadata at 10–11px and primary values at 13–14px;
  do not shrink either to unreadable single-digit text at tablet widths.
- Prefer whole-row pointer interaction plus a semantic in-cell keyboard control
  over a dedicated chevron column that consumes table width.
- Buttons, links, selects, menus, and other controls inside a clickable row must
  keep their own behavior and must not trigger the row action.
- Fixed-layout tables wrap long values and switch to cards before they require
  page-level horizontal scrolling.

## Sortable column headers

Authority: `frontend/src/styles/table-sort.css` (shared button) +
`frontend/src/lib/table-sort.ts` (toggle contract) + `DataTable`'s
`sortKey`/`sort`/`onSortChange` props.

- Every data-table column header is sortable. The header renders a real
  `<button>` with `aria-sort` (`ascending`/`descending`/`none`) and lucide
  direction arrows (`ArrowUp`/`ArrowDown` active; `ArrowUpDown` at 40% opacity
  idle). The button inherits the th's typography — it carries no font sizing of
  its own, so each table's density contract stays authoritative.
- Sorting on server-paginated tables is server-side: `sortBy` (whitelisted
  enum per endpoint) + `sortDir=asc|desc` query params, validated by the
  endpoint's zod schema and mapped to an `orderBy` whitelist with a stable id
  tiebreaker. Absent params must reproduce the endpoint's previous default
  order exactly. Client-side sorting is only for tables without pagination.
- Toggle order: a fresh column starts ascending; the active column flips
  asc ↔ desc (`nextTableSort`). Sorting always resets the page to 1.
- State plumbing follows the page's existing architecture: URL-param pages keep
  `sortBy`/`sortDir` in the address bar; `useTableQueryState` pages carry them
  in the filters bag via `setFilter`.
- Hover affordance is a neutral ink lift (`var(--ink)`), never an accent wash —
  same selection-state contract as row hover.

## Global sizing contract (table type + control density)

The `/shipments` (CUS + điều vận) sizing philosophy is app-wide default, not a
per-route style. Authority: `frontend/src/styles/operational-table-typography.css`
(tokens on `:root` + zero-specificity table base) and `frontend/src/components/Table.css`
(global base table). `pnpm --dir frontend check:ui` enforces the table scale.

- Table type scale: headers 11px (weight 600 on record-table surfaces; the
  legacy bare-table base keeps 700), supporting text 12px, bold primary values
  13px, cell padding 10×12. Pages override per-grid only to map these same
  `--ops-table-*` tokens — never to invent a per-route font scale. Raw ≥14px
  (or `--fs-sm`+) fonts in desktop `td`/`th` rules fail `check:ui`.
- Control density: filter/toolbar controls consume `--filter-control-h`
  (34px desktop, 44px ≤767px with 12px/16px fonts). General form controls are
  40px (`--control-default-h`); in-card and row actions are 34px
  (`--control-compact-h`). Phones get ≥44px everywhere via `responsive.css`'s
  universal rule — never hardcode a desktop 44px control.
- KPI/decision rails: numbers 20px bold with 12px labels (hero display numbers
  may use 24/28px). Status pills stay 11px.

## Workboard table & summary rail (golden standard)

`/shipments` (CUS container workboard) is the golden standard for every
full-page data table and operational list summary. Authority:
`frontend/src/styles/record-table.css` (shared table skin, aligned to the
workboard thead) + `frontend/src/design-system/SummaryRail.tsx` (rail).
The workboard itself (`ShipmentsPage.css` `.cus-dashboard-table` /
`.cus-workspace-summary`) is the frozen visual source of truth — keep the
shared layers visually identical to it; never fork a per-route variant.

**Summary rail** — the standard for operational list summaries. A decision
rail, not cards: one ruled row (`border-block` + `border-right` dividers, no
card boxes, no border-radius, no filled backgrounds), label (12px semibold
`--ink-2`) left of the value (20px bold `--font-data` `--ink`) on a shared
baseline. Tones (`warning`/`info`) color **the number only**; amber never
fills the container. Collapses two-up ≤700px and stacks ≤380px. Adopt
`SummaryRail` where a list screen already shows a summary — do not invent
metrics for screens without one, and do not convert hero-KPI surfaces
(`ForwarderSettlementsPage`, dashboard tiles): 24/28px hero display numbers
are their sanctioned contract.

**One elevation per group** — the rule that kills nested cards. A container
that already sits inside a bordered/background parent (a page card, a
`.driver-task-section`, a dialog body) must not repeat `border` +
`border-radius` + `background` on its children: nested content renders flat
(headings, plain list rows, fact rows), and sub-groups inside the same
elevation separate with a divider row (`border-top: 1px solid
var(--line-strong)` — at 1px on a white card `--line` is too faint to read as
a boundary on a phone screen), never with a boxed card per group. A fill or
border on an inner row is reserved for semantic state (warning tint, selected
step, rejected banner) — never as default chrome. Two divider weights:
stacked group dividers use `--line-strong`; side-by-side column hairlines
and row separators *within* a group use `--line` (SummaryRail's ruled-row
weight). This is the SummaryRail
no-cards rule applied inside elevated surfaces; every removed card layer also
removes one border + one padding tier, which is pure recovered width on
375-430px phones. Reference implementation: the driver trip-detail screen
(`TripPodSubmission.css` e-POD groups + file rows, `DriverTripDetailPage.css`
fact rows / fuel / photo groups / milestone steps).

**Table skin** — every full-page data table renders the workboard treatment:
sticky thead on `--sticky-thead-top` with `--surface-2` background,
`--ink-2` header text at `--ops-table-header-*` tokens (11px/600), padding
10px 12px, and a `1px solid var(--line-strong)` underline. Header case and
tracking are owned by the global `thead th` rule in
`frontend/src/components/Table.css` (uppercase, 0.08em tracking — exactly as
`/shipments` displays); pages never re-declare `text-transform` or
`letter-spacing` on a thead, and a conformed table's computed thead matches
the workboard's property for property. Body cells: padding 10px 12px,
`--line` right/bottom hairlines (last column drops the right border),
`vertical-align: top`, multiline stacks with the primary line at
`--ops-table-primary-size`. Row hover is a neutral `--surface-2` wash (keep
the fine-pointer gate from record-table.css — invisible on desktop, correct
on touch). Rows carrying a bucket/status classification wear a `StatusStrip`
marker — the 3×20px edge marker on the identity cell — in semantic tones
only. Row height is content-driven; a
72px floor applies only to multiline stacked-cell ledgers. Warning tint
stays cell-scoped to the owning cell. Adopt via the record-table recipe
(imports + `record-table ops-table` classes + `<colgroup>` proportions +
`data-label` on every cell for the card collapse); delete superseded
per-page table skins instead of re-declaring their values. The mobile
card-collapse eyebrow keeps uppercase — it is a card label, not a desktop
thead.

**In-card and sub-ledger tables skip the wrap.** `record-table-wrap` exists
to register the container that drives the shared card collapse — it is for
full-canvas ledgers. A table that lives inside a card, panel, or its own
scroller (P&L previews, truck-trip sub-ledgers, breakdown panels) adopts the
classes WITHOUT the wrap: such containers sit permanently under the 1100px
container threshold, so wrapping them would force permanent card mode and
destroy the layout. The sticky thead is inert inside `overflow` containers,
which is correct there — the card is the scroll context.

## Filter toolbars (CUS + điều vận)

**Current state is inconsistent — this section is the target contract, not a
description of what already ships.** `ShipmentsDetailPage.css`
(`.shipments-detail-filters`), `ShipmentsPage.css`
(`.cus-worksheet-toolbar__filters`), and the dispatch master/detailed-plan
facet pickers (`MasterPlanFilters.tsx`, `DetailedPlanFilters.tsx`) each grid
their filter row differently today (grouped sub-grids vs. one flat row vs.
bespoke facet-popover controls) with different gap values and different
action-row placement. Do not copy any one of them as-is; converge new and
touched toolbars on the rules below, and fold the others in opportunistically
when you're already in that file.

- **Grid, not flexbox, for the field row.** `display: grid` with explicit
  `grid-template-columns` sized in `minmax()` — flex-wrap causes fields to
  reflow unpredictably as labels translate to Vietnamese text of varying
  length. Semantically related fields (a date range, a facet pair) form a
  nested sub-grid group so they read as one cluster, not N independent
  columns.
- **Gap rhythm from tokens, not magic numbers.** Between distinct filter
  groups use `--space-lg` (16px; the codebase's existing 14px group-gaps
  predate this token and should migrate on touch). Within a group
  (label↔control, or two controls in one cluster) use `--space-sm` (8px) or
  tighter (6px) when the pairing is visually a single unit (e.g. from/to
  dates). Never hand-roll a third gap value for the same relationship.
- **Controls use `--filter-control-h`**, never a hardcoded 34px/44px. This is
  what makes the phone breakpoint's 44px bump apply automatically instead of
  needing a per-page override.
- **Action row trails right-aligned.** Secondary actions (reset, date-scope
  shortcuts, "về hôm nay") sit in a row with `justify-content: flex-end` so
  they close the toolbar at its right edge — never left-anchored under an
  arbitrary middle column, and never float without an explicit
  `justify-content`. If the action row needs a visual break from the fields
  above it, use a `border-top: 1px solid var(--line)` divider (as
  `.cus-worksheet-toolbar__actions` does); a grouped toolbar without a divider
  relies on the group gap alone and needs no border.
- **Responsive collapse is container-query-scoped**, not viewport-media-query,
  so the same toolbar behaves correctly inside a narrower sidebar-adjacent
  layout. Register the page grid with `container-type: inline-size` +
  `container-name` and collapse groups in this order as width shrinks: (1)
  drop the widest low-priority group to its own full-width row, (2) fold
  paired groups (date range, facet pair) to 2-column, (3) stack every group
  to one column full-width, actions row last. `ShipmentsDetailPage.css`'s
  1300px → 900px → 520px container-query cascade is the reference sequence
  for this collapse order.
- **Facet-popover controls (dispatch master/detailed-plan) are a legitimate
  alternate control family** for a field with a large or dynamic option set
  (carriers, routes) where a native `<select>` would be unusable — but the
  popover trigger still sizes to `--filter-control-h` and still sits inside
  the same grid/gap contract as every other field in the row. Don't let a
  facet picker's internal layout leak into the toolbar's outer grid rules.
- **One control family per toolbar row.** Don't mix `UuiSelectField`,
  bare `NativeSelect`, and a facet popover as siblings in the same filter
  grid unless each is solving a problem the others structurally can't (e.g.
  large option sets → facet picker). Where two families coexist for that
  reason, they must still share height, label treatment, and gap — the
  toolbar should not visually betray that two different components are
  rendering it.

## Status signals in dense ledgers

Two lanes, no third:

- **Status / attention** → the UUI badge family (`Badge` / `BadgeWithDot`,
  `frontend/src/components/untitled-ui/base/badges/badges.tsx`) with semantic
  tones only (gray = neutral, blue-family = informational, warning = needs
  action, success = complete). The badge component owns fill, ring, radius,
  and height; page CSS tunes type and in-cell containment only (font-size,
  line-height, white-space, fit-content width) — never border, padding, or
  control geometry — so a status chip can never read as a button. A chip that
  opens a flow is a real button and must be styled as one instead.
  **Cascade trap:** Tailwind's text utilities are `@layer`-scoped, so an
  unlayered page rule like `.ledger > span { color: … }` beats the badge's
  text color regardless of specificity. When embedding a badge inside such a
  scoped cell, declare the semantic ink explicitly on the chip class
  (`color: var(--warning-text)` etc.) — gray text on an amber fill is the
  symptom of forgetting this.
- **Structural classification** (direction Nhập/Xuất, combined-loading,
  cargo-mode) → neutral token chips (`--surface-3` fill, `--ink-2` text),
  matching the CUS overview treatment; accent fills are reserved for state.

Amber (`--warning-*`) means "needs attention" exclusively. Never use it for
row striping or decoration; when a row-level gap must be flagged, tint the
single owning cell (e.g. the schedule cell for a missing transport date) and
let an in-cell warning chip explain it — a full-row amber fill reads as
striping once such rows dominate a view. Warning text uses `--warning-text`
(#6F3C10, ≈9:1 on white) so small sizes stay AA-compliant.

## Dense dialogs & forms

Modal dialogs are the canonical dense-form container. The shared `Modal` owns
the chrome; feature dialogs own only their field grid.

- **Scroll model:** header and action footer stay pinned; only the body
  scrolls. Never reintroduce a body `max-height` cap or let the whole dialog
  scroll its title away.
- **Backdrop:** every dialog overlay family — modal, confirm, drawer, and
  feature dialogs with bespoke overlays — uses `rgba(10, 10, 10, 0.56)` with
  a 2px desktop blur so background content never stays readable enough to
  compete. Navigation scrims (sidebar/bottom-nav) are a separate layer and
  keep their own tokens. `frontend/src/styles/dialog-density-contract.styles.test.ts`
  guards the owned overlay files against drift.
- **One control per field:** `UuiSelectField` renders its own accessible label
  and its own boundary. Never wrap it in an outer `.field` label or add
  `wrapperClassName="input"` — that produces a duplicated label and a second
  empty border. When the surrounding field already shows a label, pass
  `hideLabel` so the control stays announced exactly once.
- **One control family per form:** do not mix a shared adapter with
  page-styled raw controls in the same form. The vendored UUI trigger keeps
  its own Tailwind skin — `UuiSelectField.css`'s boundary selectors target
  `[data-input-wrapper]`/`[role='presentation']`, which this Select version
  never renders — so the two systems drift in radius, height, and label
  metrics. Build the form from one family, or scope a local conformance skin
  (label + trigger metrics) to the form, as the CUS quick-edit modal does.
- **`controlClassName` lands on the trigger button:** `UuiSelectField`
  forwards it to the vendored Select's real trigger (`triggerClassName`) —
  the element that owns the visible boundary. Style the class directly;
  `.your-select > button` child rules and `select.your-class` element
  selectors match nothing (the trigger is a `<button>`, and no native
  `<select>` renders), and `frontend/src/components/control-density.styles.test.ts`
  rejects both patterns.
- **Secondary actions:** Cancel (Hủy) in dialog and drawer footers is a
  bordered `secondary` button, never a ghost. Ghost styling is reserved for
  icon-only and low-emphasis row actions; the primary action is the only
  filled button on the screen.
- **Grid & rhythm:** wide dialogs (900px+ canvas) use a 4-column field grid;
  collapse to 2 columns ≤960px and 1 column ≤640px. Compact dialogs pair
  fields on two columns rather than the wide 4-column grid when fields pair
  naturally — the driver dialog's `fleet-form__grid--driver` is the
  reference. Column gap 12px, row gap
  24px, section gap 32px, label→input 7–8px. The grid gap owns vertical
  rhythm — no per-field bottom margins inside a grid group.
- **Empty vs filled:** placeholders are examples (`Ví dụ: …`) in muted
  `--ink-3`; entered values are full-contrast `--ink` (the `Input.css`
  contract). Never style a placeholder to read like a value.
- **Tablet-band control heights:** the app-wide ≤900px safety rule raises
  native inputs to 44px, but UUI select triggers keep the compact boundary
  until the 640px phone sheet — so a dense dialog that stays compact across
  641–900px ends up with mixed control heights in one row. Counter it
  explicitly in that band (`@media (min-width: 641px) and (max-width: 900px)`
  with compact `min-height`/`height !important` on `.input:not(textarea)`),
  as the supplier and fleet form dialogs do.
- **Checkbox chips:** a taxonomy chip is a flex row — draw the checkbox
  yourself (`appearance: none`, 16px box, 4px radius, `--accent` fill with a
  white check when checked) and give the label `line-height: 18px` with
  `white-space: nowrap`. Native checkbox glyphs sit ~3px low against 12px
  labels, which reads as a permanent misalignment. If the chip is a `<label>`
  inside a `.field` section, the shared `.field label { display: block }`
  rule (UI.css) blockifies it out of flex flow — scope chip selectors to the
  owning form so the flex geometry wins on specificity.
- **Taxonomy strips:** a short fixed vocabulary (≤8 canonical groups) reads
  best as one full-width chip row on the wide canvas. Fold the strip to four
  columns before the dialog canvas can squeeze labels (1024px for a 960px
  dialog), and to two columns at the phone sheet.
- **Dense ledgers:** multi-column tables hand off to labelled cards below the
  1500px operational-canvas threshold instead of scrolling internally (see
  `responsive.css` plus the debt/payable/finance/tires/debt-detail handoffs).
  Cards read `data-label` attributes — every new ledger table must emit them
  on its cells.

