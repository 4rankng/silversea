# SIL-631 — Lái xe chạy kẹp vẫn chỉ nhận được 1 lệnh (hồi quy SIL-602 qua màn chi tiết)

- **Case ID:** SIL-631-REG-1
- **Ticket:** plan.tingting.vip SIL-631 (internal id 735) — báo cáo PROD silversea.tingting.vip, lái xe Trần Trung Hiếu / 15H-087.19; ảnh thật bot.tingting.vip/tmpqa/sil-631-driver-block.jpg
- **Surface:** BE — `transitionTripStatus` nhánh IN_TRANSIT, truck-busy gate. Cả hai đường nhận lệnh của driver app (`POST /driver/me/fulfillments/:fulfillmentId/progress` từ nút "Nhận lệnh vận chuyển" màn CHI TIẾT, và `POST /driver/me/trips/:tripId/progress`) đều hội tụ về `recordDriverFulfillmentProgress` → cùng guard — không có endpoint riêng nào cần vá.
- **Role:** DRIVER (nhận lệnh); DISPATCHER (phát cặp kẹp)

## Reproduction

1. Điều vận phát 1 cặp KẸP hợp lệ cho 1 xe/1 lái xe (ghép bằng `createTripPair`, `pairKind='KEP'`, `status='ACTIVE'`, cả hai trip mang `activeTripPairId`).
2. Lái xe "Nhận lệnh" chân 1 → `IN_TRANSIT` (MATS5148022000 — ĐANG CHẠY).
3. Trạng thái con dấu cặp trên một trong hai chân bị mất/lệch (pointer bookkeeping drift — ghi một phần ngoài luồng chuẩn), HOẶC con dấu trên chân đang nhận không resolve ra partner.
4. Láixe mở màn CHI TIẾT chân 2 (MATS7345584000 — Mới tạo) → bấm "Nhận lệnh vận chuyển".

## Observed (trước fix)

- **409** `Xe đang chạy chuyến MATS5148022000. Vui lòng hoàn thành chuyến đó trước.` — toast + banner đỏ trên màn chi tiết.
- Fix SIL-602 (commit 0e72086d, PASS QA trên 6e6c921a) đã loại mệnh đề `trailerId` nhưng exemption vẫn phụ thuộc **chuỗi con trỏ đúng hoàn toàn**: `trip.activeTripPairId` phải resolve ra partner từ pair row ACTIVE KEP **và** candidate phải mang đúng `activeTripPairId` đó. Con dấu lệch/mất ở bất kỳ chân nào → exemption tắt → 409, dù pair row vẫn ACTIVE KEP và chứa cả hai chân.

## Root cause

Exemption đặt nặng **sổ sách con trỏ** (stamp `activeTripPairId` hai chiều + lookup theo stamp) thay vì **chính danh sách thành viên của pair row**. Mọi trạng thái drift của con dấu (ghi một phần, gán lại ngoài luồng, restore cục bộ) đều làm exemption tắt trên cặp KẸP hợp lệ — cùng lớp lỗi với SIL-602 (mệnh đề `trailerId` không thuộc hợp đồng cặp). Vi phạm PRD LoHangKepKetHop §3.2/§7.3: "KẸP hợp lệ không tự chặn công việc thứ hai vì xe bận trong chính cặp."

## Expected (sau fix)

- Chân 2 của cặp **KẸP hợp lệ** được nhận bình thường khi chân 1 đang `IN_TRANSIT`, chứng minh bằng **membership của pair row ACTIVE KEP** (`trip_pairs.first/second_trip_id` chứa cả hai chân, không phân biệt thứ tự) + cùng lái xe — **không phụ thuộc** con dấu `activeTripPairId` trên trip (mất/lệch một bên vẫn exempt: lookup fast-path theo stamp, fallback theo membership).
- Chuyến `IN_TRANSIT` khác **ngoài membership** cùng xe → vẫn chặn.
- Cặp **BROKEN/gán lại** → pair row không còn ACTIVE (break flow đánh dấu + xóa cả hai stamp) → vẫn chặn.
- Partner khác lái xe (drift ngoài luồng) → vẫn chặn (bảo thủ; reassign có guard `propagateKepPairRigToPartner`).
- KẾT_HỢP không ăn exemption (lookup lọc `status='ACTIVE'` + `pairKind='KEP'`); gate thứ tự KẾT_HỢP (`assertKetHopSequencingAllowedTx`) giữ nguyên.

## Regression coverage

`backend/src/tests/unit/trip-status-machine.test.ts` — describe "Truck availability gate — SIL-602/SIL-631 KẸP pair partner exemption" (predicate thuần `isActiveKepPairPartner` từ `backend/src/services/trip-busy-gate.ts`, DB-free theo luật BE unit-only):

1. **REG SIL-602:** partner cùng ACTIVE KEP pair, candidate shape không mang stamp/trailer → exempt.
2. **REG SIL-631:** membership exempt partner bất kể stamp candidate mất/lệch; membership không phân biệt cột first/second.
3. Row ngoài membership / không resolve được pair ACTIVE KEP → không exempt (KẾT_HỢP giữ sequencing gate).
4. Partner khác `driverId` → không exempt.
5. Self không phải partner của chính nó; chân nhận thiếu driver → không exempt.
6. Wiring pins (source-scan): busy loop gọi predicate với `{tripId, tripDriverId, pair: kepPair}`; cả hai lookup giữ filter `ACTIVE` + `KEP`; fallback membership `or(first_trip_id = tripId, second_trip_id = tripId)` chạy chỉ khi fast-path stamp không resolve; nguồn không còn `simultaneousPartnerId` và không còn mệnh đề `trailerId`.

## QA verification (staging)

Tái hiện đúng bước Reproduction: pair KẸP qua điều vận, drift stamp một chân (cập nhật ngoài luồng trong staging DB), chân 1 nhận OK → chân 2 nhận OK qua màn chi tiết, không 409; board lái xe hiển thị 2 thẻ liền kề. PROD: không thao tác dữ liệu.
