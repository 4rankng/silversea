---
phase: 7
title: CUSTOMER Portal
status: completed
priority: P1
dependencies:
  - 1
---

# Phase 7: CUSTOMER Portal

## Overview

Treat the CUSTOMER portal as the highest privacy boundary: prove landing,
navigation, row scope, debit-note lifecycle visibility, exports, and responsive
presentation without exposing another customer or internal fields.

## Coverage

- `/`, `/dashboard`, unknown routes, `/portal/shipments`, own shipment detail,
  `/portal/debit-notes`, statement/export/account/logout surfaces.
- M3 customer lifecycle and M5 debit-note, statement, payment-status, and
  confirm/dispute views.
- Own-ID versus foreign-ID, direct office URLs, hidden internal metadata,
  document access, empty/loading/error states, pagination and dates/amounts.

## Session procedure

1. Sweep all portal routes at desktop/tablet/mobile and 320px.
2. Verify login landing and catch-all always return to a customer-safe home.
3. Attempt foreign shipment/debit-note/document IDs discovered only through
   controller-safe fixtures; require 404/403 with no metadata leak.
4. Download each offered PDF/XLSX and verify file type, opening, Vietnamese
   text, totals, pagination, and absence of internal-only fields.
5. Inspect confirm/dispute eligibility and dialog copy without submitting.
   Classify persistence-dependent state transitions as not run.

## Success Criteria

- [ ] Zero cross-customer or internal-data exposure in UI, network bodies, URLs, and exports.
- [ ] All customer pages and documents are usable at every required viewport.
- [ ] Portal navigation, account, logout, and error recovery are self-contained.
- [ ] Q16 multi-customer behavior remains pending unless separately provisioned and approved.

## Risks

Any data-scope leak is P0 and an immediate NO-GO. Stop testing that fixture and
preserve only redacted evidence.
