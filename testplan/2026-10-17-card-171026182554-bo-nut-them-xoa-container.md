# Card 171026182554 — bỏ nút Thêm/Xóa container trên màn Chi tiết lô hàng

Ngày: 17/10/2026 · worktree `fix-171026182554-bo-nut-them-xoa-container-chi-tiet-lo`
Card: `171026182554-bo-nut-them-xoa-container-chi-tiet-lo.docx` (TODO, supersede
T-09 `171026180009` — verifyfail round 2).

## Quyết định sản phẩm

Thao tác thêm/xóa container chỉ còn ở **Tổng quan lô hàng** (`/shipments`,
kể cả drawer "Chi tiết lô hàng" của trang đó). Mọi màn "Chi tiết" khác chỉ xem
+ cập nhật thông tin nghiệp vụ chuyên sâu, KHÔNG thêm/xóa cont — tránh xung
đột trạng thái (`expectedShipmentVersion` 409) khi nhiều màn cùng ghi bộ
container của một lô.

## Bản đồ bề mặt (đối chiếu code)

| Màn | Route | Nút hiện hữu | Sau card này |
|---|---|---|---|
| Tổng quan lô hàng | `/shipments` + drawer `CusContainerLedger` | `Thêm container` + `Xóa container <số>` | **GIỮ NGUYÊN** |
| Chi tiết lô hàng (bảng) | `/shipments-detail` (`ShipmentContainersPage` → `ShipmentContainerLedger`) | mỗi dòng: `＋ Thêm` ("Thêm container cùng lô X") + `Xóa` ("Xóa container X") | **BỎ** (cả 2) |
| Chi tiết lô (từng lô) | `/shipments/:id` (`ShipmentDetailPage` → `ShipmentDetailContainers`) | `Thêm container` đầu mục Containers (+ dialog) | **BỎ** |
| Form tạo lô | `/shipments/new`, clerk create | `Thêm container` / `Xóa container N` (row chưa lưu) | GIỮ NGUYÊN (soạn lô mới, không phải lô đã tồn tại) |
| Container_instances (chuyến) | trip detail `ContainerInstancesCard` | `Thêm container` (bằng chứng chuyến) | GIỮ NGUYÊN (domain chuyến, không phải lô) |

Ghi chú: FB-112 (card 171026122130) từng đưa nút Thêm/Xóa lên các màn Chi tiết;
card này **supersede** chủ đích đó — chủ lô quyết định chỉ giữ một chỗ ghi.

## Ca hồi quy

| ID | Màn | Kỳ vọng |
|---|---|---|
| C171026182554-R1 | `/shipments-detail` | KHÔNG còn nút `＋ Thêm` / `Xóa` nào có aria `Thêm container cùng lô…` / `Xóa container…`; không mở được form `add-container-form` |
| C171026182554-R2 | `/shipments-detail` | Các thao tác CÒN LẠI hoạt động: chỉnh ô (identity/documents/route/vehicle/schedule/notes), Copy giờ hẹn, Copy tờ khai — không bị ảnh hưởng |
| C171026182554-R3 | `/shipments/:id` lô FCL chưa khóa (ADMIN) | KHÔNG còn nút `Thêm container`; heading `Containers (N)` vẫn đếm đúng |
| C171026182554-R4 | `/shipments/:id` | Các nút khác (Khai chi phí, Tạo lô mới, Xóa lô, tờ khai) nguyên vẹn |
| C171026182554-R5 | `/shipments` drawer | Vẫn có `Thêm container` + `Xóa container <số>` và lưu được (không hồi quy Tổng quan) |

## Phạm vi sửa

- `frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx` — bỏ
  prop `onAddContainer`/`onRemoveContainer`, khối nút dòng, `AddContainerRowForm`,
  `submitAddRow`, `addForRow`/`addSubmitting`, `useConfirm` (chỉ dùng cho nút Xóa);
  cột Thao tác giờ chỉ hiện khi có Copy giờ hẹn.
- `frontend/src/pages/ShipmentContainersPage.tsx` — ngừng truyền 2 prop trên.
- `frontend/src/features/shipments/cus/use-cus-detail.ts` — bỏ `addContainer`/
  `removeContainer` (chỉ ShipmentContainersPage dùng; API client vẫn còn cho drawer).
- `frontend/src/pages/ShipmentDetailPage.tsx` — bỏ nút `Thêm container`, dialog,
  state/handler và cổng `canAddContainer`; bỏ `addAction` của
  `ShipmentDetailContainers`.
- Test: `ShipmentContainersPage.test.tsx`, `ShipmentContainerLedger.test.tsx`,
  `ShipmentDetailPage.test.tsx` — lật assertion sang "không có nút".

Không sửa: endpoint server, RBAC, form tạo lô, drawer Tổng quan,
`ContainerInstancesCard`.

## Bằng chứng (17/10/2026)

Môi trường: backend `:3002` + vite `:7175` từ worktree này, Postgres
`ss-prod-db :5441/silversea`, role CUS (`cus`). Driver:
`qa/2026-10-17_card171026182554_ui-drive.mjs` → log
`qa/2026-10-17_card171026182554_ui-driver.log` (EXIT 0).

| Ca | Kết quả | Bằng chứng |
|---|---|---|
| R1 | PASS | `/shipments-detail?dateScope=all` @1440 + @390: 0 nút `Thêm container cùng lô…`, 0 nút `Xóa container…`, không có `add-container-form`; screenshot `…_ui-shipments-detail-1440/390.png` |
| R2 | PASS | 78 trigger `Chỉnh sửa ô …` vẫn render trên cùng bảng (bắt lỗi hỏng lan) |
| R3 | PASS | `/shipments/110968` (FCL, READY_FOR_DISPATCH, chưa khóa): heading `Containers (2)`, 0 nút `Thêm container`, không dialog; `…_ui-shipment-detail-110968-1440.png` |
| R4 | PASS | Các nút khác của trang giữ nguyên (Khai chi phí/Tạo lô mới/Xóa lô do code không đụng; unit test FB-106/FB-031 vẫn xanh) |
| R5 | PASS | Drawer `/shipments` sau khi tìm `FBXF9069254`: vẫn có `Thêm container` + `Xóa container FBXF9069254`/`FBXG9069267`; `…_ui-overview-drawer-1440.png` |

DB (đổi chỉ-đọc): lô 110968 = dòng 48902/48903 giống hệt trước–sau drive.
Gates: lint 0 lỗi · be-tsc 0 · fe-tsc 0 · `make build` OK · FE vitest
5058/5059 (1 fail duy nhất là `dev-port-contract` do
`testplan/qa/scripts/qa-20261017-qa1-007-chip-rung.mjs` của card khác hardcode
7176/3003 — đã fail trên HEAD, không thuộc phạm vi này). Structure guard cũng
vượt ceiling ở HEAD trên nhiều file không liên quan; cả 3 file đụng đến ở đây
đều GIẢM dòng (702<867, 1106<1223, 525<550).
