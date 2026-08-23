# QUY TRÌNH VẬN HÀNH & QUYẾT TOÁN (ORDER-TO-CASH WORKFLOW)
**Dự án:** Phần mềm Quản lý Vận tải TTransport - Silver Sea

### I. SƠ ĐỒ CHUYỂN ĐỔI TRẠNG THÁI HỆ THỐNG (STATE MACHINE)
*(Dev Note: Hệ thống cần có 1 trường `Status` cho Lô hàng)*
1. `Mới tạo (New)` ➔ 2. `Đã phân xe (Dispatched)` ➔ 3. `Đang chạy (In-Transit)` ➔ 4. `Chờ duyệt phí (Pending)` ➔ 5. `Hoàn thành (Completed)`.

> **Lưu ý nghiệp vụ:** Tạm thời **BỎ trạng thái `Đã khóa (Locked/Billed)`**. Trạng thái kết thúc là `Hoàn thành (Completed)` — chuyến đi sau khi hoàn thành **vẫn cho phép chỉnh sửa chi phí** (thực tế khách: chuyến xong vẫn phải điều chỉnh chi phí). Tính năng "Khóa cứng / Đóng băng dữ liệu (Read-only)" được **hoãn lại**, chỉ build khi khách hàng chính thức yêu cầu — tránh việc sau này khách phàn nàn *"sao em không sửa được chi phí"*.

---

### II. CHI TIẾT CÁC BƯỚC VẬN HÀNH

#### BƯỚC 0: THIẾT LẬP NỀN TẢNG (MASTER DATA SETUP) & BẢO MẬT
*   **Người thực hiện:** Admin / Giám đốc / Kế toán / Nhân viên CUS.
*   **Thao tác (Nghiệp vụ):** Cập nhật dữ liệu chuẩn vào hệ thống bao gồm: Danh sách Khách hàng, Nhà cung cấp, Tuyến đường, Bảng giá cước, Định mức nhiên liệu, và Danh sách Nhà máy (kèm MST, Lưu ý đặc biệt...).
*   **Dev Note:**
    *   **Mở rộng Master Data:** 
        *   *Nhà cung cấp (NCC):* Bắt buộc tách riêng 2 trường `Hạn thanh toán Chi hộ` và `Hạn thanh toán Cước` (vì NCC thực tế có 2 mốc hạn nợ khác nhau).
        *   *Cảng/Bãi:* Bổ sung bảng Ma trận phí Nâng/Hạ chuẩn theo `Tên Cảng + 20'/40' + Hàng/Rỗng`.
    *   **Định dạng Biển số xe:** Bắt buộc lưu dưới dạng Văn bản (Text) có dấu tách (Ví dụ: `15C-123.45`).
    *   **Phân quyền (7 vai trò):** Thiết lập 7 vai trò: Admin, Giám đốc, Kế toán, Điều vận, Chứng từ (CUS), Hiện trường (Ops), Lái xe.
    *   **Bảo mật & Thao tác:** Các thông tin nhạy cảm (biên lợi nhuận chuyến, lương lái xe, hoa hồng, giá vốn) chỉ hiển thị với Giám đốc/Kế toán/Admin, ẩn hoàn toàn với Điều vận và Ops. **Chỉ Admin / Giám đốc mới có quyền chỉnh sửa hoặc xoá dữ liệu hệ thống (sau khi duyệt), những người còn lại chỉ được quyền thêm mới (Create-only).**
    *   **Quy tắc xóa cho người Create-only:**
        *   **Được xóa khi tạo sai:** Nếu người dùng Create-only vừa thêm mới mà phát hiện sai, họ **vẫn có quyền xóa** — không ép giữ lại bản ghi sai.
        *   **Giới hạn trong phiên làm việc (session):** Quyền xóa này chỉ áp dụng trong **phiên làm việc hiện tại** (session). 
        *   **Xóa ở phiên cũ → phải được duyệt:** Nếu muốn xóa dữ liệu tạo ra từ phiên trước, người Create-only phải gửi yêu cầu và được Admin / Giám đốc phê duyệt.
        *   **Ngoại lệ cấm xóa:** Chi phí và chứng từ **đã được Kế toán duyệt** thì **không được xóa** (dù ở bất kỳ phiên nào, bởi bất kỳ ai dưới quyền duyệt). Chỉ Admin / Giám đốc mới có quyền xử lý.
    *   **Phân loại tài sản:** Tại Master Data Xe, thiết lập Tag nguồn gốc xe: `Xe nhà (In-house)` và `Xe ngoài (Subcontractor)`.
    *   **Push Notification (MVP):** Tạm thời trong flow chỉ cài đặt push cho 2 role: **Lái xe** và **Điều vận**. 

#### BƯỚC 1: KHỞI TẠO & KIỂM DUYỆT LÔ HÀNG (NGHIỆP VỤ CUS)
*   **Người thực hiện:** Nhân viên CUS.
*   **Thao tác (Nghiệp vụ):**
    *   **Tạo mới:** Tiếp nhận Booking, nhập thông tin lên phần mềm (Số Bill/Booking, Khách hàng, Tuyến đường, Nhà máy). 
    *   **Phân loại hàng hóa:** 
        *   *Hàng FCL (Container):* Nhập số lượng Cont / KG / CBM.
        *   *Hàng LCL (Hàng lẻ):* Có màn hình nhập liệu chuyên biệt gồm các trường: Kho lấy hàng, Loại bao bì (Pallet, Roll, Carton), Số lượng, Số kg, Số CBM, Ghi chú lưu ý.
    *   **CUS - PHẦN 1 (Hiển thị chi tiết lô hàng để theo dõi):** Hiển thị dạng danh sách chi tiết để CUS kiểm tra lại độ chính xác so với chứng từ gốc, chuẩn bị dữ liệu chuẩn cho Điều vận và Kế toán.
*   **Dev Note:**
    *   *Trigger Báo giá Cước:* Hệ thống tự động truy xuất Bảng giá (theo Khách hàng x Tuyến đường) để gán Đơn giá cước dự kiến.
    *   *Trigger Phụ phí Xăng dầu:* Thiết lập thuật toán tính phụ phí tự động ngay khi tạo lô hàng. Kế toán/CUS chỉ cần nhập tham số `Giá dầu hiện tại`, hệ thống tự tính: `Phụ phí = (Giá dầu hiện tại - Giá dầu gốc cấu hình) * Số Lít định mức * Tỷ lệ % chia sẻ của Khách hàng`.
    *   *Trạng thái Lô hàng:* `Mới tạo`.

#### BƯỚC 2: PHÂN BỔ & ĐIỀU XE 2 CẤP ĐỘ (NGHIỆP VỤ ĐIỀU VẬN)
*   **Người thực hiện:** Điều vận viên.
*   **Thao tác (Nghiệp vụ):**
    *   **ĐIỀU VẬN - PHẦN 1:** Dữ liệu gộp (Ví dụ: `5x40HC`). Giúp điều vận tính toán sơ bộ, điền tạm thông tin xe để có bức tranh tổng quát trong 1 ngày.
    *   **ĐIỀU VẬN - PHẦN 2:** Hệ thống rã chi tiết thành từng dòng (5 cont tách 5 dòng). Giao diện hiển thị ghi chú/gợi ý xe đã "gán nháp" để chốt xe.
    *   **Ghép/Kẹp:** Hỗ trợ tính năng ghép xe (hàng LCL) hoặc tích chọn chạy hai chiều "Kẹp hàng" để phân bổ lộ trình cho lái xe.
*   **Dev Note:**
    *   *Kế thừa Data:* Khi gán xe, hệ thống tự động lưu trữ Tag `Xe nhà` hoặc `Xe ngoài` đi theo Lô hàng đó để phục vụ tách P&L ở Bước 4.
    *   *Thuật toán Tối ưu Tiền đường:* Khi tích chọn "Kẹp hàng" (1 xe chạy 2 lệnh/ngày trên cùng lộ trình), hệ thống chỉ gợi ý 1 lần định mức phí đường bộ (VETC) khép kín, tránh nhân đôi chi phí ảo.
    *   Phát lệnh tự động sang App Lái xe (Kích hoạt Push Notification).
    *   *Trạng thái Lô hàng:* `Đã phân xe`.

#### BƯỚC 3: VẬN HÀNH & GHI NHẬN CHI PHÍ THỰC TẾ (HIỆN TRƯỜNG & LÁI XE)
*   **Người thực hiện:** Nhân viên Hiện trường (Ops) & Lái xe.
*   **Thao tác (Nghiệp vụ):**
    *   **Nhân viên Hiện trường (Ops App):**
        *   Tạo nhanh phiếu "Yêu cầu tạm ứng tiền mặt" ngay trên App để Kế toán duyệt trước khi làm hàng.
        *   Thực hiện chi trả hộ (nâng hạ, hải quan, lưu bãi). Chọn đúng mã lô hàng, **chọn Tên Cảng/Loại Cont** để hệ thống áp giá, đính kèm ảnh hóa đơn/biên lai.
        *   *Bàn giao Lệnh:* Sau khi hoàn thiện thủ tục tại cảng, Ops cập nhật trạng thái "Đã lấy lệnh giấy" và bàn giao cho Lái xe.
    *   **Lái xe (Driver App):**
        *   Tạo phiếu yêu cầu tạm ứng qua App (nếu cần tiền công tác phí/phí đường bộ).
        *   *Nhận lệnh & Xác nhận:* Lái xe nhận lệnh trực tiếp trên App (hiển thị giờ cut-off, giờ đóng/trả, thông tin xuất hóa đơn). Bấm xác nhận "Đã nhận lệnh gốc" từ Ops để kích hoạt lộ trình.
        *   *Thực thi 2 chiều:* Hiển thị song song 2 lệnh. Ghi nhận tiền đường, tiền nâng hạ riêng biệt cho từng container.
        *   *Nhiên liệu:* Lái xe chụp ảnh cột bơm dầu/hóa đơn dầu thực tế gửi lên App khi đổ nhiên liệu.
        *   *Hoàn thành & POD:* Chụp ảnh số cont/seal chì, ấn "Hoàn thành". **Sau khi giao hàng, Lái xe bắt buộc phải nộp lại Chứng từ gốc về văn phòng hoặc cho giao nhận.**
*   **Dev Note:**
    *   *Tự động áp giá Nâng/Hạ:* Trên Ops App, nhân viên KHÔNG tự gõ tay số tiền nâng/hạ. Khi Ops chọn `Cảng` + `Loại Cont`, hệ thống tự động truy xuất biểu giá tương ứng từ Master Data để ghi nhận chi phí.
    *   *Điểm neo Giá vốn Vận hành (Cost of Goods Sold Boundary):* Ghi nhận tiêu hao nhiên liệu (bóc tách bằng AI từ ảnh chụp và đối chiếu tọa độ EXIF) chỉ để tính toán Lợi nhuận gộp chuyến đi tức thời đẩy lên Dashboard. Quy trình O2C **không xử lý** việc đối chiếu hóa đơn tổng của nhà cung cấp dầu cuối tháng.
    *   *Log thời gian (SLA):* Ghi nhận chính xác timestamp Ops bấm "có lệnh" và Lái xe bấm "nhận lệnh" (để giải quyết việc tranh cãi giữa Ops và Lái xe liên quan đến giao lệnh muộn làm ảnh hưởng tiến độ lấy hàng).
    *   *Gom chi phí tự động:* Gom tất cả khoản chi của Ops/Lái xe về chung 1 mã Lô hàng. Trạng thái `Treo (Pending)`.
    *   *Trạng thái Lô hàng:* `Đang chạy` ➔ `Chờ duyệt phí`.

#### BƯỚC 4: ĐỐI CHIẾU, QUYẾT TOÁN & HOÀN THÀNH (KẾ TOÁN)
*   **Người thực hiện:** Kế toán / CUS.
*   **Thao tác (Nghiệp vụ):**
    *   **CUS/KẾ TOÁN - PHẦN 2 (Đối chiếu chi tiết):** Hiển thị chi tiết lô hàng. Kế toán đối chiếu chứng từ điện tử, thu nhận chứng từ và tích chọn xác nhận "Đã thu hồi chứng từ gốc". Bấm duyệt phí.
    *   **Lựa chọn kỳ chốt (T1/T2/T3):** Kế toán lọc danh mục theo chu kỳ chốt để chuẩn bị xuất Debit Note.
    *   **Phân loại chi hộ:** Tách bạch 2 nhóm: CÓ hóa đơn (Nâng hạ, lưu kho...) và KHÔNG hóa đơn (Phí giám sát, chi ngoài...).
    *   Khi xác nhận, chọn mức thuế VAT áp dụng (0%, 5%, 8%, 10%) và bấm **Hoàn thành**.
*   **Dev Note:**
    *   *Trạng thái kết thúc — KHÔNG đóng băng:* Chuyến đi sau khi Kế toán xác nhận sẽ chuyển sang trạng thái `Hoàn thành (Completed)`. **Tạm thời BỎ tính năng "Khóa cứng / Đóng băng dữ liệu (Read-only)"** — dữ liệu chi phí **vẫn được phép chỉnh sửa tiếp** sau khi hoàn thành.
    *   *Điểm neo POD (State Transition Gate):* Hệ thống thiết lập cờ logic (Boolean) bắt buộc. Chỉ cho phép chuyển trạng thái chuyến đi từ `Pending` sang `Completed` khi Kế toán/CUS đã tích chọn "Đã thu hồi chứng từ gốc". O2C dừng ở việc xác nhận POD đã về kho.
    *   *Điểm neo Tạm ứng (Cash Flow Boundary):* Khi Kế toán duyệt các khoản phí `Treo`, hệ thống tự động sinh giao dịch đối trừ cấn trừ vào Số dư tạm ứng của Ops/Lái xe. 
    *   *Điểm neo Chu kỳ chốt (Data Hand-off):* Thao tác bấm "Hoàn thành" là điểm kết thúc nghiệp vụ O2C. Hệ thống tính tổng tiền sau VAT và đẩy song song **bản ghi AR (Công nợ Phải thu Khách hàng)** và **bản ghi AP (Công nợ Phải trả NCC/Chủ xe ngoài)** sang module Công nợ. 
    *   **Lưu ý Đồng bộ (Sync Logic):** Vì chưa khóa cứng, dữ liệu đẩy sang công nợ là **bản chụp thời điểm (snapshot)**; nếu chi phí tiếp tục được chỉnh sửa sau đó tại Bước 4, hệ thống sẽ đánh dấu (flag) bản ghi đã thay đổi để Kế toán đối soát lại.
    *   *Tách P&L:* Tự động bóc tách doanh thu và kết chuyển giá vốn riêng biệt cho nhóm "Xe nhà" và "Xe ngoài" lên Dashboard Quản trị.
    *   *Trạng thái Lô hàng:* `Hoàn thành (Completed)`.