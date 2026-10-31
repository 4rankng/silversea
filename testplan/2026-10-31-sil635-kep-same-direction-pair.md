# SIL-635 — Kẹp cùng chiều: 2 cont đều Xuất hoặc đều Nhập vẫn ghép KẸP được

- **Case ID:** SIL-635-REG-1
- **Ticket:** plan.tingting.vip SIL-635 (internal id 739) — ruling Trung Kiên 31/10: "2 cont đều Xuất hoặc đều Nhập vẫn chạy kẹp được (hàng nhẹ)".
- **Surface:** BE — validation ghép cặp (`POST /trips/pairs` → `createTripPair` → `buildTripPairSnapshot` / `assertPairableTrips`) + truck-busy exemption (`isActiveKepPairPartner`); UI ghép ở dispatch (`PairTripsDialog`, `pairCandidates`).
- **Role:** DISPATCHER (ghép cặp); DRIVER (nhận lệnh cả 2 chân).

## Reproduction (tình huống ruling)

1. Điều vận phát 2 lệnh cùng chiều (2 Xuất: cả hai chân NM → cảng; hoặc 2 Nhập: cả hai chân cảng → NM), 2 container 20', cùng xe + cùng lái + cùng ngày.
2. Ghép KẸP qua dialog "Ghép chuyến điều vận" (`pairKind='KEP'`).
3. Lái xe "Nhận lệnh" chân 1 rồi chân 2 (chân 1 đang chạy).

## Expected (ruling)

- Cặp cùng chiều ghép được — điều kiện duy nhất: 2 cont 20', cùng xe/ngày, tải trọng ok, cả 2 khai báo Kẹp (DOUBLE). Không có điều kiện yêu cầu ngược hướng.
- Miễn trừ một-chuyến-đang-chạy áp dụng như nhau cùng chiều/ngược chiều (theo membership pair row — SIL-602/631).

## Verified state (code-read + unit evidence, 31/10)

- `buildTripPairSnapshot` (KEP): bỏ qua OVERLAP / IMPOSSIBLE_REPOSITION / INSUFFICIENT_TRAVEL_BUFFER; không đọc `tradeDirection` ở bất kỳ đâu trong `trip-pairs.service.ts` / `trip-pairing.service.ts` — gate ghép vốn đã direction-blind. `IMPOSSIBLE_REPOSITION` (yêu cầu ngược hướng hình thức) chỉ thuộc KET_HOP — đúng PRD §1.2 (kết hợp phải nối tiếp trả → đóng).
- Truck-busy exemption (`isActiveKepPairPartner`, `trip-busy-gate.ts`): membership pair row ACTIVE KEP + cùng lái — không có input hướng; áp dụng như nhau cùng chiều/ngược chiều (SIL-602/631 suite pin sẵn). **Không đụng** accept-guard (SIL-634 lane khác đang fix).
- UI ghép (`PairTripsDialog`, `pairCandidates`): không lọc theo hướng.
- Bot/chatbot: không nằm trong repo này (không có thư mục/chatbot service trong silversea) — orchestrator chuyển ticket chatbot nếu cần.

## Regression coverage (BE unit-only law)

`backend/src/tests/o01-trip-pairing.service.test.ts`:

1. **REG SIL-635 (2 Xuất):** hai chân cùng NM → cùng cảng, khung giờ chồng, KEP → eligible, không blocking.
2. **REG SIL-635 (2 Nhập):** hai chân cùng cảng → cùng NM, khung giờ chồng, KEP → eligible.
3. Pin no-regression: cặp cùng chiều dưới KET_HOP vẫn bị `IMPOSSIBLE_REPOSITION` (luật chuỗi nối tiếp của kết hợp giữ nguyên — không phải gate hướng).
4. Source-scan pin: `trip-pairs.service.ts` + `trip-pairing.service.ts` không chứa tham chiếu `tradeDirection` — hợp đồng cặp không bao giờ đọc hướng.

"Accept cả 2": exemption membership đã được pin bởi suite SIL-602/631 (`backend/src/tests/unit/trip-status-machine.test.ts`) — predicate không có input hướng nên cùng chiều/ngược chiều cùng một đường. Integration probe (phát cặp thật + nhận 2 chân lên DB) thuộc QA `qa/scripts/` theo luật BE unit-only.

## Copy sweep

3 message lỗi "ghép 2 chiều" trong `trip-pairs.service.ts` (carrierType ≠ OWN / khác xe / khác lái) đổi sang wording trung tính "ghép cặp" — copy cũ gợi điều kiện ngược chiều đã bị ruling bỏ.
