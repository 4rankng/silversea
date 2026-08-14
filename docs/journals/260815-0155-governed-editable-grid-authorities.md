---
date: 2026-08-15 01:55
component: CUS shipment grids
status: verified-local
---

# Governed editable-grid authorities

## Context

The request to make both shipment tables editable like a spreadsheet exposed a
domain constraint: values that share a visual cell do not necessarily share a
persistence authority. Shipment fields, container fields, approval requests,
document governance, derived totals, and historical trip assignments must not
be flattened into one generic cell-save operation.

## What happened

The first grouped editors combined shipment schedule with container appointment,
and direct Bill/Booking changes with request-governed classification changes.
Those combinations could produce partial effects or defer fields that were safe
to save directly. The editors were split at authority boundaries while keeping
the seven-column visual grouping.

Optimistic `409` handling also needed a semantic boundary. Version conflicts
reload current server state and discard the stale draft; a normalized duplicate
container number is correctable validation and must retain the editor with the
actionable message. Returning validation as `400` prevents the UI from falsely
claiming a concurrency recovery.

## Decisions

- Group related values visually, but save shipment, container, and approval
  authorities independently.
- Keep lifecycle, finance, aggregates, declaration governance, and actual-trip
  history read-only in the grid.
- Canonicalize container numbers before equality, persistence, and duplicate
  checks under the shipment transaction lock.
- Treat only genuine optimistic-version conflicts as draft-discarding `409`
  recovery; surface domain validation inline without losing the draft.
- Project actor-specific field access to both list and detail rows so read-only
  controls are omitted before interaction, not rejected only after opening.

## Next

Reuse the same authority-first pattern for future spreadsheet-like operational
tables: define raw values and field access first, then compose visual cells from
independent save units and verify conflict behavior at desktop and mobile sizes.
