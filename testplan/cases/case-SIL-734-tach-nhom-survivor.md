# SIL-734 (id 854) — Bảo toàn cước Tách nhóm / Xóa Lô chính LCL

- Ticket: SIL-734 (board SIL, id 854, tạo 07/11/2026, HIGH). Lane K1.
- Surface: chot-debit + Chi phí - Quyết toán (Tách nhóm), backend
  lcl-grouping.service.ts (unmerge/promote/pricing), shipment-lifecycle
  (delete hook).

## Bug / gap (trước fix)

(a) Nút [Tách nhóm] per-row trên chot-debit chỉ render khi `revGroupId != null`
— dòng ghép COST (revGroupId null, costGroupId set — case R42) không có lối
vào row-level, chỉ còn strip ≥2 chọn.
(b) Tách nhóm CẢ NHÓM (REV) restore pre-merge; khi không có pre-merge thật
(member tạo sau merge / capture 0) → kẹt 0₫ CƯỚC VẬN TẢI AUTO + TỔNG PHẢI
THU; FB-145 lại XÓA `revVehicleClassId` ngay trên đường đó → khóa tra bảng giá.
(c) Xóa Lô chính: engine survivor (promotePrincipalOnRemoval +
promoteLclGroupsOnShipmentDelete, bật 26/10) — DB tests đã xóa theo owner
ruling 19/10 (da4d2f0b), chỉ còn regex pins; incident 3.500.000₫ (SIL-489,
read-side) đã fix 26/10. Cần kiểm chứng full chain + tiền không mất đồng nào.

## Case pin (expected sau thay đổi)

1. (a) Dòng ghép REV hoặc COST trên chot-debit đều có nút [Tách nhóm] per-row
   (dimension đúng nhóm); dòng cost-locked vẫn bị chặn với lý do nguyên văn.
2. (b) Tách cả nhóm REV, member không có pre-merge thật → tự tra Bảng giá
   theo lane key của TỪNG lô (revVehicleClassId + route + customer + ngày,
   capture TRƯỚC khi xóa class); tra trúng → ghi tiền + reason ngoài nhóm;
   tra trượt → giữ cited 'Chờ tra lại bảng giá' (KHÔNG tự chế số).
   Member có pre-merge thật → restore giữ luật (tiền về đúng số trước ghép).
3. (b-pin) Tổng nhóm trước tách = Σ tiền sau tách từng lô (không phát sinh,
   không mất).
4. (c) Xóa Lô 1 (trong group): survivor kế vị nhận 100% cước (REV thu + COST
   trả/manual + driver) + order=1 + giữ BKS ảo; leaver ghost-guard: các reader
   principal chỉ đọc dòng live; tổng bảo toàn.
5. Không dùng lại tiền ở 2 dòng live (leaver đã xóa mới được giữ snapshot).

## Regression evidence

- (điền sau) BE unit tests mới (re-price decision pure + source pins) +
  FE test COST row button + probe thật trên local DB (qa driver) nếu stack
  chạy, qa/2026-11-07-lane-k1/.

## Round 2 — QA fail 09/11 (staging build c4cea6b6, comment 4786) + fix r8a

**Fail thật:** Tách nhóm chạy được (POST 200, cả 2 lô rời nhóm) nhưng lot 172
(R40B1-LCL01, ex-order-2) đọc CƯỚC TRẢ ĐV 0₫ / TỔNG TRẢ 0₫ trên chot-debit
trong khi lô chính 173 + control legs 184/185 đọc 'Thiếu' — 0₫ do merge COST
stamped, không phải bảng giá.

**Root cause (đã probe staging 09/11):** merge COST ("Gán xe nhóm") zero
`trip_carrier_info.external_freight_cost = '0'` cho member 2..N ("nhảy tiền").
Tách nhóm COST (cả nhóm lẫn 1 lô) KHÔNG chạm member/leaver trips → 0₫ stamped
đứng yên; board chot-debit đọc Σ external_freight_cost per lot → 0₫ "sống".
Số liệu thật: trip 61 (shipment 172) externalFreightCost="0", revGroup null.

**Fix round 2 (chiều COST — mirror luật REV của K1):**
1. `lcl-cost-group-freight.service` thêm `repriceCostLotAfterSplit`: chỉ owns
   stamped 0₫ (null = đã honest, non-zero = tiền own — giữ nguyên); tra
   `resolveCarrierVehicleClassPrice` (tuyến × loại xe capture từ row
   in-memory TRƯỚC khi patch xóa cột + supplier từ fulfillment channel nhà xe
   của nhóm + ngày giao/ departure); trúng → ghi giá + mirror planned;
   trượt → XÓA stamp 0₫ về null ('Thiếu cước trả ĐV' honest) cả trip lẫn
   plannedCarrierCost (`clearPlannedCarrierCost` mới) — không tự chế số.
2. Wire vào `unmergeLclGroup` (COST: walk mọi member) + `unmergeLclLot`
   (COST: leaver cả 2 vị trí; order-1 reload fresh facts sau promote — cùng
   bẫy SIL-539 REV đã fix) + outcome trả về response + audit payload.
3. Delete-hook (xóa lô chính) không re-price (leaver đang bị xóa; promotee
   nhận 100% theo luật cũ — giữ nguyên).

**Pins:** `lcl-unmerge-reprice-survivor.test.ts` 3 pins (d) mới + SIL-493
mirror-seam pin cập nhật 4→5 seam; BE unit full 342 files pass; tsc BE 0.
