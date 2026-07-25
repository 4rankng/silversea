# ROADMAP — Silversea (TingTing) Logistics Platform

> **Single source of truth for what to build next and how to start.**
> Source PRD: `docs/prd/Module1.docx` … `Module12.docx` (Vietnamese, 12 modules).
> Detailed wave plans: `plans/silversea-prd-roadmap/phase-01..05-*.md`.

---

## ⚡ How to start (for the next agent)

1. **Read this file first.** It tells you what wave is next, what blocks it, and the open
   questions to confirm with Silver Sea before coding.
2. **Pick the lowest-numbered wave whose status is `Pending` and whose dependencies are
   `Done`.** That is the next thing to build. Do not skip ahead.
3. **Open the matching phase file** in `plans/silversea-prd-roadmap/phase-0N-*.md` for
   schemas, routes, file list, and PRD acceptance-code traceability.
4. **Before writing code for a wave, confirm its "Open PRD questions"** with the customer.
   The PRD response columns are empty — see "Reality check" below.
5. **Branch per wave:** `feat/wave-0-foundation`, `feat/wave-1-pricing-fuel`, etc. Do not
   commit waves directly to `main`.
6. **Stack:** Express 5 + Drizzle/Postgres + React/Vite monorepo. Ports: frontend 7174,
   backend 3001, postgres 5441, redis 6391, adminer 8083. Start everything with `make dev`.
7. **Conventions:** Vietnamese labels/errors throughout (PRD Mxx-HT-01); optimistic locking
   via `version`; every write audited (`audit_logs`); Casbin RBAC gates every route.
8. **Update this file's checklists as you complete items.** Mark wave status in the table.
   Keep it honest — if a wave is half-done, say so.

---

## 🚨 Reality check (read before trusting the PRD)

The PRD is a **survey/confirmation document, not an approved spec.** In every module the
"Đề xuất của TingTing" (proposal) column is filled, but the
"Ghi nhận của Silver Sea" (customer response) column is **empty**. Proposals become formal
requirements only after Silver Sea signs off.

**Implication:** every wave lists the specific open questions that must be answered before
that wave starts. Do not treat anything below as a locked spec — treat it as the proposed
order of work.

---

## 📦 Current codebase coverage (already built — don't rebuild)

The repo is a working monorepo with ~40 tables, Casbin RBAC, JWT auth, GPS capture, an AI
chatbot, and forwarder/driver portals. PRD coverage by module:

| Mod | Title | Status | Real gap |
|-----|-------|--------|----------|
| **M1** | Tổng quan & Điều vận | ✅ Largely done | Two-way cargo pairing (1.7), dashboard polish |
| **M2** | Cước & Doanh thu phi-vận-tải | ⚠️ Partial | **Weight-tier pricing, auto-revenue, lift catalog, ancillary revenue — mostly missing** |
| **M3** | Chăm sóc khách hàng (CUS) | ❌ Missing | **Entire module + customer portal** |
| **M4** | Chi hộ & Thu hộ khép kín | ✅ Largely done | Debit-note from approved expenses (4.5), classification (4.6/4.7) |
| **M5** | Công nợ phải thu | ⚠️ Partial | Credit-limit warnings, allocation, reminders, freight/disbursement split |
| **M6** | Công nợ phải trả | ⚠️ Partial | Fuel-invoice reconciliation, supplier-type expansion |
| **M7** | Lương & Chấm công | ⚠️ Partial | Period close + lock + ledger posting (7.3) |
| **M8** | App lái xe | ⚠️ Partial | Two-orders view (8.3), mobile expense (8.4), payslip (8.6), mobile UX |
| **M9** | App nhân viên hiện trường | ✅ Largely done | Mobile UX polish |
| **M10** | App nhân viên chứng từ | ❌ Missing | **Quick lot-create mobile, doc entry, dispatch handoff** |
| **M11** | Báo cáo tài chính | ⚠️ Partial | Per-truck P&L (11.2), payment-term eval (11.4), director dashboard (11.5). 11.1 & 11.6 ✅ |
| **M12** | Nhiên liệu & Số hóa dầu | ⚠️ Partial | Fuel norms per route/truck (12.1), monthly reconciliation (12.2), pump OCR (12.3) |

---

## 🏗️ Architectural keystone: a new `shipments` entity

Today the system is **trip-centric**. But M3, M4, M9, M10 all centre on a *shipment*
(`lô hàng`) that precedes and outlives any single trip: booking → documents → dispatch →
delivery → debit-note. Reusing `trips` for this fights the domain.

**Decision (locked):** introduce a first-class `shipments` entity in Wave 0. A shipment owns
booking docs, containers, and declarations. A trip becomes a fulfillment of (part of) a
shipment. This unblocks M3, M4, M5.6, M9, M10.

---

## 🌊 Wave order

```
Wave 0 FOUNDATION  ──►  Wave 1 PRICING & FUEL  ──►  Wave 2 CUS CORE
                                                        │
                                                        ▼
Wave 4 MOBILE & REPORTING  ◄──  Wave 3 FINANCIAL CLOSE
```

| # | Wave | Status | PRD modules | Phase file |
|---|------|--------|-------------|------------|
| 0 | Foundation: shipments + scheduler | ⏳ Pending | M3.1, M4.1 (partial) | [`phase-01`](plans/silversea-prd-roadmap/phase-01-wave-0-foundation.md) |
| 1 | Pricing & Fuel Data Layer | ⏳ Pending | M2, M12.1, M12.3 | [`phase-02`](plans/silversea-prd-roadmap/phase-02-wave-1-pricing-fuel-data-layer.md) |
| 2 | CUS Core & Customer Portal | ⏳ Pending | M3 (rest), M4.5 | [`phase-03`](plans/silversea-prd-roadmap/phase-03-wave-2-cus-core-customer-portal.md) |
| 3 | Financial Close | ⏳ Pending | M5, M6, M7.3, M4.6/4.7 | [`phase-04`](plans/silversea-prd-roadmap/phase-04-wave-3-financial-close.md) |
| 4 | Mobile & Director Reporting | ⏳ Pending | M8, M10, M11, M12.2 | [`phase-05`](plans/silversea-prd-roadmap/phase-05-wave-4-mobile-director-reporting.md) |

**Status legend:** ⏳ Pending · 🚧 In Progress · ✅ Done · ⛔ Blocked

**Why this order:** Foundation first (shipment entity is the keystone), then pricing/fuel
(because garbage-in-garbage-out for all P&L downstream), then CUS (customer-facing
differentiator), then financial close (relies on clean shipment + pricing data), then
mobile/reporting polish (builds on the closed loop).

---

## ✅ Wave 0 — Foundation

**Goal:** introduce the `shipments` entity + scheduler that every later wave depends on.
**Safe to start without PRD sign-off** — both pieces are pure foundation.

### Items

- [ ] Add `shipments`, `shipment_documents`, `shipment_declarations`,
      `shipment_status_history` tables + `trips.shipmentId` FK. `drizzle-kit generate`.
- [ ] Add `CUSTOMER` and `CLERK` to `roleEnum`; update `casbin/policy.csv` + enforcer.
- [ ] Build `shipment.service.ts` (CRUD, status transitions, container snapshot into trips).
- [ ] Build `routes/shipments.ts`: list, detail, create (draft), update, dispatch (→ trip),
      status transitions, document upload, container upsert.
- [ ] Refactor trip creation to set `shipmentId`; back-compat auto-shipment path + feature
      flag `SHIPMENT_FIRST_CREATE`.
- [x] Build scheduler skeleton: `scheduler/registry.ts`, `runner.ts`, `scheduler_run_logs`,
      boot in `index.ts`. ✅ Wave 0 done — see `backend/src/scheduler/` +
      migration `0111_peaceful_lenny_balinger.sql` + tests in
      `backend/src/tests/scheduler.test.ts` (15 tests, all pass).
- [ ] Frontend: minimal `ShipmentsPage` + `ShipmentDetailPage`; route in `App.tsx`.
      (Full CUS UI comes in Wave 2.)
- [ ] Seed test shipments + a `CUSTOMER`-role user for QA.
- [ ] Audit-log every shipment write.
- [ ] Row-scope helper `scopedByCustomer(req.user, query)` — reusable in Waves 2 & 3.

### Open PRD questions (block Wave 2+, not Wave 0)

- M3.1 §1: which fields mandatory at shipment creation vs. before dispatch?
- M3.1 §2: confirm 1 BL → N containers (assumed yes).
- M3.1 §3: declaration per container or shared? (default: per container, shared on approval)
- M3.1 §5: shipment-code format (proposed `{customerCode}-{YYMMDD}-{NNN}`).

---

## ✅ Wave 1 — Pricing & Fuel Data Layer

**Goal:** close the revenue/fuel-correctness gap before any financial-close wave touches P&L.
**Blocks:** Waves 3, 4.

### Items

- [ ] Schema: `weight_pricing_tiers`, `lift_pricing`, `ancillary_revenue`, `fuel_norms` +
      trip pricing-snapshot columns. Generate migration.
- [ ] Build `pricing.service.ts` with `resolveFreightPrice` + overlap validators.
- [ ] Build `fuel.service.ts` with `resolveFuelNorm(routeId, truckTypeId, date)`.
- [ ] Wire auto-revenue into trip create/update; surface formula in trip detail.
- [ ] M2.1: prevent price-range overlaps on `pricing_tables`; override-before-lock + reason.
- [ ] M2.2: weight-tier pricing for bulk cargo; boundary + overlap tests.
- [ ] M2.3: auto-revenue from lot weight, visible formula `weight × price + surcharges + VAT`.
- [ ] M2.4: lift/up-down catalog `lift_pricing` (port × type × direction × date); show
      suggested/actual/delta on expense entry.
- [ ] M2.5: ancillary revenue CRUD; refunds via negative amounts with reason; no silent edits.
- [ ] M12.1: extend `fuel_config` to per-route/per-truck-type norms; mountain flat-rate.
- [ ] M12.3: extend `ocr.service.ts` with pump-photo recognition; `POST /api/ocr/pump`;
      cross-check litres × price ≈ total; mismatch → manual fallback.
- [ ] Frontend config pages for the 4 new catalogs + trip formula breakdown.
- [ ] Regression: existing trip P&L still reconciles.

### Open PRD questions

- M2.2 §3: rounding rule for weight-tier pricing (PRD leaves open).
- M2.2 §6: default unit tonnes; what if entry is in kg?
- M2.4 §6: handling port price change mid-day.
- M2.5 §1: confirm LCL / consolidation / service-diff / other is the complete set.
- M12.1 §1: per-truck-type norms needed, or per-route enough?
- M12.1 §5: mountain flat-rate behaviour + per-driver exceptions?
- M12.3 §6: what counts as "trustworthy" photo metadata (EXIF GPS? phone geotag?).

---

## ✅ Wave 2 — CUS Core & Customer Portal

**Goal:** build the missing CUS-operator workflow and the customer-facing portal — the
biggest new surface area and the biggest customer-facing differentiator.
**Depends on:** Waves 0, 1.

### Items

- [ ] Schema: shipment milestone timestamps; debit-note status enum extension; new
      `customer_email_logs` table.
- [ ] M3.2: ISO 6346 container-number check-digit validator; shared-declaration override
      flow; expired-DO blocks dispatch; replacing a doc keeps history.
- [ ] M3.3: milestone service deriving from trip status; manual CUS notifications preserving
      history; cross-customer isolation.
- [ ] Email service + provider (Resend/SES); wire to Wave-0 scheduler for retries.
- [ ] M3.4: three-party delivery confirm (driver / CUS / customer); partial delivery per
      container; free-time overrun calc + fee warning.
- [ ] M3.5: extend `billingDocument.service.ts` to assemble lines from approved expenses +
      freight snapshot + ancillary revenue; per-customer template; VAT per line.
- [ ] M3.5: unapproved disbursement excluded from official doc; pending list shown.
- [ ] M3.5: re-issue guard — warn on duplicate range; no double-issue.
- [ ] M3.6: debit-note statuses DRAFT/SENT/PENDING_CONFIRM/CONFIRMED/PARTIAL_PAID/PAID/
      REJECTED/CANCELED; lock after customer confirm; adjustment-document flow for changes.
- [ ] M3.6: overpayment handling — don't drive AR negative silently.
- [ ] M3.7: configurable disbursement catalog with per-type invoice-required rule.
- [ ] M4.5: only approved disbursements enter the right period; never on two debit notes;
      late-approved → roll to next period or adjustment.
- [ ] Customer portal frontend: `/portal/*` route tree; shipment list/detail, debit-note
      list/confirm/dispute, statement download, optional two-way messaging.
- [ ] PDF export for debit notes (extend statement.service.ts PDF path).
- [ ] Cross-customer isolation integration tests (every portal endpoint, A's token vs B's IDs).

### Open PRD questions

- M3.1 §1: which shipment fields mandatory at creation vs. before dispatch?
- M3.3 §1: customer portal primary channel, email fallback? (assumed yes)
- M3.3 §4: two-way messaging in v1, or notifications + ack only?
- M3.3 §5: real-time vehicle location in portal during transit only? (assumed)
- M3.4 §3: provide the free-time rules table (customer × port × carrier × type).
- M3.5 §1: per-shipment vs. per-period default per customer?
- M3.5 §3: per-customer template customisation (logo, payment info, columns, signers)?
- M3.6 §3: payment-allocation default rule (oldest-first proposed)?
- M3.7 §2: which disbursement types mandatorily require an invoice?
- M4.5 §6: period definition (weekly vs. monthly) per customer + cross-period rule?
- Customer portal: authentication method (email+password / SSO / magic link)?

---

## ✅ Wave 3 — Financial Close

**Goal:** close the accountant-side loop. Mostly *extending* existing engines, not greenfield.
**Depends on:** Waves 0, 1, 2.

### Items

- [ ] Schema: `customers.creditWarningThreshold` + `paymentTermDays`; new
      `payment_allocations`; `supplier_type` on suppliers; new `salary_period_closes`;
      `expense_categories.requiresInvoice` + `substituteEvidenceAllowed`.
- [ ] M5.1: surface paid/outstanding/overdue-days/payment-history per document; void leaves
      offsetting line.
- [ ] M5.3: credit-limit + threshold service; block on exceed unless approver override.
- [ ] M5.4: freight/disbursement/other split report; invariant
      `freight + disbursement + other == total_ar`.
- [ ] M5.5: total AR report — opening/activity/receipts/adjustments/closing per customer;
      zero-activity-with-balance still appears.
- [ ] M5.6: `payment-allocation.service.ts`; one receipt → many shipments/trips; default
      oldest-first; cannot over-allocate.
- [ ] M5.7: reminder scheduler job (Wave-0 scheduler) + email (Wave-2) + in-app; skip
      paid/disputed/suspended; no duplicate in cycle.
- [ ] M5.8: PDF export for debit notes (match screen ↔ export).
- [ ] M6.1: fuel-AP reconciliation report (fuel invoices ↔ trip fuel by truck/period);
      variance blocks approval until explained.
- [ ] M6.2: supplier-type taxonomy (CARRIER/PORT/WAREHOUSE/SHIPPING_LINE/CUSTOMS/SERVICE/FUEL).
- [ ] M6.3: AP aging (mirror of AR); partial payment; no double-record of same payment ref;
      overpayment stays unallocated.
- [ ] M6.4: verify existing `debt_offsets` against M06-04 rules (offset ≤ smaller side;
      booked only after approval; cancel-after-approve uses reversal).
- [ ] M7.3: salary period-close service + endpoint; idempotent; single ledger entry; lock.
- [ ] M4.6: invoice-required categories enforce full invoice data before approval.
- [ ] M4.7: no-invoice items permitted only for allowed categories; over-threshold routes
      to approval; report separates and traces to approver.
- [ ] Reconciliation tests: AR sum = ledger sum; AP sum = ledger sum; salary close posts once.

### Open PRD questions

- M5.3 §1: credit-warning threshold default (80%? per customer?).
- M5.3 §5: who can approve an over-limit exception?
- M5.4 §5: allocation rule for unallocated payments (proportional / oldest-first / freight-priority)?
- M5.7 §4: reminder frequency + quiet-hours; email vs. in-app priority?
- M6.1 §1: fuel invoices per-truck or aggregated?
- M6.2 §1: supplier-type taxonomy + can a supplier have multiple types?
- M7.3 §1: period close per-driver or per-company-period? (assumed per-company)
- M4.7 §2: which categories permit substitute evidence + what counts as evidence?
- M4.7 §5: over-threshold rule (auto-reject vs. route-to-approval)?

---

## ✅ Wave 4 — Mobile & Director Reporting

**Goal:** polish role-specific mobile (driver M8, clerk M10) + complete director reporting
(M11.2/11.4/11.5) + monthly fuel reconciliation (M12.2). Builds on the closed loop.
**Depends on:** Waves 0, 1, 2, 3.

### Items

- [ ] Schema: new `dispatch_handoffs` table (UNSEEN/SEEN/ACCEPTED + handler + version).
- [ ] M10.3: handoff service + notification on handoff; version-conflict warning.
- [ ] M10.1: clerk router + mobile quick-shipment-create page.
- [ ] M10.2: clerk doc-entry page; format + duplicate checks; mandatory fields before dispatch.
- [ ] Offline-queue client lib (`idb-keyval`) + idempotent sync endpoint; client-gen request
      id + server dedupe table.
- [ ] M8.3: driver two-orders-per-day view; warn when first order late.
- [ ] M8.4: progress + incidental-cost update; offline-safe; mandatory evidence before
      completion.
- [ ] M8.5: ensure driver must confirm/edit OCR result before save (already exists).
- [ ] M8.6: driver payslip view — own issued periods only; adjusted period shows both
      versions + reason; line links to basis.
- [ ] M8.1: mobile UX pass across driver + clerk + forwarder pages — touch targets, font
      scaling, slow-network states (target device matrix only).
- [ ] M11.2: per-truck P&L report; truck-specific costs only; shared costs in separate
      "unallocated" bucket; no-trip-with-costs still listed.
- [ ] M11.4: payment-term evaluation report; per-portion for partial payments; no negative
      days for pre-payments.
- [ ] M11.5: director dashboard widgets — cash flow, two-way-cargo ratio, fleet attention
      list; period-over-period; drilldown per KPI.
- [ ] M12.2: monthly fuel reconciliation report — by truck × supplier × period; variances;
      no double-count invoices; advisory first.
- [ ] E2E smoke test: shipment → trip → expense → debit note → payment → P&L → dashboard.

### Open PRD questions

- M8.1 §1: target device matrix (phone models / screen sizes / OS versions)?
- M8.3 §3: late-first-order warning threshold (minutes? GPS-based?)?
- M8.4 §3: which evidences mandatory before completion (photo / signature / GPS)?
- M10.1 §1: minimum data set for a quick-draft shipment?
- M10.3 §3: can multiple dispatchers accept the same handoff, or only one?
- M11.2 §3: cost-allocation policy (what is truck-specific vs. shared)?
- M11.4 §3: payment-term eval per-invoice or averaged per customer?
- M11.5 §3: exact KPI list + each KPI's definition?
- M12.2 §4: do credit notes net against the original invoice in the same period?

---

## 🔑 Cross-cutting open questions (every module, every wave)

These come from every module's "Câu hỏi dùng chung cần chốt" and govern schema/policy
everywhere. Track separately with the customer:

1. **Roles & permissions** — confirm creators/checkers/approvers/view-only per module. Need
   `CUSTOMER` and `CLERK` roles + per-customer data scoping (Wave 0 introduces them).
2. **Catalog master data** — confirm initial catalogs (customers, suppliers, ports, routes,
   container types, expense categories, pricing tables, fuel norms) + owner + delivery
   deadline before trial data entry.
3. **Date/time & periods** — Vietnam TZ confirmed; need weekend/holiday handling, cross-day
   trips, and period-close (`khoá kỳ`) rules for salary/billing/fuel.
4. **Notifications** — confirm events/recipients/channels/failure handling. Today: in-app +
   web-push only. M3 wants customer portal channel; M5.7 wants scheduled email (needs email
   provider + Wave-0 scheduler).
5. **Attachments & exports** — file types, size limits, retention, who may download,
   official templates (debit-note, statement, salary slip, fuel voucher). Most exist as
   ExcelJS; PDF partial (statements only).
6. **Historical data** — scope of legacy import, opening-balance verification, who confirms.
   Drives whether a one-off import script is part of Wave 0 or separate.
7. **Cross-module integration** — confirm input/output + sync timing for each module pair to
   avoid double entry or number drift (esp. trip ↔ shipment ↔ expense ↔ debit-note ↔ ledger).
8. **Post-deployment support** — contact, issue intake, priority levels, evidence of fix.

---

## 🧭 Quick links

- Detailed plan index: [`plans/silversea-prd-roadmap/plan.md`](plans/silversea-prd-roadmap/plan.md)
- Wave 0: [`phase-01`](plans/silversea-prd-roadmap/phase-01-wave-0-foundation.md)
- Wave 1: [`phase-02`](plans/silversea-prd-roadmap/phase-02-wave-1-pricing-fuel-data-layer.md)
- Wave 2: [`phase-03`](plans/silversea-prd-roadmap/phase-03-wave-2-cus-core-customer-portal.md)
- Wave 3: [`phase-04`](plans/silversea-prd-roadmap/phase-04-wave-3-financial-close.md)
- Wave 4: [`phase-05`](plans/silversea-prd-roadmap/phase-05-wave-4-mobile-director-reporting.md)
- Dev commands: `make dev` (everything) · `make setup` (first time) · `make studio` (Drizzle GUI)
- PRD source: `docs/prd/Module1.docx` … `Module12.docx`
