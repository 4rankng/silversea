# SIL-673 (id 780) — Nhập liệu hàng lẻ: đưa ô Số tờ khai lên Nhận diện lô, ngay trên ô Số Bill/Booking

- **Ngày báo cáo:** 03/11/2026 (owner ruling, ticket SIL-673) · **Ngày fix:** 03/11/2026
- **Mức:** UX placement (owner yêu cầu trực tiếp) — không phải defect chức năng

## Hiện trạng (trước fix — tái hiện rung-3)
Tab HÀNG LẺ của form Tạo lô: ô Số Bill/Booking nằm ở phần **Nhận diện lô**
(trên), còn ô **Số tờ khai** nằm ở hàng **Thông tin hàng** phía dưới (cột cuối,
sau Thể tích — vị trí mà SIL-660, commit 5f5bd30f, đã đặt ngày 02/11).
Owner ruling 03/11 đảo vị trí: tờ khai phải đứng **ngay trên** ô Số Bill/Booking.
(Lịch sử: thứ tự cũ 23/10 ticket 223 từng đặt tờ khai cuối Nhận diện lô SAU
Bill — yêu cầu mới đảo ngược theo owner.)

Đo thật @1366 (PHASE=before, `qa/2026-11-03_sil673/ui-driver-before.log`):
`decl.top=644, left=1085` (section Thông tin hàng) vs `booking.top=308`
(section Nhận diện lô).

## Mong đợi (owner ruling 03/11)
- Tab HÀNG LẺ: ô Số tờ khai hiển thị trong **Nhận diện lô**, **ngay TRÊN** ô
  Số Bill/Booking (DOM order: tờ khai trước Bill; visual: hàng trên, cùng cột trái).
- **Chỉ đổi vị trí hiển thị**: vẫn là ô nhập cho container duy nhất của lô lẻ
  (SIL-601: 1 lô lẻ = 1 cont), vẫn persist qua `shipment_declarations`
  per-container như SIL-660. Không thêm/bớt trường, không đổi validation,
  không đổi store/payload.
- FCL không đụng: cột per-cont SỐ TỜ KHAI giữ nguyên (SIL-600/SIL-701),
  không có ô tờ khai cấp lô.
- 390px: identity stack 1 cột — tờ khai trên Bill, không tràn ngang.

## Ràng buộc đã án (đã check)
- Display-only: cùng `UTextField` với cùng props (id `shipment-lcl-declaration-number`,
  label, `form.declarationNumber`, error map) — aria-label + validation message
  giữ nguyên.
- Layout theo doctrine: cell chạy đúng ONE pattern SIL-641
  (`csc-field-with-append` + hidden 36px placeholder slot), `span 6` — nửa cột
  trái của grid 12 đang có, KHÔNG phá độ đều 2 cột (SIL-641); band mới
  `csc-identity-grid--declaration` chèn giữa band `--contact` và `--refs`.
- FCL gate: band render chỉ khi `form.cargoMode === 'LCL'` (đối xứng gate
  Hãng tàu `=== 'FCL'` tại band refs).
- Store/payload/API KHÔNG đổi: `buildShipmentDeclarationPayload`,
  `use-shipment-create-workflow` giữ nguyên trạng (SIL-660).
- Không đụng BE, không đụng FCL, không deploy/merge/main.

## Regression case (đã pin)
- Pin cập nhật vị trí: `frontend/src/features/shipments/create/ShipmentCreateWorkspace.sil660-lcl-declaration.test.tsx`
  — test 1 chuyển thành DOM-structure pin: ô tờ khai là con của section Nhận
  diện lô (`closest('section')` chứa "Nhận diện lô", không chứa "Thông tin
  hàng") + `compareDocumentPosition` TRƯỚC `[data-field-id="shipment-booking-ref"]`.
  Tests 2-3 giữ nguyên (persist + FCL) — không regress SIL-660.
- Pin đơn vị giữ nguyên: `shipment-create-model.test.ts`
  (buildShipmentDeclarationPayload LCL/FCL/blank), `shipment-edit-prefill.test.ts`,
  `use-shipment-create-workflow.test.tsx` — logic/store không đổi nên không
  cần sửa.
- Pin SIL-657 (BE `backend/src/tests/unit/sil657-declaration-number-sync.test.ts`)
  giữ nguyên — read-side merge không đụng.
- UI drive (rung 3): `qa/scripts/2026-11-03-sil673-tokhai-position-ui-drive.mjs`
  (PHASE=before tái hiện vị trí cũ 1366+390; PHASE=after: vị trí mới + create
  → DB shipment_declarations → view disabled → edit PUT cùng row → ledger
  Chứng từ → FCL không đổi → 390 stack). Artifacts `qa/2026-11-03_sil673/`.

## Expected behavior sau fix
1. Tab HÀNG LẺ @1366: ô Số tờ khai trong Nhận diện lô, ngay trên ô Số
   Bill/Booking, cùng cột trái, span 6 (nửa cột — không phá độ đều 2 cột).
2. Nhập + Lưu ⇒ persist `shipment_declarations` như cũ; ledger Chứng từ
   (Tổng quan) + edit prefill/view disabled hoạt động như SIL-660.
3. FCL: không có ô cấp lô; bảng container còn cột Số tờ khai per-cont.
4. 390px: stack 1 cột, tờ khai trên Bill, không tràn ngang.
