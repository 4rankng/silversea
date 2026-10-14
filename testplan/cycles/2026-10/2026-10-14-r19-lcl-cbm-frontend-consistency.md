# 2026-10-14 — Round 19: Hàng lẻ CBM FE/BE consistency (verify)

Ngày: 2026-10-14 · Nguồn: Zalo QLVT, lượt 19 — "users still see red error
'Nhập thể tích lớn hơn 0' on the LCL create form".

## Bối cảnh

Phiếu lặp lại của TC-LCL-CBM-OPT-01 (2026-10-13). Cổng BE đã nới
(f164a968) và cổng FE create-model đã nới + pin từ 2d0fc44a (đều là tổ tiên
của điểm cắt nhánh round-19 1658ff96):

- `shipment-create-model.ts`: CBM rỗng/toàn khoảng trắng KHÔNG sinh issue;
  giá trị đã nhập vẫn phải > 0 (`Nhập thể tích lớn hơn 0.` chỉ còn fire cho
  giá trị ≤ 0 đã nhập).
- Payload tạo lô LCL gửi `cargoVolumeCbm: null` khi rỗng.
- Pin: `shipment-create-model.test.ts` (blank + whitespace + zero-rejection)
  và `ClerkShipmentCreatePage.test.tsx` (submit toàn form với CBM rỗng).

## Trường hợp kiểm chứng (TC-R19-CBM-FE-01)

- **Tái hiện kỳ vọng:** mở `/shipments/new`, chọn "Hàng lẻ", điền đủ các
  trường LCL, để trống "Thể tích (CBM)": KHÔNG có lỗi đỏ
  `shipment-cargo-volume`; "Tạo lô hàng" tạo lô thành công với
  `cargoVolumeCbm: null`.
- **Phủ định:** chuỗi `Nhập thể tích lớn hơn 0.` chỉ có thể xuất hiện khi ô
  CBM có nội dung ≤ 0 (nhập `0` hoặc số âm) — sweep toàn FE xác nhận không
  còn đường nào khác sinh chuỗi này cho CBM rỗng.
- **Kết luận:** nếu khách vẫn thấy lỗi đỏ với CBM rỗng trên staging thì bản
  FE staging cũ hơn 2d0fc44a (cần deploy lại, ngoài phạm vi wave này —
  quy tắc không deploy).

## Chạy xác minh

- `cd frontend && npx vitest run src/features/shipments/create/shipment-create-model.test.ts src/pages/clerk/ClerkShipmentCreatePage.test.tsx`
- UI drive (rung 3) trên stack QA: tạo lô LCL với CBM rỗng qua form thật.
