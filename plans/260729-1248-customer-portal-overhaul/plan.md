---
title: Customer portal records overhaul
status: completed
priority: P1
effort: medium
branch: main
tags: [customer-portal, shipments, debit-notes, statement, responsive]
created: 2026-07-29
---

# Customer portal records overhaul

- [x] Inspect the three live routes at desktop and mobile widths.
- [x] Review the existing portal shell, tokens, data contracts, and tests.
- [x] Compare Untitled UI table and pagination patterns through MCP.
- [x] Implement one responsive record system across all three routes.
- [x] Verify focused tests, frontend typecheck, lint, and production build.
- [x] Complete authenticated desktop/mobile browser QA and independent review.
- [x] Update the task handoff with exact evidence.

## Direction

Use a flat, data-dense Swiss operational layout inside the existing TransTing
emerald shell. The focal evidence differs by job: shipment lifecycle status,
debit-note attention and value, and the statement balance equation. Preserve
all existing API, customer-scope, export, confirmation, dispute, and routing
behavior.

## Scope

- `frontend/src/pages/portal/PortalShipmentsPage.tsx`
- `frontend/src/pages/portal/PortalDebitNotesPage.tsx`
- `frontend/src/pages/portal/PortalStatementPage.tsx`
- `frontend/src/pages/portal/PortalPages.css`
- `frontend/src/pages/portal/PortalPages.test.tsx`

## Acceptance

- Desktop records are compact and scannable without decorative card grids.
- Mobile records need no horizontal scrolling and retain 44px touch targets.
- Loading, empty, error, disabled, success, and pagination states remain clear.
- Keyboard focus, heading hierarchy, status text, and table semantics remain
  accessible.
- No API, database, RBAC, financial calculation, or portal-shell behavior
  changes.

## Verified result

- Focused portal tests: 11 passed.
- Full frontend tests: 91 files / 437 tests passed.
- Frontend typecheck, root lint, UI/brand contracts, production build, and
  context validation passed.
- Customer portal E2E: 13 passed at desktop and 375px mobile widths.
- Independent review: PASS after scoping the mobile ledger conversion and
  collapsing multi-page pagination controls on narrow screens.
