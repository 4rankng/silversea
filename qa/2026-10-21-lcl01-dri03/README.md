# QA Evidence Pack: DRI-03 (211026132357) & LCL-01 (211026132257)

- **Date:** 2026-10-21
- **Branch:** `fix-dri03-driver-kep` (off main `454fab6b`)
- **Environment:** Local Development (PostgreSQL port 5441 `silversea`, backend port 3025, frontend port 7185)

---

## 1. Card 211026132357 (DRI-03) — Chuyến chạy KẸP trên App Lái Xe

### Vấn đề
Trên App Lái xe (role `DRIVER`, user `bqhuong`), chuyến chạy kẹp (1 chuyến 2 container, vd 2×20DC) hiển thị sai logic:
- `DriverContainerCard.tsx` trước fix hard-code `containers[0]`. Cả render, edit form, OCR cross-check và lệnh PATCH đều chỉ trỏ vào container đầu tiên.
- Container thứ hai của chuyến kẹp không xuất hiện trên giao diện và không thể thao tác/cập nhật độc lập.

### Giải pháp
1. **Frontend (`DriverContainerCard.tsx` + `DriverContainerCard.css`):**
   - Render toàn bộ containers trong `containers` mảng qua `.map()` khi `containers.length > 1`.
   - Mỗi container hiển thị số cont, số seal, khối lượng và nút "Sửa số cont {N}" riêng biệt.
   - Thêm state `editingContainerId` xác định chính xác container đang được chỉnh sửa.
   - Form chỉnh sửa hiển thị banner chỉ rõ container mục tiêu (`Đang sửa: Số cont N` hoặc mã cont).
   - `handleSave` gửi PATCH tới `/driver/me/trips/:tripId/containers/:id` với `targetContainer.id` và `expectedUpdatedAt` của chính container đó.
   - OCR scanner kiểm tra đối chiếu (mismatch warning) đúng mã container mục tiêu trong chế độ IMPORT.
   - Tuân thủ token thiết kế CSS house tokens (`var(--text-control-size)`, không hardcode font pixel).
2. **Backend (`driver.service.ts`):**
   - Thêm điều kiện `tripContainers.length === 1` khi ghi đè `cargoWeightKg` từ `shipmentContainers` của shipment fulfillment, bảo toàn khối lượng độc lập của từng container cho chuyến kẹp.

### UI Verification (Rung 3 — UI DRIVEN)
- **Script:** `testplan/qa/scripts/2026-10-21-dri03-ui-drive.mjs`
- **Driver:** `bqhuong` (user ID `139156`, driver ID `42966`, truck ID `186320`)
- **Trip:** `194048` (`TRP-202705-0018`, 2×20DC FCL-KEP, cont 1: `MSKU7654328`, cont 2: `CSQU3054383`)
- **Viewport:** 390×844 (Mobile portrait)
- **Kết quả:**
  1. `dri03-01-kep-view-390.png`: Render đủ 2 container bento items (Số cont 1: `MSKU7654328` / seal `SEAL001`; Số cont 2: `CSQU3054383` / seal `SEAL002`) kèm 2 nút sửa riêng biệt.
  2. Click "Sửa số cont 2": Banner "Đang sửa: CSQU3054383" hiển thị, dữ liệu cont 2 được điền trước chính xác.
  3. Cập nhật seal cont 2 thành `SEAL-KEP-02-EDITED` và lưu:
     - DOM cập nhật cont 2 thành `SEAL-KEP-02-EDITED`.
     - Cont 1 giữ nguyên `SEAL001` (không bị trộn/ghi đè).
  4. `dri03-02-kep-edited-390.png`: Minh chứng sau khi lưu.
  5. DB query xác nhận: cont 1 (`id: 28704`) `SEAL001` không đổi, cont 2 (`id: 28750`) cập nhật `SEAL-KEP-02-EDITED`.
- **Artifacts:**
  - `qa/2026-10-21-lcl01-dri03/dri03-01-kep-view-390.png`
  - `qa/2026-10-21-lcl01-dri03/dri03-02-kep-edited-390.png`
  - `qa/2026-10-21-lcl01-dri03/dri03-ui-driver.log`

---

## 2. Card 211026132257 (LCL-01) — Before/After Repro Pack

### Tình trạng fix
Fix đã merge vào `main` tại commit `454fab6b` (`cus-workspace-sql.service.ts` và `cus-shipment-workspace-reads.service.ts`). Thẻ này thực thi bằng chứng before/after repro trên local backend theo quy trình:
1. **After-run (với fix từ main):**
   - Chạy: `BACKEND=http://localhost:3025/api node testplan/qa/scripts/2026-10-21-lcl01-repro.mjs`
   - Kết quả: `failures=0`, cả 2 lô hàng lẻ (UNDATED và DATED) xuất hiện đầy đủ trên Chi tiết dưới default day lens.
   - Log: `qa/2026-10-21-lcl01-dri03/lcl01-after-pass.log`
2. **Before-run (revert về 72c4f510):**
   - `git checkout 72c4f510 -- backend/src/services/cus-workspace-sql.service.ts backend/src/services/cus-shipment-workspace-reads.service.ts`
   - Khởi động lại backend, chạy repro script.
   - Kết quả: `failures=3`
     - `FAIL R2 dated LCL lot on CHI TIẾT default lens`
     - `FAIL R5 search finds both lots under default lens`
     - `FAIL INVARIANT overview LCL lots drop none on CHI TIẾT default :: LCL01-DATED-957692`
   - Tái hiện chính xác lỗi: Lô DATED LCL bị rớt khỏi màn hình Chi tiết dưới default day lens.
   - Log: `qa/2026-10-21-lcl01-dri03/lcl01-before-fail.log`
3. **Restore fix (từ main):**
   - `git checkout main -- backend/src/services/cus-workspace-sql.service.ts backend/src/services/cus-shipment-workspace-reads.service.ts`
   - Khởi động lại backend, chạy repro script.
   - Kết quả: `failures=0` (PASS lại toàn bộ).
   - Log: `qa/2026-10-21-lcl01-dri03/lcl01-repro.log`

---

## 3. Quality Gates Verbatim Summary

| Gate | Lệnh thực thi | Kết quả |
|---|---|---|
| Frontend Scoped Vitest | `pnpm --dir frontend test src/components/trip/DriverContainerCard.test.tsx src/pages/DriverTripDetailPage.test.tsx src/pages/DriverTripsPage.test.tsx` | 3 test files, 126 passed, 0 failed |
| Frontend Style / Contract Tests | `pnpm --dir frontend test src/styles/driver-portal-typography.styles.test.ts src/styles/ordinary-control-ceiling.styles.test.ts src/styles/legacy-trip-control-ceiling.styles.test.ts src/pages/driver-density.styles.test.ts` | 4 test files, 94 passed, 0 failed |
| Dev Port Contract Test | `pnpm --dir frontend test src/tests/` | 4 test files, 25 passed, 0 failed |
| Frontend Scoped ESLint | `pnpm eslint frontend/src/components/trip/DriverContainerCard.tsx frontend/src/components/trip/DriverContainerCard.test.tsx` | 0 errors, 0 warnings |
| Frontend Typecheck | `cd frontend && npx tsc -b` | 0 errors (exit code 0) |
| Backend Typecheck | `cd backend && npx tsc --noEmit` | 0 errors (exit code 0) |
| Backend Pure Unit Tests | `cd backend && pnpm test:unit` | 53 suites, 341 passed, 0 failed |
