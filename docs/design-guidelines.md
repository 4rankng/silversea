# Silversea product design guidelines

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
- **Secondary actions:** Cancel (Hủy) in dialog and drawer footers is a
  bordered `secondary` button, never a ghost. Ghost styling is reserved for
  icon-only and low-emphasis row actions; the primary action is the only
  filled button on the screen.
- **Grid & rhythm:** wide dialogs (900px+ canvas) use a 4-column field grid;
  collapse to 2 columns ≤960px and 1 column ≤640px. Column gap 12px, row gap
  24px, section gap 32px, label→input 7–8px. The grid gap owns vertical
  rhythm — no per-field bottom margins inside a grid group.
- **Empty vs filled:** placeholders are examples (`Ví dụ: …`) in muted
  `--ink-3`; entered values are full-contrast `--ink` (the `Input.css`
  contract). Never style a placeholder to read like a value.
- **Dense ledgers:** multi-column tables hand off to labelled cards below the
  1500px operational-canvas threshold instead of scrolling internally (see
  `responsive.css` plus the debt/payable/finance/tires/debt-detail handoffs).
  Cards read `data-label` attributes — every new ledger table must emit them
  on its cells.

