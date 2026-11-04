# SIL-676 r4 + SIL-638 TC3-T3 — economics còn thiếu: VETC record + lương chưa materialize

Ngày: 2026-11-04 · Branch: `fix/econ-r4-vetc-salary` (base e9afda3f) · Lane: omp/zai

## Regression cases

### S676-R10 — driverSalary không còn NULL sau hoàn thành chân (mọi đường close)

- **Repro (QA pair 30, staging e9afda3f, trips 324/325):** cặp KẸP hoàn thành
  trên staging mà driver/route chưa cấu hình lương + `salary.pair_surcharge_*`
  chưa có trong app_settings → materializer r3 dính cổng no-op
  (`!salary.applied && costDelta === 0`) → không ghi gì → `driver_salary`
  stays NULL cả 2 chân, header 'Chi phí 0'.
- **Expected:** mọi đường hoàn thành chân (driver close, POD close — cùng
  endpoint driver-app complete, điều vận governed close, routine shipment
  close) đều ghi `driver_salary` = số luật tính, kể cả 0 (D02: zero tính toán
  là giá trị, null là khoảng trống); cấu hình có → lương cơ bản (base/26×ngày)
  chân 1 + phụ phí settings chân 2.
- **Test:** `backend/src/tests/unit/sil676-r4-vetc-salary.test.ts`
  (`staging zero-config shape`, `configured driver base salary`, `leg 2 settings phụ phí`,
  `stored wage wins`, `every completion path funnels`) + pin cập nhật
  `sil-wave7-pair-economics.test.ts` (`the materializer applies salary + toll`).

### S676-R11 — VETC record materialize 1 lần/cặp, route không trạm = 0 + marker

- **Repro (QA pair 30):** route 6 staging `tolls_stations` null → VETC 0 cả 2
  chân, settlements `tollOnceLeg: null` im lặng, không lý do nào quan sát được.
- **Expected:** settlements luôn có `tollOnceLeg: 1|2` (mặc định chân 1); route
  không trạm → amount 0 + `tollZeroReason: 'route_chua_cau_hinh_tram'` + note
  kèm cảnh báo nguyên văn 'Route chưa cấu hình trạm thu VETC — cần nhập để
  tính'; driver detail hiện cảnh báo cạnh dòng VETC 0 ₫; không nhân đôi chân;
  reconciled claim của tài xế vẫn thắng và không mang marker.
- **Test:** `sil676-r4-vetc-salary.test.ts` (VETC describe: route-có-station /
  route-không-station / reconciled / settlement read surface) +
  `DriverCostBreakdownSection.test.tsx` (`r4: a route without stations shows
  the owner warning…`).

## Ghi chú phạm vi

- 1 lỗi `backend tsc` tồn tại TẠI BASE e9afda3f, thuộc file lane 679
  (`backend/src/tests/unit/shipment-cost-lock-enforcement.test.ts:83` — RegExp
  truyền vào `slice(..., string)`), file byte-identical với HEAD, ngoài phạm vi
  brief (cấm đụng lot-lock/audit). Không sửa trong lane này.
