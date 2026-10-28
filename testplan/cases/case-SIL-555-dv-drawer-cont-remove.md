# SIL-555 — Drawer "Chi tiết container": nút XÓA CONT từng hàng (ticket id 629)

- Ticket: SIL-555 (board SIL, internal id 629, Bug/Done-pending-QA) — drawer
  "Chi tiết container" của Kế hoạch Tổng quát (`/dispatch`,
  `DispatchContainerDetailDrawer`) không có điều khiển xóa dòng container:
  cont thêm nhầm (MSKU5500004 vào lô K2K4124325234, QA SIL-550 build
  9094e31c) không xóa được.
- Repro ticket: role dungnv (Điều vận / DISPATCHER), lô FCL 2 cont.
- API xóa sẵn có: `POST /api/shipments/cus-workspace/:id/containers/:containerId/remove`
  (`removeCusShipmentContainer`, guards SIL-177 tờ khai / chuyến xe / FCL
  ≥1 cont / READY còn dòng hẹn / khóa kế toán / version) — FE thiếu caller.

## Case pin (expected sau thay đổi)

1. **Nút XÓA CONT từng hàng**: bảng drawer có cột **Thao tác** (cuối cùng),
   mỗi dòng một nút nguy hiểm nhãn "Xóa container" (aria-label
   `Xóa container <số|cont N>`, pattern CUS-10 btn--danger-outline btn--sm)
   — và CHỈ drawer có nút này (bảng "Chi tiết lô" giữ nguyên không
   thêm/xóa — SIL-334 / SIL-177).
2. **Hộp thoại xác nhận (SIL-472)**: bấm nút → `ConfirmDialog` danger
   "Xóa container <số>?" với nút xác nhận "Xóa container" — xác nhận gọi
   `removeCusShipmentContainerRow(shipmentId, containerId,
   { expectedShipmentVersion })` + Idempotency-Key → dòng biến mất, drawer
   refetch, board `/dispatch` refetch qua `onSaved`, toast "Đã xóa container
   <số>.". Hủy → không xóa, không gọi API.
3. **Guards (SIL-177)**: dòng mang số tờ khai → nút disabled, tooltip
   "Cont có tờ khai <số> — gỡ tờ khai trước khi xóa" (FE không warn-and-allow
   vượt guard BE). Dòng đã gắn chuyến (tripId khác null, tripStatus khác
   CANCELED) → disabled, tooltip "Không thể xóa container đã gắn chuyến xe".
4. **Gate chủ/khóa**: role ngoài ADMIN/MANAGER/CUS/DISPATCHER (ACCOUNTANT,
   DRIVER…) không thấy nút; lô khóa kế toán (activeLock khác null) không
   thấy nút (khớp gate Thêm container cùng drawer).
5. **Guard rejection giữ dialog**: API 409 (hết cont cuối / chuyến xe / version)
   → toast nguyên văn lý do, dialog giữ mở cho retry/Hủy; refetch resync để
   retry mang version mới (đồng luật với luồng Thêm container SIL-550).
6. Không đổi bề mặt khác: bảng "Chi tiết lô" (`ShipmentContainerLedger`) và
   màn Chi tiết container (`ShipmentContainersPage`) tiếp tục KHÔNG có nút
   thêm/xóa (pin test hiện có).

## Regression evidence (qa/2026-10-28_sil555-drawer-del/)

- `vitest-scoped.log` — scoped vitest 45 file / 679 test PASS (master-plan +
  ShipmentContainerLedger + ShipmentContainersPage + ShipmentsPage + cus
  suites — các pin "bảng Chi tiết lô không thêm/xóa" giữ nguyên); `tsc.log` —
  `npx tsc -b` EXIT 0; eslint changed files 0 errors.
- UI drive `qa/scripts/2026-10-28-sil555-drawer-del-ui-drive.mjs` EXIT=0
  (12/12 checks, `run1/assertions.json`), role dungnv (DISPATCHER), lô
  SHP-2610-00157 / R42RV-FCL (id 240): cột THAO TÁC + nút Xóa container
  (ui-1), guard SIL-177 disable + tooltip (ui-2/3), gỡ tờ khai → enabled
  (ui-4), confirm "Xóa container MSKU8234567?" (ui-5), xóa thật + toast +
  refetch về 2 cont (ui-6), stacked 390 (ui-7); `db-before.txt`/
  `db-after.txt` — throwaway tự xóa bởi flow under test, 2 dòng gốc nguyên
  vẹn (SIL-472 contract).
