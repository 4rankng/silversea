# SIL-845 (id 974) — /my-settlements áp format PHIẾU QUYẾT TOÁN 6 cột (xem/In/Excel)

- **Ticket**: SIL-845 · HIGH · QA FAIL 2 lần (fd0f7f14 + 68646e82): /ops/wallet PASS, /my-settlements vẫn layout cũ.
- **Fix round**: W3 16/11 — áp cùng format wallet cho cả 3 surface của OS- phiếu.

## Root cause của split PASS/FAIL

OS- voucher (vd OS-2611-0008/1000009) là **ops settlement đọc qua forwarder proxy** (`getAdvanceSettlementFromOps`, id offset 1.000.000). Wallet dialog dùng `/ops/settlements/:id` (grouping mới `groupOpsExpensesForSettlement`) → PASS; `/my-settlements/:id` dùng proxy response (không grouping) + bảng cũ per-lot (SIL-811) + In/Excel qua `settlement-export.service` (renderer cũ NGÀY|NỘI DUNG|KHÁCH HÀNG|SỐ CONT|THÀNH TIỀN|HÓA ĐƠN, fee code thô) → FAIL.

## Fix (3 surface, một builder)

1. **Xem**: proxy response thêm `grouping` (builder chung `groupOpsExpensesForSettlement` — cần thêm `shipment_code`/`requires_invoice` vào select); FE `SettlementPrintPage` render `OpsSettlementSheet` khi có `grouping` (title `PHIẾU QUYẾT TOÁN {code}`, ẩn summary/advances/notice concept của phiếu hoàn ứng; phiếu PL-/PT- giữ layout cũ).
2. **In**: OS- branch của export route (SELF `/forwarder/me/...` + OFFICE `/financial/...`) render `renderOpsSettlementSheetHtml` mới — letterhead company + bảng 6 cột + A/B + 3 dòng tổng + SIL-751 dòng-âm.
3. **Excel**: SELF OS- đã dùng `exportOpsSettlementXlsx` từ trước ✓; OFFICE OS- (financial route) thêm branch cùng exporter.

## Verification (UI DRIVEN rung 3 + API)

- Fixture local: ops settlement 9009 'OS-2611-W3FIX' (5 dòng: A 660.000 / B 120.000 / grand 780.000) — ĐÃ XÓA sau verify.
- Page `/my-settlements/1009009` (hoangnh, 1440px): title PHIẾU QUYẾT TOÁN ✓ · sheet 6 cột [Tên công ty|Số Bill/Book|Số tờ khai|Số cont|Tên chi phí|Số tiền] ✓ · A/B markers ✓ · 3 dòng tổng ✓ · 0 fee code thô ✓ · 0 lot header ✓ · old grid biến mất ✓ · summary cards 0 ✓.
- In (HTML export): 200 + 'PHIẾU QUYẾT TOÁN OS-…' + TỔNG CỘNG QUYẾT TOÁN + 'Tên công ty', không FEE_ ✓.
- Excel: 200, xlsx 7.452 bytes ✓.
- Ảnh: `qa/2026-11-16_sil845/sil845-my-settlements-1009009.png` + https://bot.tingting.vip/tmpqa/sil845-my-settlements-1009009.png
- Driver: `testplan/qa/scripts/2026-11-16-sil845-ui-verify.mjs`.

## Gates

- BE: `tsc --noEmit` sạch · scoped unit (grouping/export/admin-create/advance money/recovery/check/draft-flow) **34/34 PASS** (tsx --test trực tiếp; lưu ý `pnpm test:unit` glob chạy cả suite và dính 1 fail có sẵn trên main pristine: `shipment-debit-summary-sil782` — ngoài phạm vi ticket này).
- FE: `tsc -b` sạch · scoped vitest (OpsSettlementSheet + SIL-831 overlap + mobile-inset + control-ceiling) **83/83 PASS**.
