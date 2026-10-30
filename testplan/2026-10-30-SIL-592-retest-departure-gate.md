# SIL-592 (id 692) — retest 30/10: CUS bấm «Hoàn thành» xe ngoài không có tác dụng

## Case ID
SIL-592-RETEST-DEP

## Bug (QA comment 30/10, board id 2953)
Nút «Hoàn thành chuyến xe ngoài» (CUS + Điều vận) có trên dòng ledger nhưng bấm
không có tác dụng: lô 294/295 (RT592-A/B, xe ngoài ĐĂNG QUÂN 15C-581.58, đã phát
lệnh) vẫn «Đang chạy», không chuyển «Đã khóa». QA báo «không có thông báo lỗi».

## Root cause (repro local 30/10)
1. `POST /trips/:id/complete-external` trả **400 «Ngày hoàn thành không thể
   trước ngày khởi hành.»** khi ngày khởi hành của chuyến còn ở tương lai
   (`assertCompletionNotBeforeDeparture`, card 061026221826 — luật owner: ngày
   hoàn thành không bao giờ trước ngày khởi hành; trip 519 departure 31/10,
   hôm nay 30/10).
2. Frontend gate `canCompleteExternalTrip` KHÔNG check ngày khởi hành → nút vẫn
   hiện → dead button (đúng class «no dead affordance» của case plate-less).
3. Toast lỗi auto-dismiss 4.5s → thông báo 400 biến mất trước khi QA kịp thấy
   («không có thông báo lỗi»).

Điều vận bấm không tác dụng cùng nguyên nhân (cùng endpoint guard; surface ĐV
đã có banner lỗi inline nên ít nghiêm trọng hơn).

## Fix
- Wire CUS workspace mang thêm `tripDepartureDate` (shared schema + backend
  reads/builders: cả lot-row lẫn container-line).
- `canCompleteExternalTrip` ẩn nút khi ngày khởi hành (VN) > hôm nay; null
  (legacy) giữ nguyên hành vi server-gate-only.
- Toast lỗi giữ tới khi đóng (accessibility law: error toast stay until
  dismissed) — success/info/warning giữ auto-dismiss 4.5s.
- Backend guard KHÔNG đổi — luật 061026221826 giữ nguyên.

## Repro / Expected
1. Tạo 2 lô LCL, gộp nhóm, gán xe ngoài có biển, phát lệnh; trip departure
   ở tương lai.
   - EXPECT: dòng lô KHÔNG có nút «Hoàn thành» (không dead button).
2. Sửa ngày khởi hành về hôm nay (Điều vận chỉnh lịch chạy — dữ liệu nhất
   quán với thực tế đã chạy).
   - EXPECT: nút «Hoàn thành» xuất hiện; bấm → dialog xác nhận → toast «Đã
     hoàn thành chuyến xe ngoài.» → chip dòng «Hoàn thành»; lô chuyển bucket
     «Đã khóa» (shipment COMPLETED) sau refetch.
3. Bấm hoàn thành khi departure còn tương lai (surface không có nút — kiểm
   tại API): EXPECT 400 với message luật, toast lỗi GIỮ trên màn tới khi đóng.

## Tests
- shared `cus-shipment-workspace.test.ts` — wire pin tripDepartureDate.
- FE `cusUtils.externalClose.test.ts` — gate departure (future/today/past/null).
- FE `Toast.test.tsx` — error persist / success auto-dismiss.
