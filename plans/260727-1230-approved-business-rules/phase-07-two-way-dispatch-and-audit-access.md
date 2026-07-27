---
phase: 7
title: "Two-way dispatch and audit access"
status: pending
priority: P1
dependencies: [1, 2]
---

# Phase 7: Two-way dispatch and audit access

## Overview

Implement O01/M01-1.7 two-way dispatch using authoritative schedule, location,
capacity and cargo data; complete O02 ACCOUNTANT audit-log visibility.

## Related Code Files

- Modify: trip/order/vehicle schema and shared contracts
- Create or modify: trip-pairing service and dispatch routes
- Modify: dispatch and driver two-order frontend surfaces
- Modify: audit-log routes/query/UI and Casbin policy
- Add: focused service, route, UI, E2E, and responsive tests

## Implementation Steps

1. Add planned start/end, canonical origin/destination, cargo weight and
   vehicle capacity fields where absent.
2. Implement deterministic sequence eligibility: no overlap, sufficient
   travel buffer, compatible next origin, and no overload.
3. Persist pairing while retaining independent trip status/revenue/cost;
   compute empty distance and combined efficiency without merging ledgers.
4. Handle cancellation, delay, cross-day and concurrent pairing.
5. Expose ordered pair to dispatcher and driver at desktop/tablet/mobile.
6. Allow ACCOUNTANT to read only financial/payroll audit categories; retain
   ADMIN/MANAGER broader visibility, and expose the audit-log navigation item
   to ACCOUNTANT on both desktop and mobile.

## Success Criteria

- [ ] Valid outbound/return trips pair and display in order.
- [ ] Overlap, impossible repositioning and overload are blocked clearly.
- [ ] Cancellation never destroys the surviving trip.
- [ ] FORWARDER cannot pair trips.
- [x] ACCOUNTANT audit access is category-scoped, fail-closed, redacted and
  read-only; per-assignment row scope remains dependent on Q17's shared
  assignment authority.
- [x] ACCOUNTANT can discover and open the audit page from responsive
  navigation, not only by typing its URL.

## Progress

- O02 bounded domain/redaction/navigation slice: independently reviewed GO.
- O02 completion remains blocked only on Q17-compatible unit/customer/entity
  assignment scope plus persisted deterministic audit scope metadata.
- O01 pairing implementation remains pending.

## Risk Assessment

Dispatch safety and existing trip-contract risk. Add fields forward-only,
preserve legacy unpaired trips, and use server-side eligibility as authority.
