Implementation Plan — Service Costs, External Carrier & Debt Netting

 ▎ Deliverable: this content will be written to docs/plans/service-cost-partner-vendor/pending-tasks.md after
 ▎ approval, so independent agents can pick up each task without misaligning with the big picture.

 Context

 The TingTing TMS today only records core freight + own-truck (xe nhà) costs. Three capabilities are missing and cause
 per-trip / per-vehicle P&L to be wrong and AR/AP to be overstated:

 1. Chi phí dịch vụ đi kèm (ancillary service costs) — port/depot fees with a buy (mua vào) and sell (bán ra) side;
 service margin; goes on the giấy báo nợ.
 2. Điều động xe ngoài (external carrier dispatch) — a trip fulfilled by a hired partner; we owe them freight, keep
 the management margin.
 3. Đối trừ công nợ (debt netting) — dual-role partners that are both customer (AR) and party we owe (AP).

 Exploration verdict: clean slate — none of the three features exist in code yet. The flow docs (PRODUCT-SPECS.md,
 docs/flows/) were written ahead of implementation. What already exists and we build on: forwarder_expense_types
 config table, suppliers/expense_categories, AP/payables (VENDOR_EXPENSE/VENDOR_PAYMENT), LedgerService
 (postEntry/lockEntity/postTripLock with CUSTOMER/DRIVER/VENDOR/FORWARDER sign conventions), basic trip_expenses
 (single amount), forwarder portal Phase 1, Drizzle Kit migrations (latest 0029_*).

 Authoritative business source: docs/plans/service-cost-partner-vendor/BOI_CANH_va_MUC_TIEU_tinh_nang_NePO.md +
 PLAN_service_costs_external_carrier_netting_REVISED.md.

 Customer-confirmed decisions (Pete, 02/06/2026) — these override the REVISED plan where they differ

 - D-A — Advance buy-side (long-term): Ancillary fees settled FORWARDER_ADVANCE post a FORWARDER_ADVANCE ledger entry
 against the forwarder's advance balance at lock (entity_type='FORWARDER', which already exists). This is the
 foundation the Phase-2/3 advance top-up + settlement subsystem layers onto. COMPANY_DIRECT fees post supplier AP
 (VENDOR_EXPENSE). Sell side always increases the customer AR.
 - D-B — Giấy báo nợ: Formal PDF company-form template (not just Excel). Blocker: needs the company's real giấy báo nợ
 sample/form — flag for the user before building the PDF layout.
 - D-C — Approval (long-term): Build a generic reusable approval mechanism (approval_status + an approvals audit
 table). BOI_CANH §7: "mọi bút toán tài chính cần được duyệt". This batch applies it to debt offsets and
 forwarder-entered ancillary-fee edits; phiếu thanh toán hooks in later.
 - D-D — External carrier P&L line: New txn_type EXTERNAL_CARRIER_COST ("cước vận chuyển thuê ngoài") so reports
 separate it from ordinary vendor expenses. Pete: a carrier only supplies freight, not parts/materials/fuel — it
 deserves its own line.
 - D-E — Carrier master lives in Customers, NOT Suppliers: trips.external_carrier_id references customers(id).
 Carriers are flagged customers (customers.is_carrier). Keep the Suppliers catalog free of carriers.
 - D-F — Carrier payable on the customer ledger: What we owe a carrier posts as a CREDIT on that carrier's CUSTOMER
 ledger (EXTERNAL_CARRIER_COST, entity_type='CUSTOMER', credit = external freight incl-VAT). Existing CUSTOMER sign
 rule balance += debit − credit makes a negative balance = we owe them; netting is automatic via running balance.
 Aging reports must treat negative customer balances as "we owe them," not overdue receivable.

 ▎ Note the split: carrier-as-customer nets automatically on one ledger (D-F). The explicit debt_offsets mechanism
 ▎ (Feature 3) is still needed for the other dual-role case — an NCC/supplier that is also a customer (e.g. a garage),
 ▎ where AR sits on a CUSTOMER entity and AP on a separate VENDOR entity.

 Cross-cutting model rules (apply in every task)

 - VAT: trips.vat_rate (NUMERIC, default 0.000; prefilled from customer default). Entered customer freight is
 incl-VAT; ex-VAT = freight / (1 + vat_rate). AR uses incl-VAT; P&L (DT xe) uses ex-VAT. Existing rows default
 vat_rate=0 → behavior unchanged. Fee VAT is also configurable (8%, may rise to 10%).
 - Ledger is append-only. All posting via LedgerService.postEntry inside db.transaction; corrections via compensating
 ADJUSTMENT. Never UPDATE/DELETE ledger rows.
 - camelCase API ↔ snake_case DB handled by Drizzle field defs; keep request/response bodies camelCase.
 - Conventions: routes wrap handlers in asyncHandler, validate with Zod (shared/src/schemas), call services inside
 db.transaction(async tx => …); mount with authMiddleware + casbinAuthz('<resource>'); add Casbin rules in
 backend/src/casbin/policy.csv. Migrations: edit backend/src/db/schema.ts then npm run db:generate + npm run
 db:migrate. Financial precision via round2dp() / computeTripTotals() in shared/src/calculations.

 Dependency graph

 Phase A (foundation, mostly sequential)
   A1 schema+migration ─┬─> A2 shared types/schemas/enums ─┬─> A4 computeTripTotals calc+tests
                        └─> A3 generic approval mechanism  │
 Phase B (backend services; parallel after A)
   B1 ancillary fee service + config(default_markup/billing_label/seed)
   B2 lockTrip branching (settlement + external carrier posting)   [needs A4,B1]
   B3 debt-offset endpoints + approval wiring                       [needs A3]
   B4 per-vehicle P&L (serviceMargin/externalMargin/carrier bucket) [needs A4]
 Phase C (frontend; parallel after the B endpoint contracts exist)
   C1 trip form: carrier toggle + external fields + VAT + ancillary grid; TripDetail display
   C2 forwarder portal expense form upgrade (buy/sell/settlement/invoice/declaration)
   C3 customers (is_carrier, debit_note_mode, linked_supplier_id) + suppliers (linked_customer_id)
   C4 debt-netting UI (dual badge, DebtOffsetModal, bảng đối chiếu)
   C5 FinancePage P&L lines
 Phase D
   D1 giấy báo nợ PDF (company form)  [needs company sample form]
   D2 integration + unit tests

 ---
 Phase A — Foundation

 A1 — DB schema + migration

 Goal: add every column/table the three features need in one schema pass.
 Files: backend/src/db/schema.ts; generate migration in backend/drizzle/ (npm run db:generate → review → npm run
 db:migrate).
 Changes:
 - trips: vat_rate NUMERIC(5,3) NOT NULL DEFAULT 0.000; carrier_type VARCHAR(20) NOT NULL DEFAULT 'OWN'
 ('OWN'|'EXTERNAL'); external_carrier_id INTEGER REFERENCES customers(id) (nullable — customers, per D-E);
 external_freight_cost NUMERIC(15,0) (incl-VAT); external_plate_number VARCHAR(20); external_driver_name VARCHAR(100);
 external_driver_phone VARCHAR(20).
 - trip_expenses: migrate amount → buy_amount NUMERIC(15,0); add sell_amount NUMERIC(15,0) DEFAULT 0; supplier_id
 INTEGER REFERENCES suppliers(id) (nullable); settlement_method VARCHAR(20) NOT NULL DEFAULT 'FORWARDER_ADVANCE'
 ('COMPANY_DIRECT'|'FORWARDER_ADVANCE'); invoice_number VARCHAR(50); invoice_date DATE; declaration_number
 VARCHAR(50); container_number VARCHAR(20); approval_status VARCHAR(20) NOT NULL DEFAULT 'APPROVED' (see A3). Keep
 expense_type FK to forwarder_expense_types.code.
 - forwarder_expense_types: add default_markup BOOLEAN DEFAULT false; billing_label VARCHAR(120) (label shown on giấy
 báo nợ, may differ from internal name); vat_rate NUMERIC(5,3) DEFAULT 0.080.
 - customers: is_carrier BOOLEAN NOT NULL DEFAULT false; debit_note_mode VARCHAR(20) NOT NULL DEFAULT 'MONTHLY'
 ('MONTHLY'|'PER_BATCH'); linked_supplier_id INTEGER REFERENCES suppliers(id) (nullable).
 - suppliers: linked_customer_id INTEGER REFERENCES customers(id) (nullable).
 - debt_offsets table: id, customer_id FK, supplier_id FK, amount NUMERIC(15,0), offset_date DATE, note TEXT,
 approval_status VARCHAR(20) DEFAULT 'PENDING', created_by, approved_by, created_at. Indexes on customer_id,
 supplier_id.
 - txn_type enum: add EXTERNAL_CARRIER_COST (Drizzle: ALTER TYPE "txn_type" ADD VALUE … like migration 0001).
 - Index: CREATE INDEX trips_container_idx ON trip_expenses(container_number); (container-centric retrieval, REVISED
 §2.2).
 Migration care: amount → buy_amount rename + backfill sell_amount=0, settlement_method='FORWARDER_ADVANCE', backfill
 container_number from trip where possible. Existing trips default carrier_type='OWN', vat_rate=0.
 Acceptance: npm run db:migrate clean; npm run db:studio shows all columns; existing seed still loads.

 A2 — Shared types, Zod schemas, enums

 Goal: mirror A1 in the shared package so backend + frontend share one contract.
 Files: shared/src/types/index.ts (Trip ~160-212, TripExpense ~445-453, PnlTruck ~628-636),
 shared/src/schemas/index.ts (tripExpenseSchema ~388-393, updateTripFiguresSchema ~70-102), shared constants (txn
 types, route consts).
 Changes:
 - Trip: add vatRate, carrierType, externalCarrierId, externalFreightCost, externalPlateNumber, externalDriverName,
 externalDriverPhone.
 - TripExpense: add buyAmount, sellAmount, supplierId, settlementMethod, invoiceNumber, invoiceDate,
 declarationNumber, containerNumber, approvalStatus. Keep expenseType.
 - New DebtOffset type; ApprovalStatus union; SettlementMethod union; CarrierType union.
 - Expand ancillary fee enum to the 8 codes (LIFTING, LOWERING, WEIGHING, CUSTOMS, INFRASTRUCTURE, INSPECTION,
 INSPECTION_SVC, OTHER) — matches docs/flows/13 §1.3.
 - tripExpenseSchema: tripId, expenseType (8-enum), buyAmount>0, sellAmount>=0 optional, settlementMethod enum,
 supplierId?, invoiceNumber?, invoiceDate?, declarationNumber?, containerNumber?, note?. Conditional: CUSTOMS requires
 declarationNumber; invoice-bearing types require invoiceNumber+invoiceDate before lock.
 - Trip create/update schema: add vatRate, carrierType, and conditional external-carrier fields (EXTERNAL ⇒
 externalCarrierId+externalFreightCost+externalPlateNumber required, truckId/driverId optional; OWN ⇒ existing rules).
 - New debtOffsetSchema (customerId, supplierId, offsetDate, note — no client amount, server computes).
 - Add EXTERNAL_CARRIER_COST to txn-type constant/enum.
 Acceptance: tsc builds shared, backend, frontend with no any.

 A3 — Generic approval mechanism (D-C)

 Goal: one reusable PENDING→APPROVED→REJECTED pattern for financial records.
 Files: backend/src/db/schema.ts (covered by A1 for the approval_status columns; add an approvals audit table here if
 not already), new backend/src/services/approval.service.ts, backend/src/casbin/policy.csv.
 Changes:
 - approval_status enum/string (DRAFT|PENDING|APPROVED|REJECTED) reused on debt_offsets and trip_expenses. Default for
 normal records = APPROVED (no behavior change); records that require review default PENDING.
 - approvals audit table: id, entity_table, entity_id, from_status, to_status, actor_id, note, created_at (append-only
 trail).
 - ApprovalService.transition(tx, {table, id, toStatus, actorId, note}) — validates allowed transitions, writes the
 audit row, flips the record's approval_status. Manager/director only for APPROVED.
 - Casbin: ensure financial:write covers approval endpoints; approvals restricted to MANAGER/ADMIN (and ACCOUNTANT may
 create/prepare but not approve).
 Apply this batch to: debt offsets (B3) and forwarder-entered ancillary-fee sell-side edits (B1/C2) —
 accountant/forwarder edits land PENDING, manager approves. Phiếu thanh toán wires in later (out of scope).
 Acceptance: unit test of transition rules; non-financial records keep APPROVED default and behave unchanged.

 A4 — computeTripTotals extension + unit tests

 Goal: one source of truth for VAT-aware revenue, service margin, external margin.
 Files: shared/src/calculations/tripTotals.ts (current fn 58-125), shared/src/calculations/tripTotals.test.ts
 (node:test).
 Changes:
 - Inputs: add vatRate, carrierType, externalFreightCost, and an ancillaryFees: {buyAmount, sellAmount, vatRate}[] (or
 pre-summed totalServiceBuy/Sell).
 - freightExVat = round0(revenue / (1 + vatRate)). OWN: grossProfit = freightExVat − totalCost(own) + serviceMargin.
 EXTERNAL: externalFreightExVat = externalFreightCost/(1+vatRate); externalMargin = freightExVat −
 externalFreightExVat; totalCost = externalFreightCost (no fuel/allowance/salary); grossProfit = externalMargin +
 serviceMargin.
 - serviceMargin = Σ(sellExVat − buyExVat) across fees (ex-VAT, per-fee vat rate); also expose totalServiceBuy,
 totalServiceSell.
 - Backward-compat: vatRate=0 ⇒ ex-VAT = incl; carrierType absent ⇒ OWN; no fees ⇒ margins 0. Existing tests must
 still pass.
 Acceptance: new tests cover OWN+VAT, EXTERNAL margin ex-VAT, service margin, and the existing AUTO/FLAT_RATE/mountain
 cases unchanged.

 ---
 Phase B — Backend services

 B1 — Ancillary fee service + fee-type config/seed

 Goal: CRUD ancillary fees with buy/sell + metadata + markup prefill; seed the 8 fee types.
 Files: backend/src/services/trip.service.ts (or a tripExpense.service.ts), backend/src/routes/trips.ts +
 backend/src/routes/forwarder.ts (expense create ~65-76), backend/src/seed.ts, follow backend/src/routes/expense.ts
 CRUD+asyncHandler+transaction pattern.
 Changes:
 - create/update accept buyAmount, sellAmount, supplierId, settlementMethod, invoiceNumber, invoiceDate,
 declarationNumber, containerNumber. Validate per A2 (customs⇒declaration; invoice types⇒invoice no/date before lock).
 - Sell-price prefill from forwarder_expense_types.default_markup (true ⇒ editable-with-margin; false ⇒ at-cost) —
 prefill only, always editable.
 - Forwarder/accountant edits to sell-side land approval_status='PENDING' (A3); manager approves before the fee can
 appear on a giấy báo nợ.
 - Seed forwarder_expense_types with the 8 codes + Vietnamese names + default_markup (CUSTOMS, INSPECTION_SVC = true;
 rest false) + billing_label + vat_rate=0.080, per PRODUCT-SPECS §4.6.1.
 Acceptance: create fee with buy/sell persists margin; customs without declaration → 400; seed idempotent.

 B2 — lockTrip settlement + external-carrier posting

 Goal: post the right ledger entries at lock for fees and external carrier.
 Files: backend/src/services/trip.service.ts (lockTrip ~496-534), backend/src/services/ledger.service.ts (extend
 postTripLock).
 Changes (all inside the existing tx, reuse LedgerService.postEntry/lockEntities):
 - Recompute trip totals via A4 before posting; store freightExVat-derived figures as needed.
 - Customer revenue: unchanged TRIP_REVENUE debit on customer (incl-VAT).
 - Ancillary fees — buy side branch (D-A): COMPANY_DIRECT+supplierId ⇒ VENDOR_EXPENSE credit on entity_type='VENDOR'
 (AP). FORWARDER_ADVANCE ⇒ FORWARDER_ADVANCE debit on entity_type='FORWARDER' reducing advance balance; no supplier
 AP. Only APPROVED fees post.
 - Ancillary fees — sell side: increases customer AR (fold into trip revenue or a distinct line; itemized for giấy báo
 nợ).
 - External carrier (D-D/D-F): EXTERNAL_CARRIER_COST credit on entity_type='CUSTOMER', entityId=external_carrier_id,
 amount = external freight incl-VAT. Negative balance = we owe them. Lock both the trip's customer and the
 carrier-customer (sorted lockEntities). For EXTERNAL trips, do not post driver salary.
 Acceptance: integration test — own trip with one COMPANY_DIRECT + one FORWARDER_ADVANCE fee posts VENDOR AP +
 FORWARDER advance reduction + customer AR; external trip posts EXTERNAL_CARRIER_COST credit on the carrier-customer
 and no driver salary.

 B3 — Debt-offset endpoints + approval (Feature 3, supplier↔customer case)

 Goal: dual-entity listing + full-offset create + approve, posting compensating ADJUSTMENTs.
 Files: backend/src/routes/financial.ts, new backend/src/services/debtOffset.service.ts, uses A3 + LedgerService.
 Endpoints (camelCase, asyncHandler, transaction):
 - GET /api/finance/dual-entities — customers with linked_supplier_id (and vice-versa) + arBalance, apBalance,
 netBalance (via LedgerService.getBalance).
 - POST /api/finance/debt-offsets — body {customerId, supplierId, offsetDate, note}; server computes amount =
 min(arBalance, apBalance) (client sends no amount, REVISED §5); insert PENDING; one per pair per month.
 - POST /api/finance/debt-offsets/:id/approve — manager/director; via ApprovalService.transition; on approve post
 ADJUSTMENT debit on customer (↓AR) + ADJUSTMENT credit on supplier (↓AP).
 - GET /api/finance/debt-offsets?customerId&supplierId — history.
 Note: this is for NCC-that-is-also-a-customer. Carrier-as-customer (D-F) needs no offset — it nets on one ledger
 automatically.
 Acceptance: offset amount fixed at min(AR,AP); ledger only moves on approve; AR/AP both drop by the offset.

 B4 — Per-vehicle P&L: service + external margins

 Goal: roll the two new margins into reporting.
 Files: backend/src/services/reporting.service.ts (getPnlReport ~119-200), shared/src/types/index.ts (PnlTruck
 ~628-636).
 Changes:
 - Per-vehicle revenue: freightExVat (own) + serviceMargin + externalMargin. Cost: existing own-truck costs +
 totalServiceBuy (COMPANY_DIRECT) + maintenance; external trips contribute the external bucket instead of own-truck
 costs.
 - Add report lines "Lãi dịch vụ đi kèm" and "Doanh thu điều xe ngoài (lãi quản lý)"; group external trips under a
 dedicated "Xe ngoài" bucket (no own truck_id) or under the carrier-customer name.
 - Aging/AR: treat negative customer balance as "we owe them", exclude from overdue receivable buckets (D-F
 consequence).
 Acceptance: P&L for a month with own+external+fee trips shows both margin lines and the Xe ngoài bucket; a
 carrier-customer with net-negative balance does not appear as overdue AR.

 ---
 Phase C — Frontend (TanStack Query; client pattern frontend/src/api/*, frontend/src/lib/api.ts; no useCRUD)

 C1 — Trip form + detail: carrier toggle, VAT, ancillary grid

 Files: frontend/src/hooks/useTripForm.ts, frontend/src/pages/TripCreatePage.tsx, TripEditPage.tsx,
 TripDetailPage.tsx, frontend/src/api/tripClient.ts.
 Changes:
 - Carrier toggle Xe nhà | Xe ngoài. Xe nhà ⇒ existing Truck/Driver dropdowns. Xe ngoài ⇒ hide them; show Đối tác vận
 chuyển (dropdown from customers where is_carrier=true, allow marking a customer as carrier inline) + Giá cước thuê
 ngoài (gồm VAT) + Biển số xe + Tên lái xe + SĐT lái xe + read-only Lãi điều xe ngoài preview.
 - VAT rate field (default from customer; 8%/10%).
 - Ancillary fee grid (Chi phí DV đi kèm): rows with Loại phí (8), Mua vào, Bán ra (prefill by markup), Lãi DV, NCC
 (optional), Hình thức chi (COMPANY_DIRECT/FORWARDER_ADVANCE), invoice no/date, tờ khai — conditional by fee type. Số
 container per row.
 - TripDetail: "Xe ngoài" section (partner, plate, driver, external cost, management margin) when EXTERNAL; service
 buy/sell/margin grid; add totalServiceSell to revenue card. Respect DRIVER/FORWARDER financial-field exclusion.
 Acceptance: create both OWN and EXTERNAL trips; ancillary rows persist; margins preview correctly.

 C2 — Forwarder portal expense form upgrade

 Files: frontend/src/pages/ForwarderTripDetailPage.tsx (expense form ~40-114), forwarder expense hooks.
 Changes: replace single amount with Giá mua vào / Giá bán ra (auto-prefill) / NCC / Hình thức chi / Số hóa đơn / Ngày
 hóa đơn / Số tờ khai. Forwarder edits land PENDING (A3). Keep ownership-based delete. Already partly documented in
 docs/flows/13 §2.2/§2.4 — align UI to it.
 Acceptance: forwarder creates a fee with buy/sell + metadata; sell edit shows pending-approval state.

 C3 — Customer & supplier linking fields

 Files: frontend/src/pages/CustomersPage.tsx, frontend/src/pages/SupplierListPage.tsx.
 Changes: Customers form — is_carrier (Đối tác vận tải), debit_note_mode (Tháng/Lô), linked_supplier_id (Liên kết
 NCC). Suppliers form — linked_customer_id (Liên kết khách hàng). Matches docs/flows/08 §2.2 / docs/flows/12 §2.1.
 Acceptance: fields save and round-trip; carrier customers appear in the trip-form carrier dropdown.

 C4 — Debt-netting UI

 Files: frontend/src/pages/DebtListPage.tsx, DebtDetailPage.tsx, new frontend/src/components/DebtOffsetModal.tsx,
 finance client.
 Changes: DebtList — "Đối tác 2 chiều" badge + "Net công nợ" column for linked entities. DebtDetail — when linked,
 show a "Công nợ phải trả" card + "Đối trừ" button. DebtOffsetModal — shows phải thu / phải trả / computed full-offset
 = min(AR,AP) (read-only, not editable), inputs date+note, submits PENDING, then pending-approval state. Bảng đối
 chiếu công nợ view/export per pair/period (AR, AP, offsets, net). Matches docs/flows/04 §2.3.
 Acceptance: offset modal shows fixed amount; after manager approve both balances drop.

 C5 — FinancePage P&L lines

 Files: frontend/src/pages/FinancePage.tsx (per-truck ~556-589, maintenanceByComponent).
 Changes: add income-statement rows "Lãi dịch vụ đi kèm" and "Doanh thu điều xe ngoài (lãi quản lý)"; show the Xe
 ngoài bucket in per-vehicle breakdown. Matches docs/flows/03 §2.2.
 Acceptance: lines render from B4 data; totals reconcile with per-vehicle sum.

 ---
 Phase D — Document & tests

 D1 — Giấy báo nợ PDF (company form) — needs company sample

 Files: new backend/src/services/debitNote.service.ts + route in financial.ts; new
 frontend/src/components/DebitNoteExport.tsx; reuse existing export infra on DebtDetailPage.
 Changes: data endpoint selects freight + itemized ancillary sell lines (each fee its own line, never consolidated)
 for a customer, by MONTHLY or PER_BATCH per customers.debit_note_mode. Render a formal PDF matching the company's
 paper form (D-B). Only APPROVED fee lines are eligible.
 Blocker: obtain the real giấy báo nợ form/sample from the customer before finalizing layout. Until then, build
 endpoint + itemized data + a faithful draft template.
 Acceptance: both modes export; lines itemized; numbers match the ledger/AR.

 D2 — Tests

 Files: backend/src/tests/comprehensive.test.ts (node:test pattern), shared/src/calculations/*.test.ts.
 Coverage: A4 calc cases (done in A4); lock-posting for fees (both settlement paths) + external carrier
 credit-on-customer; debt-offset full-offset + approval ledger; P&L margins; negative-customer-balance aging. Use
 existing dev DB + seed + JWT helper.
 Acceptance: npm test green.

 ---
 Verification (end-to-end)

 1. npm run db:migrate (backend) → schema present; npm run seed idempotent.
 2. Backend npm test green (D2). Shared tsc/tests green (A4).
 3. Manual via running app (frontend 5173 / backend 3090):
   - Create an EXTERNAL trip picking a carrier from Customers; lock it → that carrier-customer's ledger shows a CREDIT
 (negative balance = we owe them); P&L shows "Doanh thu điều xe ngoài".
   - Add ancillary fees (one COMPANY_DIRECT, one FORWARDER_ADVANCE) as forwarder → PENDING; manager approves; lock →
 supplier AP + forwarder advance reduction + customer AR; fee lines itemized on giấy báo nợ.
   - For an NCC-that-is-also-a-customer, run a monthly đối trừ → amount fixed at min(AR,AP), approve → both balances
 drop.
 4. Confirm DRIVER/FORWARDER still cannot see financial fields (Casbin + API field exclusion).

 Open dependency to surface to the user

 - D1 blocker: need the company's real giấy báo nợ sample/form before building the final PDF layout.