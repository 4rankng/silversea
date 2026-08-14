---
date: 2026-08-15 00:30
component: CUS shipment-detail workboard
status: verified-local-with-e2e-follow-up
---

# CUS shipment-detail workboard lessons

## Context

The shipment-detail workboard adds direct container browsing and inline CUS
editing while preserving the shipment as the transport and custody authority.
The implementation had to reconcile URL-driven search/pagination, appointment
semantics, optimistic versions, internal carrier rows, and narrow browser
layouts.

## What happened

Container pagination and search were made authoritative at the container query
boundary rather than approximated from a loaded shipment slice. Shipment-level
schedule/appointment fields remain shipment authority; container appointment
values are only the per-container operational display. Internal `OWN` carrier
rows retain their business meaning and are not treated as an external carrier
lookup.

An optimistic save conflict now returns `409`, refreshes the server version,
remounts the affected editor, and explicitly discloses that the stale draft was
discarded. Browser QA also found cell-level content overflow even when the page
itself fit the viewport; the fix constrained the workboard's table/grid cells,
not merely the outer page width.

## Reflection

The durable authority is the narrowest domain boundary: query containers from
the container source, keep schedule ownership at shipment scope, and resolve
version conflicts through a fresh server snapshot. A successful page-width
measurement is insufficient evidence for dense tables. The remaining E2E red
result is a readiness race versus a production overflow finding: the race does
not prove an application defect, while the measured overflow is a real UI
regression that must stay visible until fixed and rerun.

## Decisions

- Keep container search and pagination server/query authoritative.
- Do not copy shipment appointments into container records or reinterpret
  internal `OWN` carriers as external providers.
- On `409`, refresh and remount from the returned version and tell the user the
  stale draft was discarded; never silently merge it.
- Validate individual cells and realistic long values at desktop and mobile
  widths, alongside page-level overflow checks.
- Preserve the failed E2E artifact and distinguish infrastructure/readiness
  races from reproducible production layout failures.

## Next

Fix and rerun the failing narrow-width E2E case with a confirmed-ready backend,
then repeat authenticated desktop/tablet/mobile checks for cell overflow,
pagination, appointment display, `OWN` semantics, and conflict recovery. Only
after that controlled rerun should the workboard be marked complete.
