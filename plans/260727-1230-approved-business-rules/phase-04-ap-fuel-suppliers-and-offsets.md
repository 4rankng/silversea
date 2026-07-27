---
phase: 4
title: "AP fuel suppliers and offsets"
status: pending
priority: P1
dependencies: [1, 2]
---

# Phase 4: AP fuel suppliers and offsets

## Overview

Complete Q06-Q08: multi-truck fuel invoices allocated by actual voucher data,
multi-category suppliers with a reporting primary, and controlled AR/AP
duality and offsets.

## Related Code Files

- Modify: Drizzle supplier/fuel invoice/allocation/partner schema
- Modify: `backend/src/services/fuel-ap-recon.service.ts`
- Modify: `backend/src/services/supplier-types.service.ts`
- Modify: `backend/src/routes/financial/debt-offsets.routes.ts`
- Modify: AP/fuel/supplier frontend screens and shared contracts
- Modify: `m61`, `m62`, and `m64` backend tests

## Implementation Steps

1. Add invoice-header plus per-truck allocation lines where current model is
   one-truck-only.
2. Reconcile allocations to actual litres and invoice unit price; block
   approval while evidence or allocation is incomplete.
3. Add primary supplier type without overriding transaction classification.
4. Model one legal partner by normalized tax code with separate AR/AP ledgers.
5. Require same legal entity/currency, minutes, approval and bounded amount
   for manual offsets.
6. Add responsive workflows and concurrency/RBAC tests.

## Success Criteria

- [ ] One fuel invoice supports multiple trucks without duplicate header data.
- [ ] Allocated litres/amounts reconcile exactly; equal splitting is impossible.
- [ ] Supplier primary type is reporting-only.
- [ ] Offsets never occur automatically or exceed the smaller open balance.
- [ ] Maker/checker and first-approve-wins are proved.

## Risk Assessment

Migration and ledger risk. Use additive tables, explicit backfill from existing
single-truck invoices, and paired immutable ledger entries/reversals.
