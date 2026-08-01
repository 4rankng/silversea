

```
[1] TẠO LÔ    →  [2] BÀN GIAO  →  [3] PHÂN XE   →  [4] KHỞI HÀNH  →  [5] TÀI XẾ NHẬN VIỆC
  Clerk            Clerk              Dispatcher      Dispatcher        Tài xế
  (DRAFT)       (IN_PROGRESS)        (tạo Trip)    (IN_TRANSIT)      (push → app)
```

| Bước | Ai làm | Làm gì | Kết quả |
|------|--------|--------|---------|
| **1. Tạo lô hàng** | Nhân viên chứng từ (CLERK) | Nhập khách hàng, booking, BL, tờ khai, loại hàng (FCL/LCL), container, ngày giờ | Lô ở trạng thái **Bản nháp** |
| **2. Bổ sung & bàn giao** | CLERK | Đính chứng từ + chuyển cho điều độ | Lô sang **Đang xử lý**, tạo phiếu bàn giao |
| **3. Phân xe (Dispatch)** | Điều độ (MANAGER) | Tách đơn giao, chọn **xe + tài xế** (hoặc thuê ngoài), kiểm tra trùng lịch | Tạo **Chuyến đi** (chưa chạy) |
| **4. Khởi hành** | MANAGER | Bấm "Khởi hành" trên bảng điều độ | Chuyến sang **Đang chạy**, hệ thống gửi thông báo đến app tài xế |
| **5. Nhận việc** | Tài xế (DRIVER) | Mở app xem chi tiết chuyến | Chạy chuyến (xem ghi chú bên dưới) |

### Các trạng thái lô hàng
```
Bản nháp → Đang xử lý → Đã giao → Đã đóng
              ↓
           Đã hủy
```

### Các trạng thái chuyến đi
```
Mới tạo → Đang chạy → Hoàn thành → Đã khóa
   ↓        ↓
 Đã hủy   Đã hủy
```

---

## 3. Vai trò & Trách nhiệm

Hệ thống có **7 vai trò**. Luồng này liên quan **5 vai trò**:

| Vai trò | Tiếng Việt | Trong luồng này | Quyền hạn |
|---------|-----------|-----------------|-----------|
| **CLERK** | Nhân viên chứng từ | Tạo lô, nhập chứng từ, bàn giao | Tạo/sửa lô, **không xóa** |
| **MANAGER** | Quản lý (Điều độ) | Nhận bàn giao, phân xe, khởi hành, đổi/hủy chuyến | Đầy đủ vận hành |
| **ADMIN** | Quản trị viên | Tất cả như MANAGER + cấu hình hệ thống | Tuyệt đối |
| **DRIVER** | Tài xế | Nhận thông báo, xem chuyến, chạy, nộp bằng chứng | Chỉ chuyến của mình |
| **ACCOUNTANT** | Kế toán | **Chỉ xem** lô (đối soát), không thao tác | Read-only |
