---
phase: 5
title: "Wave 4 — Mobile & Director Reporting"
status: pending
priority: P2
dependencies: [1, 2, 3, 4]
---

# Phase 5: Wave 4 — Mobile & Director Reporting

## Overview

The closing wave: polish the role-specific mobile experiences (driver app M8, field-staff app
M9 already largely built, clerk app M10) and complete the director-facing reporting layer
(per-truck P&L M11.2, payment-term evaluation M11.4, director dashboard M11.5) plus the
monthly fuel reconciliation report (M12.2). Builds on the closed financial loop from Wave 3.

**PRD modules touched:** M8 (8.1–8.6), M10 (10.1–10.3), M11 (11.2, 11.4, 11.5; 11.1 & 11.6
already done), M12.2. (M9 is largely complete — only mobile UX polish.)

## Existing code built on

- Driver portal backend (`/api/driver/me/*`) + `DriverTripsPage`/`DriverTripDetailPage`/
  `DriverEarningsPage`/`DriverPenaltyPage` React pages.
- Forwarder portal backend (`/api/forwarder/me/*`) + forwarder React pages (M9 base).
- Trip-create flow + trip-containers + OCR endpoint (for M10 clerk flows).
- P&L report (`reports/pnl`) — company-wide; not yet per-truck.
- Dashboard (`reports/dashboard`) + AI chatbot (`/api/agent`) — M11.6 already delivered.
- Receivables aging + payments + allocation (Wave 3) → feeds M11.4 payment-term analysis.
- `trip_gps_tracks` + live-fleet map → feeds M11.5 director dashboard.

## Requirements (mapped to PRD acceptance codes)

### M8 — Driver app

- **M8.1 Mobile UX** — one-hand usable, large touch targets, no manual zoom; works on small
  screens, slow networks, OS large-font mode (M08-01-03/05).
- **M8.2 Receive dispatch + instructions** — driver sees only own trips; new/changed
  instruction notifies; old instructions retained (M08-02-03). Recover from offline update
  (M08-02-03).
- **M8.3 Two-orders-per-day view** — show active order and next order distinctly, no mixing
  of documents/costs between them (M08-03-03). Warn when first order runs late.
- **M8.4 Progress + incidental cost update** — driver records departure/arrival milestones,
  lift-up/down fees, per-diem; cannot complete without mandatory evidence (M08-04-03).
  Offline-safe: queue submits, sync once (M08-04-03).
- **M8.5 Photo + container/seal OCR** — already exists (`/api/ocr`); ensure driver must
  confirm or edit before save (M08-05-03).
- **M8.6 Payslip view** — driver sees own issued periods only; cannot see others; each line
  links to its basis (trip or workday) (M08-06-03); adjusted period shows new version +
  reason + old history (M08-06-03).

### M10 — Clerk (nhân viên chứng từ) app

- **M10.1 Quick lot-creation on mobile** — using the Wave-0 shipment entity; create draft
  with minimum data; unique code; record creator + timestamp (M10-01-03). Offline-safe: lose
  connection → clear "not saved" message; resubmit doesn't duplicate (M10-01-03).
- **M10.2 Enter BL / container / declaration / delivery info** — format + duplicate checks;
  many containers per BL; mandatory fields defined before dispatch (M10-02-03). Invalid data
  rejected with reason; exceptions need approver + reason (M10-02-03).
- **M10.3 Hand off to dispatch** — when clerk sends, dispatch gets notified and sees the
  correct version; material changes re-notify (M10-03-03). Status: UNSEEN / SEEN /
  ACCEPTED + handler. Version conflict warning if data edited while dispatch is viewing
  (M10-03-03).

### M11 — Director reporting

- **M11.2 Per-truck P&L** (new) — only allocate costs to the correct truck; trailer or
  shared costs not arbitrarily assigned (M11-02-03). Truck with no trips but with costs
  still appears; missing data flagged (M11-02-04).
- **M11.4 Payment-term evaluation** (new) — for paid portion: days-to-pay; for unpaid:
  age-to-report-date. Multi-payment partial allocation handled per-portion (M11-04-04).
  Pre-payment must not produce negative days (M11-04-04).
- **M11.5 Director dashboard** (extends existing) — cash flow in/out, trip count, two-way-
  cargo ratio, profit, fleet status; each KPI has definition + update-time + drilldown
  (M11-05-03). Prominent alerts, period-over-period comparison, list of trucks needing
  attention (M11-05-01).

### M12.2 — Monthly fuel reconciliation

- Aggregate by truck × supplier × period; list variances to resolve; same unit of measure;
  separate litre / unit-price / amount variances; no double-count of invoices (M12-02-03).
- Late or multi-truck invoices allocated with basis (M12-02-04); credit notes and
  cross-period trips handled (M12-02-03).

## Architecture

- **No new core entities** — this wave is mostly read-paths, reports, and mobile UX.
- New `dispatch_handoffs` table for M10.3 status tracking (UNSEEN/SEEN/ACCEPTED + handler +
  version-at-handoff).
- Offline queue: a small client-side store (IndexedDB via `idb-keyval` or similar) in the
  driver/clerk mobile pages; sync endpoint that drains the queue idempotently (server-side
  dedupe by client-generated request id).
- Per-truck P&L: a new materialised query in `pnl.service.ts` grouping by `trips.truckId`
  with shared/trailer costs in a separate "unallocated" bucket.
- Payment-term eval: a new query joining `ledger` (AR lines) with payment allocations
  (Wave 3) to compute days-to-pay distribution per customer.

## Related Code Files

- Modify: driver & clerk frontend pages for mobile UX (M8.1, M10.1)
- Create: `frontend/src/pages/driver/DriverTwoOrdersPage.tsx` (M8.3)
- Create: `frontend/src/pages/driver/DriverPayslipPage.tsx` (M8.6) — extends existing
  earnings page
- Create: `frontend/src/pages/clerk/` — `ClerkShipmentCreatePage.tsx`,
  `ClerkShipmentDocsPage.tsx`, `ClerkDispatchHandoffPage.tsx` (M10.1–10.3)
- Create: `frontend/src/lib/offline-queue.ts` (IndexedDB queue helper)
- Modify: `backend/src/services/pnl.service.ts` (per-truck dimension)
- Create: `backend/src/services/payment-term.service.ts`, `fuel-reconciliation.service.ts`
- Modify: `backend/src/routes/financial/reports.routes.ts` (new endpoints)
- Create: `backend/src/routes/clerk.ts` (new router for `CLERK` role)
- Modify: `frontend/src/pages/DashboardPage.tsx` for director dashboard widgets (M11.5)
- Create: `dispatch_handoffs` table + service

## Implementation Steps

1. `dispatch_handoffs` schema + service + notification on handoff (M10.3).
2. Clerk router + mobile pages: quick shipment create, doc entry, handoff (M10.1–10.3).
3. Offline-queue client lib + idempotent sync endpoint (M8.4, M10.1).
4. Driver two-orders view; payslip view (M8.3, M8.6).
5. Mobile UX pass: touch targets, font scaling, slow-network states (M8.1) across driver +
   clerk + (existing) forwarder pages.
6. Per-truck P&L report + unallocated-cost bucket (M11.2).
7. Payment-term evaluation report (M11.4).
8. Director dashboard widgets: cash flow, two-way-cargo ratio, fleet attention list (M11.5).
9. Monthly fuel reconciliation report (M12.2) — advisory first, then optional enforcing.
10. E2E smoke tests for the full closed loop: shipment → trip → expense → debit note →
    payment → P&L → director dashboard.

## Success Criteria

- [ ] M08-01-03: driver/clerk pages usable one-handed on a 5" screen at OS large-font.
- [ ] M08-03-03: two-orders view shows active + next distinctly; no cost mixing.
- [ ] M08-04-03: progress update queues offline and syncs without duplicate submissions.
- [ ] M08-06-03: driver sees only own issued payslips; adjusted period shows both versions.
- [ ] M10-01-03: clerk quick-create works offline; resubmit doesn't duplicate.
- [ ] M10-03-03: handoff status UNSEEN/SEEN/ACCEPTED; version conflict warns.
- [ ] M11-02-03: per-truck P&L only assigns truck-specific costs; shared costs in separate
      bucket; truck-with-costs-no-trips still listed.
- [ ] M11-04-04: payment-term report handles partial payments per-portion; no negative days.
- [ ] M11-05-01: director dashboard shows alerts, period-over-period, trucks-needing-attention.
- [ ] M12-02-03: fuel reconciliation lists variances; same invoice not counted twice.

## Risk Assessment

- **Offline sync correctness** — duplicate submissions are the main risk. Mitigation:
  client-generated request id; server dedupe table; idempotent endpoints. Test with
  simulated offline → online transitions.
- **Per-truck P&L cost-allocation debates** — accountants may disagree on which costs are
  "truck-specific" vs. "shared". Mitigation: ship with a documented default policy, expose
  the unallocated bucket transparently, allow reclassification per period.
- **Mobile UX scope creep** — "make it mobile-friendly" can swallow unlimited time.
  Mitigation: define a fixed device matrix (iPhone SE, common Android 5"), test only there,
  defer nice-to-haves.
- **Director dashboard performance** — many KPIs over many periods can get slow.
  Mitigation: reuse the existing cached dashboard pattern; precompute per-period aggregates.

## Open PRD questions to confirm before this wave

- M8.1 §1: confirm the target device matrix (which phone models / screen sizes / OS versions).
- M8.3 §3: confirm the late-first-order warning threshold (minutes? GPS-based?).
- M8.4 §3: confirm which evidences are mandatory before completion (photo of container?
  signature? GPS?).
- M10.1 §1: confirm the minimum data set for a quick-draft shipment.
- M10.3 §3: confirm whether multiple dispatchers can accept the same handoff or only one.
- M11.2 §3: confirm the cost-allocation policy (what counts as truck-specific vs. shared).
- M11.4 §3: confirm whether payment-term evaluation is per-invoice or averaged per customer.
- M11.5 §3: confirm the exact KPI list and each KPI's definition.
- M12.2 §4: confirm whether credit notes net against the original invoice in the same period.
