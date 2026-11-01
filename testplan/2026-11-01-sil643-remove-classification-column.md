# SIL-643 (id 748) — Bỏ cột PHÂN LOẠI khỏi form Tạo lô hàng (reverses TC5)

Ngày: 2026-11-01 · Branch: `fix-sil-643` · Nguồn chuẩn: ruling boss Phạm
Trung Kiên 01/11 (thay thế TC5 của SIL-638 v2) — ticket SIL-643 (id 748).

## Ruling 01/11 (4 điểm)

1. **BỎ cột PHÂN LOẠI** (Đơn/Kẹp/Kết hợp) khỏi bảng Thông tin hàng trong
   form Tạo lô hàng — cột được thêm bởi commit `3ee6e5d8` (638-FE TC5).
2. Mọi container mới tạo mặc định **Đơn** (SINGLE) — không UI chọn.
3. Điều vận vẫn chỉnh phân loại lúc **"Chỉnh sửa điều phối"** khi phân xe
   (flow hiện có — plan PATCH classification — GIỮ NGUYÊN).
4. KHÔNG hiển thị cột chọn phân loại ở form tạo lô.

## Regression cases

### SIL-643-1 — Cột Phân loại không tồn tại trên form Tạo lô

- **Repro:** mở form Tạo lô hàng (CUS) → bảng Thông tin hàng (FCL).
- **Trước reversal (TC5):** cột "Phân loại" sau "Số tờ khai", radio
  Đơn/Kẹp/Kết hợp mỗi dòng.
- **Expected:** KHÔNG có cột "Phân loại"; thứ tự cột quay lại
  STT → Số container → Số tờ khai → Nhà máy → Tuyến đường → Cảng nâng →
  Cảng hạ → Ngày giờ đóng trả → Thao tác; không còn radio/radiogroup nào
  trong bảng.
- **Pin:** `ShipmentCreateWorkspace.sil643-classification.test.tsx`
  (assert cột không tồn tại), `ClerkShipmentCreatePage.test.tsx`
  (chip family = đúng 3 flag boolean, 0 radio; thứ tự cột không Phân loại),
  `ShipmentCreateWorkspace.sil600-declaration-column.test.tsx` (sheet order).

### SIL-643-2 — Tạo lô mới: mọi container mặc định Đơn

- **Repro:** tạo lô 1–2 container, không có bất kỳ ô chọn phân loại nào.
- **Expected:** payload quick-create luôn mang
  `containers[].classification: 'SINGLE'` tường minh cho MỌI dòng.
- **Pin:** `ShipmentCreateWorkspace.sil643-classification.test.tsx`
  (payload 2 cont = SINGLE ×2; 1 cont untouched = SINGLE),
  `shipment-create-model.test.ts` ("SIL-643: payload luôn gửi classification
  SINGLE…", exact-shape pins mang `classification: 'SINGLE'`).
- **BE giữ nguyên:** reconcile vẫn nhận field (wire contract giữ — comment
  default-SINGLE per SIL-643 tại `shipment-containers.service.ts`);
  `sil638-b2-tc5-quick-create-classification.test.ts` vẫn pass 7/7.

### SIL-643-3 — Điều vận đổi Kẹp/Kết hợp tại "Chỉnh sửa điều phối" không regress

- **Repro:** điều vận mở Chỉnh sửa điều phối → PATCH classification Kẹp/Kết
  hợp trên fulfillment; sau đó CUS Sửa lô + lưu.
- **Expected:** plan PATCH flow bất biến; save edit của CUS restate cột
  container về SINGLE nhưng **không bao giờ đụng**
  `fulfillment.dispatch_classification` (sync chỉ chạy với DOUBLE/COMBINED —
  `shipment-containers.service.ts` ~352-424).
- **Pin:** BE units `sil638-tc2-kep-vs-don-incompatibility` /
  `sil638-b2-auto-pair` / `sil638-b2-tc5-quick-create-classification`
  (35/35 scoped; toàn bộ unit suite 687/687), FE dispatch detailed-plan
  tests (trong scoped run 847/847).

## Điểm rà soát đã ghi nhận (review 01/11 — Approve)

- Explicit SINGLE restate cột `shipment_containers.classification` khi CUS
  lưu Sửa lô — khác TC5 (omit = giữ nguyên). Chấp nhận theo ruling: phân
  loại điều vận sống trên fulfillment; giá trị DOUBLE/COMBINED của cột chỉ
  tồn tại từ data TC5-window và không còn đường ghi mới từ CUS.
- Comment stale đã cập nhật kèm reversal:
  `shipment-intake-classification.ts` ("'SINGLE' is never sent…" → explicit
  SINGLE đọc giống absent), `shared/src/constants/index.ts`
  (CONTAINER_CLASSIFICATIONS không còn là vocabulary của picker).
- Shared contract `CONTAINER_CLASSIFICATIONS` +
  `shipmentContainerItemSchema.classification` GIỮ NGUYÊN (BE wire).

## Gates (artifacts: qa/2026-11-01_sil643_*)

| Gate | Kết quả |
|---|---|
| `cd frontend && pnpm exec tsc -b` | 0 lỗi |
| Scoped vitest (create form + ClerkShipmentCreatePage + dispatch detailed-plan) | 91 files, 847/847 pass |
| `cd backend && npx tsc --noEmit` | 0 lỗi |
| BE unit classification scoped (tc5/tc2/auto-pair) | 35/35 pass |
| BE unit toàn bộ | 687/687 pass |
| `pnpm lint` | 0 errors (8 warnings cũ, ngoài phạm vi) |

## Không cover

- Browser click-through thật (UI DRIVEN rung 3): phạm vi gate của task giới
  hạn scoped vitest + tsc; bằng chứng DOM là render component thật qua
  vitest (assert absence cột + payload), chưa mở browser.
- Kiểm tra tay trên staging/deploy — KHÔNG deploy theo task.
