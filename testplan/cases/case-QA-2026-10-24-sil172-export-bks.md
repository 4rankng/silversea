# Case QA-2026-10-24-SIL172 — Debit Note export giữ BKS báo khách đã xóa (FB-141 đuôi)

Ticket SIL-172 (board plan.tingting.vip, id 202). Surface: lô đã khóa chi phí →
xuất Debit Note (XLSX/PDF) — cột Biển số xe in theo `renderData.truckPlate`
đóng băng trên dòng ADHOC lúc phát hành GBN.

## Root cause

`createShipmentDebitNote`/`createConsolidatedDebitNote` đóng băng
`renderData.truckPlate = effectiveBillingPlate(lot)` vào từng dòng ADHOC khi
tạo chứng từ (FB-094 §II.4). Lần export SAU đó, `enrichLinesForDebitNoteRender`
giữ nguyên `renderData` sẵn có của dòng — nên BKS báo khách xóa SAU khi phát
hành (đã lưu NULL ở DB, case FB-141) vẫn in ra file. Vi phạm chính luật FB-094
ghi ở `shipment-cost-lock-lines.ts`: plate/loại xe resolve từ lô LIVE, "a plate
or class rename must not need a re-lock, and BKS is not a money value".

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| SIL172-R1 | Lô LCL khóa, BKS ảo 88Q-99999 → xuất Debit Note | File có dòng "1 \| 88Q-99999 \| 1500000" (đúng — giá trị hiện tại lúc đó) |
| SIL172-R2 | Xóa BKS ảo về trống (không có BKS thực) → export lại | File MỚI không chứa "88Q-99999" ở bất kỳ ô nào; ô BKS trống |
| SIL172-R3 | Xóa BKS ảo nhưng lô có BKS thực (LCL) | File mới in BKS thực (fallback effectiveBillingPlate), không in BKS ảo cũ |
| SIL172-R4 | Đổi BKS ảo sang giá trị mới → export lại | File mới in giá trị MỚI (đọc hiện tại, không đọc snapshot) |
| SIL172-R5 | Dòng legacy không renderData (issued trước FB-094) | Giữ luật gốc: billing plate hoặc trống — KHÔNG áp fallback BKS thực retroactively (ruling Review M2) |
| SIL172-R6 | Tiền/lock | Số tiền đóng băng, version chứng từ, lock semantics không đổi — chỉ plate/loại xe là live |
| SIL172-R7 | Unit | Pure resolver: frozen plate + live lot (đã xóa/đổi/fallback) → giá trị live; legacy path không đổi |

## Rule (nguồn)
`shipment-cost-lock-lines.ts` FB-094 header comment; `effectiveBillingPlate`
(shared/constants/billing-plate.ts); spec 23/10 §4.1 (case FB-141).

## Verify
- Unit: `backend/src/tests/unit/debit-note-live-bks.test.ts`
- Probe (rung 2): `qa/scripts/2026-10-24-sil172-export-bks-probe.mjs` — set BKS ảo
  → issue → xóa → re-export → quét file XLSX không còn 88Q-99999.
