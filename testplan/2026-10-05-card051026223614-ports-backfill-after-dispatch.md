# Card 051026223614 — Bổ sung cảng nâng/hạ sau điều xe trên Kế hoạch Tổng quát (regression case)

Case ID: TC-PORTS-BACKFILL-01
Feature: drawer "Chi tiết container" trên Kế hoạch Tổng quát (`/dispatch`, `MasterPlanPage`) — hai cột Cảng nâng / Cảng hạ trở thành bộ chọn danh mục cảng khi backend cấp quyền (`fieldAccess` DIRECT), lưu qua đúng route container-line hiện có.

## Bối cảnh thẻ (retest #358)
Card 358 đã hạ cánh quyền bổ sung cảng sau điều xe ở backend (commit 0184a5bc: `containerFieldAccess` cho `liftSiteId`/`dropoffSiteId` DIRECT không kèm điều kiện đã-gắn-chuyến, writer bỏ chặn value-aware) và trên bảng Chi tiết (`ShipmentContainerLedger`). Nhưng dispatcher làm việc trên Kế hoạch Tổng quát: ô cảng trên bảng là hiển thị, drawer "Chi tiết container" chỉ xem, dialog điều phối không có trường cảng — **không còn UI nào để bổ sung**. Thẻ chốt phương án 1: cho phép bổ sung cảng sau điều xe.

## Bề mặt đã chọn
`frontend/src/features/dispatch/master-plan/DispatchContainerDetailDrawer.tsx` — đúng bề mặt repro "chi tiết container chỉ xem", đã sẵn dữ liệu (`ShipmentCusWorkspaceDetail` chứa `fieldAccess`, `selectors.ports`, `liftSiteId`/`dropoffSiteId`, `shipmentVersion`) và mutation sẵn có `POST /api/shipments/cus-workspace/:id/containers/:containerId` (đã `declareMaterialWrite`, idempotent, `requireRoles(ADMIN, MANAGER, CUS, DISPATCHER)`, khóa kế toán chặn ở `assertShipmentAccountingUnlocked`). Không thêm backend, không đổi schema.

## Expected (sau khi sửa)
- Khi `fieldAccess.liftSiteId/dropoffSiteId.mode === 'DIRECT'` (ADMIN/MANAGER/CUS/DISPATCHER, chưa khóa kế toán — cả container đã gắn chuyến): ô Nâng/Hạ trong drawer là `SearchableSelect` danh mục cảng Master-Data (không free-text), có nhãn accessible "Cảng nâng/hạ của container <số>", chọn là lưu ngay (one-shot, Idempotency-Key tự sinh), gửi đúng `{ expectedShipmentVersion, liftSiteId | dropoffSiteId }` — chỉ trường vừa đổi.
- Bỏ chọn ("Bỏ chọn") gửi `null` — xóa cảng là sửa đúng, writer value-aware chấp nhận.
- Lưu thành công: drawer tự tải lại chi tiết (giá trị bền vững), gọi `onSaved` → `MasterPlanPage` refetch → cột CẢNG NÂNG/HẠ trên bảng đọc lại từ cùng cột container (`pickupPortId`/`dropoffPortId`) và hiện cảng mới.
- Lưu lỗi (409 catalog/version, role chặn phía server): thông báo lỗi server hiện `role="alert"`, drawer refetch để ô chọn snap về giá trị đã lưu; board không refetch.
- Role không có quyền / lô đã khóa kế toán: `fieldAccess` READ_ONLY → ô giữ dạng text tĩnh ("—" khi trống), KHÔNG render bộ chọn; header drawer giữ câu "Chỉ xem tại đây…". Server vẫn là rào chặn cuối (`requireRoles` + khóa kế toán + guard value-aware).
- Trong lúc lưu: các bộ chọn cảng disable (version lot đổi sau mỗi lần lưu — chọn song song sẽ 409, refetch sau lưu cấp version mới).

## Automated pins
`frontend/src/features/dispatch/master-plan/DispatchContainerDetailDrawer.test.tsx`:
1. DIRECT → hai ô cảng thành bộ chọn, header bỏ câu "chỉ xem"; chọn cảng nâng gọi `updateCusShipmentContainerLine(1, 10, { expectedShipmentVersion: 7, liftSiteId: 7 })`, refetch chi tiết lần 2, gọi `onSaved`.
2. READ_ONLY (khóa kế toán/vai trò thiếu quyền) → không có bộ chọn, text tĩnh, không gọi mutation.
3. Lưu lỗi → `role="alert"` mang đúng thông báo server, không gọi `onSaved`, refetch đồng bộ lại.

## Not covered bởi hồ sơ này
- Bằng chứng UI DRIVEN (rung 3, AGENTS §9) trên staging: chụp màn hình thật + thao tác thật do lane chính thực hiện sau deploy (lô tái hiện E2E-BILL-001 — cảng trống, đã phân bổ SilverSea 1x20', container Hoàn thành).
- Dialog "Chỉnh sửa điều phối" (Kế hoạch Chi tiết) vẫn không có trường cảng — không thuộc bề mặt đã chọn của thẻ này; một bề mặt đủ theo phương án 1.
- Role thực không nằm trong danh sách (OPS, driver…) nhìn drawer: pin bằng `fieldAccess` READ_ONLY ở mức component; chưa rung từng role thật.
