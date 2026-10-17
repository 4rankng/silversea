# FB-086 / FB-111 / FB-112 — vòng container trên màn CUS

Ngày: 17/10/2026 · worktree `fix-fb086-111-112-containers`
Card: `171026113520-fb086-verifyfail2-no-add-container-button.docx` (verifyfail2),
`171026122120-fb111-them-cont-moi-tu-copy-truong.docx` (P2),
`171026122130-fb112-chi-tiet-lo-nut-them-xoa-container.docx` (P2)

## Bản đồ bề mặt (đã đối chiếu code, không đoán theo tên card)

Ba card đều nói về "Chi tiết lô hàng" nhưng repo có **ba** màn khác nhau, và
đây là nguồn gốc của cả ba lỗi báo lại:

| Màn | Route | Component | Nơi có container CRUD |
|---|---|---|---|
| Tổng quan lô hàng | `/shipments` | `ShipmentsPage` + drawer `ShipmentDetailContent` | `CusContainerLedger` (section "Chi tiết container") — có `Thêm container` + `Xóa container` |
| Chi tiết lô hàng (bảng) | `/shipments-detail` | `ShipmentContainersPage` → `ShipmentContainerLedger` | ＋ `Thêm` / `Xóa` **theo từng dòng** trong cột Thao tác |
| Chi tiết lô hàng (lô) | `/shipments/:id` | `ShipmentDetailPage` → `ShipmentDetailContainers` | `Thêm container` ở đầu mục (chưa có Xóa) |

Card FB-086 chụp màn `/shipments/:id` (chuỗi `Containers (N)` + `Chưa có container
nào.` chỉ tồn tại ở `ShipmentDetailContainers.tsx`). Card FB-111 nói "bên Tổng
quan" = drawer trên `/shipments`. Card FB-112 yêu cầu nút Thêm/Xóa "trong phần
Chi tiết lô hàng" và bảo nút Thêm ở cuối bảng "Chi tiết container" của dialog
phải chạy được.

## FB-086 — verifyfail2

### (b) Không có nút 'Thêm container'

**Đã được sửa ở commit `0f669cb9` (17/10 12:34), SAU lúc card được gửi (11:35).**
Card là verify-fail của một build cũ. Xác minh lại trên build hiện tại:

- Rung 3: `/shipments/110250` (lô FCL tạo qua `POST /api/shipments/quick` kèm
  1 container) → heading `Containers (1)`, có đúng 1 nút `Thêm container`.
- Ca pin sẵn có: `ShipmentDetailPage.test.tsx:744-831`.

### (a) Lô có 1 container nhưng hiện 'Containers (0)'

Chưa tái hiện được trên build hiện tại — xem verdict ở mục "Bằng chứng" dưới.

Đường đọc không lọc: `getShipmentDetail` →
`listShipmentContainers(shipmentId)` lấy **mọi** `shipment_containers` của lô
(`backend/src/services/shipment-containers.service.ts:37-46`), rồi 3 decorator
(`decorateContainersWithIssuedVehicle` / `PairKind` / `PortNames`) đều `.map`
1-1, không `.filter`. Probe API: lô tạo với 1 container → payload chi tiết trả
`containers: 1`, tên `MSKU3868091`. UI đọc đúng `Containers (1)`.

**Phân biệt 2 hiện tượng dễ nhầm:** `transportDate` của dòng FCL trên bảng
`/shipments-detail` suy ra từ `shipment_containers.customer_appointment_at`
(`cus-workspace-sql.service.ts:216-219`), và mặc định trang lọc "hôm nay". Nên
container FCL **chưa có giờ hẹn** biến mất khỏi bảng đó — nhưng nó KHÔNG biến
mất khỏi `/shipments/:id`. `Containers (0)` mà card chụp là màn `/shipments/:id`,
nơi không có bộ lọc ngày nào.

## FB-111 — thêm container mới thì copy trường của dòng trên, trừ số/loại cont

**Luật đã có sẵn ở form tạo lô:** `createContainerFromPrevious`
(`shipment-create-model.ts:173-183`) copy mọi trường vận hành, chỉ xoá
`containerNumber` + `containerTypeId` (chính là 2 trường card nêu, rationale
card 071026100800: type copy sang dòng mới đọc như text lạc).

**Còn hỏng:** hai hàng "thêm container" ngoài form tạo lô đều mở ra trắng —
không áp luật đó:
- `CusContainerAddRow` (drawer `/shipments`) — `EMPTY_ADD_FIELDS`.
- `AddContainerRowForm` (`ShipmentContainerLedger`) — 5 `useState('')` rời rạc.

Cả hai đều đã có đủ cổng nhận: `shipmentCusContainerAddSchema`
(`shared/src/schemas/cus-shipment-workspace.ts:658-689`) nhận
`routeId`/`operationalSiteId`/`liftSiteId`/`dropoffSiteId`/`cargoWeightKg`/
`cargoVolumeCbm`/`customerAppointmentAt`.

## FB-112 — nút Thêm/Xóa container trong phần Chi tiết lô hàng

- `/shipments-detail`: đã có ＋ `Thêm` / `Xóa` mỗi dòng
  (`ShipmentContainerLedger.tsx:1170-1198`) — chạm thật (rung 3).
- `/shipments/:id`: mục `Containers` có `Thêm container` nhưng **không có Xóa**
  — lệch với "giống cụm nút ở Tổng quan" theo card.
- Dialog "Chi tiết lô hàng" (drawer `/shipments`): hàng thêm đã có, cần chứng
  minh nó chạy được (xem bằng chứng).

## Ca hồi quy

| ID | Màn | Kỳ vọng |
|---|---|---|
| FB086-R1 | `/shipments/:id` lô FCL có container | heading đếm đúng số container thật |
| FB086-R2 | `/shipments/:id` lô FCL, chưa khóa kế toán | có nút `Thêm container` |
| FB086-R3 | `/shipments/:id` lô đã khóa kế toán / LCL / đã kết thúc | KHÔNG có nút (không mở cổng chết) |
| FB111-R1 | drawer `/shipments`, bấm `Thêm container` | Tuyến/Nhà xe/Nâng/Hạ/TL/CBM/Giờ hẹn đã điền theo container trên cùng; **Số container** và **Loại cont** trống |
| FB111-R2 | lô chỉ có 1 container | dòng trên cùng là container đó → copy đủ |
| FB111-R3 | lô chưa có container nào | hàng thêm mở trắng (không có dòng để copy) |
| FB112-R1 | `/shipments/:id` | mỗi container có nút `Xóa container`, xác nhận trước khi xoá |
| FB112-R2 | bấm `Xóa container` → xác nhận | container biến khỏi danh sách + DB mất dòng |
| FB112-R3 | hủy xác nhận | không mất container |
| FB112-R4 | `/shipments-detail` | mỗi dòng có ＋ `Thêm` / `Xóa` |

## Bằng chứng

Môi trường: backend `:3002` (Postgres `:5441/silversea`), frontend vite `:7177`
(port `:7175` thuộc checkout khác — không đụng). Role CUS (`cus`).

- API probe `qa/tmp-probe.mjs`: tạo lô FCL 1 container qua đúng endpoint form
  dùng → `201`, `GET /api/shipments/110250` → `containers: 1`.
- UI driver `qa/tmp-ui.mjs`: `/shipments/110250` → `Containers (1)` + 1 nút
  `Thêm container`; `/shipments-detail?dateScope=all` → 6 nút hành động dòng
  đầu `["Thêm container cùng lô FBKU1234565","Xóa container FBKU1234565", …]`.

Lưu ý môi trường: lần đầu mở một route lazy của vite dev mất 10–20s (cold
compile) và ra màn "Đang tải…". Đó **không** phải lỗi sản phẩm — chờ rồi đọc
lại. Không được dùng làm bằng chứng.

## Phạm vi

Sửa: hai hàng thêm container (auto-copy FB-111) + nút Xóa ở `/shipments/:id`
(FB-112) + test FE.
Không sửa: luật server của endpoint thêm/xoá container, `createContainerFromPrevious`
(đã đúng), RBAC.