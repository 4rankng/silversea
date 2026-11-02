# SIL-653 (id 760) — Số cont nhập SAU khi phát lệnh đồng bộ cả 3 phía

Lane: `fix-sil-653` (worktree wave653). Base `origin/main` `1fd89c3b`.

## Đã làm

### Chiều A — Điều vận/CUS → lái xe (BE)

1. **Bỏ lock 409 chung, thay bằng lock theo field** —
   `backend/src/services/shipment-containers.service.ts`,
   `reconcileShipmentContainersWithFulfillmentGuard`:
   - 409 blanket `'Không thể thay đổi container sau khi đã phát hành lệnh điều xe…'` bị
     XOÁ (nó khoá cả số cont — kể cả khi số cont đó null từ lúc snapshot).
   - Giữ nguyên luật SIL-644 (id 749) cho field **cấu trúc**: loại cont / tuyến /
     lịch hẹn / nhà máy / phân loại vẫn 409 — cả với lô đã phát lệnh, với thông
     điệp riêng: *"Lệnh điều xe đã được phát — chỉ số container/seal được cập nhật
     trực tiếp…"*.
   - Trọng tải/CBM: khoá **sau** khi phát lệnh (đồng nhất với luật CUS ledger
     SIL-644 — giá trị đã chốt theo phương án tính cước); 409 riêng.
   - Tự do sau phát lệnh: **số cont, seal** (identity) + hãng tàu / tờ khai / ghi chú
     (annotation — không phải tham số chuyến xe lập kế hoạch từ nó; khoá sẽ 409 oan
     các save lặp lại từ drawer "Sửa thông tin lô").
2. **Cầu đồng bộ xuôi (lot → trip snapshot)** — `reconcileShipmentContainersInTx`
   gọi `syncTripSnapshotIdentityFromShipmentContainer()` (helper mới, export cùng
   file) khi reconcile thực sự **đổi** số cont của một dòng: mọi `trip_containers`
   có `source_shipment_container_id` trỏ về dòng đó được ghi đè số mới → app lái xe
   thấy ngay. Seal **không** mirror chiều này (giữ nguyên evidence multi-seal của
   lái xe — `trip_container_seals`).
3. **Cùng cầu đó chạy cho đường CUS workspace** —
   `backend/src/services/cus-shipment-workspace-writes.service.ts`
   (`updateCusShipmentContainerLine`): lệnh sửa dòng của CUS vốn đã cho sửa số cont
   sau phát lệnh (identity exemption có sẵn) nhưng không lan xuống trip — giờ gọi
   forward bridge ngay sau khi ghi `shipment_containers.container_number`.

### Chiều B — lái xe → Điều vận/CUS (BE)

Helper ngược `syncShipmentIdentityFromTripContainers()` trong
`shipment-containers.service.ts`, được **3 đường ghi trip-side** gọi trong cùng
transaction (`backend/src/services/forwarder-container.service.ts`):

- `updateTripContainerInClient` (driver "Số cont & seal" PATCH
  `/api/driver/me/trips/:tripId/containers/:containerId`),
- `batchUpsertContainerSeals` (driver PUT seals — primary seal mirror lên lot),
- `batchUpsertTripContainers` (PUT `/api/trips/:id/containers`).

Cầu: chỉ hàng snapshot (`source_shipment_container_id != null`) mới mirror; diff-guard
(giống nhau → no-op, không đụng lot row khi lái xe chỉ sửa notes); validate ISO 6346
+ trùng số trong lô trước khi ghi lot (400 với đúng thông điệp CUS dùng);
**không bump `shipment.version`** — lái xe nhập số không được 409 các editor văn
phòng đang mở (các board reconcile bằng refetch; hai chiều mirror tự hội tụ).

Lưu ý phạm vi: file BE ghi `trip_containers` cho luồng lái xe là
`forwarder-container.service.ts` (không phải `trip-create.service.ts` như brief
đoán) — brief cho phép chọn đúng file sau khi đọc code.

### Điều vận sửa số cont sau phát lệnh (FE)

- `frontend/src/features/dispatch/detailed-plan/DispatchContainerNumberCell.tsx`
  (mới): ô SỐ CONT trong cột Container của grid Kế hoạch Chi tiết thành **click-to-edit
  inline** — đúng pattern cell SỐ TỜ KHAI (SIL-591/593, commit `f354cea5` SIL-648
  cell-click ruling, catalog provenance: house primitive `FloatingCellEditor` +
  `__decl-*` classes đã có, không Tailkit mới). Role law SIL-551: CUS/ADMIN/MANAGER/
  DISPATCHER được sửa; vai trò khác thấy text tĩnh (không giả actions).
- Save = `updateCusShipmentContainerLine` (`POST /shipments/cus-workspace/:id/
  containers/:lineId`, `{ expectedShipmentVersion, containerNumber }`, Idempotency-Key)
  — đúng endpoint CUS line command; lỗi server (ISO 6346, trùng lô, 409 version)
  hiện nguyên văn trong toast; SIL-594 echo hiện giá trị vừa lưu ngay trước refetch.
- LCL/phone card: `DispatchPlanCardList` đọc cùng `row.container.containerNumber`
  từ server → tự hiển thị số sau refetch (chỉ đọc — đúng phạm vi "tối thiểu").

Không sửa: `backend/src/routes/**`, `shared/src/schemas/**` (schema
`shipmentCusContainerLineUpdateSchema` đã có sẵn `containerNumber`),
`docs/prd/**`, `DriverTripDetailPage` (app lái xe đã có editor riêng, chỉ thiếu
dữ liệu — BE bridge đã xử lý).

## Gates (output thật)

|Gate|Kết quả|
|---|---|
|`pnpm --dir shared build`|OK (tsc + fix-esm-imports, 75 bare imports)|
|`cd backend && npx tsx --test src/tests/unit/sil653-container-number-sync.test.ts`|**pass 10, fail 0** (file mới); chạy kèm `sil644-container-weight-lock.test.ts`: **18 pass, 0 fail**|
|`cd backend && npx tsc --noEmit`|0 error (exit 0)|
|`cd frontend && pnpm exec vitest run src/features/dispatch/detailed-plan`|46 files, **501 pass, 0 fail** (gồm `DetailedPlanGrid.test.tsx` + `DispatchContainerNumberCell.test.tsx` 4 test mới)|
|`cd frontend && pnpm exec tsc -b`|0 error (exit 0)|
|`cd backend && pnpm test` (toàn bộ BE unit)|**342 pass, 0 fail**|
|`cd frontend && pnpm test` (toàn bộ FE)|**6073 pass** / 2 fail — 2 fail đó là `numeric-identity.styles.test.ts` yêu cầu `dist/` production build (worktree mới chưa build, lỗi môi trường có sẵn, không phải regression của lane); sau `make build`: **6/6 pass**. Tính lại: toàn bộ FE xanh.|
|`make build`|succeeds (vite built in 16.23s)|

Chỉnh sửa test cũ có chủ đích: `sil644-container-weight-lock.test.ts` test 1 từng pin
409 blanket của phát lệnh — chính là luật SIL-653 (owner) thay thế; pin mới khóa
"không được quay lại blanket throw" + `issuedContainerIds` per-field.

## Không làm được / giới hạn rõ ràng

- **DB-round-trip của 2 chiều bridge không chạy được trong unit tree** (owner ruling
  2026-10-19: BE test unit-only, cấm boot db/app). Phần behavior thật (ghi lái xe →
  lot row đổi; CUS sửa → trip_containers đổi; reload 3 phía khớp) cần QA chạy
  integration probe `qa/scripts/` theo đúng nơi quy định — lane này không tự thêm
  script integration vào BE tree. Coverage unit = wiring scan + pure law.
- UI DRIVEN (rung 3): lane chạy headless không có stack local (`make dev` không khởi
  động trong worktree lane) — phần FE chỉ đến mức vitest render + tsc (rung 1-2).
  Screenshot/DOM/postgres evidence cần QA hoặc orchestrator chạy stack.
- Seal: chiều lái xe → lot được mirror; chiều lot → trip cố tình không mirror
  (bảo vệ evidence multi-seal) — số cont là field hai chiều đầy đủ.

## Coverage table

|Claim|Rung|Evidence|Not covered|
|---|---|---|---|
|Bỏ 409 blanket, lock theo field (cấu trúc vẫn khoá, measures khoá sau phát lệnh)|CODE-READ + unit wiring test|`sil653-container-number-sync.test.ts` (4+3 test), `sil644` pin cập nhật|Behavior với db thật (integration probe)|
|Lái xe sửa số cont/seal → lot row nhận số|CODE-READ + unit wiring test|3 đường ghi gọi `syncShipmentIdentityFromTripContainers` trong cùng tx (source scan)|DB/API thật — cần QA probe|
|CUS/ĐV sửa số cont → trip_containers nhận số|CODE-READ + unit wiring test|reconcile + CUS line gọi `syncTripSnapshotIdentityFromShipmentContainer` khi giá trị thật sự đổi|DB/API thật — cần QA probe|
|Điều vận click-to-edit ô SỐ CONT sau phát lệnh|Component render test (vitest)|`DispatchContainerNumberCell.test.tsx`: role gate, Enter/Esc, echo, lỗi verbatim|UI DRIVEN rung 3 — cần stack + screenshot + DB proof|
|3 phía khớp sau reload|CODE-READ (một nguồn sự thật = `shipment_containers`, mirror 2 chiều write-through)|Thiết kế bridge + diff-guard; không có đường ghi lệch còn lại đã biết|Chưa chạy e2e reload thật|
