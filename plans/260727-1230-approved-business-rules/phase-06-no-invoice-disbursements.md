---
phase: 6
title: "No-invoice disbursements"
status: pending
priority: P1
dependencies: [1, 2]
---

# Phase 6: No-invoice disbursements

## Overview

Complete Q12-Q14 with configuration-driven allowed categories, substitute
evidence, anti-splitting thresholds, return-for-evidence, and tiered approval.

## Related Code Files

- Modify: expense-category/app-config schema and admin configuration UI
- Modify: `backend/src/services/no-invoice-disbursement.service.ts`
- Modify: expense approval routes and field-app UI
- Modify: `backend/src/tests/m47-no-invoice-disbursement.test.ts`

## Implementation Steps

1. Replace hard-coded thresholds/categories with seeded configurable policy.
2. Model allowed substitute evidence per category and validate mandatory
   amount/date/payee/shipment-or-trip/reason/evidence.
3. Aggregate same person/date/category to detect split transactions.
4. Return incomplete evidence for supplementation; route complete over-limit
   requests to the correct approval tier.
5. Prevent self-approval and audit every exception.
6. Add configuration, mobile evidence capture, and boundary tests.

## Success Criteria

- [ ] Only configured legitimate categories can be selected.
- [ ] Missing minimum evidence cannot enter approval.
- [ ] Default 1M/item and 5M/person/day are seeded but editable.
- [ ] Finance lead approves through 5M/item; Director handles higher or
  over-10M/day cases.
- [ ] Split transactions cannot bypass daily limits.

## Risk Assessment

Fraud/control risk. Policy changes require versioned configuration and audit;
existing approved expenses must retain the policy snapshot used at approval.
