# SIL-676 r4 + SIL-638 TC3-T3 — VETC record + lương materialize (2026-11-04)

Branch `fix/econ-r4-vetc-salary` (base e9afda3f). Local stack: backend :3103
(this worktree), frontend :7179 (this worktree, proxy → :3103), DB ss-prod-db
:5441. QA verdict fought: comment 3832 (SIL-676) + 3833 (SIL-638 TC3-T3),
staging pair 30 (trips 324/325) — driverSalary null cả 2 chân, VETC 0,
tollOnceLeg null, header 'Chi phí 0'.

## Root cause (traced, code-read + e2e)

Mọi đường hoàn thành chân (driver close / POD close — cùng endpoint
driver-app complete / điều vận governed close / routine shipment close) đều
chạy qua `transitionTripStatus` → `materializeCompletedTripEconomics` (wave-7
đã wire đúng). Cổng no-op của materializer r3
(`!salary.applied && costDelta === 0`) + `tollOnceLeg: null` trong
`pairSettlementEconomics` là gốc: staging có route 6 `tolls_stations` NULL,
không có `salary.pair_surcharge_*` trong app_settings, driver chưa cấu hình
base_salary → luật tính 0 và KHÔNG ghi gì → `driver_salary` stays NULL,
settlements record mang null im lặng. Local PASS trước đó vì mirror đã cấu
hình đủ (2 trạm × 55.000, kep 200.000, base 5M).

## Fix (r4)

1. `completionEconomicsWrite` (pure, db-free) — trường chưa có giá trị luôn
   được ghi bằng số luật tính, kể cả 0 (D02: zero tính toán là giá trị; null
   là khoảng trống). Stored (governed correction) vẫn thắng. Idempotent.
2. VETC: `netTollForCompletedLeg` thêm `tollZeroReason`
   ('route_chua_cau_hinh_tram' khi route không có trạm; reconciled claim
   thắng và không mang marker); `pairSettlementEconomics` — `tollOnceLeg`
   luôn 1|2 (mặc định chân 1), `tollAmount` 0 + reason; settlement note kèm
   cảnh báo nguyên văn 'Route chưa cấu hình trạm thu VETC — cần nhập để tính'.
3. FE: `DriverCostBreakdownSection` hiện cảnh báo cạnh dòng VETC khi
   `tollZeroReason` set (twin constant trong driverClient.ts). Không CSS mới.

## Evidence

| File | What it proves |
| --- | --- |
| `e2e-pair-econ-r4.py` | Harness: 2 lot CONT20 → dispatch → cặp KẸP → hoàn thành CẢ 2 chân qua driver-app (không actuals) → đọc economics. 2 chế độ: `staging` (route 6 trạm NULL + xoá setting phụ phí + driver base 0 — đúng shape pair 30 staging, backup/restore trong finally) và `configured` (2 trạm, kep 200.000, base 5M). |
| `e2e-pair-econ-r4-staging.log` | Pair 37 (trips 1330/1331): driverSalary `0` CẢ 2 CHÂN (không NULL), tollCost `0`, settlements OS-PAIR-37 `tollOnceLeg: 1` + `tollAmount: 0` + `tollZeroReason: 'route_chua_cau_hinh_tram'` + note kèm cảnh báo; driver detail costBreakdown mang marker. FAILURES: 0. |
| `e2e-pair-econ-r4-configured.log` | Pair 40 (trips 1336/1337): lương 384.615 (luật ngày công: hoàn thành 15:10 UTC = 2 ngày × 5M/26) / phụ phí 200.000; VETC 1 lần 110.000 / 0 + deduction; OS-PAIR-40 không marker; header totalCost 384.615 ≠ 0; ledger DRIVER_SALARY đủ 2 chân; snapshot 3.952.000/pricingTable 33; pricing 3.800.000. FAILURES: 0. |
| `ui-drive-r4.mjs` / `ui-driver-r4.log` | UI DRIVEN 390×844 (driver `laixe`, app lái xe thật): 13 PASS / 0 FAIL — staging leg A hiện cảnh báo nguyên văn cạnh VETC 0 ₫; configured leg A VETC 110.000 ₫ + lương 384.615 ₫ + summary (đóng section) 384.615 ₫ ≠ 0 + không cảnh báo; configured leg B phụ phí 200.000 ₫; 0 console error. |
| `ui-390-staging-legA-warning.png` | Staging leg A — cảnh báo 'Route chưa cấu hình trạm thu VETC — cần nhập để tính' trên Chi phí chuyến. |
| `ui-390-configured-legA.png` / `ui-390-configured-legB.png` | Configured leg A/B — đủ 7 dòng, tổng ≠ 0. |
| `be-test-scoped.log` | Scoped suite (r4 mới 9 test + wave7 pins + sil676 alias): 37/37, exit 0. |
| `be-test-full.log` | FULL BE unit: 914/914 pass, exit 0. |
| `be-tsc.log` | `npx tsc --noEmit`: 1 error TỒN TẠI TẠI BASE e9afda3f — `src/tests/unit/shipment-cost-lock-enforcement.test.ts:83` (lane 679 cost-lock, RegExp vào `slice(..., string)`), file byte-identical với HEAD, ngoài phạm vi brief (cấm đụng lot-lock/audit). 0 error trên mọi file lane r4 đụng. |
| `fe-tsc.log` | `npx tsc -b`: 0 errors. |
| `fe-vitest-scoped.log` | vitest driver scope: 7 files / 89 tests pass (gồm test cảnh báo mới). |

## Ghi nhận phạm vi

- totalCost trên đường driver-close vẫn theo luật delta r3 (stored + Δsalary +
  Δtoll): toll đã được dispatch ghi sẵn nên tổng = phần lương materialize.
  Composition tổng-chi-phí đủ thành phần của path không-actuals là shape
  pre-existing của r3, QA chưa phàn nàn, không thuộc 3 điểm brief.
- Pair 38 (trips 1332/1333) là run giữa chừng khi hiệu chỉnh harness
  (kỳ vọng cứng sai luật ngày công) — data hợp lệ, không dùng làm evidence
  chính; pair 39 tương tự sau fix ms-math của harness.
- Staging/prod KHÔNG đụng trong lane này; QA re-verify sau khi owner deploy.
