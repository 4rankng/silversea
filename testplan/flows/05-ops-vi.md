# Luồng 5: Vận Hành Hiện Trường (Ops) — Lô hàng · Theo dõi xe · Ví tạm ứng

> **Vai trò sở hữu:** Nhân viên Hiện trường (`Role.OPS`, tài khoản `giaonhan`)
> **Tài khoản demo:** `giaonhan` / `Abc123` (kế toán duyệt: `ketoan` / `Abc123`)
> **Route chính:** `/ops/orders`, `/ops/fleet-tracking`, `/ops/wallet`
> **Thiết bị mặc định:** Mobile (390×844) cho khai liệu tại cảng; Desktop cho đối soát
> **PRD nguồn:** `docs/prd/OpsVanHanh.md`; tiêu chí vai trò: `roles/06-vanhanh.md` Flow 7–9
>
> **Tổng quan luồng:** Ops xem kế hoạch làm hàng theo ngày (toàn công ty), ghim lô cần
> theo dõi, khai chi phí phát sinh kèm ảnh biên lai ngay trên lô; theo dõi thụ động các
> đầu xe được giao quản lý; kiểm soát ví tạm ứng (số dư nhảy tức thời, nhắc nợ chứng từ)
> và xuất đề nghị thanh toán cho Kế toán duyệt.
>
> **Ghi chú phạm vi (2026-09-06):** Luồng `05-ops-chi-phi.md` cũ (gắn
> PENDING_EXPENSE_APPROVAL + tự cấn trừ) đã dừng và xoá 2026-09-05 (commit `58a330af`).
> File này tái đưa phạm vi chi phí Ops theo đặc tả mới — không dùng lại cơ chế đã dừng.

---

## 5.1 — Kế hoạch làm hàng (/ops/orders)

### TC-OPS-VI-001 — Danh sách lô theo ngày, mặc định hôm nay

- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Có ≥ 3 lô có `Ngày giao dự kiến` = hôm nay (trạng thái bất kỳ trừ Đã hủy)
- **Các bước:**
  1. Đăng nhập `giaonhan`. Mở `/ops/orders`.
  2. Xem danh sách; đổi sang ngày khác có lô; tìm theo mã khách hàng.
- **Kết quả mong đợi (Pass):**
  - Mặc định hôm nay; hiển thị TOÀN BỘ lô của công ty trong ngày (không lọc theo người), bỏ lô Đã hủy.
  - Bảng: Mã lô | Khách hàng | Tuyến | Cont | Bill/Booking | Trạng thái (chữ màu) | hành động.
  - Đổi ngày/tìm kiếm phản ánh đúng; URL giữ trạng thái.
- **Kỳ vọng sai (Fail nếu):** Thiếu lô của người khác; sai ngày; badge màu ở Trạng thái.
- **Bằng chứng:** ảnh danh sách hôm nay + ảnh ngày khác + ảnh tìm kiếm

### TC-OPS-VI-002 — Ghim lệnh (sổ tay cá nhân)

- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Các bước:**
  1. Bấm Ghim trên 1 lô giữa danh sách. Quan sát vị trí.
  2. Tải lại trang. Ghim thêm lô thứ hai.
  3. (Nghiệm thu phân quyền) đăng nhập OPS khác — lô đó KHÔNG ghim trên tài khoản này.
- **Kết quả mong đợi (Pass):**
  - Lô ghim nhảy lên đầu danh sách ngay; sống sót qua reload; ghim mới nhất trên cùng.
  - Ghim là của riêng từng tài khoản (bookmark cá nhân).
- **Kỳ vọng sai (Fail nếu):** Ghim ảnh hưởng tài khoản khác; mất ghim sau reload.
- **Bằng chứng:** ảnh trước/sau ghim + ảnh tài khoản OPS khác

### TC-OPS-VI-003 — Khai báo chi phí: tự điền Bill/Cont

- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Lô IMPORT có Bill + ≥ 2 vỏ cont; lô EXPORT có Booking
- **Các bước:**
  1. Bấm vào dòng lô IMPORT. Kiểm tra form Khai báo chi phí.
  2. Chọn Loại phí nhóm "Có hóa đơn"; chọn vỏ cont; nhập số tiền; chụp 1 ảnh biên lai; Lưu.
  3. Lặp lại với lô EXPORT, chọn "Phí chung lô", KHÔNG tải ảnh, Lưu.
- **Kết quả mong đợi (Pass):**
  - Mã lô + Số Bill (IMPORT) / Booking (EXPORT) tự điền readonly đúng.
  - Danh sách vỏ cont đúng theo lô; "Phí chung lô" xuất hiện khi lô nhiều vỏ.
  - Loại phí nhóm Có/Không hóa đơn; số tiền nguyên dương VND.
  - Cả 2 khoản lưu thành công trạng thái Chờ duyệt; khoản không ảnh vẫn được lưu (nợ chứng từ).
- **Kỳ vọng sai (Fail nếu):** Bill/Booking ngược chiều; số tiền âm/0/thập phân vẫn lưu; bắt buộc ảnh.
- **Bằng chứng:** ảnh 2 form + ảnh lịch sử ví sau lưu

### TC-OPS-VI-004 — RBAC màn /ops/*

- **Vai trò:** `cus`, `laixe`
- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `cus`. Truy cập trực tiếp `/ops/wallet`.
  2. Đăng nhập `laixe`. Truy cập trực tiếp `/ops/orders`.
- **Kết quả mong đợi (Pass):** Cả hai bị chuyển về trang chủ của vai trò (AUTH-03); không thấy mục "Vận hành" trên menu.
- **Bằng chứng:** ảnh URL sau chuyển hướng × 2

---

## 5.2 — Theo dõi phương tiện (/ops/fleet-tracking)

### TC-OPS-VI-005 — Chỉ hiển thị xe được gán, trạng thái live

- **Vai trò:** `giaonhan` (+ `admin` cấu hình, `dieuvan` phát lệnh)
- **Mức độ:** P0
- **Tiền điều kiện:** Admin gán "Ops phụ trách" = `giaonhan` cho 2 xe; 1 xe có chuyến đang chạy
- **Các bước:**
  1. `admin` cấu hình gán xe tại trang Đội xe.
  2. `giaonhan` mở `/ops/fleet-tracking`. Ghi nhận danh sách.
  3. `dieuvan` phát lệnh cho 1 xe chưa có lệnh trong danh sách. Chờ ≤ 30s (không tải lại tay).
- **Kết quả mong đợi (Pass):**
  - Chỉ 2 xe được gán hiển thị: Biển số | Rơ-moóc | Lệnh đang gán (mã chuyến + mã lô) | Tài xế | Trạng thái | Thời gian.
  - Trạng thái khớp thao tác lái xe (Chờ nhận lệnh / Đang vận chuyển / Đã hoàn thành / Đang rảnh).
  - Lệnh mới TỰ xuất hiện không cần thao tác của Ops.
  - Không có bất kỳ nút thao tác nào trên trang (read-only tuyệt đối).
- **Kỳ vọng sai (Fail nếu):** Hiển thị xe không được gán; phải tải lại mới thấy lệnh mới; có nút xác nhận/chỉnh sửa.
- **Bằng chứng:** ảnh trước/sau phát lệnh (kèm giờ) + ảnh trang rỗng với OPS chưa được gán

### TC-OPS-VI-006 — OPS chưa được gán xe

- **Vai trò:** OPS thứ 2 (chưa gán xe)
- **Mức độ:** P1
- **Kết quả mong đợi (Pass):** Trang trống "Chưa có xe nào được giao cho bạn quản lý" + gợi ý liên hệ Admin; không lỗi.
- **Bằng chứng:** ảnh

---

## 5.3 — Ví tạm ứng (/ops/wallet)

### TC-OPS-VI-007 — Công thức 4 thẻ

- **Mức độ:** P0
- **Tiền điều kiện:** Backend test/DB: tạm ứng đã duyệt 1.000.000; chi APPROVED 300.000; chi PENDING 200.000; chi REJECTED 100.000
- **Các bước:**
  1. Mở `/ops/wallet`. Đối chiếu 4 thẻ với công thức.
- **Kết quả mong đợi (Pass):**
  - SỐ DƯ HIỆN TẠI = 1.000.000 − (300.000 + 200.000) = **500.000** (thẻ to nhất).
  - Đã duyệt 300.000 (xanh lá); Chờ duyệt 200.000 (vàng/cam); Bị từ chối 100.000 (đỏ).
  - REJECTED KHÔNG trừ vào số dư.
- **Kỳ vọng sai (Fail nếu):** Sai công thức bất kỳ vế nào; REJECTED làm giảm số dư.
- **Bằng chứng:** ảnh thẻ + truy vấn DB đối chiếu

### TC-OPS-VI-008 — Số dư nhảy tức thời khi lưu chi phí (optimistic)

- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Các bước:**
  1. Mở `/ops/wallet`, ghi số dư + Chờ duyệt.
  2. Vào `/ops/orders`, khai 1 khoản 50.000 kèm ảnh. Quay lại `/ops/wallet`.
- **Kết quả mong đợi (Pass):**
  - Ngay khi Lưu (không chờ refetch): Số dư −50.000, Chờ duyệt +50.000; sau refetch khớp tuyệt đối server.
- **Kỳ vọng sai (Fail nếu):** Phải chờ tải lại mới nhảy; lệch số sau refetch (drift).
- **Bằng chứng:** ảnh trước/sau + network log

### TC-OPS-VI-009 — Xin tạm ứng → kế toán duyệt → số dư tăng

- **Vai trò:** `giaonhan` + `ketoan`
- **Mức độ:** P0
- **Các bước:**
  1. `giaonhan` bấm `+ Xin Tạm Ứng`: 2.000.000, lý do "phí cảng 4 cont".
  2. `ketoan` duyệt (màn duyệt tạm ứng sẵn có). Quay lại `giaonhan` mở `/ops/wallet`.
- **Kết quả mong đợi (Pass):**
  - Lưu thành PENDING; phiếu xuất hiện cả ở `/my-advances` (cùng bảng dữ liệu).
  - Sau duyệt: Tổng đã ứng +2.000.000, SỐ DƯ HIỆN TẠI +2.000.000.
  - Lý do bắt buộc — bỏ trống không lưu được.
- **Bằng chứng:** ảnh form + ảnh duyệt + ảnh ví sau duyệt

### TC-OPS-VI-010 — Nhãn đỏ "Nợ chứng từ"

- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Các bước:**
  1. Tạo 1 khoản chi KHÔNG ảnh (TC-003 bước 3 đã có). Mở lịch sử chi phí.
- **Kết quả mong đợi (Pass):** Dòng có số tiền nhưng 0 ảnh hiển thị nhãn đỏ "Nợ chứng từ" (chữ đỏ); dòng có ảnh không có nhãn.
- **Bằng chứng:** ảnh lịch sử

### TC-OPS-VI-011 — Kế toán từ chối → cộng ngược số dư → gửi lại

- **Vai trò:** `ketoan` + `giaonhan`
- **Mức độ:** P0
- **Các bước:**
  1. `ketoan` từ chối khoản 50.000 (TC-008) lý do "ảnh mờ".
  2. `giaonhan` mở `/ops/wallet`: kiểm 4 thẻ + xem dòng bị từ chối.
  3. Bấm "Chụp lại/Gửi lại" trên dòng đó, thêm ảnh, gửi.
- **Kết quả mong đợi (Pass):**
  - Chờ duyệt −50.000; SỐ DƯ HIỆN TẠI **+50.000** (cộng ngược); Bị từ chối +50.000 (đỏ) kèm lý do.
  - Gửi lại thành công → trả về Chờ duyệt (+50.000, số dư −50.000).
- **Kỳ vọng sai (Fail nếu):** Từ chối không cần lý do; số dư không cộng ngược; gửi lại tạo dòng mới thay vì đổi trạng thái.
- **Bằng chứng:** ảnh 3 thời điểm + DB status

---

## 5.4 — Đề nghị thanh toán & sổ phụ

### TC-OPS-VI-012 — Tạo đề nghị thanh toán: gom lô + 2 rổ hóa đơn

- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Tiền điều kiện:** Có chi chưa quyết toán ở ≥ 2 lô, đủ cả loại Có/Không hóa đơn
- **Các bước:**
  1. Bấm `Tạo Đề Nghị Thanh Toán`. Kiểm tra bản xem trước.
  2. Xác nhận tạo phiếu.
- **Kết quả mong đợi (Pass):**
  - Group by lô (Mã lô + Bill/Booking); mỗi lô 2 rổ Có hóa đơn / Không hóa đơn đúng theo loại phí; tổng từng rổ + tổng chung.
  - Chỉ gồm chi PENDING + APPROVED chưa thuộc phiếu nào (chi đã ở phiếu trước không vào lại).
  - Phiếu có mã riêng; danh sách chi của phiếu bị khóa (khoản mới vào phiếu sau).
- **Kỳ vọng sai (Fail nếu):** Trộn hóa đơn/không hóa đơn; chi đã quyết toán vào lại; thiếu tổng.
- **Bằng chứng:** ảnh preview + ảnh phiếu + DB link

### TC-OPS-VI-013 — Xuất Excel + In phiếu

- **Vai trò:** `giaonhan`
- **Mức độ:** P1
- **Các bước:**
  1. Trên phiếu vừa tạo: bấm Xuất Excel; mở file.
  2. Bấm In phiếu (`/ops/wallet/settlements/:id/print`).
- **Kết quả mong đợi (Pass):**
  - Excel: từng dòng chi (lô, loại phí, cont, số tiền, rổ), dòng tổng theo rổ + tổng chung, mở được bằng Excel.
  - Bản in: khổ A4, không menu/sidebar, đủ chi tiết + ô ký tên.
- **Bằng chứng:** file Excel + ảnh print view

### TC-OPS-VI-014 — Kế toán duyệt phiếu (quyết toán)

- **Vai trò:** `ketoan`
- **Mức độ:** P0
- **Các bước:**
  1. `ketoan` mở tab "Chi phí Ops" (workspace tạm ứng): duyệt từng khoản của phiếu TC-012.
  2. Thử duyệt PHIẾU khi còn 1 khoản PENDING → kỳ vọng bị chặn.
  3. Duyệt nốt khoản cuối rồi duyệt phiếu.
- **Kết quả mong đợi (Pass):**
  - Duyệt từng khoản: nhãn xanh, khóa (không sửa/xóa được nữa).
  - Duyệt phiếu chỉ khi mọi khoản đã Duyệt → phiếu "Đã quyết toán".
  - Từ chối khoản phải kèm lý do; khoản bị từ chối tự rời khỏi phiếu.
- **Kỳ vọng sai (Fail nếu):** Duyệt phiếu khi còn khoản chờ; chi đã duyệt vẫn sửa được.
- **Bằng chứng:** ảnh từng bước + DB

---

## Bảng nghiệm thu

| Ngày thử | Mã TC | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|-----------|---------|---------|------------|
| __/__/__ | TC-OPS-VI-001 | | | | |
| __/__/__ | TC-OPS-VI-002 | | | | |
| __/__/__ | TC-OPS-VI-003 | | | | |
| __/__/__ | TC-OPS-VI-004 | | | | |
| __/__/__ | TC-OPS-VI-005 | | | | |
| __/__/__ | TC-OPS-VI-006 | | | | |
| __/__/__ | TC-OPS-VI-007 | | | | |
| __/__/__ | TC-OPS-VI-008 | | | | |
| __/__/__ | TC-OPS-VI-009 | | | | |
| __/__/__ | TC-OPS-VI-010 | | | | |
| __/__/__ | TC-OPS-VI-011 | | | | |
| __/__/__ | TC-OPS-VI-012 | | | | |
| __/__/__ | TC-OPS-VI-013 | | | | |
| __/__/__ | TC-OPS-VI-014 | | | | |
