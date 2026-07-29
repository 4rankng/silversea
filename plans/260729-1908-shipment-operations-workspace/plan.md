---
title: Shipment Operations Workspace
description: >-
  Make shipment creation, operational editing, and dispatch handoff discoverable
  while adding the customer workbook's highest-value planning fields.
status: completed
priority: P1
effort: large
branch: main
tags:
  - shipment
  - dispatch
  - backend
  - frontend
  - responsive
blockedBy: []
blocks: []
created: '2026-07-29T11:08:00.000Z'
createdBy: 'ck:cook'
source: skill
---

# Shipment Operations Workspace

Mode: autonomous (`ck:cook`)
Risk: high — additive database/API fields and frontend role reachability; the user approved autonomous implementation for this scope only.

## Outcome

Turn the existing shipment register, quick-create form, dossier editor, and shipment-to-trip dispatch into one discoverable operational workflow for SilverSea staff, while preserving shipment authority, optimistic locking, audit, finance, portal, and trip execution contracts.

## Phases

| Phase | Name | Status |
|---|---|---|
| 1 | [Additive shipment operations contract](./phase-01-shipment-operations-contract.md) | Completed |
| 2 | [Discoverable responsive workflow](./phase-02-responsive-workflow.md) | Completed |
| 3 | [Closed-loop verification and handoff](./phase-03-verification-handoff.md) | Completed |

## Locked additive field set

`tradeDirection`, `cargoMode`, `factoryName`, `shippingLineName`,
`customsCutoffAt`, `closingAt`, `plannedReturnAt`, `cargoWeightKg`,
`cargoVolumeCbm`, `packageCount`, `packageType`, and `operationalNotes`.

## Acceptance criteria

- Existing create/update clients remain valid when all new fields are omitted.
- Shipment create/update/list/detail persist and return the accepted operational fields.
- Server-side shipment search covers shipment code, B/L, booking, customer, factory, and shipping line.
- ADMIN and MANAGER can reach create/edit/dispatch from the shipment register; ACCOUNTANT sees no write actions.
- CLERK quick-create lands on its allowed dossier route and retains scoped backend authority.
- Desktop and mobile surfaces have no page-level horizontal overflow and use touch targets of at least 44px.
- Shipment-to-trip dispatch, credit governance, portal payloads, lifecycle, audit, and optimistic-lock behavior remain unchanged.
- All affected QA gates are green and their complete outputs are under `qa/`.

## Explicitly out of scope

- Excel bulk import, historical backfill, deployment, push, or commit.
- New customer-site/shipping-line master tables or repeating deadline/cargo-line tables.
- Finance, customer portal, GPS, or post-trip dispatch redesign.
