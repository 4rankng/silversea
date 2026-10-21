# Case QA-2026-10-21-dri03-kep-driver-view — logic chuyến kẹp trên app lái xe

Card 211026132357 (dri-03). QA không verify được trên staging vì bqhuong
0 trips (data mất từ đợt sync) → repro bằng data LOCAL tự tạo.

## Trạng thái trước fix

Chuyến kẹp (1 chuyến 2 cont, vd 2×20DC) trên app lái xe (role DRIVER, user
bqhuong) hiển thị/điều khiển sai logic: cần audit driver trip view + API
projection cho kẹp — hiển thị 2 cont, nâng/hạ từng cont, không trộn.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| DRI03-R1 | Driver (bqhuong) mở trip kẹp 2 cont trên app | hiển thị ĐỦ 2 cont, mỗi cont 1 dòng riêng, đúng số cont |
| DRI03-R2 | Nâng cont A (leg nâng) | chỉ cont A gắn cờ nâng; cont B không bị đổi |
| DRI03-R3 | Hạ cont B (leg hạ) | chỉ cont B gắn cờ hạ; cont A giữ nguyên — KHÔNG trộn số cont giữa các leg |
| DRI03-R4 | API projection trip kẹp | payload chứa 2 cont với identity ổn định (không index-first, không sort lệch giữa 2 lần gọi) |
| DRI03-R5 | Test unit projection/render | pin: per-container lift/drop keying cho trip kẹp |
| DRI03-R6 | UI 390px mobile | bằng chứng mobile width cho R1-R3 |

## Verify (sẽ điền sau khi fix)

## Not covered

(điền sau)
