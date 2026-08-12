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
