# SIL-634 — Cặp kẹp thật vẫn bị chặn nhận lệnh 2 (phân loại Kẹp nhưng chưa ghép pair)

- **Case ID:** SIL-634-REG-1
- **Ticket:** plan.tingting.vip SIL-634 (internal id 738) — báo cáo STAGING 31/10/2026: K4K423254356 (Xuất, đóng) + K4K5346345654 (Nhập, trả), xe 15E-016.26, tài xế Nguyễn Duy Tuấn, ngược hướng (Đình Vũ → Mipec và ngược lại), cùng ngày 31/10 (22:30 / 22:25). Chân Nhập là 1/6 container của lô K4K5346345654.
- **Surface:** BE — `transitionTripStatus` nhánh IN_TRANSIT, truck-busy gate. Cả hai đường nhận lệnh của driver app (`POST /driver/me/fulfillments/:fulfillmentId/progress` màn CHI TIẾT, và `POST /driver/me/trips/:tripId/progress`) hội tụ về `recordDriverFulfillmentProgress` → cùng guard — không cần vá endpoint nào khác.
- **Role:** DRIVER (nhận lệnh); DISPATCHER/CUS (phân loại Kẹp + phát lệnh)

## Reproduction

1. ĐV phân loại **Kẹp** cho cả 2 fulfillment (→ `dispatch_classification = 'DOUBLE'`, cùng xe + cùng lái xe + cùng ngày, 2 cont 20').
2. ĐV phát lệnh **cả hai chân** — được phép: issue-time clamp (`assertResourceAvailability`) cho qua với `partner.activePairId == null`, KHÔNG đòi pair row (dis-03, card 211026131857).
3. ĐV **không tạo pair** (bỏ qua thao tác ghép `POST /trips/pairs` — luồng phân loại Kẹp không tự sinh pair row).
4. Lái xe nhận lệnh chân 1 → `IN_TRANSIT`. Mở màn chi tiết chân 2 → bấm "Nhận lệnh vận chuyển".

## Observed (trước fix)

- **409** `Xe đang chạy chuyến K4K423254356. Vui lòng hoàn thành chuyến đó trước.` — toast trên màn chi tiết chân 2.
- Nguyên nhân: exemption của truck-busy gate chỉ chứng minh bằng **pair row ACTIVE KEP** (`isActiveKepPairPartner` cần `pair != null`). Không có pair row → `kepPair == null` → chân 1 đang chạy cùng xe/ngày → blocked. Lệch hợp đồng giữa hai gate: **issue-time** chấp nhận cặp DOUBLE chưa pair, **accept-time** từ chối.

## Root cause

Accept-time exemption thiếu chứng minh thứ hai cho cặp kẹp **đã khai báo nhưng chưa ghép**. Ruling 602/635: miễn trừ áp dụng cho cặp kẹp, không phụ thuộc thao tác ghép — nhưng exemption hiện tại vẫn phụ thuộc (pair row = thao tác ghép).

## Expected (sau fix)

- Chân 2 được nhận bình thường khi chân 1 `IN_TRANSIT` nếu thỏa **declared clamp proof**: cả 2 fulfillment `DOUBLE` + cùng lái xe + cùng ngày khởi hành + cả 2 proven đúng 1 vỏ 20' (probe giống issue-time: đúng 1 row `trip_containers`, code bắt đầu '20'). Áp dụng khi **đúng 1** busy row khớp shape ("one compatible partner, never a third load" — mirror `conflicts.length === 1` của issue-time).
- **Vẫn chặn** (không mở lỗ): 2 lô ĐƠN trùng xe/ngày/lái xe (REG TC1 SIL-638); khai báo trộn ĐƠN/DOUBLE một bên nào đó; KẾT_HỢP/COMBINED (sequencing gate giữ nguyên); khác lái xe; khác ngày; thiếu ngày khởi hành một bên; cont không phải 20' hoặc lô 2 container; ≥2 busy row cùng khớp shape DOUBLE (third load — giữ bảo thủ).
- Không đòi rơ-moóc (SIL-602: mooc không thuộc hợp đồng cặp); không re-check trọng lượng (issue-time clamp là chủ gate trọng lượng; đường pair-row cũng không re-check).
- Pair row vẫn là chứng minh ưu tiên giữ nguyên (SIL-602/631 không hồi quy).

## Regression coverage

`backend/src/tests/unit/trip-status-machine.test.ts` — describe "Truck availability gate — SIL-634 declared Kẹp clamp without a pair row" (predicate thuần `isDeclaredKepClampPartner` từ `backend/src/services/trip-busy-gate.ts`, DB-free theo luật BE unit-only):

1. **REG SIL-634:** candidate đúng shape staging (2×DOUBLE, cùng driver/ngày, 2×20', không pair) → exempt.
2. **REG SIL-638 TC1:** 2 lô SINGLE trùng xe → không exempt (vẫn chặn).
3. Khai báo trộn (SINGLE/DOUBLE một bên; COMBINED cả hai) → không exempt.
4. Khác lái xe / thiếu lái xe một bên → không exempt.
5. Khác ngày khởi hành → không exempt.
6. Thiếu ngày khởi hành một bên → không exempt (bảo thủ).
7. Vỏ không phải 20' hoặc không proven 1 vỏ (40'/2 container) một bên → không exempt.
8. Self không tự miễn.
9. Wiring pins (source-scan): busy loop consults `declaredClampExempt`; busy select mang `fulfillmentClassification` (leftJoin fulfillments); bound `length === 1`; classification của chân nhận resolve theo `trip.fulfillmentId`; probe 20' `provesSingleTwentyFootShellTx`.

## QA verification

Gates scoped đã chạy (local, branch fix-sil-634): `cd backend && pnpm exec tsx --test src/tests/unit/trip-status-machine.test.ts` → 49/49 pass; full `pnpm test:unit` → 597/597 pass; `pnpm exec tsc -b` backend → 0 lỗi. Click-through thật trên staging (nhận lệnh 2 của K4K5346345654 sau deploy) do orchestrator/QA owner thực hiện — claim UI để rung 3, không thuộc phạm vi commit BE này.

## Re-verification 31/10 (staging, SELECT-only)

QA re-confirm 31/10 "cặp thật vẫn chặn" → điều tra lại trên staging DB (ssh
vantai.tingting.vip, container `vantai-postgres-1`, chỉ SELECT; evidence:
`qa/sil634/2026-10-31_sil634_staging-pair-shape-selects.txt`):

- **Giả thuyết "classification set sai tầng" BỊ PHỦ ĐỊNH trên dữ liệu thật:**
  fulfillment của chính cont MNBU0001000 (id 350, shipment 302
  K4K5346345654) mang `dispatch_classification = 'DOUBLE'` — không phải
  SINGLE; 5 fulfillments anh em khác của lô 6 cont đúng là SINGLE (đúng shape
  lô nhiều cont, 1 cont kẹp). Lô đối ứng K4K423254356: fulfillment 357
  `DOUBLE` (tiền thân COMBINED id 353 đã cancel — declaration live là DOUBLE).
- **Shape đủ điều kiện miễn trừ:** trips 80 + 81 cùng xe 15E-016.26 (truck 1,
  trailer 1), cùng tài xế 3 (Nguyễn Duy Tuấn), cùng ngày 2026-10-31, mỗi trip
  đúng 1 row `trip_containers` loại 20DC, `trip_pairs` 0 row, đúng 1 busy row
  khớp shape → mọi conjunct của `isDeclaredKepClampPartner` (7497a900) đều
  khớp — gate accept-time KHÔNG chặn shape này.
- **Timeline:** chân 2 (trip 80) `ORDER_RECEIVED` thành công 20:43 VN 31/10;
  build staging đang chạy xác nhận có đủ fix (dist chứa
  `isDeclaredKepClampPartner` + `declaredClampCandidates`) sau redeploy
  22:06 VN. Re-confirm "vẫn chặn" của QA diễn ra TRƯỚC redeploy này → khớp
  trạng thái cũ, không phải block mới.
- Kết luận: không có lỗ hổng code mới ở cặp này; registry regression ở trên
  được cộng 1 pin đóng băng ĐÚNG shape thật (giá trị staging thật — trip
  80/81, driver 3, ngày 31/10, 20DC, không pair row) để thay đổi luật sau này
  phải chủ đích.
