---
phase: 5
title: DRIVER Mobile Operations
status: completed
priority: P1
dependencies:
  - 1
---

# Phase 5: DRIVER Mobile Operations

## Overview

Validate the DRIVER portal as a mobile-first operational product while still
covering tablet and desktop layouts. Do not transition trips or upload evidence.

## Coverage

- `/my-trips`, assigned trip detail, `/my-trips/two-orders`,
  `/my-earnings`, `/my-payslips`, `/my-penalties`, account sheet, logout.
- M8.1-M8.6 and the DRIVER half of M12.3 pump/photo evidence.
- Bottom navigation, camera/upload affordances, status progression, route and
  contact details, offline/error/retry messaging, earnings/payslip/penalty math.

## Session procedure

1. Check all pages at 390x844 and 320x568 first, then 768x1024 and 1440x900.
2. Inspect safe areas, bottom nav, keyboard/form behavior, 44px targets,
   wrapping, orientation resilience, scroll containment, and action reachability.
3. Inspect upload validation and action states without selecting a private file
   or submitting; classify real upload/status/OCR postconditions as not run.
4. Use direct URLs to prove the driver cannot see office, finance, other driver,
   forwarder, customer, or CLERK data.
5. Do not claim browser emulation proves real camera, GPS, or offline-device behavior.

## Success Criteria

- [ ] All DRIVER pages are usable at 320px and have no horizontal overflow.
- [ ] Assigned and foreign trip boundaries are explicitly tested.
- [ ] Earnings, payslip, and penalty figures can be traced to visible sources.
- [ ] Camera/GPS/offline claims are labeled simulated or real-device with evidence.

## Risks

Emulated mobile coverage is insufficient for device permission and offline
recovery. A customer-visible limitation must be recorded if no real device is used.
