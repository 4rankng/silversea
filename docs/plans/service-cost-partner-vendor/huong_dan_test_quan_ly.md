# Hướng dẫn Kiểm thử Hệ thống dành cho Quản lý

Tài liệu này hướng dẫn chi tiết cách kiểm thử 3 tính năng mới dưới vai trò **Quản lý**:
1. **Chi phí dịch vụ đi kèm**
2. **Điều động xe ngoài**
3. **Đối trừ công nợ**

---

## 1. Tổng quan vai trò Quản lý
Trong hệ thống, **Quản lý** chịu trách nhiệm:
- Điều hành, lập kế hoạch chuyến xe (Xe nhà hoặc Xe thuê ngoài).
- Duyệt các thay đổi chi phí tài chính do Giao nhận hoặc Kế toán nhập.
- Duyệt lệnh đối trừ công nợ cuối tháng.
- Khóa chuyến xe để ghi nhận sổ cái chính thức.
- Xem báo cáo lợi nhuận gộp và xuất Giấy báo nợ gửi khách hàng.

---

## Kịch bản 1: Chi phí dịch vụ đi kèm
Tính năng này quản lý các chi phí phát sinh ngoài cước vận chuyển (nâng hạ, hải quan, cân hàng, kiểm hóa...) với 2 chiều: **Mua vào** (Chi phí) và **Bán ra** (Doanh thu).

### Bước 1: Kiểm tra Cấu hình Loại phí
1. Truy cập trang **Cấu hình**.
2. Tìm thẻ **Loại chi phí giao nhận**.
3. Xác minh đã có 8 loại phí được nạp sẵn:
    - Phí nâng vỏ/hàng
    - Phí hạ vỏ/hàng
    - Phí cân hàng
    - Phí thủ tục hải quan
    - Phí hạ tầng
    - Phí kiểm hóa tại cảng
    - Phí dịch vụ kiểm hóa
    - Chi hộ khác
4. Xác minh thuế suất mặc định là **8%** (hoặc 10% tùy cấu hình thuế GTGT hiện hành).

### Bước 2: Tạo Chuyến xe và Nhập Phí Dịch vụ
1. Đi tới **Thêm chuyến xe**.
2. Tạo một chuyến xe mới hoặc chọn một chuyến xe ở trạng thái **Mới tạo** hoặc **Đang chạy**.
3. Ở thẻ **Chi phí dịch vụ đi kèm**:
    - Nhấn **Thêm chi phí**.
    - Chọn loại phí (ví dụ: Phí thủ tục hải quan).
    - Nhập **Giá mua vào** (ví dụ: `1.000.000 VNĐ`).
    - Kiểm tra xem **Giá bán ra** có được gợi ý tự động (dựa trên quy tắc cộng lãi mặc định) hay không. Bạn có thể tự chỉnh sửa ô **Giá bán ra** này (ví dụ nhập: `1.200.000 VNĐ`).
    - Xác minh hệ thống tính đúng: **Lãi DV** = `Giá bán ra - Giá mua vào` = `200.000 VNĐ`.
    - Chọn hình thức chi:
      - **Chi hộ tạm ứng**: Giao nhận dùng tiền tạm ứng chi trước, hệ thống sẽ trừ vào quỹ tạm ứng của Giao nhận khi chốt chuyến.
      - **Công ty trả trực tiếp**: Chọn nhà cung cấp liên kết, hệ thống sẽ tự động ghi nhận công nợ phải trả cho nhà cung cấp này khi chốt chuyến.
    - Nhập mã chứng từ bắt buộc:
      - Với phí Hải quan: Bắt buộc nhập **Số tờ khai**.
      - Với các phí có hóa đơn: Nhập **Số hóa đơn** và **Ngày hóa đơn**.
      - Nhập **Số công-te-nơ** để đối chiếu.
4. Nhấn **Lưu** và xác minh dòng chi phí hiển thị chính xác trên bảng lưới.

### Bước 3: Kiểm duyệt Phí do Giao nhận nhập (Phê duyệt giá bán)
1. Khi Giao nhận đăng nhập cổng thông tin và sửa đổi Giá bán ra của một chi phí dịch vụ, trạng thái của chi phí đó sẽ chuyển sang **Chờ duyệt**.
2. Với tư cách là Quản lý, bạn vào trang chi tiết chuyến xe, bạn sẽ thấy trạng thái phí hiển thị là **Chờ duyệt** (màu cam).
3. Sau khi xác nhận giá khớp với báo giá khách hàng, Quản lý phê duyệt (phí chuyển sang **Đã duyệt**). Chỉ các chi phí **Đã duyệt** mới được tính vào doanh thu phải thu và đưa vào Giấy báo nợ.

---

## Kịch bản 2: Điều động xe thuê ngoài
Khi đội xe nhà quá tải, hệ thống thuê xe ngoài. Chúng ta trả cước mua vào cho đối tác và thu cước bán ra từ khách hàng.

### Bước 1: Khai báo Đối tác vận tải
1. Truy cập trang **Khách hàng**.
2. Nhấn **Thêm khách hàng** hoặc sửa một khách hàng có sẵn.
3. Kích hoạt nút chuyển **Đối tác vận tải** sang trạng thái bật.
4. Chọn hình thức xuất Giấy báo nợ: **Theo tháng** hoặc **Theo lô**.
5. Liên kết nhà cung cấp tương ứng nếu đây là đối tác hai chiều. Nhấn **Lưu**.

### Bước 2: Điều hành Chuyến xe Thuê ngoài
1. Truy cập trang **Thêm chuyến xe** hoặc chỉnh sửa một chuyến xe **Mới tạo**.
2. Ở phần thông tin điều xe, chọn hình thức: **Xe ngoài**.
3. Xác minh giao diện:
    - Các ô chọn Đầu kéo và Lái xe nhà sẽ tự động ẩn đi.
    - Ô **Đối tác vận chuyển** xuất hiện. Chọn đối tác vừa khai báo ở Bước 1.
    - Nhập **Giá cước thuê ngoài** (Giá mua vào đã gồm thuế, ví dụ: `5.000.000 VNĐ`).
    - Nhập thông tin xe ngoài: **Biển số xe**, **Tên lái xe**, **Số điện thoại lái xe**.
4. Kiểm tra phần hiển thị **Lãi điều xe ngoài / Lãi quản lý**:
    - Hệ thống phải tự động quy đổi giá bán và giá mua về **chưa gồm thuế** rồi tính hiệu số.
    - Công thức: `Lãi điều xe = [Giá bán bán ra (chưa thuế)] - [Giá cước thuê ngoài (chưa thuế)]`
5. Nhấn **Lưu**.

### Bước 3: Khóa chuyến & Xác minh Sổ cái
1. Chuyển trạng thái chuyến xe lần lượt: **Mới tạo** -> **Đang chạy** -> **Hoàn thành** -> **Đã chốt**.
2. Sau khi chuyến xe đã được chốt, hãy đi tới **Sổ cái / Công nợ** của đối tác xe ngoài đó:
    - Xác minh có 1 bút toán được ghi nhận là một khoản **CÓ** trên sổ cái của đối tác xe ngoài (ghi nhận công nợ phải trả cho họ). Số dư sổ cái của đối tác này sẽ âm (thể hiện công ty nợ họ tiền).
    - Xác minh **KHÔNG** có bút toán tính lương lái xe nhà cho chuyến đi này.
    - Xác minh doanh thu cước bán ra vẫn được ghi **NỢ** bình thường cho Khách hàng mua dịch vụ.

---

## Kịch bản 3: Đối trừ công nợ
Dành cho đối tác hai chiều (vừa chở hàng cho công ty, vừa thuê công ty chở hàng hoặc sử dụng dịch vụ sửa chữa của công ty).

### Bước 1: Liên kết hồ sơ Đối tác hai chiều
1. Tại trang **Khách hàng**, mở hồ sơ của đối tác -> Chọn **Liên kết Nhà cung cấp** trỏ đến nhà cung cấp tương ứng của họ.
2. Tại trang **Nhà cung cấp**, kiểm tra xem đã tự động liên kết ngược lại với Khách hàng đó chưa.
3. Xác minh tại trang danh sách công nợ: Khách hàng này có nhãn **"2 chiều"** màu xanh lá cây và cột **Công nợ** hiển thị hiệu số: `Công nợ = Phải thu - Phải trả`.

### Bước 2: Tạo yêu cầu Đối trừ công nợ (Do Kế toán thực hiện)
1. Kế toán truy cập trang chi tiết công nợ khách hàng.
2. Hệ thống hiển thị hộp thông tin **"Công nợ phải trả (NCC liên kết)"** màu cam.
3. Nhấn nút **"Đối trừ công nợ"**.
4. Hộp thoại hiện lên hiển thị:
    - Số tiền Phải thu hiện tại.
    - Số tiền Phải trả hiện tại.
    - **Số tiền đối trừ tự động**: Luôn bằng giá trị nhỏ hơn giữa Phải thu và Phải trả. Người dùng **không được tự nhập số tiền tự do**.
5. Kế toán chọn ngày đối trừ, nhập ghi chú (ví dụ: "Đối trừ công nợ tháng 5") và nhấn **Xác nhận**.
6. Yêu cầu đối trừ được tạo với trạng thái **Chờ duyệt**.

### Bước 3: Quản lý Phê duyệt Đối trừ
1. Dưới vai trò Quản lý, bạn vào trang chi tiết công nợ.
2. Xem phần **Lịch sử đối trừ**. Bạn sẽ thấy yêu cầu đối trừ đang ở trạng thái **Chờ duyệt** (màu cam).
3. Nhấp **Phê duyệt** (hoặc kích hoạt lệnh duyệt qua hệ thống).
4. Xác minh kết quả sau khi duyệt:
    - Cả hai số dư Phải thu và Phải trả của đối tác đều **giảm đi** một lượng đúng bằng số tiền đối trừ.
    - Trong **Sổ kế toán** của Khách hàng, xuất hiện một dòng điều chỉnh ghi **CÓ** làm giảm công nợ phải thu.
    - Trong **Sổ kế toán** của Nhà cung cấp, xuất hiện một dòng điều chỉnh làm giảm công nợ phải trả.

---

## Kịch bản 4: Giấy báo nợ & Báo cáo Lợi nhuận

### Bước 1: Xuất Giấy báo nợ gửi khách hàng
1. Đi tới chi tiết công nợ khách hàng.
2. Nhấn chọn **Xuất Giấy báo nợ**.
3. Tùy thuộc cấu hình của khách hàng đó:
    - **Theo tháng**: Hệ thống xuất bảng kê gom toàn bộ các chuyến và phí dịch vụ phát sinh trong tháng chọn.
    - **Theo lô**: Bạn cần chọn danh sách các chuyến cụ thể để xuất.
4. Kiểm tra tệp tải xuống:
    - Tiền cước vận chuyển chính nằm ở một dòng riêng.
    - **Từng loại phí dịch vụ đi kèm** được tách thành các dòng riêng biệt, chi tiết số công-te-nơ, số hóa đơn, số tờ khai (không gộp chung vào cước chính).
    - Xác minh chỉ những chi phí dịch vụ nào ở trạng thái **Đã duyệt** mới xuất hiện trên giấy báo nợ.

### Bước 2: Kiểm tra Báo cáo Kết quả Kinh doanh
1. Đi tới trang **Tài chính**.
2. Xem bảng báo cáo lợi nhuận theo đầu xe và khoảng thời gian.
3. Xác minh đã xuất hiện hai dòng doanh thu mới:
    - **Lãi dịch vụ đi kèm**: Tổng chênh lệch bán - mua của tất cả các phí dịch vụ đã duyệt.
    - **Doanh thu điều xe ngoài (lãi quản lý)**: Phần chênh lệch giữa giá bán cho khách và giá cước thuê đối tác ngoài (chỉ tính trên phần giá chưa thuế).
4. Xác minh các chuyến xe ngoài được gom đúng vào nhóm **"Xe ngoài"** thay vì tính chi phí vận hành xe nhà (không bị tính nhiên liệu thực tế, lương lái xe nhà hay khấu hao sửa chữa vào chi phí của chuyến thuê ngoài).

---

## 💡 Một số mẹo nhỏ khi kiểm thử
- **Kiểm tra thuế**: Khi nhập Giá bán (đã gồm thuế) là `10.800.000 VNĐ` với thuế suất `8%`. Hãy kiểm tra xem báo cáo lãi/lỗ có ghi nhận doanh thu chưa thuế đúng bằng `10.000.000 VNĐ` hay không.
- **Tính bất biến của Sổ cái**: Khi chuyến xe đã **Đã chốt**, nút sửa và xóa phí dịch vụ đi kèm sẽ bị ẩn đi. Mọi sai sót phát sinh sau khi chốt bắt buộc phải xử lý bằng cách lập **Phiếu điều chỉnh** thay vì sửa trực tiếp số liệu cũ.
- **Tìm kiếm theo công-te-nơ**: Thử tìm kiếm chuyến xe bằng cách nhập **Số công-te-nơ** trên thanh tìm kiếm của trang Danh sách chuyến xe và Danh sách công nợ để kiểm tra khả năng truy xuất công-te-nơ.
