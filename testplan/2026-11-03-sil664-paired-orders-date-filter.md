# SIL-664 — Trang hai lệnh lái xe: `?date` phải lọc đúng cặp theo ngày + route `paired-orders` (regression case)

Case ID: TC-SIL664-01
Feature: trang hai lệnh (paired orders) của app lái xe — `GET /driver/me/two-orders`, trang FE `/my-trips/paired-orders` (đổi tên từ `/my-trips/two-orders`).

## Quyết định owner (ràng buộc, không mở lại)
Ruling owner 03/11: **lọc theo ngày là BẮT BUỘC** — `?date=X` phải hiện đúng cặp (pair) của ngày X; không có `?date` → mặc định hôm nay. Route `paired-orders` là tên owner đã xác nhận. Chỉ đụng phía đọc/hiển thị — không đụng logic ghép cặp (auto-pair dispatch).

## Repro (trước khi sửa — commit base 8ce2dda34, driver bqhuong, DB dev :5441)
Data thật: pair 4 — `departure_date 2026-11-04`, trips 575+576 (IN_TRANSIT, ACTIVE); ngày 2026-11-03 (hôm nay) chỉ có trip 571 CANCELED; 2026-11-05 trống.

1. `GET /api/driver/me/two-orders?date=2026-11-04` → trả `date=2026-11-03`, pair 4 — tham số bị bỏ qua.
2. `GET /api/driver/me/two-orders?date=2026-11-05` (ngày trống) → vẫn trả pair 4 — hiện nhầm cặp hôm nay.
3. UI `/my-trips/two-orders?date=2026-11-05` → hiện "Lệnh ghép 2 chiều" với cặp 11-04, khối tóm tắt không nhắc ngày nào — không phân biệt được ngày.
4. Nguyên nhân gốc: route BE gọi `getDriverTwoOrdersView(driver.id)` không truyền param; service chọn pair ACTIVE mới nhất **không lọc ngày** (`orderBy desc(departureDate)` across all days), nhãn `date` luôn = hôm nay.

## Expected (sau khi sửa)
- `?date=<ngày có cặp>` → view của đúng ngày đó: `date` trả về = ngày yêu cầu, `pair` = cặp của ngày đó.
- `?date=<ngày không có cặp>` → view rỗng của ngày đó (`pair: null`, `allToday: []`), UI hiển thị empty state gọi tên ngày ("Không có lệnh ngày DD/MM/YYYY") — không hiện nhầm cặp ngày khác.
- Không có `?date` → mặc định hôm nay (giữ hành vi lịch sử).
- `?date` sai định dạng → HTTP 400 (thông báo yêu cầu YYYY-MM-DD); FE deep-link sai → trạng thái "Đường liên kết không hợp lệ", không âm thầm hiện dữ liệu ngày khác.
- Cặp hiển thị phải gọi tên ngày của nó (khối "Cặp điều vận ngày DD/MM/YYYY") — lái xe phải phân biệt được ngày đang xem.
- Route mới `/my-trips/paired-orders` hoạt động; path cũ `/my-trips/two-orders` redirect sang mới **giữ nguyên `?date`**, không 404.

## Automated pins
- `backend/src/tests/unit/sil664-two-orders-date-param.test.ts` — 8 test: parser `?date` (đúng sai định dạng, ngày lịch không tồn tại, giá trị non-string, status 400) + static source law (route phải pipe `req.query.date` qua parser vào service; service phải key theo `date ?? today`, lọc `departureDate = day`, echo `date: day`).
- `frontend/src/pages/driver/DriverPairedOrdersPage.test.tsx` — `?date` truyền vào query; không param → undefined; empty state theo ngày; block cặp gọi tên ngày; malformed date → bad-link state; các pin cũ (2 thẻ riêng biệt, plate/icon, banner, empty slots).
- `frontend/src/pages/driver/PairedOrdersRedirect.test.tsx` — redirect giữ `?date`, path trống không thêm query.

## Bằng chứng rung-3 (local dev, driver bqhuong, 390/768)
`qa/2026-11-03_sil664/` — `ui-driver-before.log` (3 lỗi tái hiện: mọi `?date` trả cùng view; UI hiện cặp 11-04 trên ngày trống 11-05), `ui-driver-after.log` (22 PASS / 0 FAIL: lọc đúng ngày, empty đúng ngày, 400 sai định dạng, redirect giữ `?date`, link vào/ra sibling, @768), ảnh `sil664-before-1105-shows-1104-pair-390.png` → `sil664-after-1105-empty-390.png` / `sil664-after-1104-pair-390.png` / `sil664-after-redirect-old-path-390.png`; DB proof pair 4 (2026-11-04) unchanged (read-only view).

## Not covered
- Role khác (lái xe khác không có cặp nào, DISPATCH xem trang này qua RBAC driver mount) — chỉ drive bqhuong.
- Ngày có cặp nhưng leg bị BREAK/cập nhật giữa ngày (chỉ đọc tĩnh luồng đó trong service).
- Stage/prod environment — drive chỉ chạy local dev :5441/:3014/:7191.
