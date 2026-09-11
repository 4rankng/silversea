---
name: "prd-roadmap-and-decisions"
description: "PRD structure, O2C business flow (CUS→dispatch→driver, e-POD, Hoàn thành chuyến), locked decisions (shipments keystone, all 23 Q&A proposals accepted 2026-07-27, Q15-Q23 rules), wave status snapshot"
folder: "features"
tags: ["prd", "roadmap", "business-logic", "o2c", "decisions"]
updatedAt: "2026-09-09T18:09:02.844Z"
author: "AI Engineer"
---

# PRD roadmap & business decisions (migrated from ROADMAP.md + docs/prd, 2026-09-10)

## Architecture (product)

Silversea (TingTing) logistics platform built from a 12-module Vietnamese PRD (`docs/prd/archive/Module1..12.docx`). Operational flow spec: `docs/prd/QuyTrinhO2C.md` — **O2C: Chứng Từ (documents/CUS) → Điều Vận (dispatch) → Lái Xe (driver)**:
- CUS creates shipment lots (auto-freight-calc), enters containers/loose cargo, hands to dispatch.
- Dispatch: master plan (allocate own-truck vs external carrier) → detailed plan (assign plate + driver per row) → Phát lệnh (issue order; checks truck/trailer/schedule) → push notification to driver.
- Driver: receive order → pickup/load/deliver → record expenses + fuel → submit e-POD (2 mandatory photos) → "Hoàn thành chuyến" (auto-sends e-POD + fills missing milestones; trip COMPLETED; flips revenue/AP/AR + busts report caches).
- Shipment completes when all its trips complete (hồ sơ chờ chốt — no accountant gate). CUS approves e-POD + confirms original-doc recovery → hồ sơ locked; rejected e-POD → driver resubmits (trip stays completed).
- Shipment lifecycle: Chờ chốt lịch → Sẵn sàng điều xe → Đã phân xe → Đang chạy → Hoàn thành / Đã hủy.

## Decisions (locked)

- **PRD reality check:** the PRD is a survey/confirmation document, NOT an approved spec — every module has TingTing's proposal column filled but the customer-response column empty. **Exception: all 23 cross-cutting business-logic Q&A proposals (Q01–Q23, 2026-07-26) were ACCEPTED by SilverSea as-written on 2026-07-27 and are now authoritative requirements.** Key ones: Q15 maker/checker/approver separation for money, no self-approval; Q16 one legal entity per CUSTOMER account; Q18 approved/locked data never edited in place — adjustment/undo only with reason + before/after + actor + approver; Q19 payment dates roll to next workday but original date kept+shown; Q20 revenue/salary/count/P&L → completion-date period, attendance/fuel/expenses → event date; Q21 salary+fuel lock monthly, debit-note lock = payment cycle; Q22 source-of-truth table per data type (shipment=customer+goods+containers, trip=truck+driver+time+status, approved expense=cost, debit-note=AR, receipt+allocation=paid); Q23 idempotency keys on every write, duplicate submit returns original result, first-wins approvals, `version` optimistic locking.
- **Shipments keystone (Wave 0, locked):** the domain is shipment-centric, not trip-centric. A first-class `shipments` entity (booking docs, containers, declarations; a trip is a fulfillment of part of a shipment) was introduced in Wave 0 and unblocks M3/M4/M5.6/M9/M10.
- Vietnamese labels/errors throughout; optimistic locking via `version`; every write audited (`audit_logs`); Casbin RBAC gates every route.

## State (as of migration — verify live before relying)

- Wave order: 0 Foundation (shipments + scheduler) → 1 Pricing & Fuel → 2 CUS Core & Portal → 3 Financial Close → 4 Mobile & Director Reporting. Wave 0 confirmed done; the roadmap's own wave-status table still showed 1–4 "Pending" while section headings were marked done — treat per-module coverage as stale and verify against code. A 27-row evidence matrix (`docs/prd/overall-business-workflow-alignment.md`) was the 2026-08-03 authority for remaining work; it and `business-logic-qa-proposals.md` live in the main silversea repo — NOT present in this prod checkout.
- Module coverage snapshot (roadmap-era): M1 overview/dispatch largely done; M2 freight+non-transport revenue partial (weight-tier pricing, auto-revenue, lift catalog gaps); M3 CUS + customer portal was missing then built; M4 disbursement/receipt largely done; M5 AR partial; M6 AP partial; M7 salary period close partial; M8/M10/M11 mobile+reporting late waves.
- Much has shipped since (see [[test-debt-and-db-lean-down]] and git history): trips split, governance direct-apply, PENDING_EXPENSE_APPROVAL retirement, responsive space-utilisation program ([[responsive-space-utilisation]]).

## Pitfalls

- The roadmap file referenced phase files under `plans/silversea-prd-roadmap/` and several `docs/prd/*.md` indexes that do not exist in this prod checkout — don't dead-link; check the main silversea repo or git history.
- PRD proposals with `pending` status are NOT approved requirements; plans describe intent, code + green QA establish implemented behavior ([[agent-working-contract]] authority order).
