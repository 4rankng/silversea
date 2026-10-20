# Testplan — FB-095 (Điều vận thiếu nút xóa lô — "lô chính" nhóm LCL)

Card: `211026005623` — "Điều vận KHÔNG có nút xóa lô chính" (QA dòng FB-095
LCL grouping). Ngày: 2026-10-21. Môi trường: local (`make dev`), test accounts
`testplan/testaccounts.txt`.

## Điều tra → verdict (a) — nút thiếu thật

- Nút "Xóa lô" chỉ có ở 2 surface CUS/Admin: drawer `/shipments`
  (`ShipmentsPage.tsx` `canDeleteLot = CUS || ADMIN`) và header
  `/shipments/:id` (`ShipmentDetailPage.tsx` card 091026225720/FB-031) — cùng
  một flow: confirm + lý do → `deleteCusShipment` → `DELETE
  /api/shipments/cus-workspace/:id` → `requestShipmentDelete` (service law
  "Chỉ CUS hoặc Quản trị viên", cards 20261007_396/204710 + user directive
  2026-09-10) → `softDeleteShipment` + `promoteLclGroupsOnShipmentDelete`
  (FB-095 auto-promote/dissolve — FB095-06).
- Surface Điều vận: `/dispatch` (MasterPlanPage) + `/dispatch-detail`
  (DispatchDetailPlanPage → DetailedPlanGrid, bảng lô có badge "Lẻ · Ghép
  (i/N)" + "Tách nhóm" trên Lô 1) — KHÔNG có bất kỳ affordance xóa lô nào cho
  role nào. "Lô chính" (host lot, `lcl.group.order === 1`) vì thế không xóa
  được tại surface Điều vận.
- Không tồn tại gate "phải giải tán nhóm trước" (giả thuyết verdict (b) —
  phủ định): xóa host lot khi nhóm còn member là hợp lệ server-side theo luật
  promote-on-delete (FB-095 §"Xóa Lô 1", FB095-06). Nút chỉ đơn thuần thiếu.

**Verdict: (a)** — thêm đúng flow xóa existing (confirm dialog + lý do, audit
`SHIPMENT_DELETED` + `SHIPMENT_LCL_GROUP_UNMERGED`, guards nhóm LCL giữ nguyên
`promoteLclGroupsOnShipmentDelete`/`assertGroupMutable`). KHÔNG nới role:
gate giữ nguyên `canDeleteLot = CUS || ADMIN` như 2 surface kia
(`requestShipmentDelete` 403 mọi role khác). DISPATCHER/MANAGER không được
xóa (ruling giữ nguyên) — nút vẫn hiển thị và trả lời bằng nguyên văn luật
service thay vì biến mất (card 20260923_1).

## Case hồi quy

### FB095-UI-05 — nút "Xóa lô" trên mọi hàng lô /dispatch-detail, theo role
- **Repro**: đăng nhập ADMIN (được xóa lô theo law CUS/ADMIN) mở
  `/dispatch-detail`;对照 đăng nhập DISPATCHER (`dungnv`).
- **Kỳ vọng**: mọi hàng lô (gồm hàng "lô chính" — badge "Lẻ · Ghép (1/N)" +
  "Tách nhóm") có "Xóa lô" trong cụm row action (ô Ghi chú). ADMIN/CUS bấm
  → mở flow xóa (FB095-UI-06). DISPATCHER/MANAGER bấm → banner
  `role="alert"` nguyên văn luật service "Chỉ CUS hoặc Quản trị viên mới
  được yêu cầu xóa lô hàng." — KHÔNG mở dialog, KHÔNG gọi API (affordance
  trả lời bằng lý do thay vì biến mất — card 20260923_1; role law giữ
  nguyên, không nới guard). Trang chưa nhận `onDeleteLot` (dùng khác) →
  không render nút (parity với "Tách nhóm"/"Hủy ghép").
- **Test**: `DispatchDetailPlanPage.delete-lot.test.tsx`.

### FB095-UI-06 — xóa lô chính: confirm nêu luật FB-095 → DELETE + toast + refresh
- **Repro**: hàng "lô chính" nhóm COST N lô (không có chuyến live), bấm
  "Xóa lô".
- **Kỳ vọng**: modal "Xóa lô hàng" + lý do (bắt buộc) + dòng law FB-095
  "xóa Lô chính chuyển 100% cước trả ĐV cho lô kế tiếp (N=2: nhóm giải tán)".
  Xác nhận → `deleteCusShipment(shipmentId, shipmentVersion, lý do)` (DELETE
  `/api/shipments/cus-workspace/:id`); thành công → toast nêu Số Bill/Booking
  + lưới refresh. Server 409 (đã phát lệnh / nhóm chốt kế toán) → toast lỗi
  nguyên văn, không refresh.
- **Test**: `DispatchDetailPlanPage.delete-lot.test.tsx`; UI DRIVEN local
  (`testplan/qa/scripts/fb095-dieuvan-delete-lot-20261021.mjs`) với DB
  side-effect proof (soft-delete + audit + survivor promote/dissolve).

### FB095-UI-07 — xóa thành viên nhóm: copy nêu Lô 1 giữ 100% cước
- **Repro**: hàng thành viên (order > 1) nhóm N lô, bấm "Xóa lô".
- **Kỳ vọng**: modal nêu "Lô 1 giữ nguyên 100% cước trả ĐV; các thành viên
  còn lại được đánh số lại" (N=2: nhóm giải tán) — cùng luật
  `promoteLclGroupsOnShipmentDelete` nhánh member. Flow xác nhận như
  FB095-UI-06.
- **Test**: `DispatchDetailPlanPage.delete-lot.test.tsx`.

## Phạm vi hồi quy trước khi sửa

| # | Khu vực | Rủi ro | Kiểm bằng |
|---|---|---|---|
| R1 | `ShipmentActionModal` (contract nới `actionItem`) | drawer flow `/shipments` đổi hành vi | ShipmentsPage.test.tsx xanh nguyên vẹn |
| R2 | DetailedPlanGrid row actions (thêm nút) | lệch render/aria các nút cũ | các test grid hiện có + FB095-UI-05 |
| R3 | `requestShipmentDelete`/`softDeleteShipment`/`promoteLclGroupsOnShipmentDelete` | KHÔNG đụng backend | FB095-01..06/C2-01..03 giữ nguyên (không sửa BE); UI DRIVEN prove promote-on-delete chạy đúng luật |
| R4 | Frontend typecheck/compile | prop/typo | `npx tsgo -b` exit 0 |

## Giới hạn ghi nhận

- `/dispatch` (MasterPlanPage) không thêm nút xóa — ngoài card (QA repro tại
  bảng lô Điều vận có badge nhóm/"Tách nhóm" = `/dispatch-detail`); ghi ở
  coverage.
- MANAGER không có nút (parity 2 surface kia + service law CUS/ADMIN) —
  ngoài phạm vi, không nới role.

## Evidence — UI DRIVEN rung 3 (2026-10-21, local dev)

Driver `testplan/qa/scripts/fb095-dieuvan-delete-lot-20261021.mjs`
(`QA_BASE=http://localhost:7181` — vite ad-hoc từ worktree này; backend
:3002 + DB :5441 local dev) — **26/26 PASS, exit 0**. Artifacts
`qa/2026-10-21-fb095/`:

- `…_ui-driver.log` (lệnh + exit status ở footer), `…_fixtures.json`,
  `…_db-after.json`.
- PNG: `ui-01-before` (hàng "lô chính" badge "Lẻ · Ghép (1/2)" + nút Xóa lô),
  `ui-02-confirm` (modal + notice FB-095), `ui-03-after` (toast "Đã xóa lô"),
  `ui-04-grid-after` (hàng host biến mất), `ui-05-dieuvan-role-law` (banner
  luật role), `ui-06-w390/w768/w1440`.
- DB: host `311938` soft-deleted (`deleted_at` set; actor = audit
  "Quản trị viên Trần Văn Admin"), survivor `311939` `cost_group_id`/`order`
  null (dissolve — FB-095 promote-on-delete), audit `SHIPMENT_DELETED` +
  `SHIPMENT_LCL_GROUP_UNMERGED` `"cause":"DELETE"` `"dissolved":true`.

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Điều vận surface có "Xóa lô" cho lô chính; ADMIN xóa thật được (FB095-UI-06) | UI DRIVEN | ui-01..04 PNG + driver UI-01..07 + db-after.json | role CUS tại surface này (route dispatch-only, CUS không mở được /dispatch-detail); server 409 live (fixture chưa phát lệnh — nhánh 409 pin bằng unit FB095-UI-06b) |
| Role law không nới: DISPATCHER bấm → banner nguyên văn, không API (FB095-UI-05b) | UI DRIVEN | ui-05 PNG + driver UI-08..11 | MANAGER (cùng nhánh gate `canDeleteLot=false`, pin unit; không có tài khoản local để drive) |
| FB-095 promote-on-delete: host xóa → survivor dissolve + audit cause DELETE | UI DRIVEN (DB) | db-after.json + driver DB-01..04 | nhánh chuyển tiền (fixture không có chuyến live ⇒ transferredAmount null; luật promote-money giữ bởi FB095-01/02/05/06 unit) |
| Nút + banner không clip ở 390/768/1440 | UI DRIVEN | ui-06-w*.png + driver UI-12 | card-mode sâu / notes dài; visual sweep toàn route (`role-ui-sweep.mjs`) — ngoài scope card |
| FB095-UI-05..07 flow unit (role gate, confirm copy, reason required, gọi API đúng args, 409 giữ dialog) | automated unit | `DispatchDetailPlanPage.delete-lot.test.tsx` 5/5; scoped vitest 599/599 | — |
| `/dispatch` (MasterPlanPage) không nút xóa | NOT TESTED (cố ý ngoài card) | — | thêm affordance tại master plan — cần card/ruling riêng |
