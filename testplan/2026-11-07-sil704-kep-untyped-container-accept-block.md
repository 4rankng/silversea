# SIL-704 — Cổng lái xe chặn nhận lệnh 2 của cặp Kẹp khi vỏ container không còn chứng minh được

- **Case ID:** SIL-704-REG-1
- **Ticket:** plan.tingting.vip SIL-704 (internal id 824) — lái xe chạy Kẹp, nhận chân 1 xong, bấm nhận chân 2 báo 409 "Xe đang chạy chuyến MATS5148022000. Vui lòng hoàn thành chuyến đó trước." (ảnh Zalo 07/11)
- **Surface:** BE — `transitionTripStatus` nhánh IN_TRANSIT (driver "Nhận lệnh" `ORDER_RECEIVED` auto-start, `backend/src/services/driver-fulfillment.service.ts` → `backend/src/services/trip-status-machine.service.ts`)
- **Role:** DRIVER (nhận lệnh); DISPATCHER (phát cặp kẹp)

## Root cause

Accept-time declared-clamp proof (SIL-634) re-probe dữ liệu vật lý vỏ 20' (`provesSingleTwentyFootShellTx` — đúng 1 row `trip_containers` có code `20*`) trên CẢ HAI chân. Khi dữ liệu container của một chân không còn "proven" (row bị xóa/không type — luồng "bổ sung sau" `replaceTripContainersForFulfillment` chèn row `containerTypeId = null` khi `shipmentContainerId == null`), exemption tắt → chân 2 409 dù cặp Kẹp khai báo ĐÚNG hợp đồng (cùng xe + cùng lái + cùng ngày + cả hai chân `dispatchClassification='DOUBLE'`). Đây là lần thứ TƯ của cùng class lỗi "mệnh đề tái-xác-nhân thêm ở accept-time biến thành 409 prod": SIL-602 (moóc), SIL-631 (con dấu pointer), SIL-634 (bắt buộc pair row), SIL-704 (probe vỏ 20'). Luật pair (PRD LoHangKepKetHop §3.2/§7.3): khai báo + chung rig/ngày là đủ ở accept-time; dữ liệu vật lý vỏ thuộc issue-time (`dispatch-resource-availability.service.ts` giữ nguyên probe của nó; `ensureDeclaredKepContainerSize` chặn khai 40' ở mọi dispatch write).

## Reproduction (probe drift — `SIL704_DRIFT=1`)

1. 1 lô FCL 2×20DC → 2 chân khai DOUBLE, cùng xe/driver/ngày, KHÔNG pair row (dis-03: bookkeeping optional).
2. Phát lệnh cả 2 chân OK.
3. Mô phỏng drift: xóa `trip_containers` của cả hai chân (container data mất/không type).
4. Lái xe nhận chân A → IN_TRANSIT; nhận chân B.

### Observed

- **BASE 25dc1a2e** (backend archive `/tmp/sil-base-704`, port 3103): chân B **409** `Xe đang chạy chuyến TRP-202610-0068…` — log `qa/2026-11-07-lane-r1/sil704-api-kep_unpaired-BASE.log`
- **FIX (branch)** (port 3102): chân B **201**, cả hai chân IN_TRANSIT đồng thời — log `qa/2026-11-07-lane-r1/sil704-api-kep_unpaired-FIXED.log`

## Fix

`trip-busy-gate.ts`: bỏ conjunct probe vỏ 20' khỏi `isDeclaredKepClampPartner` (+ comment SIL-704); `trip-status-machine.service.ts`: bỏ `provesSingleTwentyFootShellTx` và 2 lần gọi. Giữ nguyên: exactly-1 shape-match, cả hai chân DOUBLE, cùng driver, cùng ngày, KẾT_HỢP không exempt, SINGLE chặn (SIL-638 TC1), pair row ACTIVE KEP exempt theo membership (SIL-602/631).

## Regression coverage

`backend/src/tests/unit/trip-status-machine.test.ts` — describe "SIL-634/SIL-704 declared Kẹp clamp without a pair row": REG SIL-704 (container data vắng/mất type vẫn exempt), các no-regression pin SINGLE/COMBINED/khác lái/khác ngày/missing day/self, wiring pin `provesSingleTwentyFootShellTx` không còn trên đường accept.

## Kết quả verify

- Unit: 50/50 (`trip-status-machine.test.ts`) + 46/46 (pair family) — `qa/2026-11-07-lane-r1/`
- API drift trước/sau như trên (before 409 / after 201).
- UI drive 390px (vite worktree :7196 → API :3102): nhận lệnh A rồi B bằng click thật "Nhận lệnh vận chuyển", không toast chặn — `sil704-api-kep_unpaired-ui2.log` + screenshots `sil704-ui-*.png`.
- Mode `kep_unpaired` container TYPED (không drift): PASS cả 2 build — fix không phá shape đã chạy (SIL-634). Mode `kep_paired` (ghép pair row ACTIVE KEP): PASS — SIL-602/631 không đổi.
