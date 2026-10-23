# CUS-10 — nút XÓA CONTAINER trong drawer "Chi tiết container" (ruling Frank 21/10)

Ruling: bảng **Chi tiết lô** KHÔNG có nút thêm/xóa cont (TICKET-09 giữ nguyên);
DRAWER **"Chi tiết container"** (mở từ Tổng quan) CẦN CÓ nút xóa cont.

## Đã làm (frontend-only)

- `CusContainerLedgerRow.tsx`: nút per-row chuyển từ icon rác 26px (xóa NGAY,
  không confirm) thành nút **"Xóa container"** `btn btn--danger-outline
  btn--sm` (danger style, có nhãn; aria-label `Xóa container <số>` giữ nguyên).
- `CusContainerLedger.tsx`: thêm **ConfirmDialog `variant="danger"`** —
  "Xóa container <số>?" — chặn mọi đường xóa; API cũ
  `POST /shipments/cus-workspace/:id/containers/:containerId/remove` dùng
  nguyên trạng (không tạo API mới — caller `removeCusShipmentContainerRow`
  được test assert đúng từng tham số). Guard API giữ nguyên và surface đúng
  reason (đã điều xe / cont cuối FCL / version 409) qua toast; dialog MỞ LẠI
  sau lỗi để thử lại hoặc Hủy. Sau xóa thành công: `onLineSaved(null)` refresh
  danh sách + `onContainerRemoved()` đóng drawer.
- `ShipmentsPage.tsx`: gate role `canRemoveContainers` =
  ADMIN/MANAGER/CUS/DISPATCHER — mirror `requireWorkspaceWriter` của API
  (ACCOUNTANT/DRIVER không thấy nút); `onContainerRemoved={requestCloseMobileDetail}`
  — close có dirty-guard: nếu lô còn sửa chưa lưu ở hàng khác, dialog "bỏ
  thay đổi?" chặn việc đóng thay vì âm thầm vứt sửa (R5b).
- TICKET-09: KHÔNG đổi gì `features/shipments/detail/` hay
  `ShipmentContainersPage` — các pin "no add/remove" vitest vẫn xanh.

## Gates (final code)

- `cd frontend && npx tsgo -b` → exit 0 (`gates-typecheck.log`)
- Scoped vitest **388/388** — 9 file: CusContainerLedger 43 · ShipmentsPage
  138 · density + ceiling + TICKET-09 pins (ShipmentContainerLedger,
  ShipmentContainersPage) + draft-wipe + copy-appointment + declarations 207
  (`gates-vitest-scoped.log`)
- `pnpm lint` (root) → exit 0 (`gates-lint.log`)

## UI DRIVEN evidence (§9)

| Bước | Artifact | Run |
|---|---|---|
| Drawer trước xóa — nút "Xóa container" danger-outline trên 2 hàng | `ui-1-drawer-before.png` | B |
| Confirm "Xóa container QATU0001234?" (danger; API chưa gọi — removePosts=0) | `ui-2-confirm.png` | B |
| Sau xác nhận: drawer ĐÓNG + toast + list search theo cont đã xóa → 0 hàng "Không có lô hàng phù hợp" | `ui-3-after-delete-list.png` | B |
| Re-open drawer: "1 cont", cont đã xóa biến mất, survivor nguyên | `ui-4-drawer-after-reopen.png` | A (read-only, cùng build) |
| Mobile 390: nút visible, cao đúng 40px, trong viewport | `ui-5-drawer-390.png` | 390 run |
| Driver log (mọi run, đúng thứ tự) | `ui-driver.log` | — |
| DB trước: 2 cont (141259/141260), version 2 | `db-before.txt` | — |
| DB sau: 141260 MẤT (hard delete), version 2→3 | `db-after.txt` | — |

DOM assertions (trong log): button class `btn btn--danger-outline btn--sm
cus-container-row__remove` · dialog message chính xác "Xóa container
QATU0001234?" · confirm button `btn btn--danger btn--sm` · `removePosts=0`
trước confirm · POST …/containers/141260/remove → 200 ·
`.cus-shipment-drawer` biến mất sau xóa · toast "Đã xóa container
QATU0001234".

## Coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Nút "Xóa container" danger theo permission (4 writer roles; ACCOUNTANT/DRIVER ẩn) | UI DRIVEN (role CUS) + unit pin permission | `ui-1`, `ui-5`, `ui-driver.log`, vitest CUS-10 describe | UI-drive role ACCOUNTANT/DRIVER thật (chỉ unit pin) |
| Confirm chặn mis-click; Hủy không gọi API | UI DRIVEN | `ui-2`, log `removePosts=0`, vitest "Hủy never calls the API" | — |
| Guard 409 surface reason, dialog giữ mở | Unit + UI DRIVEN (happy path) | vitest 409 test; `toastActionError` | chưa UI-drive case 409 với lô gắn chuyến thật |
| Sau xóa: drawer đóng + danh sách mất cont + DB hard delete | UI DRIVEN | `ui-3` (0 hàng cho search cont), `ui-4`, `db-after.txt` (141260 gone, version 3) | — |
| Dirty-guard: xóa khi lô có sửa chưa lưu → dialog chặn đóng (R5b) | CODE-READ + design | `requestCloseMobileDetail` wiring | chưa UI-drive case dirty (documented follow-up) |
| Mobile 390 của nút vừa đổi CSS | UI DRIVEN | `ui-5` (40px floor, visible, in-viewport) | full 390 flow (chỉ layout check) |
| TICKET-09: bảng Chi tiết lô vẫn không có nút | CODE-READ + vitest pins | ShipmentContainerLedger.test / ShipmentContainersPage.test xanh (388 scoped) | — |
| Error/rollback path (remove 200 rồi refresh lỗi) | NOT TESTED | — | không có cơ chế rollback; onLineSaved throw → toast lỗi (giữ hành vi cũ) |

## Hạn chế / ghi chú môi trường

- Drive trên vite :7185 + backend :3012 của worktree (cùng DB ss-prod-db
  :5441/silversea) vì :3002 lúc đó không listener (hai tsx watch của task
  khác tranh chấp) — không đụng process của ai.
- Lot 311985 là fixture QA trên DB DÙNG CHUNG: một lane khác re-seed lúc
  09:52 (id cont mới 141259/141260) giữa 2 run — cả RUN A (xóa 141231) và
  RUN B (xóa 141260) đều là delete thật; restore qua add API fail đúng luật
  (validator ISO-6340 check-digit mà seed bỏ qua) nên lot dừng ở 1 cont.
- ui-4 đến từ RUN A (read-only re-open, cùng build) — RUN B không tái lập được
  re-open vì cont đã xóa đi khỏi danh sách tìm kiếm.
- Run A tail + RUN B tail gặp 2 bug driver-timing (đã sửa script: polling +
  0-row acceptance); RUN C là rerun sai (search cont đã xóa) — không đổi state.
