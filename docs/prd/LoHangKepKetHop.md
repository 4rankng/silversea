# Lô hàng kẹp & lô hàng kết hợp

**Dự án:** TTransport — Silver Sea

Xem thêm: [mục lục PRD](README.md), [Quy trình O2C](QuyTrinhO2C.md), [Màn hình lái xe](ManHinhLaiXe.md).

Điều vận cần ghép các công việc phù hợp để tận dụng xe, moóc và hành trình. Lái xe cần hiểu hai công việc chạy đồng thời hay nối tiếp. CUS và Kế toán cần giữ đúng lô hàng, chứng từ, doanh thu và chi phí của từng công việc khi ghép.

## 1. Định nghĩa nghiệp vụ

### 1.1 KẸP — hai container 20FT chạy đồng thời

Ghép **hai container 20FT** lên cùng một moóc có khả năng chở hai vị trí 20FT, dùng chung đầu kéo và tài xế, vận chuyển đồng thời. Trường hợp thường gặp là một container có hàng và một container rỗng.

- Moóc 40FT phù hợp có thể chở hai container 20FT; loại moóc 40FT không phải lý do từ chối cặp.
- Container 40FT không được làm thành viên của cặp hai container 20FT này.
- **Tổng trọng lượng hàng của cả hai container** phải phù hợp với năng lực của tổ hợp đầu kéo/moóc. Từng container đủ tải riêng chưa có nghĩa cả cặp đủ tải.
- Thông tin hàng, tiến độ và bằng chứng của từng container vẫn được theo dõi riêng.

### 1.2 KẾT HỢP — tái dùng vỏ, thực hiện nối tiếp

Xe đưa container đến trả hàng Lệnh 1, giữ lại vỏ để đi đóng hàng Lệnh 2 thay vì chạy rỗng về bãi. Hai lệnh dùng chung đầu kéo, moóc và tài xế nhưng thực hiện nối tiếp.

**Cảng nâng → trả hàng tại Nhà máy 1 → giữ vỏ → đóng hàng tại Nhà máy 2 → Cảng hạ.**

Chỉ được bắt đầu đóng hàng Lệnh 2 sau khi hoàn thành phần trả hàng Lệnh 1. Tiết kiệm hành trình rỗng không làm gộp chứng từ hoặc doanh thu của hai công việc.

## 2. Lô hàng và quan hệ ghép

Một **lô hàng nguồn có thể gồm nhiều container**. Mỗi công việc vận chuyển có phân công, lịch, tiến độ và bằng chứng riêng, đồng thời vẫn thuộc đúng lô hàng nguồn.

| Nội dung | Yêu cầu nghiệp vụ |
|----------|------------------|
| Lô hàng nguồn | Giữ đúng khách hàng, chứng từ và các container/công việc thuộc lô |
| Công việc vận chuyển | Nhận diện rõ container, lịch, phân công và kết quả thực hiện riêng |
| Cặp ghép | Nhận diện thống nhất hai công việc được ghép, loại ghép và xe/moóc/tài xế dùng chung |

Mỗi cặp chỉ có **một quan hệ ghép thống nhất** trên các màn hình. Điều vận, CUS, lái xe và Ops phải cùng thấy đúng hai công việc, loại ghép và phân công đang có hiệu lực. Cùng biển số, cùng ngày hoặc ghi chú “KẸP” không tự làm hai công việc trở thành một cặp.

Không ép tách một lô nhiều container thành nhiều lô chỉ để ghép, cũng không gộp hai lô vì chạy cùng xe. Doanh thu và chứng từ tiếp tục thuộc đúng lô/container ban đầu.

Công việc LCL được nhận diện và theo dõi riêng mà không cần container. Không tạo container giả để đưa LCL vào quy tắc ghép hai container 20FT.

## 3. Phân xe và quản lý cặp

### 3.1 Tạo cặp

Người làm Điều vận có quyền phân xe chọn hai công việc phù hợp, chọn loại ghép và đầu kéo, moóc, tài xế dùng chung. Hai công việc phải cùng ngày vận hành; tuyến, giờ và điểm làm hàng phải phù hợp với cách ghép.

- Với **KẸP**, đúng hai công việc trong cặp được vận chuyển đồng thời trên cùng tổ hợp xe.
- Với **KẾT HỢP**, lịch phải đáp ứng thứ tự trả hàng rồi đóng hàng.
- Mỗi công việc chỉ thuộc một cặp đang có hiệu lực. Không thêm container thứ ba vào ngoại lệ dùng chung của cặp hai container.
- Chỉ ghép công việc còn cho phép thay đổi phân công; không bỏ qua quyền thao tác hoặc ràng buộc xe, moóc và tài xế đang bận.

Sau khi lưu thành công, cả hai công việc cùng có phân công và quan hệ ghép đúng. Nếu không thể lưu đủ cả cặp, thông báo rõ lý do và không để lại một nửa phân công khiến người dùng hiểu nhầm đã ghép xong.

### 3.2 Dùng chung xe, moóc và tài xế

Cặp KẸP hợp lệ không được tự chặn công việc thứ hai vì xe đang phục vụ công việc thứ nhất trong chính cặp đó. Công việc khác ngoài cặp vẫn phải bị chặn nếu gây trùng lịch hoặc vượt năng lực.

Khi hai người cùng phân xe, hệ thống không được xác nhận thành công cho các phân công mâu thuẫn. Người không thể hoàn tất phải thấy xe/moóc/tài xế nào đã được sử dụng và có thể chọn lại phương án phù hợp.

### 3.3 Sửa, hủy và phân lại

- Người có quyền được sửa hoặc bỏ ghép trực tiếp trong phạm vi trạng thái công việc cho phép; không có bước phê duyệt nội bộ.
- Khi đổi hoặc bỏ một thành viên, cập nhật quan hệ ghép, lịch sử dụng xe/moóc/tài xế, chi phí và lương của phần còn lại. Cặp đã bỏ không còn cho phép chồng lịch.
- Nếu người khác đã đổi phân công trong lúc màn hình đang mở, giữ nội dung đang nhập để đối chiếu và giải thích thay đổi trước khi người dùng tiếp tục. Không âm thầm ghi đè lựa chọn mới của người khác.
- Sau khi lưu, mở lại công việc hoặc xem từ vai trò liên quan phải thấy phân công mới mà không cần tải lại toàn bộ ứng dụng.
- Bấm lưu nhiều lần hoặc thử lại sau gián đoạn không tạo thêm cặp, phân công, chi phí hay lương trùng lặp.
- Có thể xem lại cặp ghép đang có hiệu lực và tình trạng phân công hiện hành.

Mọi thao tác cần Internet. Khi chưa thể xác định đã lưu hay chưa, trạng thái phải nói rõ và làm rõ kết quả trước khi người dùng thử lại. Không cho làm việc ngoại tuyến hoặc tự gửi lại khi có mạng.

## 4. Hiển thị cho Điều vận, CUS và lái xe

Nhãn **KẸP/KẾT HỢP** nằm cạnh đúng công việc/container và phản ánh cặp đang có hiệu lực. Khi bỏ ghép, nhãn ghép ngừng hiển thị; trạng thái hiện hành của từng công việc vẫn đọc được.

Trên app lái xe, hai thẻ đứng liền kề, có dấu hiệu cùng cặp. Mỗi thẻ vẫn thể hiện container, loại, lịch và thao tác riêng. KẸP thể hiện chạy đồng thời; KẾT HỢP thể hiện phần trước/phần sau cùng lý do chưa thể bắt đầu phần sau. Xem [Màn hình lái xe](ManHinhLaiXe.md).

Ở Điều vận, từng công việc giữ thông tin cảng nâng/hạ đúng chiều nhập/xuất. Dấu hiệu dùng chung xe không che số container, loại hoặc trạng thái của từng công việc.

Trên điện thoại, máy tính bảng và máy tính, người dùng phải đọc nhanh được cặp và hành động cần làm. Trình bày xe/moóc/tài xế dùng chung gọn một lần khi phù hợp; tránh thẻ lồng nhau, khoảng trống lớn hoặc nhân đôi khối thông tin. Số container, biển số và loại container phải đọc nguyên cụm. Nút dễ chạm, có nhãn rõ và dùng được bằng bàn phím.

## 5. Chi phí, lương và doanh thu

### 5.1 Phí của hành trình dùng chung

Phí đường bộ/VETC của **cùng một hành trình thực tế dùng chung** chỉ ghi nhận một lần cho cặp. Không lấy phí một hành trình nhân với số container.

Các khoản phí thật sự khác nhau của hai chặng vẫn được ghi nhận riêng. Kế toán phải đối chiếu được tổng phí, khoản nào dùng chung và khoản nào thuộc từng công việc. Khi bỏ ghép hoặc tính lại, áp dụng cách tính phù hợp với hành trình còn lại mà không ghi thêm cùng một khoản phí.

### 5.2 Lương tài xế

**Lương chuyến ghép = Lương cuốc cơ bản + Phụ phí KẸP hoặc KẾT HỢP.**

Phụ phí lấy theo mức lương đã cấu hình cho loại ghép. Không trả tổng hai cuốc đơn cho một cặp được tính theo công thức ghép. Khi thay đổi hoặc bỏ ghép, tính lại theo quy tắc phù hợp và cho đối chiếu được thay đổi; không ghi lương hai lần khi người dùng thử lại.

Kỳ lương đã chốt và việc điều chỉnh tiếp tục theo quy tắc lương chung. Không âm thầm thay đổi lịch sử lương hoặc tạo thêm bước phê duyệt cho chuyến ghép.

### 5.3 Khoản riêng của từng lô/container

Doanh thu, công nợ khách hàng, phí nâng/hạ, vệ sinh và lưu bãi vẫn thuộc đúng lô/container phát sinh. Cùng xe không đồng nghĩa cùng khách hàng hoặc cùng bên xuất hóa đơn. Tổng hợp không được vừa cộng tổng lô vừa cộng lại các khoản của từng container.

## 6. Bảng so sánh

| Tiêu chí | Đơn | KẸP | KẾT HỢP |
|----------|-----|-----|---------|
| Thời gian | Một công việc | Đồng thời | Nối tiếp |
| Container | Theo công việc | Hai container 20FT | Một vỏ tái sử dụng qua hai công việc |
| Công việc | Theo phân công | Hai công việc trong một cặp | Hai công việc trong một cặp |
| Lô hàng nguồn | Giữ lô ban đầu | Giữ lô ban đầu của từng công việc | Giữ lô ban đầu của từng công việc |
| Xe/moóc/tài xế | Theo phân công | Dùng chung, đủ năng lực chở cả cặp | Dùng chung theo trình tự |
| Lịch | Theo công việc | Cùng ngày, phù hợp vận chuyển đồng thời | Cùng ngày, trả xong rồi đóng |
| Phí hành trình dùng chung | Một lần | Một lần | Một lần |
| Lương | Cuốc đơn | Cơ bản + phụ phí KẸP | Cơ bản + phụ phí KẾT HỢP |
| Bằng chứng/tiến độ | Theo công việc | Riêng từng công việc | Riêng từng công việc và đúng thứ tự |

## 7. Tiêu chí nghiệm thu

1. Ghép được hai container 20FT trên moóc 40FT phù hợp, cùng đầu kéo và tài xế. Cả hai công việc đều thể hiện đúng cặp và phân công sau khi lưu.
2. Từ chối container 40FT trong cặp hai 20FT, container thứ ba, công việc đã thuộc cặp khác và tổng trọng lượng vượt năng lực; mỗi trường hợp có lý do dễ hiểu.
3. KẸP hợp lệ không tự chặn công việc thứ hai vì xe bận trong chính cặp. Công việc ngoài cặp vẫn bị chặn khi trùng xe/moóc/tài xế.
4. Hai Điều vận cùng phân xe không tạo phân công mâu thuẫn. Lưu không thành công hoặc thử lại không để lại nửa cặp hay bản ghi trùng.
5. Sửa, bỏ ghép hoặc phân lại cập nhật đúng cả hai công việc, lịch dùng xe, nhãn, chi phí và lương; mở lại thấy kết quả mới.
6. Với KẾT HỢP, chưa trả xong Lệnh 1 thì không bắt đầu đóng Lệnh 2. Quy tắc chạy đồng thời của KẸP không làm mất điều kiện này.
7. Ghép công việc từ lô nhiều container vẫn giữ đúng nguồn, khách hàng, chứng từ, doanh thu, bằng chứng và tiến độ riêng.
8. Một hành trình dùng chung chỉ có một khoản phí tương ứng và một lần tính lương ghép. Phí độc lập của từng chặng vẫn được giữ; bỏ ghép hoặc thử lại không làm tăng tổng sai.
9. Điều vận, CUS, lái xe và Ops đọc được cùng quan hệ ghép trên điện thoại, máy tính bảng và máy tính; rõ số–loại container, cảng, lịch, thứ tự và xe dùng chung.
10. Người có quyền thao tác trực tiếp khi có Internet. Mất mạng không báo thành công giả, không tự gửi lại và không tạo bước chờ phê duyệt nội bộ.
