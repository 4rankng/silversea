# REQ-07 — Format mã chuyến trong Driver App (2026-10-21)

Doc khách REQ-07 "Driver — format mã chuyến": mã chuyến hiển thị trong app tài
xế phải có format thống nhất, dễ đọc — không phải chuỗi generator thô.

## Audit (2026-10-21)

- Backend sinh mã: `backend/src/services/trip-create.service.ts`
  `generateTripCode()` → `TRP-<YYYYMM>-<counter padStart 4>` (vd
  `TRP-202610-0007`). Không đổi tầng sinh.
- Row thật (DB dev 5441, schema `silversea`): 152 row shape chuẩn
  `TRP-NNNNNN-NNNN` (`TRP-202606-0084`, `TRP-202608-7037`) + legacy
  `TRP-C12-53-1791212851260-gvr4vb`, `CN-…` (429), `BULK-TR-…`. Formatter phải
  spacing shape chuẩn, passthrough legacy, không được vỡ.
- Trước fix, driver app: danh sách lệnh + chi tiết KHÔNG hiển thị mã chuyến nào
  (chỉ Bill/Booking theo internal-ids law); `DriverPenaltyPage` render chuỗi
  generator THÔ (`p.tripCode`).

## Cases

### REQ07T-01 — Journey card hiển thị mã chuyến format chuẩn
1. Đăng nhập driver (bqhuong staging / quyet local).
2. Mở `/my-trips`, tab Lệnh mới.
3. Card chuyến có mã `TRP-202610-0007` hiển thị dòng "Mã chuyến TRP 2026-10 · 0007".
4. Bill/Booking vẫn là dòng nhận diện chính (không đổi).

**Expected:** mã render spaced `TRP <yyyy>-<mm> · <seq>`; KHÔNG render chuỗi
thô `TRP-202610-0007`; SHP-/QADRV- vẫn không bao giờ xuất hiện.

### REQ07T-02 — Chi tiết lệnh: hàng "Mã chuyến" đầu lưới Thông tin lệnh
1. Mở chi tiết lệnh (`/my-trips/:id`).
2. Lưới "Thông tin lệnh" có hàng đầu "Mã chuyến" giá trị format chuẩn.
3. Lô legacy không có mã → hàng hiển thị "—"; mã legacy khác format
   (`TRP-C12-…`, `BULK-TR-…`) → passthrough nguyên văn, không vỡ layout.

**Expected:** hàng có label "Mã chuyến", giá trị `valueOrDash`-bọc, không làm
đổi thứ tự các hàng còn lại (Ngày giờ kế hoạch → Tên nhà máy → …).

### REQ07T-03 — Trang phạt không còn render mã thô
1. Mở `/my-penalties` với driver có vi phạm gắn chuyến.
2. Dòng meta vi phạm hiển thị mã ở cùng format chuẩn REQ-07.

**Expected:** `{driverTripCodeLabel(p.tripCode)}`, không có chuỗi generator thô.

## Unit coverage

- `frontend/src/features/driver/driver-display.test.ts` — `driverTripCodeLabel`:
  format chuẩn, trim, sequence ngắn normalize 4 số, sequence dài giữ nguyên số,
  legacy passthrough (TRP-C12-…, BULK-TR-…, CN-…), null/''/'   ' → null.
- `DriverTripsPage.test.tsx` — card render formatted + ẩn khi null + legacy
  passthrough + SHP code vẫn bị cấm + raw string không render.
- `DriverTripDetailPage.test.tsx` — hàng "Mã chuyến" trong lưới + field order
  cập nhật (REQ-07 đứng đầu).
- `DriverPenaltyPage.test.tsx` — formatted code trong meta, không raw, không
  render khi không có trip.

## Trạng thái

- Fix: display-layer only (frontend), 2026-10-21. KHÔNG đổi backend/DB/generation.
- Gates: `npx tsgo -b` 0; vitest scoped xanh (driver-display 12, trips 42,
  detail 60, penalty 4); root lint 0; `make build` 0.
- Pre-existing branch-base breakage (không phải do change này, chứng minh bằng
  `git stash` rerun): `design:drift` baseline lag so với base; `size-check`
  spawn suite đã retire (e54504bf).
