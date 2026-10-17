# FB-108 — card 171026115830 — cụm thao tác cuối trang /shipments/new

Ngày: 17/10/2026 · Mức: P3 · Nguồn: Phạm Trung Kiên (Zalo SilverSea)

## Vấn đề

`/shipments/new` (cả hàng cont FCL và hàng lẻ LCL) chỉ có cụm
'Huỷ / Lưu nháp / Tạo lô hàng' ở dải đầu trang. Người dùng vừa nhập xong
trường cuối phải cuộn ngược lên đầu trang mới lưu được.

## Kỳ vọng

1. Cuộn xuống cuối trang thấy cùng cụm 3 nút, ở cả hai chế độ hàng.
2. Bấm bất kỳ nút nào ở cuối trang → hành vi **y hệt** cụm đầu trang
   (Huỷ: hỏi bỏ thay đổi rồi quay lại; Lưu nháp: tạo bản nháp một phần;
   Tạo lô hàng: validate đủ rồi tạo lô).
3. Cụm đầu trang không đổi, không bị mất nhãn truy cập.

## Test hồi quy

`frontend/src/features/shipments/create/ShipmentCreateWorkspace.footer-actions.test.tsx`
(6 ca, `pnpm vitest run src/features/shipments/create/ShipmentCreateWorkspace.footer-actions.test.tsx`):

| # | Ca | Khoá |
|---|---|---|
| R1 | `mounts the cluster at the end of the hàng cont worksheet` | footer là phần tử cuối của `form.csc-workspace`, 3 nút mang `(cuối trang)`; cụm topline giữ nhãn trần |
| R2 | `mounts the cluster at the end of the hàng lẻ worksheet` | cùng kỳ vọng ở chế độ LCL (card yêu cầu cả hai chế độ) |
| R3 | `saves the draft from the footer exactly like the topline` | payload `quickCreateShipment` từ footer **bằng đúng** payload từ topline (khoá idempotency là UUID mới mỗi lần lưu nên chỉ so payload) |
| R4 | `runs the same full-intake validation from the footer as from the topline` | footer `Tạo lô hàng` ra danh sách thiếu y như topline, không rơi xuống `quickCreateShipment` |
| R5 | `discards and leaves from the footer Huỷ the way the topline Huỷ does` | footer `Huỷ` mở modal 'Bỏ tạo lô hàng?' → 'Bỏ thay đổi và quay lại' → về `/shipments` |
| R6 | `locks both clusters together while a save is in flight` | một trạng thái `saving` chung: 6 nút của cả hai cụm đều khoá, copy 'Đang lưu…' hiện ở cả hai |

Test cấu trúc có sẵn (giữ nguyên): `ShipmentCreateWorkspace.lcl-points.test.tsx`
ca 'repeats the Huỷ / Lưu nháp / Tạo lô hàng cluster at the end of the page'.

**Bằng chứng đỏ:** bỏ khối `<div className="csc-form-actions">` khỏi
`ShipmentCreateWorkspace.tsx` → cả 6 ca đỏ; khôi phục → 6/6 xanh.

## Kết quả chạy

```
cd frontend && pnpm vitest run src/features/shipments/create/ShipmentCreateWorkspace.footer-actions.test.tsx
→ Tests 6 passed (6)
```

Ghi chú kỹ thuật: sau một lần tạo thất bại, `.csc-topline` bị react-aria gắn
`aria-hidden` trong jsdom (focus chạy về ô 'Chọn khách hàng'), nên R4 tra cụm
đầu trang bằng `{ hidden: true }`. Đây là hệ quả của overlay/focus trong jsdom,
không phải hành vi của mã FB-108; hai nút vẫn bấm được và cùng handler.