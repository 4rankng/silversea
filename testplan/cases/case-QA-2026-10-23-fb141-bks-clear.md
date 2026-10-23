# Case QA-2026-10-23-FB141 — BKS báo khách (Ảo): đã lưu thì không xóa được về trống

Card 231026163927 (QA R39 residual, minor). Surface: Chi phí - Quyết toán →
mở rộng dòng lô lẻ → PHÂN XE → "BKS báo khách (Ảo)" + [Lưu BKS]
(`DebitLotLclFacts`). Spec 23/10 §4.1: để trống = HỢP LỆ (fallback lấy BKS thực
do ĐV gán); nhập giá trị = dùng giá trị nhập.

## Root cause

`saveTruck()` gửi `billingTruckNo: ''` khi người dùng xóa trắng; shared schema
`truckNo = z.string().trim().min(1, 'BKS không được để trống')` từ chối → 400.
Schema đã hỗ trợ `null` (clear ⇒ fallback BKS thực) nhưng FE không bao giờ gửi
null. Sibling cùng lớp lỗi: "Phân bổ nhà xe" (DispatchAllocationLclDialog) xóa
trắng BKS ảo → payload OMIT trường đó → giá trị cũ nằm lại DB (mồ côi).

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| FB141-R1 | Nhập BKS ảo "29H-77777" → Lưu BKS | Toast "Đã cập nhật BKS", giá trị lưu thành công |
| FB141-R2 | Xóa trắng ô → Lưu BKS | Lưu THÀNH CÔNG (không còn lỗi "BKS không được để trống"); DB billing_truck_no = NULL; ô hiển thị trống |
| FB141-R3 | Placeholder động | Có BKS thực: placeholder = chính BKS thực (ghost value). Không có: "Trống = tự động dùng BKS thực" |
| FB141-R4 | Hint dưới input | "Mặc định dùng BKS thực tế nếu để trống" |
| FB141-R5 | Schema | `billingTruckNo` trong updateLclTruckSchema/mergeLclRevGroupSchema chấp nhận '' / null (normalize null phía service — sẵn có `|| null`) |
| FB141-R6 | Sibling sweep | DispatchAllocationLclDialog: xóa trắng BKS ảo (đã touched) → gửi `billingTruckNo: null`, DB clear |
| FB141-R7 | Vitest | `DebitLotLclFacts.test.tsx` pin R2 (payload null, không error toast) |

## Verify
- `qa/2026-10-24-gomhang-r39/` — Playwright trước/sau + SQL billing_truck_no.
