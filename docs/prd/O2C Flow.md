# TÀI LIỆU ĐẶC TẢ QUY TRÌNH VẬN HÀNH & QUYẾT TOÁN (ORDER-TO-CASH)
**Dự án:** Phần mềm Quản lý Vận tải TTransport 
**Đơn vị sử dụng:** Công ty Silver Sea

---

## I. MỤC ĐÍCH & PHẠM VI
*   **Mục đích:** Quy chuẩn hóa toàn bộ luồng luân chuyển thông tin, chứng từ và trách nhiệm của các bộ phận từ khi tiếp nhận yêu cầu vận tải đến khi chốt dữ liệu công nợ.
*   **Phạm vi hệ thống:** Quy trình này được áp dụng nghiêm ngặt trên phần mềm TTransport. Bất kỳ sự thay đổi nào về luồng thao tác đều phải được phê duyệt.
*   **Vòng đời tiêu chuẩn của Lô hàng:** (1) `Mới tạo` ➔ (2) `Đã điều xe` ➔ (3) `Đang chạy` ➔ (4) `Chờ duyệt phí` ➔ (5) `Hoàn thành`.

> **Ghi chú quyết định (01/08/2026):** Tạm thời **bỏ trạng thái `Đã khóa`**. Trạng thái kết thúc là `Hoàn thành` — chuyến đi sau khi hoàn thành **vẫn cho phép chỉnh sửa chi phí** (thực tế khách: chuyến xong vẫn phải điều chỉnh chi phí). Tính năng khóa cứng (Read-only) **hoãn lại**, chỉ build khi khách hàng chính thức yêu cầu. Quy tắc xóa: người Create-only được xóa khi tạo sai **trong phiên làm việc hiện tại**; xóa dữ liệu ở phiên cũ phải được Admin/Giám đốc phê duyệt; chi phí/chứng từ đã được duyệt thì cấm xóa. Push notification trong MVP chỉ cơ bản cho **Lái xe** và **Điều vận**; các role khác chỉ làm khi khách đề xuất.

---

## II. ĐẶC TẢ CHI TIẾT QUY TRÌNH

### BƯỚC 0: THIẾT LẬP NỀN TẢNG & MA TRẬN PHÂN QUYỀN
**1. Bộ phận chịu trách nhiệm:** Ban Giám đốc / Quản trị viên (Admin).
**2. Thao tác nghiệp vụ:** 
*   Khai báo danh mục chuẩn: Khách hàng, Nhà cung cấp, Bảng giá cước, Định mức nhiên liệu, Danh sách Nhà máy, và Danh sách Xe (phân loại rõ `Xe nhà` và `Xe thuê ngoài`).
**3. Điểm kiểm soát hệ thống (System Rulers):**
*   **Kiểm soát bảo mật:** Dữ liệu nhạy cảm (Lợi nhuận, Giá vốn, Lương tài xế, Định mức) chỉ được cấp quyền hiển thị cho Ban Giám đốc và Kế toán. Các bộ phận Điều vận, Hiện trường (Ops) tuyệt đối không được tiếp cận.
*   **Kiểm soát thao tác:** Áp dụng nguyên tắc "Bảo vệ Dữ liệu". Chỉ tài khoản cấp Giám đốc/Admin mới có quyền Sửa/Xóa dữ liệu gốc. Các vai trò vận hành khác chỉ có quyền Thêm mới (Create-only).
*   **Quy tắc xóa cho Create-only (quyết định 01/08/2026):** Người Create-only nếu thêm mới sai **vẫn được xóa**, nhưng:
    *   Chỉ trong **phiên làm việc hiện tại** (session) — tránh việc nhân viên cố tình xóa để phá dữ liệu.
    *   Xóa dữ liệu của **phiên cũ** → phải được Admin/Giám đốc **phê duyệt**.
    *   **Ngoại lệ cấm xóa:** Chi phí và chứng từ **đã được Kế toán duyệt** thì không được xóa (bất kỳ ai, bất kỳ phiên nào, dưới quyền duyệt). Chỉ Admin/Giám đốc xử lý.
*   **Thông báo đẩy (Push Notification) — MVP (quyết định 01/08/2026):** Tạm thời chỉ cài đặt push **cơ bản** cho 2 vai trò: **Lái xe** và **Điều vận**. Các vai trò khác (Kế toán, Giám đốc, Khách hàng) và kênh mail/nhắc nợ **chưa làm** — chỉ build khi khách đề xuất.

### BƯỚC 1: KHỞI TẠO & KIỂM DUYỆT LÔ HÀNG
**1. Bộ phận chịu trách nhiệm:** Nhân viên Chứng từ (CUS).
**2. Thao tác nghiệp vụ:**
*   Tiếp nhận Booking từ khách hàng và khởi tạo dữ liệu Lô hàng.
*   Khai báo chi tiết đặc tính hàng hóa: Đối với hàng FCL (Nhập số Cont); Đối với hàng lẻ LCL (Nhập quy cách bao bì, số lượng, khối lượng, CBM).
*   Thực hiện đối chiếu chéo (Cross-check) dữ liệu trên hệ thống với chứng từ gốc để đảm bảo thông tin truyền tải sang bộ phận Điều vận là chính xác 100%.
**3. Điểm kiểm soát hệ thống:**
*   Hệ thống tự động áp mã tính cước dựa trên biểu giá đã ký kết với khách hàng, loại bỏ việc tự gõ giá thủ công.

### BƯỚC 2: PHÂN BỔ & ĐIỀU CHUYẾN 
**1. Bộ phận chịu trách nhiệm:** Điều vận viên.
**2. Thao tác nghiệp vụ:**
*   Lập kế hoạch tổng thể: Đánh giá tổng khối lượng hàng trong ngày và thực hiện gán xe dự kiến (gán nháp).
*   Lập kế hoạch chi tiết: Điều hướng chính xác từng xe cho từng Container/Lô hàng lẻ dựa trên gợi ý nháp.
*   Xử lý nghiệp vụ kẹp/ghép: Tích chọn các chuyến đi kết hợp 2 chiều để tối ưu hóa năng lực vận tải.
**3. Điểm kiểm soát hệ thống:**
*   **Tự động hóa lệnh:** Lệnh điều động được chuyển thẳng tới thiết bị di động (App) của Lái xe.
*   **Tối ưu hóa giá vốn:** Khi Điều vận khai báo xe chạy "Kẹp hàng" (2 chiều), thuật toán hệ thống sẽ tự động hiệu chỉnh chỉ ghi nhận 1 lần phí cầu đường khép kín, tránh nhân đôi chi phí ảo.

### BƯỚC 3: THỰC THI & GHI NHẬN CHI PHÍ HIỆN TRƯỜNG
**1. Bộ phận chịu trách nhiệm:** Nhân viên Hiện trường (Ops) & Lái xe.
**2. Thao tác nghiệp vụ:**
*   **Nhân viên Ops:** Thực hiện chi trả hộ các phí bãi/cảng, nhập dữ liệu thực chi lên App kèm ảnh chụp biên lai. Xác nhận và bàn giao chứng từ/lệnh vật lý cho Lái xe.
*   **Lái xe:** 
    *   Tiếp nhận lệnh đầy đủ (Giờ cut-off, đóng/trả hàng) và bấm "Xác nhận Lệnh" để tính thời gian bắt đầu.
    *   Cập nhật thực tế chi phí đi đường, chi phí nâng hạ cho từng container. Chụp ảnh cột bơm/hóa đơn khi đổ nhiên liệu.
    *   Chụp ảnh số Container/Seal chì báo cáo hoàn thành chuyến đi.
    *   **Bắt buộc nộp lại Chứng từ gốc về văn phòng sau khi giao hàng.**
**3. Điểm kiểm soát hệ thống:**
*   **Kiểm soát gian lận nhiên liệu:** Hệ thống tự động nhận diện dữ liệu từ ảnh chụp hóa đơn đổ dầu và đối chiếu lịch sử định vị lộ trình, làm căn cứ tính toán lợi nhuận gộp tức thời.
*   **Tự động gom chi phí:** Mọi khoản chi lẻ từ nhiều Ops/Lái xe phát sinh trên cùng 1 lô hàng sẽ được hệ thống tự động gom cụm và đặt ở trạng thái chờ duyệt.

### BƯỚC 4: ĐỐI CHIẾU, QUYẾT TOÁN & HOÀN THÀNH
**1. Bộ phận chịu trách nhiệm:** Kế toán / CUS.
**2. Thao tác nghiệp vụ:**
*   Rà soát toàn bộ các khoản phí phát sinh do Ops/Lái xe đẩy về. Phân loại rõ nhóm chi hộ CÓ hóa đơn (Nâng hạ, lưu kho) và KHÔNG hóa đơn.
*   Lọc dữ liệu các chuyến hàng theo Chu kỳ đối soát thực tế của Khách hàng (Ví dụ: T1, T2, T3). Áp dụng mức thuế VAT chuẩn.
*   Bấm "Hoàn thành" để xuất số liệu sang bảng kê / Debit Note.
**3. Điểm kiểm soát hệ thống:**
*   **Không đóng băng dữ liệu (quyết định 01/08/2026):** Chuyến đi sau khi Kế toán xác nhận sẽ chuyển sang trạng thái `Hoàn thành`. **Tạm thời bỏ tính năng "Khóa cứng / Read-only"** — chi phí **vẫn được phép chỉnh sửa tiếp** sau khi hoàn thành (thực tế khách: chuyến xong vẫn phải sửa đổi chi phí). Khóa cứng sẽ bổ sung sau nếu khách yêu cầu.
*   **Ranh giới POD:** Hệ thống KHÔNG CHO PHÉP chuyển trạng thái sang `Hoàn thành` nếu Kế toán chưa tích xác nhận "Đã thu hồi Chứng từ gốc (POD)".
*   **Ranh giới Tạm ứng:** Ngay khi phí chi hộ được Kế toán duyệt, hệ thống tự động sinh bút toán cấn trừ vào dư nợ tạm ứng của cá nhân Ops/Lái xe.
*   **Bàn giao Dữ liệu:** Thao tác "Hoàn thành" là điểm kết thúc nghiệp vụ O2C. Hệ thống tính tổng tiền sau VAT và đẩy một **bản chụp thời điểm (snapshot)** sang Phân hệ Kế toán Công nợ để ghi nhận sổ sách và xuất Debit Note. Vì chưa khóa cứng, nếu chi phí tiếp tục được chỉnh sửa sau đó, hệ thống đánh dấu bản ghi đã thay đổi để Kế toán đối soát lại.