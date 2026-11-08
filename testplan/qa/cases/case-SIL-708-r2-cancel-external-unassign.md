# Case SIL-708 r2 — Hủy phân xe lỗi 'Nhà xe ngoài là bắt buộc.' với xe ngoài

- **Case ID:** SIL-708 r2 (board id 828); QA verdict Muse 07/11 build b293f3cf, lô R3Q-680-B / RTAU4012043 (ĐĂNG QUÂN 15C-581.58, 'Đã phát lệnh').
- **Surface:** `/dispatch-detail` (và /dispatch) — menu ⋯ dòng → 'Hủy phân xe'.

## Reproduction
1. dungnv → dòng lô phân cho XE NGOÀI ở trạng thái 'Đã phát lệnh'/'Đã nhận lệnh' → ⋯ → 'Hủy phân xe' → confirm.
2. Trước fix: `cancelTrip` OK nhưng `savePlan` giữ `carrierType: 'EXTERNAL'` không có `externalCarrierId` → BE 400 'Nhà xe ngoài là bắt buộc.' + banner đỏ 'Không thể lưu kế hoạch.'; lô kẹt 'Đã phân xe' (và TripStatus bị đẩy lùi 'Đã điều xe' vì cancel đã chạy).

## Expected
- 'Hủy phân xe' chạy cho CẢ xe nội bộ và xe ngoài, không cần điền gì: payload lưu kế hoạch = nhà xe TRUNG TÍNH chưa phân (`carrierType: 'OWN'`, `clearVehicle: true`) → lô về 'Chưa phân xe', phân xe mới được ngay (cả nội bộ lẫn ngoài).

## Fix
FE-only `DispatchDetailPlanPage.handleCancelDispatch`; pin: `DispatchDetailPlanPage.test.tsx` (external row → savePlan với `carrierType: 'OWN'` + `clearVehicle: true`).
