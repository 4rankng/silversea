# QA1-007 — card 171026113510 — chip completeness đếm thiếu trường bắt buộc

- **Case ID:** QA1-007-COMPLETENESS-CHIP
- **Card:** `171026113510-qa1-007-verifyfail2-required-chip-3-3.docx` (VERIFY-FAIL lần 2)
- **Card gốc:** `121026084623-qa1-007-required-chip-contradicts-validation-flaky.docx` (DEV_COMPLETED)
- **Màn hình:** `/shipments/new`
- **Ngày:** 2026-10-17

## Tái hiện (theo card)

1. Đăng nhập role CUS (staging: tiepvv / Abc123).
2. Mở `/shipments/new` (form trống): chip hiện `Bắt buộc: 0/3`.
3. Điền 3 trường nhận diện: Khách hàng = LONG MINH, Hình thức = Nhập khẩu,
   Số Bill/Booking = BILL-QA1-007.
4. **Sai (thực tế):** chip hiện `Bắt buộc: 3/3`, không có panel
   `Cần bổ sung 6 thông tin` ở đâu trên trang.
5. **Kỳ vọng:** chip hiện `Bắt buộc: 3/9` (FCL catalog, 1 dòng container) và
   panel `Cần bổ sung 6 thông tin` liệt kê đúng 6 trường còn thiếu của dòng
   container (loại container, nhà máy, tuyến đường, cảng nâng, cảng hạ, ngày
   giờ đóng/trả).

## Gốc rễ

(a) — tập trường bắt buộc của chip bị hẹp: `requiredTotal` cứng = 3 (chỉ 3
trường nhận diện, kèm sàn `Math.max(3, …)`), trong khi CREATE validation set
(`getShipmentCreateReadiness` trong `shipment-create-model.ts`) chặn "Tạo lô
hàng" bằng 9 trường với FCL catalog. Panel cũng chỉ được nạp từ
`validationIssues` — danh sách chỉ có sau lần Lưu đầu — nên trước lần Lưu
đầu trang không có panel nào.

## Kỳ vọng hành vi (hợp đồng chip)

Mẫu số = **toàn bộ** trường bắt buộc của hình dạng form hiện tại, khớp đúng
tập trường issue của `getShipmentCreateReadiness` (slot id mirror 1:1); nguồn
một (one denominator) cho cả chip lẫn panel `Cần bổ sung N thông tin`. Panel
sống trước lần Lưu đầu và liệt kê từng trường còn thiếu. CBM (tùy chọn) không
đưa vào mẫu số trừ khi đang nhập sai (≤ 0) — khi đó nó là blocker phụ.

| Trạng thái (FCL catalog, 1 dòng) | Chip | Panel |
|---|---|---|
| Form trống | `Bắt buộc: 0/9` | `Cần bổ sung 9 thông tin` |
| Mới chọn Khách hàng (partial) | `Bắt buộc: 1/9` | 8 mục |
| Khách hàng + Hình thức (partial) | `Bắt buộc: 2/9` | 7 mục |
| Đủ 3 trường nhận diện (repro card) | `Bắt buộc: 3/9` | `Cần bổ sung 6 thông tin`, liệt kê 6 mục của container |
| Điền đủ 9/9 | `Bắt buộc: 9/9` | không panel |

Các biến thể hình dạng form (mẫu số theo validator, không hardcode):

- FCL catalog 2 dòng container: mẫu số 15.
- LCL catalog: mẫu số 10 (tuyến + nhà máy + kho + quy cách + số lượng + trọng
  lượng + ngày giao; CBM tùy chọn không tính).
- Lệnh chạy ngoài (ad-hoc) FCL: 5/dòng (3 nhận diện + loại container + ngày
  giờ đóng/trả); LCL ad-hoc: 7 — catalog prerequisites bị waive đúng như
  guard `!adHoc` trong validator.

Lưu ý lệch với mô tả card: card nói form trống `0/3` "là đúng" — theo hợp
đồng chip mới (mẫu số = toàn bộ trường bắt buộc) form trống đọc `0/9`. Kỳ
vọng lõi của card (`3/9` + panel sau khi điền 3 trường nhận diện) được giữ
nguyên.

## Hồi quy pin

- `frontend/src/features/shipments/create/ShipmentCreateTopline.test.tsx` —
  chip math qua các trạng thái (empty / partial / all-identity / all-9) chạy
  trên `getShipmentCreateReadiness` thật, + các biến thể hình dạng form.
- `frontend/src/features/shipments/create/ShipmentCreateWorkspace.required-progress.test.tsx`
  — chip + panel sống trước lần Lưu đầu, panel liệt kê đúng 6 mục còn thiếu.
- `frontend/src/features/shipments/create/ShipmentCreateWorkspace.asterisk-contract.test.tsx`
  — dấu `*` = tập trường issue của validator (khớp với slot set).
