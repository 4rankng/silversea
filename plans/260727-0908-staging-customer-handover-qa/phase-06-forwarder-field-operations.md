---
phase: 6
title: FORWARDER Field Operations
status: completed
priority: P1
dependencies:
  - 1
---

# Phase 6: FORWARDER Field Operations

## Overview

Validate the FORWARDER field workflow for assigned trips, advances, expenses,
evidence, and settlements across narrow mobile and larger layouts.

## Coverage

- `/my-forwarder-trips` and detail, `/my-advances`, `/my-settlements`,
  create/detail/print settlement routes.
- M4 field-side disbursement/recovery and all M9 cases.
- Drawer navigation, assigned-data scope, container/expense forms, supplier and
  category validation, photo upload, price suggestion, totals, print preview.

## Session procedure

1. Check 390px and 320px first, then tablet and desktop.
2. Verify empty/error/loading states and form validation without persisting
   shared changes.
3. Confirm unauthorized office/finance/customer/driver direct URLs deny cleanly
   without leaked content or noisy background requests.
4. Reconcile existing advance→expense→settlement records in Session 09.
   Persistence and cross-user aggregation cases remain not run without approval.
5. Distinguish browser file upload from real camera/geotag/network-loss proof.

## Success Criteria

- [ ] Every FORWARDER page/action is reachable and usable at all viewports.
- [ ] Own-versus-foreign data scope is visible and later proven by negative tests.
- [ ] Totals, evidence previews, and settlement print layout are readable and consistent.
- [ ] M4/M9 pending policy and device limitations are explicit.

## Risks

Forwarder tests can collide through shared advances and settlements. Keep them
read-only; Session 09 may compare existing records but does not own mutations.
