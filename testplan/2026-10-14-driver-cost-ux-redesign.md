# Regression plan — driver end-of-lot cost UX redesign (cost-doc wave B)

Scope: `ShipmentCostEntryForm` + `useDriverExpenseEntry` + new shared
`components/costs/LotCostForm` base. FRONTEND only; no backend change.

## Cases

### DCUX-01 — panel keeps the two cost tables
1. Open `/my-trips/:id` as the assigned driver (trip IN_TRANSIT).
2. Scroll to the cost panel.
Expected: two labelled tables render — "Chi phí lô hàng" and "Tiền đường" —
each driver-entered row appears under its own group; nothing merges the groups.

### DCUX-02 — lot-cost entry drops người chi + invoice fields, gains document-kind selector
1. Table "Chi phí lô hàng" → Thêm.
Expected: fields are Loại chi phí, Tên khoản chi (unclassified fees only),
Thực chi, Ngày chi, "Chứng từ kèm theo" segmented (Phiếu thu | Hóa đơn),
ảnh chứng từ, Ghi chú. NO "Người chi", NO "Số hóa đơn", NO "Ngày hóa đơn".
2. Pick "Phí nâng" (catalog INVOICED): selector preselects and locks "Hóa đơn".
3. Pick "Đảo vỏ" (catalog NO_INVOICE): selector preselects "Phiếu thu".
Payload never carries invoiceNumber/invoiceDate; payerKind is omitted
(server default USER).

### DCUX-03 — receipt photo required for every lot-cost row
1. Enter a lot-cost row without a photo → save is blocked with the required
   hint.
2. Attach a photo → save proceeds; the row persists with its receipt.

### DCUX-04 — Tiền đường system-auto rows
1. Table "Tiền đường" shows two read-only system rows first: "Tiền đường"
   (= trip total_road_allowance) and "Nâng/Hạ Lạch Huyện" (= LIFT_DROP_ALLOWANCE
   fee norm). Missing values render "—", never 0đ.
2. Driver road entry offers ONLY Loại chi phí + Thực chi (no date, note,
   payer, photo, invoice controls).

### DCUX-05 — continuous entry
1. Add a lot-cost row, tap "Thêm khoản khác" → the row moves to the pending
   list and a fresh editor opens; add a road row the same way; tap
   "Lưu tất cả (2)" once.
Expected: 2 POSTs with stable per-row idempotency keys; both rows appear in
their tables after refresh. A failed row stays pending with its error and the
same key on retry; succeeded rows are not re-sent.

## Preserved rulings (must not regress)
- 20260928_197: signed amounts enterable; negative rows labelled "bút toán
  điều chỉnh" and excluded from totals (display rule stays).
- 20260924_1: vi-VN grouped amount display; plain integer on the wire.
- Idempotent retry reuses the same key (single unresolved save).
- Read-only on cancelled trips / accounting lock.
- DRV-DET-08: receipts load via Authorization-header blob, never ?token=.

## Known cross-wave dependency (NOT fixable frontend-only)
Backend `insertDriverIncidentalCostTx` still rejects catalog-INVOICED fees
without an invoice number ("Phí có hóa đơn phải kèm số hóa đơn"). The redesign
moves invoice-number capture to accountant reconciliation, so that gate must be
lifted by the backend/accountant wave; until then an invoiced-class driver save
surfaces the server's own 400 message. No client-side fabrication is added.
