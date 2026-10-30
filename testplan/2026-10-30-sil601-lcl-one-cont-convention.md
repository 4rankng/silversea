# SIL-601 (id 702) — Quy ước hàng lẻ: mỗi lô lẻ = 1 lô cont 1 cont

- Nguồn: owner 30/10/2026 — ticket SIL-601 (id 702), plan.tingting.vip/tingtingsoft/SIL.
- Quy ước: đối với hàng lẻ (LCL), mỗi lô hàng lẻ tương đương 1 lô cont chỉ có
  1 cont. Ở mọi nơi hệ thống xử lý theo đơn vị lô/container — đếm lô, phân bổ
  xe, tính cước, hiển thị tổng quan và các luồng gộp lô — một lô lẻ được tính
  như một lô cont 1 cont: **không phải 0 cont, không phải nhiều cont**.
- FCL giữ nguyên số cont thật của lô (luật cũ không đổi).
- Không phá các law hiện hành: datetime 686-688 (giờ hẹn theo ICT), 615 (thu
  khách per-lot), 689-691 (cờ Lẻ/Ghép), FB-091 (ô tổng quan hàng hoá LCL in
  thành phần hàng, không "Chưa có cont"), 20260916_5 (demand LCL in "N lô").

## Tái hiện (trước fix)

Các nơi quy chiếu số cont của một lô hiện trả 2 họ sai lệch với quy ước:

1. **ZERO** — lô LCL không có dòng `shipment_containers` nên mọi đếm dựa trên
   dòng cont trả 0/absent: `containerCount: containers.length`
   (`shipment-detail-reads.service.ts`), `totalContainers = containers.length`
   (`cus-workspace-builders.service.ts`), `count(shipment_containers)`
   (`forwarder-trip-query.service.ts`), qty debit note
   (`billing-document-draft.service.ts` `input.containers.length`).
2. **NHIỀU** — lô LCL có nhiều chuyến active thì Σ `trips.container_count` > 1:
   `shipment-debit-summary.service.ts` `coalesce(sum(trips.container_count),0)`
   (SIL-478 phone meta "Bill · ngày · n cont").
3. Lô LCL chưa có chuyến → meta `containerCount` null/0 → FE bỏ segment hoặc in 0.

## Kỳ vọng sau fix

- Mọi phép đếm/hiển thị theo đơn vị lô/container: lô LCL đọc đúng **1** — không
  0, không N.
- Số cont thật của lô FCL không đổi ở mọi nơi.
- Demand phân bổ xe giữ bucket riêng "N lô" (1 lô lẻ = 1 đơn vị), không nhập
  lô lẻ vào 20'/40'.

## Case ID

- SIL-601-C1: helper dùng chung — lô LCL luôn ra 1 cont; FCL giữ số thật
  (unit test pure, không db).
  → `shared/src/constants/lcl-lot-cont.test.ts` (3 tests).
- SIL-601-C2: debit summary phone meta `containerCount` = 1 cho lô LCL có N
  chuyến active (không phải Σ) và = 1 cho lô chưa có chuyến khi lot scope có
  chuyến hay không — đúng contract "1 lô lẻ = 1 cont".
  → `backend/src/tests/unit/shipment-debit-summary-row-meta.test.ts` (pin
  `effectiveLotContainerCount(lot.cargoMode, …)`).
- SIL-601-C3: mọi projection backend per-lot cont count (detail reads, CUS
  workspace totals, forwarder query, billing draft qty) = 1 cho LCL.
  → `backend/src/tests/unit/lcl-lot-cont-count-law.test.ts` (8 site pins:
  debit meta · detail reads · workspace · forwarder · billing qty · ops
  orders · readiness advisory · settlement cargoMode).
- SIL-601-C4: display FE theo đơn vị cont của lô LCL hiện 1 (không 0/—/N).
  → `frontend/src/features/shipments/cus/cusUtils.lot-cont.test.ts` (3),
  `frontend/src/pages/OpsOrdersPage.test.tsx` ('1 cont' cell),
  `frontend/src/pages/admin-advance-settlement-summary.test.ts` (KPI + plan
  row = 1 cho LCL).
- SIL-601-C5: luồng gộp lô (merge/unmerge, debit merge bar) đếm mỗi lô lẻ là 1
  đơn vị; tổng cont của nhóm = số lô thành viên.
  → đã conform sẵn (lcl-grouping.service memberCount = số LÔ; các chuỗi
  "N lô" là lot-unit 1/lô — không cần sửa; đối chiếu BE sweep #41).
- SIL-601-C6 (regression guard): FCL không đổi — 2-cont lot vẫn ra 2 ở mọi nơi;
  FB-091/20260916_5/615/686-688/689-691 laws giữ nguyên (test pin hiện hành
  vẫn xanh).
  → full gates green (qa/2026-10-30_sil601_*.log).

## Phạm vi đã rà (không đổi — có chủ đích)

- Cấu trúc cont (containerCount20/40, containerTypeSummary, containerTotal của
  dispatch aggregates): là FACT cấu trúc cont của lô FCL (kích thước, dòng
  cont) — lô LCL không có cấu trúc này và hiển thị theo FB-091/§9.1 (thành
  phần hàng + cờ Lẻ). Unit-count của lô LCL phía demand đã là 1 ("N lô",
  ruling 20260916_5). Đổi containerTotal sẽ mở nhầm khối demand cont trên
  dòng LCL (phá FB-091) — GIỮ NGUYÊN.
- Cột liệt kê SỐ CONT/Container (billing-export-legacy 'Số cont',
  statement 'Số Container', work-inbox subtitle): liệt kê identity cont
  (MSKU…) — lô Lẻ không có số cont, hiển thị trống/— là đúng identity, không
  phải "đếm = 0".
- Split 20/40 (sl20/sl40) của cont ảo: không suy diễn kích thước — bỏ trống.
- Trip-grain "Số lượng cont" (trip form, multipliers): đơn vị của CHUYẾN,
  mặc định 1 = khớp quy ước; không clamp thêm (ngoài phạm vi lô).
- Multi-lot consolidated trip tại trip-grain rows (advance settlements):
  hiển thị tải trọng cont của CHUYẾN (tripContainerCount), không phải tổng
  per-lot — ghi nhận là giới hạn diễn giải (cần owner nếu muốn đổi).

