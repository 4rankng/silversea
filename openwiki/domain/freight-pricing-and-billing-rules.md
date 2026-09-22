---
type: Domain rules
title: "Freight Pricing and Billing Rules"
description: "SilverSea's money-math contracts: how the fuel surcharge is computed and when it is blocked, how zero differs from a missing source on screen, what must be true before a bảng kê (debit note) issues, and why no internal approval hop exists."
tags: [pricing, fuel-surcharge, billing, debit-note, display-contracts]
sources:
  - id: openwiki-source-7d078f7ea54e3537b5202b19
    resource: repo://backend/drizzle/20260922124500_card9_merge_legacy_fund_history.sql
  - id: openwiki-source-908be3a6f6197a3e04f3eba1
    resource: repo://backend/src/db/schema/pricing.ts
  - id: openwiki-source-e9e879d7129d1316457b3c7b
    resource: repo://backend/src/middleware/material-write.ts
  - id: openwiki-source-22287984c48f175c9111b39c
    resource: repo://backend/src/routes/shipments/core.routes.ts
  - id: openwiki-source-6ee9d82604a0a878f2bd4f58
    resource: repo://backend/src/seed/seed-demo-freight-pricing.ts
  - id: openwiki-source-b3ce971443b0973d86aae282
    resource: repo://backend/src/services/accounting-debit-close.service.ts
  - id: openwiki-source-10e4db2d245bc653bfb84cab
    resource: repo://backend/src/services/billing-document-governance.service.ts
  - id: openwiki-source-f182525155ebdf45eaa76a0b
    resource: repo://backend/src/services/deposit-refund-tracker.service.ts
  - id: openwiki-source-a3a0a1921d5309133aa9d113
    resource: repo://backend/src/services/freight-pricing-engine.service.ts
  - id: openwiki-source-4f38a86b10ebec9affe678df
    resource: repo://backend/src/services/treasury-fund-book.service.ts
  - id: openwiki-source-64f15c4bf2dabd7241f4d7ec
    resource: repo://backend/src/tests/card9-fund-history-merge.test.ts
  - id: openwiki-source-8038dca02791074513aa5725
    resource: repo://BACKLOG.md
  - id: openwiki-source-7c110e1f554a6edd95993c36
    resource: repo://docs/prd/PhuongAnTinhCuocTuDong.md
  - id: openwiki-source-5780a594c9de4a6704542afb
    resource: repo://docs/prd/README.md
  - id: openwiki-source-9f3012bd7b3b7e37fa71ae81
    resource: repo://frontend/src/features/trips/tripColumns.tsx
  - id: openwiki-source-83e07eecdb8292c75c7ec3b7
    resource: repo://frontend/src/lib/format.ts
  - id: openwiki-source-e91ca5eb093baa7f2c484a34
    resource: repo://frontend/src/pages/finance-derived.ts
  - id: openwiki-source-b2fbadbe08a5df4d9cfca2ed
    resource: repo://shared/src/calculations/fuelSurcharge.ts
generated: { by: "claude-code", at: "2026-09-22T09:33:28.570Z" }
verified:
  - by: openwiki/0.5.0
    at: 2026-09-22T09:33:28.570Z
---

# Freight Pricing and Billing Rules

> Related: [Architecture](../architecture.md) · [Overview](../overview.md) · Specs: `docs/prd/CuocPhiPhuPhiDau.md`, `docs/prd/PhuongAnTinhCuocTuDong.md`, `docs/prd/QuyTrinhO2C.md`

## Fuel-surcharge math

The freight engine resolves a customer-route contract term and delegates the arithmetic to `shared/src/calculations/fuelSurcharge.ts`. `computeFreightRate()` computes the per-trip freight `J = roundInt(round2dp(basePrice × (1 + sharePct/100)))` and the fuel surcharge `H = MAX(0, ROUND((G − F) × liters))`, rounding J and H to whole đồng separately (HALF_UP), with the total `K = J + H`; a deprecated legacy helper that applied the share percent to the surcharge itself is marked wrong per the Excel PRD and retained only for history. Each trip creation snapshots the resolved inputs so later price changes never rewrite issued freight.

The benchmark price F is persisted at full precision: `freight_rate_terms.base_fuel_price` is `numeric(12,4)` seeded from `19.270 / 1,08 = 17.842,5926` — scale ≥ 4 is required by the PRD's DB design note, and the frequently-seen `17.842,59` is a display abridgment only. Storing a rounded F drifts every surcharge, so no code path may round it.

The adjustment threshold fires at equality: the engine keeps the prior price only while the fuel-price change is strictly below the ngưỡng; a change exactly equal to it counts as "đạt ngưỡng" and opens a new price period. The PRD docs were amended on 2026-09-20 to state this rule, conforming the documents to running code.

When a contract term is incomplete — threshold mode `UNSET`, lag unconfirmed, base price or period missing — the engine does not guess. It returns `source: 'MANUAL'` with zeros meaning "not applicable" and a formula string naming exactly what is missing ("độ trễ giá dầu chưa được xác nhận", "ngưỡng biến động giá dầu chưa được khách chốt"), and the freight preview card renders that reason verbatim. The PRD's rule is absolute: never substitute 0, an example number, or another route's price for missing data.

## The zero-vs-missing display boundary

A computed zero and a missing source are different facts and must never render alike. A value computed from complete inputs displays as `0`; a missing source displays as `—` (and indeterminate values as "Chưa xác định"), never as 0. The boundary is enforced at the presentation layer: `frontend/src/lib/format.ts` renders `—` for null/undefined, and the finance derive layer propagates null for report-backed cells while keeping `?? 0` only inside sums over defined arrays, so an arithmetic zero over a well-defined empty set stays a legitimate 0.

The 15T vehicle class is the canonical missing case: the PRD records that 15T has no GIÁ GỐC on any route — missing data, not a pricing policy. The seed no longer invents 15T prices on any environment, so dev/staging behave exactly like production: the engine returns MANUAL with "Thiếu giá gốc cho 15T — cần nhập tay", the pricing-config screen shows the rows as absent, and the trips list marks affected rows with "—" plus a "Thiếu giá 15T" chip. Production receives no invented contract data.

## Bảng kê issuance readiness

Issuing a debit note (bảng kê) requires the four §7.2 conditions — goods, price, documents, and an open period — where "documents" means the §7.1 original-document receipt: a real person and date recorded on the trip's POD-mộc-đỏ recovery fields (`trips.pod_recovered_at/by`), never inferred from a photo or a completed status. The server-side gate on the issue path collects EVERY missing condition and rejects with one 409 whose `details[]` names each reason individually (no masking, no overflow), and the builder renders each reason on its own line; eligible documents keep the prior validation path unchanged. The three §7.1 facts (sufficient evidence, transport completed, paper documents received) are recorded as separate states — recording rules, not an extra gate.

The only sanctioned manual price entry is the accountant's negotiated final price when building the statement: the auto-computed price remains stored for reconciliation. There is no manual override of the fuel-clause gate — a missing clause blocks auto-calc and names what is missing.

## No internal approval hop

All internal approval workflows were removed by product ruling (2026-09-15): finance/ops writes execute directly under role checks with audit events instead of an approval request/queue step. Docs carry the ban explicitly (no offline queues, no auto-resend, no pseudo-approval states); the 2026-09-20 audit purged the last approval-language remnants from BACKLOG and the PRD corpus, and the issue-path gate above is the enforcement that replaced process gates for issuance readiness.

## Chi-phi wave additions (2026-09-21/22)

- **Receivable = the negotiated customer-charge side only.** `TỔNG PHẢI THU KHÁCH` sums `customer_charge_amount` (the entered/negotiated charge), never the ops cost amount; rows with an un-entered charge stay unknown and never fabricate revenue, and a later-entered charge joins the debit exactly once (`shipment-debit-summary.service.ts`).
- **Tiền đường** = `trip_financial_state.total_road_allowance` plus the trip's CONFIRMED driver-entered cost lines; the parent board cell sums confirmed items from the same rows the detail dialog reads.
- **Phai-thu / phai-tra reports** (phoi-phieu spine): THU groups by customer, TRA groups by carrier — external carriers keep their name, internal Silver Sea trucks fold under one carrier code. Buckets (nâng / hạ / PS khác) derive from the fee's structural category. Đã thu/trả = treasury cash actually allocated to the source; Còn = Tổng − Đã; over-pay shows an explicit "Đã thu/trả vượt — cần hoàn lại phần chênh" annotation instead of hiding the difference.
- **Confirm-gated driver payables:** a driver-entered tiền-đường line joins the payable total only after the accountant's per-item confirm tick; unconfirmed lines never ride a consolidated phiếu chi.
- **No-invoice fees carry a separate Thực chi / Thực thu pair** (`amount` vs `customer_charge_amount`): chi-ho declarations take both numbers independently; charged no-invoice fees surface on the dispatch plan as "Thu khách: <fee name>" — name only, amounts stay out of the dispatch projection.

## Two-source fund ledger and the Lồng ghép merge (2026-09-22)

- **Every treasury movement belongs to exactly one fund source**: `treasury_accounts.fund_code` is `COMPANY` (TK công ty – ngân hàng ACB) or `TM` (Tiền mặt). The per-source sổ quỹ (fund book) aggregates every ACTIVE account of that source — opening balance plus POSTED movements — and never mixes sources.
- **Lồng ghép (merge history), operator ruling 2026-09-22**: the legacy single-ledger history joins the ACB stream by a one-time classification flip (`fund_code` NULL → `COMPANY` on legacy accounts). Movement rows are never rewritten — the append-only ledger keeps them byte-identical — while old entries appear in the COMPANY book immediately with running totals continuous from day one. The TM (cash) stream starts at activation with no imported history.
- **Deposit refunds post to the ACB stream**: marking a container deposit refunded writes one IN movement against the ACTIVE COMPANY account through the standing treasury engine, guarded against double posting by the movement id on the tracker row (`deposit-refund-tracker.service.ts`).

## Chot-debit rate adjustment (confirmation columns) and the debit-export gate

- **"Duyệt" means đối soát, not approval** (user ruling on card 20260921_21, 2026-09-21): the accounting chot-debit board treats a rate adjustment as a confirmation column — kế toán ticks a lot row and sends "gửi yêu cầu điều chỉnh cước"; there is no approval queue and confirm/withdraw never change any rate.
- **One live pending request per lot.** While a lot's request is PENDING, that lot cannot be exported to debit — both debit-note issuance paths refuse with 409 "Lô <code> đang chờ đối soát cước". Kế toán clears the gate by confirming (per row or tick-all); withdrawing a request re-opens the lot and any earlier confirmed state shows again; a cost-locked lot is frozen and rejects new requests outright.
- **Honest money display**: a missing input (Phí RU rate, carrier cost, ops total) renders "Chưa xác định" — never a fabricated 0 — and lợi nhuận stays unknown until every component is known (tổng thu − tổng 1 − phí RU, with tổng 1 excluding phí RU).

## Financial-write idempotency boundary (2026-09-22)

- **Ten financial-write mutations require an Idempotency-Key** and replay their first outcome on retry: the three chot-debit rate-adjustment commands, the three deposit-tracker commands, and the four phoi-phieu commands (phiếu lập, row void, phôi take-over metadata, truck-accountant assignment). The middleware registry rejects an out-of-registry write, the wrapper refuses a keyless request with 400, and each mutation commits together with its idempotency record so a retried submission can never apply twice.
