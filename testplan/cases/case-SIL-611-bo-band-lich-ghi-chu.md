# case-SIL-611 — Form tạo lô: bỏ band "Lịch & ghi chú", dời Ghi chú xuống dưới Thông tin hàng

- **Board:** SIL-611 (id 714) — "[BUG] Form tạo lô: bỏ Lịch, chuyển Ghi chú xuống dưới Thông tin hàng và dồn gọn phần trên"
- **Reported:** 2026-10-30, owner (ảnh đính ticket): mục "Lịch & ghi chú" ở giữa form + phần trên thưa, nhiều khoảng trống.
- **Owner ruling 30/10:** (1) bỏ hẳn phần Lịch khỏi mục "Lịch & ghi chú" (bộ datetime đã ở band ĐẦU cạnh Loại hàng theo SIL-587/598 — giữ nguyên); (2) 2 ô Ghi chú (khách hàng, lái xe) chuyển xuống dưới Thông tin hàng, cuối form; (3) dồn gọn phần trên. Thứ tự mới: Nhận diện lô (gọn) → Thông tin hàng → Ghi chú.

## Repro (trước fix)

1. Mở `/shipments/new` (FCL mặc định).
2. Form có band riêng "Lịch & ghi chú" (nút copy-down + 2 ô ghi chú) tách khỏi Thông tin hàng.

## Expected (sau fix)

1. Không còn section `#shipment-section-schedule` / heading "Lịch & ghi chú" ở bất kỳ mode nào (FCL lẫn hàng lẻ).
2. FCL kết thúc bằng band "Ghi chú" (`#shipment-section-notes`) render SAU `#shipment-section-cargo`, chứa đúng 2 ô: "Ghi chú cho khách hàng" + "Ghi chú cho lái xe".
3. Nút "Copy giờ hẹn xuống cont trống" sống sót, nằm TRONG section Thông tin hàng ngay dưới bảng container (cùng gate cũ: có dòng nguồn có lịch + còn dòng chưa có lịch).
4. Hàng lẻ KHÔNG có band Ghi chú (luật SIL-587 giữ nguyên) — form kết thúc ở Thông tin hàng.
5. ≥1280px: grid rows mới — mode r1 · identity r2 · freight r3 (khi có dữ liệu) · cargo r4 (FCL) / route r4 + cargo r5 (LCL) · notes r5 (FCL); freight vắng mặt thì pull-up không để hàng trống.
6. View mode (SIL-481): nút copy-down vẫn disabled, mọi control read-only như cũ.

## Regression guards

- `frontend/src/features/shipments/create/ShipmentCreateWorkspace.lcl-visible.test.tsx` — LCL-03: Ghi chú sau cargo + rụng ngay khi chọn Hàng lẻ.
- `frontend/src/features/shipments/create/ShipmentCreateWorkspace.onescreen.styles.test.ts` — pins grid-area mới + cấm `#shipment-section-schedule` hồi sinh + pin source `id="notes"` sau `id="cargo"`.
- `frontend/src/features/shipments/create/ShipmentCreateWorkspace.copy-appointment.test.tsx` — copy-down trong cargo, fill đúng mọi dòng trống.
- `frontend/src/features/shipments/create/ShipmentCreateWorkspace.sil607-appointment-error.test.tsx` — copy-all xóa lỗi per-container (luật 607/CUS-03 giữ nguyên).
- `frontend/src/pages/clerk/ClerkShipmentCreatePage.test.tsx` — heading "Ghi chú" là band cuối; seam whitespace title→label (card 071026204720).
- `frontend/src/pages/clerk/ClerkShipmentCreatePage.onescreen.css` — `:has(#shipment-section-route)` đẩy cargo xuống r5; pin freight-absent kép cho LCL.
