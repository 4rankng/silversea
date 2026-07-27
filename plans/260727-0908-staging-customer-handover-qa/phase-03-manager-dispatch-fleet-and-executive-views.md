---
phase: 3
title: MANAGER Dispatch Fleet and Executive Views
status: completed
priority: P1
dependencies:
  - 1
---

# Phase 3: MANAGER Dispatch Fleet and Executive Views

## Overview

Exercise the MANAGER/director experience for operational control, approvals,
audit visibility, and financial drill-down without mutating shared records.

## Coverage

- `/dashboard`, `/dispatch`, `/fleet`, tire detail, `/trips` and detail/edit
  shells, `/shipments`, `/finance`, `/profit`, `/audit-logs`, advances and
  settlements, customer/debt and supplier/payable summaries.
- M1 dashboard/dispatch/fleet/close visibility, M3 shipment oversight, and M11
  P&L, truck drill-down, cash/advance, payment-term, executive KPI, and assistant.
- Verify no ADMIN-only App Settings or chatbot monitoring entry appears.
- Retest the historical dispatch background request issue and require no
  unauthorized failed request during normal page load.

## Session procedure

1. Sweep all reachable MANAGER routes at desktop/tablet/mobile plus home at 320px.
2. Verify filters, period controls, drill-downs, maps/charts, tables, exports,
   approvals shown/hidden, empty/loading/error states, and Vietnamese formatting.
3. Record M1.7 with delivery `not_found`, authority `pending`, and execution
   `NOT_RUN` with reason `AUTHORITY`; do not invent a failure status or visual pass.
4. Record KPI/source discrepancies for serialized reconciliation in Session 09.

## Success Criteria

- [ ] Every visible MANAGER action has an observed allowed/denied reason.
- [ ] Dispatch loads without unexplained 403/5xx, console error, or hidden content.
- [ ] Financial and executive views remain legible and actionable at all viewports.
- [ ] M1/M3/M11 partial or unsigned requirements are separately classified.

## Risks

Executive dashboards can look plausible while using stale or inconsistent
sources. Visual pass does not close financial/source-reconciliation cases.
