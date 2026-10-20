# Case: FB-048 lần 4 — Viền đỏ báo lỗi ở các ô hàng container trong form Tạo lô (card 211026034111)

- **Case ID**: `QA-2026-10-21-FB048-LAN4`
- **Card**: `211026034111` (`FB-048 — Viền đỏ báo lỗi còn thiếu ở các ô hàng container trong form Tạo lô (chỉ có chữ đỏ)`)
- **Surface**: `/shipments/new` (`ShipmentCreateWorkspace` → `ShipmentCreateContainerRow` → `ShipmentContainerCell`)

## Reproduction Steps

1. Đăng nhập tài khoản CUS (`tiepvv`) hoặc vận hành, mở màn Tạo lô hàng (`/shipments/new`).
2. Để trống các trường bắt buộc trong phần hàng container (`Loại container`, `Nhà máy`, `Tuyến đường`, `Cảng nâng`, `Cảng hạ`, `Ngày giờ đóng trả`) và/hoặc thêm dòng container trống rồi bấm `Tạo lô hàng`.
3. Quan sát bảng hàng container ở desktop (`1440px`, `768px`) và mobile (`390px`), cả khi đứng yên lẫn khi ô nhận focus mà chưa mở menu combobox.

## Actual Behavior (Before Fix — build `9d60f507`)

- Ô `Khách hàng`, `Hình thức xuất nhập khẩu`, và `Ngày giờ đóng trả` (`HH:mm` / `DD/MM/YYYY`) có viền đỏ (`1px solid var(--danger)`).
- 5 ô combobox thuộc hàng container (`Loại container`, `Nhà máy`, `Tuyến đường`, `Cảng nâng`, `Cảng hạ`) ở desktop (`> 620px`) chỉ hiện dòng chữ lỗi màu đỏ bên dưới (`.csc-container-cell__error`) nhưng **không có viền đỏ quanh ô** (`.csc-container-cell__display` có `border: 0`, còn rule `.csc-container-cell--error:not(:focus-within) { box-shadow: inset 0 0 0 1px var(--danger); }` bị `#root .app * { box-shadow: none; }` trong `base.css` triệt tiêu hoàn toàn).
- Khi `focusIssue` đưa focus vào ô picker (ví dụ `Loại container`) mà menu chưa mở (`aria-expanded="false"`), `.csc-container-cell__editor > *` vẫn `opacity: 0` còn `:not(:focus-within)` làm mất cả rule lỗi trên mobile (`<= 620px`).
- Ngoài ra, `HintText` (`[data-uui-control]:not(.date-seg-wrapper) ~ span:not(.date-sep)`) ẩn (`opacity: 0`) bên trong `.csc-container-cell__editor` vẫn chiếm chiều cao layout làm `.csc-container-cell__value` / `.csc-container-cell__display` phình lên ~72px khi có lỗi (vượt trần 40px).

## Expected Behavior

1. Mọi trường không hợp lệ trong hàng container (`Loại container`, `Nhà máy`, `Tuyến đường`, `Cảng nâng`, `Cảng hạ`, và bất kỳ `ShipmentContainerCell` nào đang có lỗi) đều hiển thị **viền đỏ thực sự (`border: 1px solid var(--danger); border-radius: var(--r-sm)`)** quanh ô giá trị (`.csc-container-cell__display`) kèm chữ lỗi màu đỏ bên dưới, nhất quán với `Khách hàng`, `Hình thức xuất nhập khẩu`, `Số Bill/Booking`, và `Ngày giờ đóng trả` (`HH:mm` / `DD/MM/YYYY`).
2. Khi ô picker nhận focus nhưng chưa mở menu (`[role="combobox"][aria-expanded="true"]` chưa kích hoạt), `.csc-container-cell__display` vẫn giữ viền đỏ; khi mở menu combobox, `.csc-container-cell__display` ẩn (`opacity: 0`) và `[data-uui-control="combobox"][aria-invalid="true"]` hiện (`opacity: 1`) với viền đỏ `var(--danger)` — không mất viền đỏ ở bất kỳ trạng thái nào và không vẽ chồng 2 viền.
3. Chiều cao vùng ô điều khiển (`.csc-container-cell__value` / `.csc-container-cell__display`) giữ nguyên trong trần control (`<= 40px`), không bị `HintText` ẩn bên trong `.csc-container-cell__editor` đẩy phình chiều cao, đồng thời giữ nguyên dấu phân cách `.date-sep` (`:` và `/`) của `Ngày giờ đóng trả`.
