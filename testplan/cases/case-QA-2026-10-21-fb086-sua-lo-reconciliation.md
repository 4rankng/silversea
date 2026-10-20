# Case QA-2026-10-21-fb086-sua-lo-reconciliation — Sửa lô ở Chi tiết lô; container GIỮ read-only

## Card (201026234505, QA R29 — tiepvv, build a079aaf5)

FB-086: ở CHI TIẾT LÔ (`/shipments/:id`) KHÔNG có (1) nút SỬA LÔ, (2) nút THÊM
CONTAINER; `/shipments/965/edit` quay về trang chi tiết. QA kỳ vọng sửa lô để
thêm container bị thiếu khi tạo lô.

## Reconciliation (owner steer 21/10)

TICKET-09 (card 171026182554, 17/10) **supersede** FB-086 ở surface Chi tiết-lô:
khách KHÔNG muốn thêm/xóa container tại màn này — composition chỉ ở drawer Tổng
quan. Verdict R29 = invalid-at-surface cho phần container. Phần còn hợp lệ:
nút **Sửa lô** (sửa THÔNG TIN lô). Spec `testplan/roles/01-cus.md`: CUS "read &
write the shipment workspace"; backend `PUT /shipments/:id` +
`SHIPMENT_INTAKE_MUTATION_ROLES` đã cấp quyền — chỉ thiếu UI.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| FB086R-R1 | `/shipments/:id` role CUS/ADMIN/MANAGER/DISPATCHER, lô chưa khóa | nút **Sửa lô** đứng TRƯỚC "Tạo lô mới" (vẫn ngay trước "Xóa lô") |
| FB086R-R2 | role ACCOUNTANT, hoặc lô đã khóa kế toán | KHÔNG có nút Sửa lô |
| FB086R-R3 | bấm Sửa lô | picker "Sửa thông tin lô" với 6 nhóm: Khách hàng & nhà máy / Chứng từ / Phân loại & hãng tàu / Tổng quan hàng hóa / Lịch trình / Ghi chú |
| FB086R-R4 | lô FCL: nhóm Lịch trình | disabled + title "Lịch FCL được cập nhật theo từng container." |
| FB086R-R5 | chọn một nhóm → sửa → Lưu thay đổi | modal quick-edit dùng chung; lưu thành công → toast "Đã lưu ô dữ liệu lô hàng", header repaint, DB version +1 |
| FB086R-R6 | bất kỳ lúc nào ở màn này | KHÔNG có nút "Thêm container"/xóa container (TICKET-09 giữ vững) |
| FB086R-R7 | `/shipments/:id/edit` | vẫn land về trang chi tiết (card 358 giữ nguyên) |

## Verify (20-21/10/2026)

- Vitest: `ShipmentDetailPage.test.tsx` describe "Sửa lô affordance (FB-086 R29
  remainder)" — R1..R6 pins; `cusQuickEditModel.test.ts` `quickEditGroupGate`;
  full FE 5342/5343 (1 fail pre-existing `dev-port-contract`, A/B stash —
  script PWA worktree, không liên quan).
- UI DRIVEN: `qa/2026-10-20-fb086/` — BEFORE staging tiepvv/965 (R6, R7),
  AFTER local cus/311567 (R1..R5 + DB version 2→3,
  `shipping_line_name=QA-FB086-…`).

## Known limitations / 409 (không phải bug của fix)

- Lô READY_FOR_DISPATCH mà thiếu ngày vận chuyển (QA data cũ, ví dụ lô 311587
  local) sẽ 409 "phải giữ ngày vận chuyển" khi lưu bất kỳ nhóm nào — luật
  nghiệp vụ đã có của `updateShipment`, self-heal quick-edit rẽ nhánh đúng.
- Notes carve-out dưới khóa kế toán: server vẫn cho sửa GHI CHÚ trên lô đã
  khóa (ruling 2026-09-20, `shipment-update.service.ts`), nên Tổng quan giữ
  Ghi chú editable — host Chi tiết lô KHÔNG surface carve-out đó (nút Sửa lô
  ẩn khi khóa). Thu hẹp có chủ đích cho trang này; nếu QA cần sửa ghi chú lô
  khóa, dùng Tổng quan.
- L2 hygiene: state picker tự reset khi đổi `:id` trên cùng route (đã có
  useEffect; không có navigation detail→detail thật hôm nay).
