---
phase: 3
title: "Wave 2 — CUS Core & Customer Portal"
status: pending
priority: P1
dependencies: [1, 2]
---

# Phase 3: Wave 2 — CUS Core & Customer Portal

## Overview

Build the customer-facing and CUS-operator-facing functionality that the system completely
lacks today: shipment document verification, progress notifications, delivery confirmation,
debit-note issuance from approved expenses, and a read-only **customer portal** where the
customer tracks their shipments, acknowledges debit notes, and replies.

This is the wave with the largest *new* surface area, and the biggest customer-facing
differentiator.

**PRD modules touched:** M3 (3.1–3.7), M4.5.

**Note on M3.1:** the shipment entity itself was built in Wave 0. This wave adds the CUS
workflow on top of it.

## Existing code built on

- `shipments` + documents + declarations (from Wave 0).
- `trip_expenses` with `approvalStatus` workflow + `forwarder-expense-types` catalog.
- `billing_documents` + `billing_document_lines` + `debit_note_templates` + ExcelJS export —
  a substantial debit-note engine already exists, but it's trip-centric. Wave 2 extends it
  to assemble lines from approved expenses and from shipment-level data.
- `notifications` (in-app) + `push_subscriptions` (web push) — no email yet.
- Audit log + optimistic locking patterns.

## Requirements (mapped to PRD acceptance codes)

- **M3.2 — Document verification** (new)
  - On shipment, verify BL ↔ containers ↔ declarations ↔ delivery-order for consistency.
  - ISO 6346 container-number check-digit validation (CUS-02-01/02).
  - Declaration reuse across containers allowed only with approver + reason (CUS-02-03).
  - Expired delivery order blocks dispatch step (CUS-02-04). Replacing a doc keeps history
    (CUS-02-05).
- **M3.3 — Progress notifications** (new)
  - Define milestones: RECEIVED → CONTAINER_PICKED_UP → IN_TRANSIT → DELIVERED →
    COST_PENDING → DEBIT_NOTE_ISSUED → PAID.
  - Auto-advance from trip status; CUS may add manual notifications for schedule changes
    (CUS-03-03) preserving history.
  - Send via in-app + push now; **email as fallback channel** (needs an email provider —
    see Architecture). Failed sends retry per a policy and surface to CUS (CUS-03-04).
  - Cross-customer data isolation enforced (CUS-03-05).
- **M3.4 — Delivery confirmation** (new)
  - Capture timestamps: container pickup, delivery, strip-off (rút hàng), container return
    (trả vỏ), free-time deadline.
  - Three-party confirm: driver records, CUS confirms, customer acknowledges (CUS-04-01).
  - Manual confirm allowed with reason + evidence when driver milestone missing (CUS-04-02).
  - Partial delivery per container (CUS-04-03). Free-time overrun calc + fee warning
    (CUS-04-04).
- **M3.5 — Debit-note issuance** (extends existing billing-documents engine)
  - Per-customer mode: by shipment or by period (already on `customers.debitNoteMode`).
  - Group lines: freight, service fee, disbursement, adjustment — never collapse losing
    traceability (CUS-05-01).
  - VAT per line: pre-tax / rate / tax / total; non-taxable lines flagged (CUS-05-04).
  - Unapproved disbursements excluded from the official document; show pending list
    (CUS-05-02 / ties into M4.4 done in Wave 3).
  - Re-issue guard: warn on duplicate range, don't double-issue (CUS-05-03).
  - Lock after customer confirmation; later changes via adjustment document (CUS-06-03).
- **M3.6 — Debit-note tracking & payment** (extends existing)
  - Statuses: DRAFT / SENT / PENDING_CONFIRM / CONFIRMED / PARTIAL_PAID / PAID / REJECTED /
    CANCELED (CUS-06-01 status set).
  - Customer confirms on portal; CUS may confirm on behalf with note (CUS-06-02).
  - Payment recorded against bank slip / receipt; allow one payment → many debit notes
    (already supported by ledger payments).
  - Reminder rule + stop-on-dispute (ties to M5.7 in Wave 3).
  - Overpayment handling: don't drive AR negative silently (CUS-06-06).
- **M3.7 — Disbursement reconciliation** (extends M4.4 done in Wave 3)
  - Catalog of disbursement types (configurable: nâng/hạ/lưu bãi/phí cảng/cước hãng tàu/hải
    quan/khác).
  - Per-type rules: which require invoice, what's an acceptable substitute.
  - Required reconciliation fields: amount, doc date, issuer, invoice/declaration number,
    container, shipment, file.
  - Suggest price from `lift_pricing` (built in Wave 1) by port + type + date; override with
    reason.
- **M4.5 — Generate debit note and close into correct period** (joins M3.5)
  - Only approved disbursements enter the right period; a disbursement never appears on two
    debit notes (M04-05-03).
  - Late-approved disbursement after period issued → roll to next period or adjustment per
    locked rule (M04-05-03).

### Customer portal (new frontend surface)

A separate authenticated area for `CUSTOMER`-role users:

- Shipment list (their own only) with status + milestones.
- Shipment detail: milestones timeline, documents (download permitted ones), container list.
- Debit-note list with status; confirm / dispute per line; download XLSX/PDF.
- Statement of account (reuses existing customer statement export).
- Two-way messaging with CUS on a shipment (scope: confirm whether this is in v1 — see open
  questions).

## Architecture

- New router group `backend/src/routes/portal/` mounted under `/api/portal` with the
  `CUSTOMER` role gate and a row-scope helper (`scopedByCustomer`) introduced in Wave 0.
- Extend `billing_documents` generation to assemble lines from approved `trip_expenses`
  whose `sellAmount` is set, plus freight from pricing snapshots, plus ancillary revenue.
- New `customer_email_logs` table tracking address / subject / sentAt / status / retryCount.
- Email provider: pick one (Resend / SendGrid / Amazon SES). Keep behind an interface so it
  can swap. Wire into the Wave-0 scheduler for retries.
- Portal frontend: new React route tree `/portal/*` with a leaner, customer-facing layout.
  Reuse the existing design system but a separate `CustomerPortalLayout`.

## Related Code Files

- Modify: `backend/src/db/schema.ts` (shipment timestamp fields, email log table,
  debit-note status enum extension, customer-portal user fields)
- Create: `backend/src/routes/portal/index.ts`, `shipments.routes.ts`,
  `debit-notes.routes.ts`, `messages.routes.ts`
- Modify: `backend/src/services/billingDocument.service.ts` (assemble from expenses)
- Modify: `backend/src/services/statement.service.ts` (already XLSX/HTML; add PDF)
- Create: `backend/src/services/email.service.ts`, `backend/src/services/milestone.service.ts`
- Modify: `backend/src/services/notification.service.ts` (add email channel)
- Create: `frontend/src/pages/portal/CustomerPortalLayout.tsx`,
  `PortalShipmentListPage.tsx`, `PortalShipmentDetailPage.tsx`,
  `PortalDebitNoteListPage.tsx`, `PortalDebitNoteDetailPage.tsx`
- Modify: `frontend/src/pages/FinancePage.tsx` / debit-note admin UI for new statuses
- Modify: Casbin policy.csv for `customer_portal` resource grants

## Implementation Steps

1. Schema: shipment milestone timestamps, debit-note status enum, email log table.
2. ISO 6346 check-digit validator + shared declaration-override approval flow (M3.2).
3. Milestone service: derive milestones from trip status transitions; manual CUS notifications.
4. Email service + provider integration; wire to scheduler for retries.
5. Extend debit-note generation to assemble lines from approved expenses + freight snapshot.
6. Debit-note statuses + customer-confirmation endpoint + lock-after-confirm.
7. Delivery-confirmation flows (driver/CUS/customer three-party).
8. Customer portal frontend (list, detail, debit notes, statement download).
9. Cross-customer isolation tests (CUS-03-05, CUS-06-04 duplicate-payment guard).
10. PDF export for debit notes (extend statement.service.ts PDF path).

## Success Criteria

- [ ] CUS-02-02: invalid ISO 6346 container number blocked with a clear Vietnamese message.
- [ ] CUS-03-05: customer A cannot read customer B's shipment/debit-note via direct URL.
- [ ] CUS-04-03: partial delivery marks only delivered containers as complete.
- [ ] CUS-05-02: unapproved disbursement excluded from official debit note; pending list shown.
- [ ] CUS-05-03: re-issuing same range warned; no double-issue.
- [ ] CUS-06-03: confirmed debit note locked; edits require an adjustment document.
- [ ] CUS-06-06: overpayment recorded as unallocated, not as negative AR.
- [ ] M04-05-03: late-approved disbursement rolls to next period or adjustment per rule.
- [ ] Customer portal: login, see own shipments, confirm a debit note, download PDF.
- [ ] Email reminder sends + retries on failure + logs result.

## Risk Assessment

- **Email provider + deliverability in Vietnam** — outbound email to Vietnamese
  customer domains can be filtered. Mitigation: SPF/DKIM setup, start with a transactional
  provider with good VN delivery (Resend or SES), keep templates plain-text-friendly.
- **Debit-note generation correctness** — assembling lines from many sources (freight,
  expenses, ancillary) is the highest-blast-radius logic in the system. Mitigation:
  comprehensive unit tests on the line assembler; a reconciliation check that
  `Σ(lines) == document.total`; dry-run preview before issue.
- **Three-party delivery confirmation races** — driver and customer may confirm near-
  simultaneously. Optimistic locking on the milestone record + clear status ordering resolve
  this; tested in CUS-04-02.
- **Portal auth scope leakage** — the largest security risk. Mitigation: every portal query
  passes through `scopedByCustomer`; add an integration test that tries every portal
  endpoint with customer A's token against customer B's IDs.

## Open PRD questions to confirm before this wave

- M3.1 §1: which shipment fields are mandatory at creation vs. before dispatch?
- M3.3 §1: is the customer portal the *primary* channel and email the fallback? (assumed yes)
- M3.3 §4: is two-way customer messaging in v1, or notifications + acknowledgement only?
- M3.3 §5: confirm real-time vehicle location display in portal during transit only (assumed).
- M3.4 §3: provide the free-time rules table (per customer × port × carrier × container type).
- M3.5 §1: confirm per-shipment vs. per-period default mode per customer.
- M3.5 §3: confirm per-customer template customisation (logo, payment info, columns, signers).
- M3.6 §3: confirm payment-allocation rule when customer gives no instruction (oldest-first
  proposed).
- M3.7 §2: confirm which disbursement types mandatorily require an invoice.
- M4.5 §6: confirm period definition (weekly vs. monthly) per customer and the cross-period
  shipment rule.
- Customer portal: confirm authentication method (email + password? SSO? magic link?).
