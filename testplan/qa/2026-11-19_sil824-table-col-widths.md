# SIL-824 (id 953) — /shipments-detail: khôi phục width model 1440px (hồi quy từ wave 18/11)

- **Ticket**: SIL-824 · board plan.tingting.vip/tingtingsoft/SIL
- **Regression**: Build `ad4f0597` / `4db2d62f` (so với `6bae7153` 18/11 PASS) — commit `ab50b4c9` áp bảng width ticket 18/11 lên `ShipmentContainersPage.css`, cố định `col--customer` thành `185px` (`max-width: 200px`) và tăng `route` `96→155px`, `schedule` `100→160px`, `status` `92→145px`, `billbook` `112→115px`, đẩy `--led-fixed-sum` lên `1371px` và `min-width` lên `1556px`.

## Reproduction (trước fix)

1. Đăng nhập vai `CUS` (`tiepvv`), mở `/shipments-detail` tại đúng viewport `1440x900`, bấm `Xóa bộ lọc`, thu gọn sidebar (`Đóng menu`).
2. Đo độ rộng bảng: tổng bảng `1556px` (right edge `1628px` > `1440px`, tràn `188px`), `KHÁCH HÀNG & LỘ TRÌNH` co từ `404px` xuống `221px`, `TRẠNG THÁI` (`174px`) nằm hoàn toàn off-screen, `PHÂN XE` (`153px`) bị cắt mép phải.
3. Các cột tĩnh đều bị kéo giãn theo tỷ lệ `1556/1300`: `NHẬP/XUẤT 91`, `HÃNG TÀU 115`, `BILL/BOOKING 138`, `SỐ TỜ KHAI 148`, `THÔNG SỐ CONTAINER 139`, `NÂNG/HẠ 186`, `LỊCH TRÌNH 192`.

## Expected behavior (sau fix)

- Khôi phục `KHÁCH HÀNG & LỘ TRÌNH` làm cột `auto` flex-grow duy nhất (không có `width`/`max-width` trên `.shipment-container-ledger__col--customer`), `--led-w-customer-floor: 136px`.
- Các cột tĩnh về lại đúng thang px SIL-824/SIL-848 đã PASS ở `6bae7153`: `select 44 · billbook 112 · declaration 124 · direction 76 · shippingline 96 · container 116 · route 96 · schedule 100 · vehicle 128 · notes 120 · status 92 · actions 92`, `--led-fixed-sum: 1196px`, `min-width: calc(1196px + 136px) = 1332px`.
- Tại `1440x900` sidebar đóng (canvas `1344px`): bảng vừa khít khung nhìn (`table right edge ≤ 1440`, không scroll ngang), `KHÁCH HÀNG & LỘ TRÌNH` mở rộng thoải mái (`~404px` khi ẩn `notes`/`actions`/`select`), không cột nào off-screen, giữ nguyên `.shipment-container-ledger__owner` (team mode).

## Pins

- `frontend/src/pages/ShipmentContainersPage.styles.test.ts`
- `frontend/src/pages/ShipmentContainersPage.no-truncation.styles.test.ts`
