# 2026-10-14 — Round 19: Hàng lẻ "Quy cách đóng gói" gợi ý kiểu nhà máy

Ngày: 2026-10-14 · Nguồn: Zalo QLVT — "để trưởng gọi ý giống nhà máy - sau
thêm trường cố định" ( dispatcher focus/type vào Quy cách đóng gói → hiện
gợi ý theo quy ước nhà máy: Thùng gỗ, Pallet, Roll, Carton, Box, Crate,
Khung, Bao…; sau này chủ lô muốn trường cố định).

## Hiện trạng

FB-079 (card 091026180800) đã biến ô này thành combobox gợi ý
(`ShipmentCreateLclCargoFields` → `SearchableField` + `allowsCustomValue` +
`openOnType`) với 6 giá trị cứng: Pallet, Roll, Carton, Thùng gỗ, Bao, Can.

## Kỳ vọng mới (TC-R19-PKG-01)

- Danh sách gợi ý MỞ RỘNG theo đúng vocabulary nhà máy khách kể:
  `Thùng gỗ, Pallet, Roll, Carton, Box, Crate, Khung, Bao, Can` (giữ Can
  của FB-079; thứ tự theo cách khách đọc).
- Nguồn duy nhất: hằng số shared (`shared/src/constants`) để card "trường
  cố định" sau này và các surface khác dùng chung — FE không tự định nghĩa
  list riêng.
- Free-text vẫn cho phép (giữ đảm bảo 2026-09-06 của FB-079): gợi ý chỉ là
  gợi ý.

## Sweep

| # | Bề mặt | Xử lý |
|---|---|---|
| S1 | `ShipmentCreateLclCargoFields` PACKAGE_TYPE_SUGGESTIONS | thay bằng hằng số shared mở rộng |
| S2 | CusQuickEdit (sửa nhanh hàng lẻ) | ngoài phạm vi (không có combobox gợi ý hôm nay); card "trường cố định" sẽ quyết |

## Chạy xác minh

- `cd frontend && npx vitest run src/features/shipments/create/ShipmentCreateLclCargoFields.test.tsx` (file mới — pin danh sách option render).
