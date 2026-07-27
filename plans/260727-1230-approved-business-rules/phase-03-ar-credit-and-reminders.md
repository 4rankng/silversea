---
phase: 3
title: "AR credit and reminders"
status: pending
priority: P1
dependencies: [1, 2]
---

# Phase 3: AR credit and reminders

## Overview

Complete and prove Q01-Q05 for credit exposure, tiered over-limit approval,
oldest-due payment allocation, business-calendar reminders, email/in-app
delivery, retry, deduplication, and stop conditions.

## Related Code Files

- Modify: `backend/src/services/credit-limit.service.ts`
- Modify: `backend/src/services/receivables.service.ts`
- Modify: `backend/src/services/receivable-reminder.service.ts`
- Modify: scheduler/email/notification services and relevant routes
- Modify: customer configuration schema and AR frontend screens
- Modify: `backend/src/tests/m53-credit-limit.test.ts`
- Modify: `backend/src/tests/m57-receivable-reminder.test.ts`

## Implementation Steps

1. Rebaseline current Q01/Q03 implementation and preserve oldest-first logic.
2. Make 80%/100% and per-customer override configuration authoritative.
3. Add tiered, expiring, reasoned over-limit approval for Q02.
4. Apply Q04 business-day schedule and one-summary-per-customer-per-day.
5. Deliver Q05 email plus in-app notification; retry at 15m/2h/24h and alert
   CUS after terminal failure.
6. Add AR UI states, configuration controls, and end-to-end tests.

## Progress

- [ ] Q01 exposure authority and production enforcement.
- [ ] Q02 tiered, expiring over-limit approval.
- [ ] Q03 immutable-due-date allocation and receipt replay safety.
- [x] Q04 business-calendar cadence, working-hour rollover, recurring
  reminders, customer/day claim and obligation-scoped dispute suppression.
- [x] Q05 honest email delivery/retry, customer-scoped portal fallback,
  immutable occurrence repair, bounded retry processing and terminal
  escalation. Independent review: GO.

## Success Criteria

- [ ] Exposure includes current debt, approved-uncollected amounts, and proposed
  shipment/trip value.
- [ ] Over-limit continuation follows configured tier and cannot self-approve.
- [ ] Unspecified receipts allocate oldest due first; excess stays unapplied.
- [x] Disputed, suspended, and fully paid customers are not reminded.
- [x] Email failure never masquerades as success; in-app evidence is distinct.

## Risk Assessment

Financial and customer-communication risk. Use exact VND arithmetic,
transactional allocations, deterministic clocks, and sandbox email recipients.
