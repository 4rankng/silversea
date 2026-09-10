# Luồng 5: Kế hoạch làm hàng, Theo dõi phương tiện & Quỹ tạm ứng — Ops (Hiện trường)

> **Vai trò sở hữu:** Nhân viên vận hành / hiện trường (OPS)
> **Vai trò tham gia:** Kế toán (ACCOUNTANT) — duyệt tạm ứng & chi phí; Điều vận — gán chuyến
> **Tài khoản:** theo `testplan/testaccounts.txt` (mục `demoUsers` — chỉ tồn tại trên local dev)
> **Route chính:** `/ops/orders`, `/ops/fleet-tracking`, `/ops/wallet`
> **PRD nguồn:** [`docs/prd/OpsVanHanh.md`](../../docs/prd/OpsVanHanh.md)
>
> **Bản đồ route:** các màn `/ops/*` là bộ màn mới
> (`frontend/src/pages/ops/OpsOrdersPage.tsx`, `OpsFleetTrackingPage.tsx`,
> `OpsWalletPage.tsx`). Bộ `/my-orders`, `/my-advances`, `/my-settlements` cũ vẫn tồn tại
> song song và được regression riêng ở [`../roles/06-vanhanh.md`](../roles/06-vanhanh.md)
> Flow 1–6. Nếu một màn `/ops/*` chưa deploy ở môi trường đang thử → ghi **BLOCKED**,
> không ghi FAIL.
>
> **Ghi chú lịch sử:** slot Luồng 5 trước đây là "Chi phí phát sinh (Ops)" đã bị gỡ 2026-09.
> Tệp này thay thế slot đó bằng đặc tả Ops mới ngày 2026-09-06.
>
> **Hợp nhất 2026-09-07:** từng tồn tại song song một tệp `05-ops-vi.md` viết cho **cùng
> đặc tả này** với dải mã `TC-OPS-VI-*` **trùng** dải mã ở §5.3 dưới đây. Tệp đó đã được
> gộp vào đây và xoá. **Tệp này là bản chuẩn duy nhất cho Luồng 5.**

---

## 5.1 — Màn hình 1: Kế hoạch làm hàng & Lệnh phụ trách (`/ops/orders`)

### TC-OPS-KH-001 — Danh sách tổng thể lô hàng theo ngày

- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Thiết bị:** Desktop + Mobile (390 × 844)
- **Tiền điều kiện:** có ≥ 3 lô hàng của công ty trong ngày hôm nay
- **Các bước:**
  1. Đăng nhập `giaonhan`, mở `/ops/orders`.
  2. Đọc danh sách mặc định.
  3. Đổi bộ chọn ngày sang một ngày cụ thể trong quá khứ, rồi sang một ngày tương lai.
  4. Tìm kiếm theo mã lô, theo tên khách hàng, theo số container.
- **Kết quả mong đợi (Pass):**
  - Bộ chọn ngày **mặc định hôm nay**; trục ngày = `expected_delivery_date` (Ngày giao dự kiến).
  - Hiển thị **toàn bộ lô hàng của công ty** trong ngày — không giới hạn theo lô được gán riêng cho Ops này.
  - **Bỏ qua lô đã hủy.**
  - Cột đầy đủ: `Mã lô` | `Khách hàng` | `Tuyến` | `Cont` (số lượng + danh sách số vỏ) | `Bill/Booking` | `Trạng thái` | hành động.
  - `Trạng thái` hiển thị **chữ màu, KHÔNG badge nền / chấm tròn** (quy ước dự án).
  - Tra cứu được ngày quá khứ **và** tương lai; tìm kiếm khớp cả 3 tiêu chí; URL giữ trạng thái ngày/tìm kiếm.
  - Nhãn tiếng Việt; nút chạm ≥ 44 px trên mobile; **bảng giữ dạng tabular tới giới hạn container 680px**; không cuộn ngang.
- **Kỳ vọng sai (Fail nếu):** chỉ thấy lô của riêng mình; lô đã hủy vẫn hiện; badge nền ở cột Trạng thái; không đổi được ngày.
- **Bằng chứng:** ảnh danh sách hôm nay + ảnh sau khi đổi ngày + ảnh kết quả tìm kiếm

---

### TC-OPS-KH-002 — Ghim lệnh: lô được ghim lên đầu danh sách

- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Các bước:**
  1. Mở `/ops/orders`. Ghi lại thứ tự 5 lô đầu tiên.
  2. Cuộn xuống chọn 1 lô ở giữa/cuối danh sách, bấm `[📍 Ghim]`.
  3. Tải lại trang (F5).
  4. Bấm bỏ ghim.
- **Kết quả mong đợi (Pass):**
  - Ngay khi bấm Ghim, lô đó **nhảy lên vị trí trên cùng** danh sách.
  - Sau F5, lô vẫn ở trên cùng (ghim **bền vững**, không phải state tạm trên client).
  - Bỏ ghim ⇒ lô trở về vị trí sắp xếp tự nhiên.
- **Kỳ vọng sai (Fail nếu):** ghim mất sau reload; ghim không đưa lô lên đầu.
- **Bằng chứng:** ảnh trước ghim / sau ghim / sau F5 / sau bỏ ghim

---

### TC-OPS-KH-003 — Ghim là sổ tay CÁ NHÂN, không rò sang Ops khác

- **Vai trò:** `giaonhan` + 1 tài khoản OPS thứ hai
- **Mức độ:** **P0** (rò dữ liệu cá nhân)
- **Tiền điều kiện:** có 2 tài khoản OPS
- **Các bước:**
  1. `giaonhan` ghim lô X.
  2. Đăng xuất, đăng nhập tài khoản OPS thứ hai, mở `/ops/orders`.
- **Kết quả mong đợi (Pass):**
  - Lô X **không** được ghim trên tài khoản thứ hai; danh sách ở thứ tự tự nhiên.
  - Ghim lưu theo `user_id`, hoạt động như bookmark cá nhân.
- **Kỳ vọng sai (Fail nếu):** Ops thứ hai thấy lô X ghim sẵn (ghim bị lưu global).
- **Bằng chứng:** ảnh 2 tài khoản cạnh nhau

---

### TC-OPS-KH-004 — Form khai báo chi phí: Số Bill / Số Cont auto-fill

- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Tiền điều kiện:** 1 lô **IMPORT** có `bl_number` + ≥ 2 vỏ cont; 1 lô **EXPORT** có `booking_ref`
- **Các bước:**
  1. Mở `/ops/orders`, click vào lô **IMPORT** (ghi lại Số Bill + danh sách vỏ của lô).
  2. Đọc form "Khai báo chi phí" vừa mở.
  3. Thử sửa trực tiếp ô Số Bill / Số Cont.
  4. Mở danh sách `Số Cont` và danh sách `Loại phí`.
  5. Thử nhập Số tiền = `0`, số âm, và số có phần thập phân.
  6. Lặp lại bước 1–2 với lô **EXPORT**.
- **Kết quả mong đợi (Pass):**
  - Form mở ra với tiêu đề **"Khai báo chi phí"**.
  - `[Mã lô]`, `[Số Bill]`, `[Số Cont]` **đã điền sẵn đúng** giá trị của lô vừa click, ở trạng thái **readonly** — Ops không gõ tay, không sửa được.
  - **Đúng chiều Bill:** lô IMPORT hiện `bl_number`; lô EXPORT hiện `booking_ref`. Không lẫn ngược.
  - `Số Cont`: chọn 1 vỏ trong danh sách vỏ **của đúng lô đó**; lô nhiều vỏ có thêm lựa chọn **"Phí chung lô"** (không gắn vỏ riêng).
  - `Loại phí` nhóm theo **"Có hóa đơn" / "Không hóa đơn"**, suy từ cột `requires_invoice` (không hard-code theo tên).
  - `Số tiền`: chỉ nhận **nguyên dương**, VND, **không phần thập phân** — cả 3 giá trị ở bước 5 đều bị chặn.
  - Ops chỉ còn phải nhập: **Loại phí**, **Số tiền**, **Upload ảnh biên lai** (ảnh **không bắt buộc** — xem `TC-OPS-VI-006`), **Ghi chú** (tùy chọn).
- **Kỳ vọng sai (Fail nếu):** Số Bill/Cont trống hoặc sửa được; Bill/Booking ngược chiều; thiếu "Phí chung lô" ở lô nhiều vỏ; lưu được số tiền ≤ 0 hoặc thập phân; bắt buộc phải có ảnh.
- **Bằng chứng:** ảnh form IMPORT + ảnh form EXPORT + ảnh 3 lỗi số tiền

---

### TC-OPS-KH-005 — Lưu chi phí → đẩy ngay sang màn Quản lý Quỹ

- **Vai trò:** `giaonhan`
- **Mức độ:** **P0**
- **Tiền điều kiện:** ghi lại `[SỐ DƯ HIỆN TẠI]` và `[Chờ duyệt]` ở `/ops/wallet` trước khi thử
- **Các bước:**
  1. Từ `/ops/orders`, khai báo 1 khoản chi 500.000 ₫, có ảnh biên lai. Bấm **Lưu**.
  2. Mở `/ops/wallet`.
- **Kết quả mong đợi (Pass):**
  - Khoản chi xuất hiện ngay trong lịch sử chi phí ở `/ops/wallet`.
  - `[Chờ duyệt]` **tăng** đúng 500.000 ₫; `[SỐ DƯ HIỆN TẠI]` **giảm** đúng 500.000 ₫.
  - Không cần thao tác đồng bộ thủ công.
- **Bằng chứng:** ảnh 4 card trước/sau + ảnh dòng chi phí mới

---

## 5.2 — Màn hình 2: Theo dõi phương tiện được giao (`/ops/fleet-tracking`)

### TC-OPS-XE-001 — Chuyến tự xuất hiện khi Điều vận gán xe thuộc danh sách Ops

- **Vai trò:** `dieuvan` + `giaonhan`
- **Mức độ:** P0
- **Tiền điều kiện:** xe `15C-284.56` được cấu hình do `giaonhan` quản lý
- **Các bước:**
  1. `giaonhan` mở `/ops/fleet-tracking`, ghi lại danh sách hiện có. **Không tải lại trang nữa.**
  2. `dieuvan` gán 1 chuyến mới cho xe `15C-284.56`.
  3. Chờ tối đa **30 giây** trên màn của `giaonhan` — **không** bấm F5.
- **Kết quả mong đợi (Pass):**
  - Chuyến mới **tự động xuất hiện** trên màn của `giaonhan` trong ≤ 30 s nhờ tự làm mới (polling 30 s) — **không** cần tải lại tay, không cần thao tác nhận/claim.
  - Backend map `truck_ops_assignments` (xe Ops quản lý) × `trips` (chuyến Điều vận phân công).
  - Việc gán xe ↔ Ops do **Admin** cấu hình ở trang Đội xe (trường "Ops phụ trách"); một xe chỉ có **một** Ops active.
- **Kỳ vọng sai (Fail nếu):** Ops phải bấm nút/F5 để thấy chuyến; chuyến không xuất hiện.
- **Bằng chứng:** ảnh trước/sau **kèm đồng hồ** + ảnh thao tác gán của `dieuvan`

---

### TC-OPS-XE-002 — Danh sách hiển thị đủ 3 cột bắt buộc

- **Vai trò:** `giaonhan`
- **Mức độ:** P1
- **Các bước:** mở `/ops/fleet-tracking`, đọc cấu trúc bảng.
- **Kết quả mong đợi (Pass):**
  - Dạng **list view** với các cột: `Biển số xe` | `Lệnh đang gán` | `Trạng thái thời gian thực`.
  - Giá trị trạng thái nằm trong tập: `Chờ nhận lệnh`, `Đang vận chuyển`, `Đã hoàn thành`, …
- **Bằng chứng:** ảnh bảng đủ 3 cột

---

### TC-OPS-XE-003 — Trạng thái đồng bộ trực tiếp từ thao tác của Lái xe

- **Vai trò:** `laixe` + `giaonhan`
- **Mức độ:** P0
- **Tiền điều kiện:** chuyến của xe `15C-284.56` đang ở `Chờ nhận lệnh`
- **Các bước:**
  1. `giaonhan` mở `/ops/fleet-tracking`, xác nhận trạng thái `Chờ nhận lệnh`.
  2. `laixe` bấm **"Nhận lệnh vận chuyển"** trên app.
  3. `giaonhan` tải lại màn theo dõi.
- **Kết quả mong đợi (Pass):**
  - Trạng thái đổi sang `Đang vận chuyển`, khớp đúng thao tác của lái xe.
  - Không có độ trễ nghiệp vụ nào khác ngoài thời gian tải lại.
- **Bằng chứng:** ảnh trạng thái trước/sau + ảnh thao tác của `laixe`

---

### TC-OPS-XE-004 — Màn hình read-only tuyệt đối

- **Vai trò:** `giaonhan`
- **Mức độ:** **P0**
- **Các bước:**
  1. Mở `/ops/fleet-tracking`. Rà toàn bộ màn hình tìm nút/ô nhập.
  2. Thử click vào dòng, vào ô trạng thái.
- **Kết quả mong đợi (Pass):**
  - **Không có** nút xác nhận, duyệt, sửa, hủy — bất kỳ mutation nào.
  - Click vào dòng chỉ mở xem chi tiết (nếu có), không mở form sửa.
- **Kỳ vọng sai (Fail nếu):** tồn tại bất kỳ thao tác ghi nào trên màn này.
- **Bằng chứng:** ảnh toàn màn + danh sách phần tử tương tác (DOM)

---

### TC-OPS-XE-005 — Ops chỉ thấy xe được giao cho mình

- **Vai trò:** `giaonhan` + OPS thứ hai
- **Mức độ:** **P0** (phạm vi dữ liệu)
- **Các bước:**
  1. `giaonhan` mở `/ops/fleet-tracking`, ghi danh sách biển số.
  2. Đăng nhập OPS thứ hai, so sánh.
- **Kết quả mong đợi (Pass):** mỗi Ops chỉ thấy đúng các đầu xe được giao quản lý; 2 danh sách khác nhau.
- **Bằng chứng:** ảnh 2 danh sách

---

### TC-OPS-XE-006 — Ops chưa được gán xe nào: trang trống có hướng dẫn

- **Vai trò:** tài khoản OPS chưa được gán xe
- **Mức độ:** P1
- **Các bước:** đăng nhập tài khoản OPS chưa được Admin gán xe, mở `/ops/fleet-tracking`.
- **Kết quả mong đợi (Pass):**
  - Trang trống hiển thị thông điệp **"Chưa có xe nào được giao cho bạn quản lý"** + gợi ý liên hệ Admin.
  - **Không** lỗi JS, không bảng rỗng không nhãn, không spinner treo.
- **Kỳ vọng sai (Fail nếu):** màn trắng; lỗi console; hiện toàn bộ đội xe của công ty.
- **Bằng chứng:** ảnh trang trống + console sạch

---

## 5.3 — Màn hình 3: Quỹ tạm ứng cá nhân & Chi phí (`/ops/wallet`)

### TC-OPS-VI-001 — Xin tạm ứng: nút ghim đầu màn, đẩy sang Kế toán ở trạng thái Pending

- **Vai trò:** `giaonhan` + `ketoan`
- **Mức độ:** P0
- **Các bước:**
  1. Mở `/ops/wallet`. Xác nhận nút `[+ Xin Tạm Ứng]` **ghim ở đầu màn hình**.
  2. Bấm nút, điền `Số tiền` = 5.000.000 ₫ và `Lý do / Ghi chú`. Gửi.
  3. Đăng nhập `ketoan`, mở phân hệ tạm ứng.
- **Kết quả mong đợi (Pass):**
  - Form chỉ gồm 2 trường: Số tiền cần ứng, Lý do / Ghi chú.
  - Lệnh xuất hiện bên Kế toán với trạng thái **Pending / Chờ duyệt**.
  - `[SỐ DƯ HIỆN TẠI]` **chưa** tăng (vì chưa duyệt).
- **Kỳ vọng sai (Fail nếu):** số dư tăng ngay khi gửi yêu cầu chưa được duyệt.
- **Bằng chứng:** ảnh nút ghim + ảnh form + ảnh hàng chờ bên `ketoan` + ảnh số dư chưa đổi

---

### TC-OPS-VI-002 — Kế toán duyệt tạm ứng → SỐ DƯ HIỆN TẠI tăng

- **Vai trò:** `ketoan` → `giaonhan`
- **Mức độ:** **P0**
- **Các bước:**
  1. Ghi lại `[SỐ DƯ HIỆN TẠI]` của `giaonhan` (gọi là `S0`).
  2. `ketoan` duyệt (Approved) khoản tạm ứng 5.000.000 ₫.
  3. `giaonhan` mở `/ops/wallet`.
- **Kết quả mong đợi (Pass):**
  - `Total_Advance` của tài khoản Ops tăng 5.000.000 ₫.
  - `[SỐ DƯ HIỆN TẠI]` = `S0 + 5.000.000`.
- **Bằng chứng:** ảnh số dư trước/sau + ảnh thao tác duyệt

---

### TC-OPS-VI-003 — Dashboard 4 card: đúng công thức và đúng màu

- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Tiền điều kiện (dữ liệu chốt để tính tay được):** tạm ứng **đã duyệt** `1.000.000`;
  chi `APPROVED` `300.000`; chi `PENDING` `200.000`; chi `REJECTED` `100.000`
- **Các bước:**
  1. Mở `/ops/wallet`. Đọc 4 card trên cùng.
  2. Đối chiếu với phép tính tay theo công thức PRD.
- **Kết quả mong đợi (Pass):**
  - Đủ 4 card: `[SỐ DƯ HIỆN TẠI]`, `[Đã duyệt]`, `[Chờ duyệt]`, `[Bị từ chối]`.
  - `SỐ DƯ HIỆN TẠI` = `Tổng tiền đã ứng − (Đã duyệt + Chờ duyệt)`
    = `1.000.000 − (300.000 + 200.000)` = **`500.000`** — khớp chính xác đến từng đồng.
  - `[Đã duyệt]` = `300.000` (**xanh lá**); `[Chờ duyệt]` = `200.000` (**vàng/cam**); `[Bị từ chối]` = `100.000` (**đỏ**).
  - **`REJECTED` KHÔNG bị trừ vào số dư** — đây là vế dễ sai nhất của công thức.
  - `[SỐ DƯ HIỆN TẠI]` dùng **font to nhất, nổi bật nhất** trong 4 card.
  - Tiền VND định dạng `vi-VN`, không có phần thập phân.
  - Có **unit test** phủ đúng công thức này (không chỉ kiểm bằng mắt).
- **Kỳ vọng sai (Fail nếu):** ra số khác `500.000`; `REJECTED` làm giảm số dư; 4 card cùng cỡ chữ; sai màu quy ước.
- **Bằng chứng:** ảnh 4 card + truy vấn DB đối chiếu + log unit test công thức

---

### TC-OPS-VI-004 — Optimistic UI: số dư giảm ngay khi Lưu chi phí

- **Vai trò:** `giaonhan`
- **Mức độ:** **P0**
- **Các bước:**
  1. Ghi `[SỐ DƯ HIỆN TẠI]` = `S0`.
  2. Nhập 1 khoản chi 300.000 ₫, bấm **Lưu**, quan sát số dư **ngay lập tức** (không chờ reload).
  3. DevTools → Network → Slow 3G, lặp lại với 200.000 ₫.
- **Kết quả mong đợi (Pass):**
  - Số dư nhảy sang `S0 − 300.000` **tức thời**, trước khi response server về.
  - Ở Slow 3G, số dư vẫn nhảy ngay (đúng bản chất Optimistic UI).
  - Nếu server trả lỗi ⇒ số dư **rollback** về giá trị cũ kèm thông báo tiếng Việt.
- **Kỳ vọng sai (Fail nếu):** phải F5 mới thấy số dư đổi; lỗi server mà số dư không rollback.
- **Bằng chứng:** video/ảnh liên tiếp thời điểm bấm Lưu + ảnh rollback khi lỗi

---

### TC-OPS-VI-005 — Kế toán từ chối → tiền rời [Chờ duyệt], cộng ngược vào [SỐ DƯ]

- **Vai trò:** `ketoan` → `giaonhan`
- **Mức độ:** **P0**
- **Tiền điều kiện:** có 1 khoản chi 300.000 ₫ đang `Chờ duyệt`
- **Các bước:**
  1. Ghi `[SỐ DƯ HIỆN TẠI]`, `[Chờ duyệt]`, `[Bị từ chối]`.
  2. `ketoan` thử **Từ chối** khoản 300.000 ₫ **bỏ trống lý do**.
  3. `ketoan` **Từ chối** với lý do "ảnh mờ".
  4. `giaonhan` mở lại `/ops/wallet`, xem dòng bị từ chối.
  5. `giaonhan` bấm **Chụp lại / Gửi lại** trên dòng đó, bổ sung ảnh, gửi.
- **Kết quả mong đợi (Pass):**
  - Bước 2: **bị chặn** — từ chối **bắt buộc có lý do**.
  - Bước 3: backend đặt `Status = Rejected`.
  - Bước 4: `[Chờ duyệt]` **giảm** 300.000 ₫; `[Bị từ chối]` **tăng** 300.000 ₫;
    `[SỐ DƯ HIỆN TẠI]` **tăng ngược** đúng 300.000 ₫; dòng hiển thị **lý do từ chối**.
  - Bước 5: gửi lại **đổi trạng thái dòng cũ** về `Chờ duyệt` (`[Chờ duyệt]` +300.000, số dư −300.000) — **không** tạo dòng chi mới (không nhân đôi khoản chi).
- **Kỳ vọng sai (Fail nếu):** từ chối được mà không cần lý do; tiền bị trừ 2 lần; số dư không cộng ngược; gửi lại sinh dòng trùng.
- **Bằng chứng:** ảnh 4 card ở 3 thời điểm + ảnh lý do từ chối + `SELECT` cho thấy vẫn 1 dòng chi

---

### TC-OPS-VI-006 — Smart Tag đỏ: có số tiền nhưng thiếu ảnh biên lai

- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Các bước:**
  1. Nhập 1 khoản chi **có số tiền, KHÔNG upload ảnh**. Lưu.
  2. Nhập 1 khoản chi **có số tiền + có ảnh**. Lưu.
  3. Mở danh sách lịch sử chi phí.
  4. Bổ sung ảnh cho khoản thứ nhất.
- **Kết quả mong đợi (Pass):**
  - Khoản thiếu ảnh gắn **Thẻ Màu Đỏ** trên dòng đó.
  - Khoản đủ ảnh **không** có thẻ đỏ.
  - Sau khi bổ sung ảnh, thẻ đỏ **biến mất**.
- **Kỳ vọng sai (Fail nếu):** thẻ đỏ gắn theo trạng thái duyệt thay vì theo `Attachment`.
- **Bằng chứng:** ảnh danh sách 2 dòng khác nhau + ảnh sau khi bổ sung

---

### TC-OPS-VI-007 — Micro-ledger: nhiều Ops chi trên cùng 1 lô → gom về 1 mã lô

- **Vai trò:** `giaonhan` + OPS thứ hai
- **Mức độ:** **P0**
- **Các bước:**
  1. `giaonhan` nhập chi phí Nâng cont cho lô X.
  2. OPS thứ hai nhập chi phí Bồi dưỡng cho **cùng lô X**.
  3. `ketoan` mở tổng hợp chi phí của lô X.
- **Kết quả mong đợi (Pass):**
  - Mỗi khoản lưu đúng `Paid_By_ID` = người nhập tương ứng.
  - Kế toán thấy **cả 2 khoản gom chung dưới 1 mã lô X duy nhất** — không tách thành 2 nhóm theo người chi.
- **Kỳ vọng sai (Fail nếu):** chi phí bị tách theo Ops; `Paid_By_ID` sai người.
- **Bằng chứng:** ảnh màn Kế toán gom theo lô + 2 giá trị `Paid_By_ID`

---

### TC-OPS-VI-008 — Đồng bộ PC ↔ Mobile

- **Vai trò:** `giaonhan`
- **Mức độ:** P1
- **Thiết bị:** Desktop + Mobile (390 × 844)
- **Các bước:**
  1. Trên **mobile**, nhập 1 khoản chi + chụp ảnh biên lai bằng camera. Lưu.
  2. Trên **desktop**, mở `/ops/wallet`, tải lại.
  3. Trên desktop nhập 1 khoản khác; kiểm tra lại trên mobile.
- **Kết quả mong đợi (Pass):**
  - Cả 2 chiều đều thấy dữ liệu của nhau — cùng một nguồn dữ liệu.
  - Trên mobile, ô upload cho phép `Chụp ảnh` (camera) qua `accept="image/*"`.
- **Bằng chứng:** ảnh 2 thiết bị hiển thị cùng danh sách

---

### TC-OPS-VI-009 — Tạo Đề nghị Thanh toán: gom theo lô, chia 2 rổ hóa đơn

- **Vai trò:** `giaonhan`
- **Mức độ:** **P0**
- **Tiền điều kiện:** có ≥ 4 khoản chi `Pending`/`Approved` chưa quyết toán, thuộc ≥ 2 lô, gồm cả loại phí có và không hóa đơn
- **Các bước:**
  1. Bấm `[Tạo Đề Nghị Thanh Toán]`.
  2. Đọc bảng kê sinh ra.
- **Kết quả mong đợi (Pass):**
  - Hệ thống tự query **toàn bộ** khoản `Pending` + `Approved` **chưa quyết toán** của Ops đó.
  - Dữ liệu **group by từng Lô hàng** (Số Bill / Booking).
  - Bảng kê chia **2 rổ**:
    - **Có hóa đơn**: Nâng/Hạ, Phí cảng, Lưu kho, Cơ sở hạ tầng.
    - **Không hóa đơn**: Phí làm hàng hải quan, Bồi dưỡng, Tiền luật, Cân xe.
  - Khoản đã quyết toán trước đó **không** bị gom lại lần hai.
- **Kỳ vọng sai (Fail nếu):** phân loại rổ sai; gom trùng khoản đã quyết toán.
- **Bằng chứng:** ảnh bảng kê đủ 2 rổ + nhóm theo lô

---

### TC-OPS-VI-010 — Export Excel/PDF + đồng bộ thẳng sang màn Kế toán

- **Vai trò:** `giaonhan` → `ketoan`
- **Mức độ:** P1
- **Các bước:**
  1. Từ đề nghị thanh toán vừa tạo, bấm xuất **Excel** rồi **PDF**.
  2. Đăng nhập `ketoan`, mở `/expenses` (hoặc `/advances`).
- **Kết quả mong đợi (Pass):**
  - Tệp Excel và PDF tải về, mở được, nội dung khớp bảng kê trên màn (đủ 2 rổ, đủ nhóm lô).
  - Đề nghị **đã hiện sẵn** trên màn Kế toán — không cần Ops gửi thủ công.
- **Bằng chứng:** 2 tệp tải về + ảnh màn Kế toán

---

### TC-OPS-VI-011 — Luồng duyệt cuối: đủ ảnh → duyệt; nợ ảnh → chặn

- **Vai trò:** `ketoan`
- **Mức độ:** **P0**
- **Tiền điều kiện:** đề nghị chứa 1 khoản đủ ảnh + 1 khoản gắn thẻ đỏ (nợ ảnh)
- **Các bước:**
  1. `ketoan` duyệt khoản **đủ ảnh hợp lệ**.
  2. `ketoan` thử duyệt khoản **nợ ảnh (thẻ đỏ)**.
  3. `giaonhan` bổ sung ảnh; `ketoan` duyệt lại.
- **Kết quả mong đợi (Pass):**
  - Khoản đủ ảnh: chuyển **nhãn xanh**, **trừ chính thức** vào tạm ứng; `[Đã duyệt]` tăng, `[Chờ duyệt]` giảm.
  - Khoản nợ ảnh: **bị chặn duyệt**, buộc Ops bổ sung ảnh (hoặc chờ Kế toán kiểm chứng từ giấy tận tay).
  - Sau khi bổ sung ảnh: duyệt được, thẻ đỏ mất.
- **Kỳ vọng sai (Fail nếu):** duyệt được khoản nợ ảnh mà không có bước kiểm chứng từ giấy.
- **Bằng chứng:** ảnh 3 bước + 4 card sau mỗi bước

---

### TC-OPS-VI-012 — Phiếu có mã riêng và khóa danh sách khoản chi tham gia

- **Vai trò:** `giaonhan`
- **Mức độ:** **P0** (chống gom trùng)
- **Tiền điều kiện:** đã tạo 1 đề nghị thanh toán ở `TC-OPS-VI-009`
- **Các bước:**
  1. Đọc mã phiếu vừa tạo; ghi lại danh sách khoản chi thuộc phiếu.
  2. Quay lại `/ops/orders`, khai thêm **1 khoản chi mới**.
  3. Mở lại phiếu cũ.
  4. Bấm `[Tạo Đề Nghị Thanh Toán]` lần thứ hai.
- **Kết quả mong đợi (Pass):**
  - Phiếu mang **mã phiếu riêng, duy nhất**.
  - Danh sách khoản chi của phiếu cũ **bị khóa** — khoản mới ở bước 2 **không** lọt vào phiếu cũ.
  - Phiếu thứ hai chứa **đúng khoản mới**, không gom lại khoản đã thuộc phiếu trước.
  - Tổng tiền mỗi phiếu khớp tổng các khoản của chính nó.
- **Kỳ vọng sai (Fail nếu):** khoản chi nằm trong 2 phiếu cùng lúc; phiếu cũ tự nuốt khoản mới; trùng mã phiếu.
- **Bằng chứng:** ảnh 2 phiếu + `SELECT` bảng liên kết khoản chi ↔ phiếu

---

### TC-OPS-VI-013 — Bản in A4 của phiếu (sổ phụ đính kèm hồ sơ giấy)

- **Vai trò:** `giaonhan`
- **Mức độ:** P1
- **Các bước:**
  1. Trên phiếu vừa tạo, bấm **In phiếu**.
  2. Xem bản xem trước khi in (print preview).
- **Kết quả mong đợi (Pass):**
  - Bản in **khổ A4**, **không** có menu / sidebar / khung điều hướng của app.
  - Đủ nội dung: mã phiếu, tên Ops, kỳ đối soát, bảng kê theo lô chia 2 rổ, tổng từng rổ, tổng chung.
  - Có **ô ký tên** để đính kèm hồ sơ chứng từ gốc gửi Kế toán.
  - Bảng không bị cắt cột khi in; xuống trang không cắt đôi dòng.
- **Kỳ vọng sai (Fail nếu):** in ra kèm sidebar; mất cột; thiếu ô ký tên.
- **Bằng chứng:** ảnh print preview + file PDF in ra

---

### TC-OPS-VI-014 — Chặn duyệt cả phiếu khi còn khoản chưa duyệt; khoản đã duyệt bị khóa

- **Vai trò:** `ketoan`
- **Mức độ:** **P0**
- **Tiền điều kiện:** phiếu có ≥ 2 khoản, trong đó ≥ 1 khoản còn `PENDING`
- **Các bước:**
  1. `ketoan` duyệt 1 khoản trong phiếu, để lại ≥ 1 khoản `PENDING`.
  2. Thử **duyệt cả phiếu** ngay lúc này.
  3. Thử sửa / xoá khoản vừa được duyệt (cả trên UI của `ketoan` lẫn của `giaonhan`).
  4. Duyệt nốt khoản cuối, rồi duyệt phiếu.
- **Kết quả mong đợi (Pass):**
  - Bước 2: **bị chặn** với thông báo tiếng Việt — phiếu chỉ duyệt được khi **mọi khoản** đã `APPROVED`.
  - Bước 3: khoản `APPROVED` **khóa vĩnh viễn** — không sửa, không xoá được từ bất kỳ vai trò nào.
    (Đối chiếu: khoản `PENDING` / `REJECTED` thì **người nhập** vẫn sửa/xoá được.)
  - Bước 4: duyệt phiếu thành công ⇒ phiếu chốt trạng thái **"Đã quyết toán"**.
  - Duyệt phiếu **không** đổi lại công thức ví (khoản `APPROVED` đã trừ từ lúc duyệt khoản).
- **Kỳ vọng sai (Fail nếu):** duyệt được phiếu khi còn khoản `PENDING`; khoản đã duyệt vẫn sửa/xoá được; số dư nhảy lần hai khi duyệt phiếu.
- **Bằng chứng:** ảnh lỗi bước 2 + ảnh nút sửa/xoá bị khóa + ảnh 4 card trước/sau duyệt phiếu

---

## 5.4 — Phân quyền

### TC-OPS-RBAC-001 — Vai trò khác không vào được `/ops/*`

- **Vai trò thử:** `laixe`, `cus`, `dieuvan`, `customer`
- **Mức độ:** P0
- **Các bước:** với từng vai trò, mở trực tiếp `/ops/orders`, `/ops/fleet-tracking`, `/ops/wallet`.
- **Kết quả mong đợi (Pass):**
  - Bị chuyển hướng im lặng về màn nhà của vai trò; không nháy nội dung bị cấm.
  - API trả 403; body không lộ dữ liệu.
  - Sidebar không hiển thị mục `/ops/*` cho các vai trò này.
- **Bằng chứng:** ảnh redirect từng vai trò + Network 403

---

### TC-OPS-RBAC-002 — Ops không vào được màn văn phòng

- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Các bước:** mở `/dispatch`, `/dispatch-detail`, `/shipments`, `/finance`, `/audit-logs`.
- **Kết quả mong đợi (Pass):** tất cả bị chặn, redirect về `/ops/orders`.
- **Bằng chứng:** ảnh redirect từng route

---

## Bảng nghiệm thu — Luồng Ops

| Ngày thử | Mã TC | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|-----------|---------|---------|------------|
| __/__/__ | TC-OPS-KH-001 | | | Danh sách tổng thể theo ngày | |
| __/__/__ | TC-OPS-KH-002 | | | Ghim lên đầu, bền sau reload | |
| __/__/__ | TC-OPS-KH-003 | | | Ghim cá nhân, không rò | |
| __/__/__ | TC-OPS-KH-004 | | | Auto-fill Số Bill / Số Cont | |
| __/__/__ | TC-OPS-KH-005 | | | Lưu chi phí → đẩy sang Quỹ | |
| __/__/__ | TC-OPS-XE-001 | | | Chuyến tự xuất hiện | |
| __/__/__ | TC-OPS-XE-002 | | | Đủ 3 cột | |
| __/__/__ | TC-OPS-XE-003 | | | Trạng thái đồng bộ từ Lái xe | |
| __/__/__ | TC-OPS-XE-004 | | | Read-only tuyệt đối | |
| __/__/__ | TC-OPS-XE-005 | | | Chỉ thấy xe được giao | |
| __/__/__ | TC-OPS-XE-006 | | | Trang trống khi chưa gán xe | |
| __/__/__ | TC-OPS-VI-001 | | | Xin tạm ứng → Pending | |
| __/__/__ | TC-OPS-VI-002 | | | Duyệt → số dư tăng | |
| __/__/__ | TC-OPS-VI-003 | | | 4 card đúng công thức + màu | |
| __/__/__ | TC-OPS-VI-004 | | | Optimistic UI + rollback | |
| __/__/__ | TC-OPS-VI-005 | | | Từ chối → cộng ngược số dư | |
| __/__/__ | TC-OPS-VI-006 | | | Smart Tag đỏ nợ chứng từ | |
| __/__/__ | TC-OPS-VI-007 | | | Micro-ledger gom theo lô | |
| __/__/__ | TC-OPS-VI-008 | | | Đồng bộ PC ↔ Mobile | |
| __/__/__ | TC-OPS-VI-009 | | | Đề nghị TT: gom lô + 2 rổ | |
| __/__/__ | TC-OPS-VI-010 | | | Export + sync Kế toán | |
| __/__/__ | TC-OPS-VI-011 | | | Duyệt cuối: đủ ảnh / nợ ảnh | |
| __/__/__ | TC-OPS-VI-012 | | | Phiếu có mã riêng + khóa danh sách (P0) | |
| __/__/__ | TC-OPS-VI-013 | | | Bản in A4 có ô ký tên | |
| __/__/__ | TC-OPS-VI-014 | | | Chặn duyệt phiếu khi còn PENDING (P0) | |
| __/__/__ | TC-OPS-RBAC-001 | | | Vai trò khác bị chặn | |
| __/__/__ | TC-OPS-RBAC-002 | | | Ops không vào màn văn phòng | |
