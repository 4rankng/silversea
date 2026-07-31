# Customer Workflow Gap Analysis (SilverSea)

> Source of truth: `docs/BIẾU MẪU BÁO CÁO/` (three Excel workbooks delivered by
> the customer on 2026-07-29/30). This document compares those templates against
> the running Silversea app on 2026-07-31.
>
> Authority (per `CONTEXT.md`): the Excel values are **explicit customer input**
> for data. The report *formats* are requirements intent; implemented behavior is
> established by code + green QA. Where a template implies a feature the app
> does not have, the gap is documented here and deferred — it is not silently
> built.

## 1. Report templates — status matrix

| # | Customer report (workbook / sheet) | App status | Owning app surface | Key gaps |
|---|------------------------------------|------------|--------------------|----------|
| 1 | **BC LÃI LỖ** — P&L + MoM trend + cost pie + near-due/overdue debt reminders (`DEMO KẾ TOÁN / BC LÃI LỖ`) | **Partial** | `/finance` → `FinancePage.tsx`; `pnl.service.ts` | P&L, MoM trend (`RevenueTrendChart`), and cost pie exist. Debt-reminder widgets live on the Dashboard, not the finance page. No Excel/PDF export on this page (CSV util only). |
| 2 | **TH VẬN TẢI** — transport summary ledger → multi-select "XÁC NHẬN XHĐ" reconciliation → AR/AP post + per-customer Debit Note Excel (`DEMO KẾ TOÁN / TH VẬN TẢI`) | **Missing** | — | No standalone reconciliation ledger. The underlying data exists (`computeTripTotals`, P&L `tripDetails`) and Debit Note export infra exists (`billingDocument.service.ts`, `debit-note-pdf.service.ts`), but the page, the reconciliation action, and the "confirm → post to AR + download Debit Note Excel" flow do not. Admin-only profit columns + hideable columns + PDF/Excel export are also absent. |
| 3 | **BC HÀNG NGÀY** — daily P&L split by **XE NGOÀI** vs **XE NHÀ**, own-truck cost as Lương CB / Xăng dầu / Lương chuyến+LH / Vé / Khấu hao with % of revenue, margin green ≥50% / red <50% (`DEMO KẾ TOÁN / BC HÀNG NGÀY`) | **Missing** | — | No daily report. The own/external split exists in P&L (`pnl.service.ts` → `ownTrips`/`extTrips`) and the cost sub-categories are computed, but not in the daily format with %-of-revenue columns or green/red coloring. |
| 4 | **BÁO CÁO CÔNG NỢ THEO THÁNG** — row-level monthly AR/AP aging with 6-level warning state + Gmail remind (`DEMO KẾ TOÁN / BÁO CÁO CÔNG NỢ THEO THÁNG`) | **Partial** | `/debt` → `DebtListPage.tsx`; `aging.service.ts`; Excel aging export | Aging buckets (0-30/31-60/61-90/>90), per-customer ledger, and an Excel aging export exist. Missing: the row-level table columns (mã nội bộ, MST, ngày phát sinh, hạn TT, ngày đến hạn, số HĐ, tiền HĐ, chi hộ, đã TT, còn lại, ngày TT thực tế) and the 6-level `trạng thái cảnh báo` (thiếu / sớm / đúng hạn / nguy cơ / quá hạn / muộn). Gmail remind action is not implemented. |
| 5 | **BÁO CÁO TÌNH TRẠNG KH** — customer status: aging count+ratio, top on-time payers, top overdue payers (`DEMO KẾ TOÁN / BÁO CÁO TÌNH TRẠNG KH`) | **Partial** | `/debt` (buckets); Dashboard (`topOverdueCustomer`) | Aging buckets and top-overdue exist. Missing: dedicated page, aging as count+ratio, top **on-time** payers ranking. |
| 6 | **LN THÁNG** — monthly income statement, admin only: I.Doanh thu / II.Chi phí (vendor + cố định + biến đổi + tài chính) / III.LN trước thuế / IV.Thuế / V.LN sau thuế (`DEMO KẾ TOÁN / LN THÁNG`) | **Missing** | — | No 5-section income statement. No vendor/fixed/variable/financial cost classification, no tax (GTGT/TNDN) computation, no after-tax profit. |

### Column-level detail for the missing/partial reports

**TH VẬN TẢI (report 2) — required columns vs app field:**

| Template column | App source | Status |
|-----------------|------------|--------|
| Ngày vận chuyển | `trips.departureDate` / `tripLegs` | Available |
| KHÁCH HÀNG | `customers.name` via `trips.customerId` | Available |
| NHÀ MÁY | `shipments.factoryName` | Available (free text) |
| TUYẾN ĐƯỜNG | `routes.name` | Available |
| LOẠI CONT / XUẤT-NHẬP / TL / CBM / SỐ CONT / CHỦ XE / BKS | `trip_containers`, `trips.carrierType`, `trucks.licensePlate` | Available |
| PHẢI THU: Cước / Lạch Huyện / Phụ Phí / Com / Phát sinh / Tổng thu | `computeTripTotals` revenue side | Available (computed) |
| PHẢI TRẢ: same breakdown / Tổng trả | `computeTripTotals` cost side | Available (computed) |
| Lợi Nhuận / Biên LN (admin-only, hideable) | `computeTripTotals.grossProfit` / margin | Available, but **not gated to admin** on any trip table today |
| Multi-select row checkbox + "XÁC NHẬN XHĐ" → post AR/AP + download Debit Note Excel | — | **Missing** (the reconciliation action + bulk Debit Note export) |

## 2. Master-data representability

| Excel sheet (`DATA PM`) | App home | Status / notes |
|-------------------------|----------|----------------|
| THÔNG TIN NCC (suppliers, e.g. Long Minh) | `suppliers` + `customers` (linked via `linkedSupplierId`/`linkedCustomerId`) | Representable. Long Minh is both the cargo-owning customer and the debit-note recipient. Payment terms (HẠN TT CHI HỘ 25 / CƯỚC 15 days) → `customers.paymentTermDays`. |
| THÔNG TIN KH (customers) | `customers` | Representable. (Sheet is empty beyond headers in the delivered file — placeholder for future customers; we do not fabricate.) |
| NHÀ MÁY (factories: NEWEB, ASKEY, SUNRISE, SJ Tech, S-CONNECT) | **No dedicated entity** | **Representability gap.** Factories live as free-text `shipments.factoryName` and inside operational notes today. Stored as reference data in the seed; **not** re-architected here. |
| TUYẾN ĐƯỜNG (routes) | `routes` | Representable. (Sheet lists columns but no rows; canonical routes are derived from MẪU BÁO GIÁ instead.) |
| LOẠI HÌNH XE (trucks w/ BKS + romooc + named driver + tonnage) | `trucks`, `trailers`, `drivers` | Representable, with caveats: BKS → `trucks.licensePlate`; romooc → `trailers.licensePlate`; **`trucks` has no tonnage column** → the "Loại hình xe" class (NẶNG 2 CẦU 3 GIÀN, etc.) and tonnage (33T/29T/22T) are stored as model/classifier text only; the Excel GPLX/đăng kiểm dates are stored on the driver/truck where a column exists. |
| MẪU BÁO GIÁ (pricing grid by customer × size × route, with fuel-surcharge formula) | `pricing_tables`, `weight_pricing_tiers`, `fuel_config`, `fuel_norms` | Representable. The fuel-surcharge formula (định mức dầu/KM × giá dầu × % chia sẻ) maps to `fuel_config` + `fuel_norms`; cước gốc per size × route → `pricing_tables`. **The formula is implemented, not hardcoded.** |
| THÔNG TIN CẢNG BÃI (17 ports/yards) | `ports` | Representable. Web-portal URL → `ports.notes`. |
| DS NHÂN SỰ (~28 drivers + ~20 office staff) | `drivers` (drivers); `users` (office logins) | Drivers representable. Office staff are **not** seeded as users (existing logins are preserved per the user's decision). |
| MẪU DEBIT LONG MINH (20-column debit-note layout) | `debit_note_templates` + `billing_documents` | Representable. Silver Sea issuer identity (MST 0201985011, address, VCB account 0031000391518), VAT 8%, and the PHÍ DỬCH VỤ / PHÍ CHI HỘ (vendor breakdown) columns map to the dynamic template + billing-document lines. |

## 3. Dispatch workflow — CUS-ĐIỀU XE vs shipment workspace

The customer's `BẢNG DEMO PHẦN MỀM 2026- CUS- ĐIỀU XE.xlsx` describes a
two-section dispatch screen:

- **MỤC 1 — BẢNG KẾ HOẠCH XE** (planning): customer, factory, bill, shipping
  line, total qty, weight, customs cutoff, NÂNG/HẠ ports, closing time,
  IMPORT/EXPORT, delivery point, cont type, notes, return date, carrier.
- **MỤC 2 — BẢNG HIỂN THỊ CHI TIẾT CUS** (container-level detail) +
  **BẢNG NHẬP THÔNG TIN HÀNG** (create-new-lot form).

The app's shipment workspace (`shipments`, `shipment_containers`, implemented
under `plans/260729-1908-shipment-operations-workspace`) carries most of these
fields. **Gap:** the two-pane planning-vs-detail view and the exact column order
are a **UI-organization gap**, not a data-model gap.

## 4. Deferred to separate plans

The following are out of scope for `260731-customer-audit-reseed` and are the
natural input to the reporting-layer build-out in
`260730-2232-customer-service-finance-workflow`:

| Deferred item | One-line scope |
|---------------|----------------|
| TH VẬN TẢI reconciliation ledger | New page: per-trip receivable/payable table + multi-select "XÁC NHẬN XHĐ" → post AR/AP + download per-customer Debit Note Excel. Admin-only profit columns, hideable columns, PDF/Excel export. |
| BC HÀNG NGÀY | New daily report: XE NGOÀI vs XE NHÀ sections, own-truck cost as %-of-revenue (Lương CB / Xăng dầu / Lương chuyến+LH / Vé / Khấu hao), margin green ≥50% / red <50%. |
| LN THÁNG | New admin-only income statement: Doanh thu / Chi phí (vendor+định+biến+tài chính) / LN trước thuế / Thuế (GTGT+TNDN) / LN sau thuế. |
| AR aging row-level + trạng thái cảnh báo + Gmail remind | Extend `/debt`: full row-level monthly table, 6-level warning state, Gmail remind action. |
| Customer status page | Dedicated page: aging count+ratio, top on-time + top overdue payers. |

## 5. Data-cleaning observations for the seed script

Captured during planning while parsing the workbooks; the seed script must
normalize these:

- **LOẠI HÌNH XE — BKS punctuation is inconsistent:** `15H-052.82` vs
  `15H - 052.82` vs `15H-116,24`. Normalize to `15H-116.24` form (dash, no
  spaces, dot decimal).
- **LOẠI HÌNH XE — driver names** have typos and need fuzzy-matching against
  DS NHÂN SỮ (e.g. romooc column sometimes carries the wrong field).
- **NHÀ MÁY notes** contain mixed Chinese + Vietnamese text and very long
  multiline addresses. Keep the Vietnamese + MST + Google Maps link; drop the
  raw Chinese blocks.
- **DS NHÂN SỰ — MST** is personal tax code; `drivers` has no tax column, so it
  is dropped (or stored in a note if valuable).
- **MẪU BÁO GIÁ** fuel-surcharge numbers are pre-computed for "giá dầu
  26/2 = 17,843" and "hiện tại 25,760"; the seed implements the **formula**
  (định mức × giá dầu × %) and validates one row against the Excel total before
  seeding all.

## 6. Data appendix (reseed outcome)

This section is filled in after the local and staging reseeds complete (Phases 3
and 4 of `260731-customer-audit-reseed`). It records: tables wiped, counts
inserted per entity, the driver-login relink map, and confirmation that no
`users` row was deleted or re-passworded.
