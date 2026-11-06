# Case SIL-693 — Debit note xuất thiếu toàn bộ cước vận tải khi lô chưa được định giá (freightAuto null)

- **Case ID:** SIL-693 (board id 805)
- **Reported:** 2026-11-06, QA report 06/11 (tiền thật — chứng từ SENT trên staging), lane fix/sil-money-chain-urgent.
- **Surface:** backend debit-note issuance (`createDebitNoteFromCostLock` / `createConsolidatedDebitNote` → `buildFrozenShipmentDebitLines`) + cost-lock freeze (`buildCostSnapshot`); dispatch pricing skip path (`lockShipmentFreightRate`). FE untouched.
- **Mutation surface:** `shipment_cost_locks.cost_snapshot` (new `freightPricingBasis` key); issuance refuses (409) instead of writing a wrong `billing_documents` row. No existing row or law changes.

## Root cause
Lô LCL điều động không có `pricingRateKey` (không container typed) → `classifyLotPricingBasis` SKIP `NO_RATE_KEY` → dispatch freeze bỏ qua NGẦM (`requirePrice` chỉ chặn MISSING_WEIGHT) → freight không tồn tại ở bất kỳ kênh tiền nào. Khóa lô đóng băng `freightAuto: null`; `buildFrozenShipmentDebitLines` tính `freight = null ?? 0` → dòng FREIGHT bị bỏ → note phát hành im lặng chỉ với phát sinh thu khách (150.000₫ thay vì freight 3.800.000₫). Thực tế staging: note id 14 SENT 150.000₫ trên lô 832 / SHP-2611-00338.

## Reproduction (local restored DB, silversea :5441)
1. Tạo lô LCL (quick-create) + OPS expense "Phí nâng container" amount 150.000 / customerCharge 150.000 (không freight nào được định giá).
2. Khóa lô (base behavior) → xuất Debit Note → 201, note SENT tổng 150.000₫, chỉ dòng SERVICE_FEE, không dòng FREIGHT.
3. Áp fix → mở khóa → khóa lại → xuất → **409** đặt tên lý do (NO_RATE_KEY) + remedy (xác định giá trên Quyết toán, khóa lại).
4. Xác định giá theo remedy (`POST /api/shipments/lcl/rev-class {freightRevenue: 3.800.000}`) → khóa lại → xuất → 201: dòng FREIGHT 3.800.000₫ + SERVICE_FEE 150.000₫ (tổng 3.950.000₫).

## Expected
- Note không bao giờ phát hành khi freight chưa xác định (freeze ghi bằng chứng định giá SKIP vì thiếu căn cứ, trừ AD_HOC và snapshot legacy giữ luật cũ).
- Settlement có freight 3.800.000 → note mang đúng dòng FREIGHT 3.800.000 (luật hiện có: `billedFreight = min(freightAuto, receivableTotal)`).
- Unit: `debit-note-unpriced-freight-guard.test.ts` (9 test) pin toàn bộ luật trên.

## Status
FIXED on fix/sil-money-chain-urgent (SIL-693). Evidence: qa/2026-11-06-money-chain/ (staging-trace.md, local-repro-sil693.md). Bug B (SIL-682) thuộc lane fix/sil-be-682-683 — see sil682-bug-b-verification.md.
