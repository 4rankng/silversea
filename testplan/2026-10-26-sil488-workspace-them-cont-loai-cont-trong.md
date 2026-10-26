# Regression case — SIL-488 (board id 550): form Tạo/Sửa lô "Thêm container" tự copy Loại cont — vi phạm REQ-22 REVERSED

- **Ngày**: 2026-10-26
- **Ticket**: SIL-488 (board plan.tingting.vip internal id 550) — báo trên staging build `c8f68a26`, lô /shipments/231 (FCL 40DC, Bill R42CUS-MAIN).
- **Surface**: form Tạo lô hàng (`/shipments/new`) **và** Sửa lô (`/shipments/:id/edit` — SIL-171 dùng lại cùng workspace) → seed row mới qua
  `frontend/src/features/shipments/create/shipment-create-model.ts` `createContainerFromPrevious()` (seam duy nhất của workspace, gọi tại
  `ShipmentCreateWorkspace.tsx` handler "Thêm container").

## Vì sao còn sót (gap của reversal 22/10)

Ruling REQ-22 REVERSED (ticket 221026173728, 22/10 — "copy TẤT CẢ TRỪ số cont + Loại cont") đã land `093c5334` nhưng CHỈ sửa
surface ledger CUS (`CusContainerLedger.addFieldsSeed()` — drawer Tổng quan + Chi tiết trượt ngang, case
`2026-10-22-card221026173728-req22-reversed-loaicont-trong.md`). Workspace Tạo/Sửa lô giữ nguyên luật 21/10 (FB-111 —
"copy cả Loại cont là feature") trong `createContainerFromPrevious` → defect theo ticket SIL-488.

## Ruling chain (nguồn: testplan 22/10 + docs/prd/CHANGELOG.md 22/10)

| Ngày | Card | Luật loại cont |
|---|---|---|
| 18/10 | 191026100000 (A.1) | Seed có copy loại cont |
| 21/10 | 211026112600 (FB-111) | KHÔI PHỤC copy loại cont |
| **22/10** | **221026173728 — REQ-22 REVERSED** | **Copy TẤT CẢ TRỪ Số cont + Loại cont. Loại cont luôn trống ("Chọn loại") cho operator tự chọn.** |

## SIL488-R1 — "Thêm container" ở workspace: Loại cont trống, các trường còn lại copy

**Repro**: form Tạo lô (hoặc Sửa lô có ≥1 cont đã chọn loại) FCL → điền row 1 đủ (Loại cont 40HC, Tuyến, Nhà máy, Cảng
nâng/hạ, Trọng lượng, Giờ đóng/trả) → "Số container cần thêm" = 3 → bấm "Thêm container".

- **Trước fix (defect)**: rows 2-4 copy CẢ Loại cont (hiện "40HC").
- **Sau fix (expected)**: rows 2-4 hiển thị placeholder **"Chọn loại"** (containerTypeId ''); Số container trống; Tuyến/
  Nhà máy/Cảng nâng/Cảng hạ/Trọng lượng/Giờ đóng,trả VẪN copy từ row 1. Submit: type unpicked → payload
  `containerTypeId: null` (EXPLICIT — đã đúng sẵn trong `buildShipmentContainerPayload`, không đụng).

## Edge pins

1. Model unit (`shipment-create-model.test.ts`): `createContainerFromPrevious` copy mọi trường TRỪ `containerNumber` +
   `containerTypeId`; `id` vẫn không thừa hưởng (SIL-171).
2. Page pin (`ClerkShipmentCreatePage.test.tsx`): rows thêm vào hiển thị "Chọn loại" (không phải code row 1); các cột
   copy khác giữ nguyên assertion.

## Ghi chú

- Không đổi wire contract server (explicit null đã đúng từ A.1).
- Flip pin chứ không bỏ qua (ruling-reversal rule): test pin luật 21/10 trong 2 file trên sẽ đỏ sau fix → flip theo
  luật 22/10, cite ticket 221026173728 + SIL-488 trong comment test.
