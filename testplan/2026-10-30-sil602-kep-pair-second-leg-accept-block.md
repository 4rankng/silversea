# SIL-602 — Lái xe chạy kẹp chỉ nhận được 1 lệnh (chân 2 bị 409 "Xe đang chạy chuyến…")

- **Case ID:** SIL-602-REG-1
- **Ticket:** plan.tingting.vip SIL-602 (internal id 703) — báo cáo PROD silversea.tingting.vip, lái xe Trần Trung Hiếu / 15H-087.19; nhận được MATS7345584000 (NEWEB-KHO 1, 20ft MATU2097066), chân còn lại MATS5148022000 chặn bằng 409
- **Surface:** BE — `transitionTripStatus` nhánh IN_TRANSIT (driver "Nhận lệnh" `ORDER_RECEIVED` auto-start, `backend/src/services/driver-fulfillment.service.ts` → `backend/src/services/trip-status-machine.service.ts`)
- **Role:** DRIVER (nhận lệnh); DISPATCHER (phát cặp kẹp)

## Reproduction

1. Điều vận phát 1 cặp KẸP hợp lệ cho 1 xe/1 lái xe: hai lệnh cùng truckId, cùng driverId, cùng ngày khởi hành, hai container 20ft — ghép bằng `createTripPair` (`pairKind='KEP'`, `status='ACTIVE'`, cả hai trip mang `activeTripPairId`).
2. Lái xe "Nhận lệnh" chân 1 → `IN_TRANSIT` thành công.
3. Lái xe "Nhận lệnh" chân 2 (trong khi chân 1 đang chạy).

## Observed (trước fix)

- **409** `Xe đang chạy chuyến MATS5148022000. Vui lòng hoàn thành chuyến đó trước.`
- Lái xe kẹt: không thể tự nhận chân 2 của cặp kẹp; phải nhờ staff can thiệp.

## Root cause

Exemption cho cặp KẸP trong busy-gate (`trip-status-machine.service.ts`, loop busyTrips) yêu cầu **đủ 4 điều kiện**: candidate là partner của ACTIVE KEP pair + cùng `activeTripPairId` + cùng `driverId` + **`trip.trailerId != null && candidate.trailerId === trip.trailerId`**.

Mệnh đề trailer không thuộc hợp đồng cặp: `assertPairableTrips`/`createTripPair` chỉ validate cùng xe + cùng lái xe + cùng ngày + hai vỏ 20ft (PRD `docs/prd/LoHangKepKetHop.md` §1.1 — "loại moóc 40FT không phải lý do từ chối cặp"; card 211026152138: master-data import để trống Loại Moóc). Khi `trailerId` null ở một trong hai chân (mooc chưa gán/phát hành ngoài luồng có sync) hoặc lệch nhau, exemption hỏng → chân 2 của cặp KẸP hợp lệ bị 409. Vi phạm PRD §3.2/§7.3: "KẸP hợp lệ không tự chặn công việc thứ hai vì xe bận trong chính cặp."

Đồng bộ rig giữa hai chân (`propagateKepPairRigToPartner`, FB-081 v2) chỉ chạy trên đường reassign và truyền đúng trạng thái hiện có (kể cả null→null) — không tự vá trailer thiếu.

## Expected (sau fix)

- Chân 2 của cặp **KẸP hợp lệ** (cùng ACTIVE KEP pair row, cùng driver) được nhận bình thường khi chân 1 đang `IN_TRANSIT` — **không phụ thuộc** `trailerId` (null, một bên null, hay lệch nhau đều không chặn).
- Chuyến `IN_TRANSIT` khác **ngoài cặp** cùng xe → vẫn chặn (không mở khóa tuỳ tiện).
- Partner mang `activeTripPairId` khác/null (cặp đã gãy/gán lại) → vẫn chặn.
- Partner khác lái xe (drift ngoài luồng) → vẫn chặn (bảo thủ; các đường reassign có guard chống drift).
- Cặp KẾT_HỢP không ăn exemption này (`simultaneousPartnerId` chỉ resolve cho `pairKind='KEP'` + `status='ACTIVE'`); gate thứ tự KẾT_HỢP (`assertKetHopSequencingAllowedTx`) giữ nguyên.

## Regression coverage

`backend/src/tests/unit/trip-status-machine.test.ts` — describe "Truck availability gate — SIL-602 KẸP pair partner exemption" (predicate thuần `isActiveKepPairPartner` từ `backend/src/services/trip-busy-gate.ts`, DB-free theo luật BE unit-only):

1. Partner ACTIVE KEP — candidate shape **không mang trailer** (mooc null/một bên null/lệch đều đi qua cùng shape này) → exempt → không 409. **Đỏ trên code trước fix** (mệnh đề trailer bắt buộc khác null + bằng nhau).
2. Chuyến `IN_TRANSIT` ngoài cặp (pairId null cả hai phía) → không exempt → vẫn chặn (no-regression pin).
3. Row mang pairId khác/null so với chân đang nhận (cặp gãy/gán lại) → không exempt.
4. Partner khác `driverId` (drift ngoài luồng) → không exempt (bảo thủ; reassign có guard).
5. Row cùng pair nhưng không phải partner được resolve → không exempt; chân nhận thiếu driver → không exempt.
6. Wiring pin (source-scan): busy loop gọi `isActiveKepPairPartner(candidate, …)` với đủ 4 đối số; nguồn **không còn** mệnh đề `trip.trailerId != null && candidate.trailerId === trip.trailerId`; select busy vẫn mang `activeTripPairId` + `driverId`; pair lookup giữ filter `status='ACTIVE'` + `pairKind='KEP'` (KẾT_HỢP tiếp tục do sequencing gate `assertKetHopSequencingAllowedTx` quản).

## QA verification (staging)

Tái hiện đúng bước Reproduction trên staging (pair KẸP qua điều vận, chưa gán mooc): chân 1 nhận OK → chân 2 nhận OK, không 409; board lái xe hiển thị 2 thẻ liền kề (§4 PRD — đã đúng từ trước, không đổi FE). PROD: không thao tác dữ liệu.
