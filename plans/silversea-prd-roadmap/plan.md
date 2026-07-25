---
title: "Silversea PRD Roadmap — 12-module implementation order"
description: "Roadmap-level implementation order for the 12-module Silver Sea logistics PRD, sequenced by dependency and revenue-correctness risk. Each wave lists PRD modules touched, key deliverables, and the open PRD questions that must be confirmed before that wave starts."
status: pending
priority: P1
branch: "main"
tags: [prd, roadmap, logistics, silversea]
blockedBy: []
blocks: []
created: "2026-07-25T01:49:42.937Z"
createdBy: "ck:plan"
source: skill
---

# Silversea PRD Roadmap — 12-module implementation order

## Overview

This plan sequences the 12-module Silver Sea (TingTing) logistics & freight-forwarding
PRD into 5 dependency-ordered waves. It is intentionally **roadmap-level**: each phase
lists the PRD modules touched, the key deliverables, the existing code it builds on, and
the open PRD questions that must be confirmed with the customer before the wave starts.

This is **not** a per-task build plan. Per-wave detailed plans (schema, routes, acceptance-
criteria traceability) are produced separately once (a) the customer has filled in the
"Ghi nhận của Silver Sea" response columns and (b) Wave 0 has landed.

### Source material

- PRD modules: `docs/prd/Module1.docx` … `docs/prd/Module12.docx` (Vietnamese, 12 modules,
  each structured as info → terms → scope → per-feature {need/questions/acceptance/
  conclusion} → shared-questions → system-wide-acceptance).
- Customer: Công ty TNHH Thương mại và Dịch vụ Silver Sea.
- Basis: Báo giá TTransport cho Silver Sea — Phiên bản 2, 20/07/2026.
- Working version 1.0; dated 21/07/2026.

### Critical reality check

**The PRD is a survey/confirmation document, not an approved spec.** In all 12 modules the
"Đề xuất của TingTing" (TingTing proposal) column is populated but the
"Ghi nhận của Silver Sea" (customer response) column is **empty**. The proposals become
formal requirements only after Silver Sea signs off. Treat all wave contents as proposed
until confirmed.

### Current codebase coverage (already built)

The repo is a working Express 5 + Drizzle/Postgres + React/Vite monorepo with ~40 tables,
Casbin RBAC, JWT auth, GPS capture, an AI chatbot, and forwarder/driver portals. Significant
PRD scope is already implemented:

- **M1** trip CRUD/fleet/dashboard/P&L-per-trip/lock+audit — largely done.
- **M4** trip-expense + approval workflow, forwarder settlements — largely done.
- **M5** ledger, AR aging, customer/supplier statements, debt list, payments — largely done.
- **M6** supplier ledger, payments, debt offsets, fuel price history — partly done.
- **M7** salary calc, attendance calendar, salary confirmations, penalties — partly done.
- **M8** driver portal backend + React pages — partly done.
- **M9** forwarder portal backend + React pages — largely done.
- **M11** P&L, dashboard, advance report, **AI chatbot (=11.6)** — largely done.
- **M12** fuel config, price history, fuel voucher — partly done.

The real gaps concentrate in **M2 (pricing rules), M3 (CUS + customer portal), M10 (clerk
app), and the close/report pieces of M5/M6/M7/M11/M12.** See each phase for the gap list.

### Architectural keystone: introduce a Shipment/Lot entity

Today the system is **trip-centric**. But M3, M4, M9, M10 all centre on a *shipment* (lô hàng)
that precedes and outlives any single trip: booking → documents → dispatch → delivery →
debit-note. Reusing `trips` for this fights the domain (one shipment often spans multiple
trips; a booking exists before any trip is created). Wave 0 therefore introduces a first-class
`shipments` entity. This decision is locked; the wave-0 phase file designs it.

## Wave ordering (dependency-driven)

```
Wave 0 FOUNDATION  ──►  Wave 1 PRICING & FUEL  ──►  Wave 2 CUS CORE
                                                        │
                                                        ▼
Wave 4 MOBILE & REPORTING  ◄──  Wave 3 FINANCIAL CLOSE
```

| # | Wave | PRD modules | Why this order |
|---|------|-------------|----------------|
| 1 | **Wave 0 — Foundation** | M3.1, M4.1 (partial) | Introduces `shipments` entity + scheduler infra. Blocks M3, M4, M5.6, M9, M10. Safe to start regardless of which PRD items get confirmed. |
| 2 | **Wave 1 — Pricing & Fuel Data Layer** | M2 (all), M12.1, M12.3 | Revenue and fuel figures feed every downstream P&L. Garbage in = garbage out. Must be correct before financial close. |
| 3 | **Wave 2 — CUS Core & Customer Portal** | M3 (rest), M4.5 | Customer-facing value; depends on shipments + debit-note generation. |
| 4 | **Wave 3 — Financial Close** | M5, M6, M7.3, M4.6/4.7 | Relies on clean shipment + pricing data from Waves 0–2. |
| 5 | **Wave 4 — Mobile & Director Reporting** | M8, M10, M11, M12.2 | Builds on the closed loop; reporting & mobile polish come last. |

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Wave 0 Foundation](./phase-01-wave-0-foundation.md) | Pending |
| 2 | [Wave 1 Pricing & Fuel Data Layer](./phase-02-wave-1-pricing-fuel-data-layer.md) | Pending |
| 3 | [Wave 2 CUS Core & Customer Portal](./phase-03-wave-2-cus-core-customer-portal.md) | Pending |
| 4 | [Wave 3 Financial Close](./phase-04-wave-3-financial-close.md) | Pending |
| 5 | [Wave 4 Mobile & Director Reporting](./phase-05-wave-4-mobile-director-reporting.md) | Pending |

## Dependencies

Internal to this plan: strict wave order — each wave depends on the previous (see each
phase's `dependencies:` frontmatter and `Risk Assessment`).

External cross-plan dependencies: none (no other plans in `./plans/` at creation time).

Upstream blocker on **all** waves: customer sign-off on the per-module PRD response columns.
Track in `## Open PRD questions` per phase.

## Open PRD questions (cross-cutting — must be confirmed with Silver Sea before any wave)

These come from every module's "Câu hỏi dùng chung cần chốt" and recur identically across
M1–M12. They govern schema and policy decisions everywhere:

1. **Roles & permissions** — confirm who creates / checks / approves / view-only in each
   module. Today's Casbin policy has 5 roles (ADMIN/MANAGER/ACCOUNTANT/DRIVER/FORWARDER).
   M3 introduces a customer-side user; M10 a clerk role. Need: a `CUSTOMER` and possibly
   `CLERK` role, plus per-customer data scoping rules.
2. **Catalog master data** — Silver Sea to confirm the initial catalog (customers, suppliers,
   ports, routes, container types, expense categories, pricing tables, fuel norms), the owner
   of each, and the deadline to deliver before trial data entry.
3. **Date/time & business periods** — Vietnam timezone confirmed; still need: weekend/holiday
   handling, cross-day trips, and period-close (khoá kỳ) rules for salary, billing, fuel.
4. **Notifications** — confirm which events notify, recipients, channels (in-app / email /
   push), and failure handling. Today: in-app + web-push only. M3 wants a customer portal
   channel; M5.7 wants scheduled email reminders (needs an email provider + scheduler).
5. **Attachments & exports** — file types, size limits, retention, who may download, official
   templates (debit-note, statement, salary slip, fuel voucher). Most templates exist as
   ExcelJS renderers; PDF export is partial (statements only).
6. **Historical data** — scope of legacy data to import, opening-balance verification, who
   confirms. Drives whether a one-off import script is part of Wave 0 or a separate effort.
7. **Cross-module integration** — confirm input/output data and sync timing for each module
   pair to avoid double entry or number drift (esp. trip↔shipment↔expense↔debit-note↔ledger).
8. **Post-deployment support** — contact, issue intake, priority levels, evidence of fix.

## How to use this plan

- Run `/ck:plan status plans/silversea-prd-roadmap` to see wave state.
- Before starting a wave, run a focused `/ck:plan` for that wave to produce a detailed
  phase file with schemas, routes, and PRD acceptance-criteria traceability.
- Do **not** start Wave 1+ until the customer has signed off on that wave's open PRD
  questions (listed in each phase file).
