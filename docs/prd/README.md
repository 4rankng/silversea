# PRD — TTransport / Silver Sea

Tài liệu yêu cầu sản phẩm từ góc nhìn khách hàng, chủ sản phẩm và người sử dụng. Mỗi tài liệu mô tả người dùng cần làm gì, quy trình mong muốn, quy tắc nghiệp vụ và tiêu chí nghiệm thu. Nguồn yêu cầu khách hàng được ghi ở đầu tài liệu liên quan.

Silver Sea hỗ trợ toàn bộ công việc từ tiếp nhận lô hàng, lập kế hoạch vận chuyển, thực hiện giao nhận đến quản lý chi phí, hồ sơ và công nợ. Người dùng phải nhận biết được việc cần làm, dữ liệu còn thiếu và kết quả của hành động ngay tại nơi làm việc; không phải nhập lại cùng thông tin hoặc đối chiếu những trạng thái mâu thuẫn giữa các màn hình.

| Tài liệu | Phạm vi | Nguồn |
|----------|---------|-------|
| [QuyTrinhO2C.md](QuyTrinhO2C.md) | Quy trình từ tiếp nhận lô đến điều vận, giao nhận, hoàn thành hồ sơ và thu tiền; trách nhiệm từng vai trò | Tổng hợp yêu cầu nghiệp vụ |
| [MasterDataNhaMay.md](MasterDataNhaMay.md) | Khách hàng, nhà máy, tuyến và địa điểm; lựa chọn dữ liệu theo quan hệ; lệnh chạy ngoài | `2026.9.6_Logic_nghiep_vu.docx` Phần 1 |
| [LoHangKepKetHop.md](LoHangKepKetHop.md) | Kẹp hai container đồng thời và kết hợp hai công việc nối tiếp; nguồn lực, tiến độ, chi phí và doanh thu | `2026.9.6_Logic_nghiep_vu.docx` Phần 2 |
| [OpsVanHanh.md](OpsVanHanh.md) | Kế hoạch làm hàng, theo dõi phương tiện, tiền ứng, chi phí, chứng từ và quyết toán của nhân viên hiện trường | `2026.9.6_Man_hinh_ops.docx` |
| [ManHinhLaiXe.md](ManHinhLaiXe.md) | Hành trình lái xe: nhận lệnh, đọc thông tin, thực hiện, bổ sung ảnh/chứng từ và hoàn thành | `2026.8.27_Man_hinh_lai_xe.docx` và yêu cầu màn hình bổ sung |
| [CuocPhiPhuPhiDau.md](CuocPhiPhuPhiDau.md) | Công thức cước, tham số hợp đồng, bảng số tham chiếu và quy tắc làm tròn | `18.7 - BG Long Minh T7.xlsx` và trả lời khách hàng |
| [CuocPhiThietKeDB.md](CuocPhiThietKeDB.md) | Yêu cầu đối với dữ liệu cước, ngày hiệu lực, giải thích số tiền và bảo toàn lịch sử | Yêu cầu cước và phương án khách hàng |
| [PhuongAnTinhCuocTuDong.md](PhuongAnTinhCuocTuDong.md) | Trải nghiệm cấu hình, tính cước theo ngày vận chuyển, xử lý thiếu giá và điều chỉnh giá trên bảng kê | `Phương án tính cước tự động.docx` |
| [CauHoiKhachHang_CuocPhi_2026-09-08.md](CauHoiKhachHang_CuocPhi_2026-09-08.md) | Các câu trả lời đã có và thông số hợp đồng còn cần khách hàng xác định | Trao đổi về bảng cước Long Minh |

## Người dùng và kết quả cần đạt

| Vai trò | Nhu cầu chính |
|---------|---------------|
| Quản trị | Quản lý tài khoản, phạm vi quyền và danh mục nhất quán; người ngừng hoạt động không được nhận công việc mới, hồ sơ lịch sử vẫn đọc được |
| Quản lý | Nắm tiến độ, việc tồn đọng và tình hình tài chính bằng số liệu có ý nghĩa rõ; thực hiện các điều chỉnh thuộc thẩm quyền |
| Chứng từ / CUS | Nhập lô nhanh, lưu được thông tin chưa đầy đủ, bổ sung đúng lúc, chuyển dữ liệu chính xác sang điều vận và kế toán |
| Điều vận | Nhận biết phần chưa phân bổ, chọn nguồn lực phù hợp, phát lệnh và xử lý thay đổi mà không gây trùng lịch hoặc mất công việc |
| Lái xe | Nhìn thấy đúng lệnh được giao, hiểu việc cần làm và thông tin liên hệ, cập nhật chứng từ và hoàn thành với ít thao tác cần thiết |
| Nhân viên hiện trường / Ops | Xem kế hoạch, phối hợp tại cảng/nhà máy, ghi tiền thực nhận/thực chi, bổ sung chứng từ và đối chiếu quỹ |
| Kế toán | Đối chiếu hồ sơ và số tiền, lập bảng kê, ghi nhận thanh toán/phân bổ, quản lý lương và khóa kỳ trong phạm vi được cấp |
| Khách hàng | Theo dõi lô hàng của mình, hiểu tiến độ và các thông tin được chia sẻ; xác nhận thực tế giao nhận khi thuộc quy trình của mình |

Tên vai trò không đồng nghĩa được truy cập mọi dữ liệu hoặc thực hiện mọi hành động. Mỗi màn hình chỉ cung cấp thông tin và thao tác trong phạm vi người dùng; cùng một nghiệp vụ phải có ý nghĩa thống nhất giữa các vai trò.

## Thay đổi có hiệu lực gần nhất

**14/09/2026 — Thao tác trực tiếp, cần Internet, trải nghiệm gọn trên mọi thiết bị.**

- Người có quyền lưu, phát hành, điều chỉnh hoặc hủy trực tiếp sau khi đáp ứng quy tắc nghiệp vụ. Ứng dụng không có quy trình gửi duyệt, người duyệt, chờ duyệt theo cấp tiền hoặc tự động duyệt. Quyền thao tác, kiểm tra dữ liệu, lý do điều chỉnh, lịch sử và khóa kỳ vẫn được giữ.
- Lái xe nhận lệnh và khách hàng xác nhận thực tế giao hàng là các sự kiện nghiệp vụ cần giữ. Xác nhận một thao tác của chính người dùng, chẳng hạn xác nhận hủy, không phải bước phê duyệt của người khác.
- Ứng dụng cần Internet để làm việc. Khi mất kết nối, thông báo rõ chưa thể lưu; giữ nội dung đang nhập trong màn hình khi còn có thể và cho người dùng chủ động tiếp tục khi kết nối trở lại. Không hứa lưu ngoại tuyến hoặc tự gửi lại thay người dùng.
- Giao diện dùng tốt trên điện thoại, máy tính bảng và máy tính. Ưu tiên thông tin và thao tác hữu ích trên mỗi màn hình; tránh chữ quá lớn, khối quá cao, lề dư và thẻ trang trí lồng nhau.
- Ghi nhận chi phí, thiếu chứng từ, hoàn thành vận chuyển, đã thanh toán và đã khóa kỳ là những tình trạng khác nhau. Mỗi nhãn phải nói đúng sự kiện đã xảy ra, không dùng một trạng thái chung để suy ra tất cả.

Các quyết định cước đã được khách hàng xác nhận vẫn có hiệu lực: kẹp phụ phí dầu về 0, không hồi tố cước đã chốt, luôn tính km khứ hồi theo hợp đồng và chọn Ngày vận chuyển làm mốc. Giá trị, phạm vi và điều kiện cụ thể nằm trong các tài liệu cước; thông số chưa được khách hàng xác định không được tự thay bằng số minh họa.

## Chất lượng trải nghiệm cần đạt

- **Dễ nhận biết:** người dùng biết mình đang ở đâu, đang xem lô/công việc/kỳ nào, dữ liệu nào còn thiếu và hành động tiếp theo. Tên gọi, ngày, số tiền và trạng thái thống nhất trên danh sách, chi tiết và chứng từ.
- **Ít nhập lại:** thông tin đã biết được kế thừa đúng nơi; chọn nhà máy, xe hoặc công việc điền dữ liệu liên quan phù hợp. Đổi lựa chọn cập nhật các trường phụ thuộc mà không âm thầm mất nội dung đang sửa.
- **Lưu đáng tin cậy:** bấm nhiều lần không tạo bản trùng hoặc phát sinh tiền trùng. Nếu chưa rõ thao tác đã thành công, ứng dụng giúp người dùng xác định kết quả trước khi thử lại. Khi có người khác sửa cùng dữ liệu, người dùng được xem thay đổi và quyết định cách tiếp tục; không bị ghi đè mà không biết.
- **Tận dụng diện tích:** bảng trên máy tính hỗ trợ so sánh; màn hình nhỏ ưu tiên định danh, lịch, trạng thái, số liệu chính và hành động. Thông tin phụ có thể mở thêm nhưng các mã quan trọng không bị cắt hoặc ngắt thành từng ký tự. Các nhóm trường dùng khoảng cách và tiêu đề rõ, tránh nhiều lớp khung.
- **Thao tác thuận tiện:** điều khiển dễ chạm, dùng được bằng bàn phím; chữ dễ đọc, lỗi nằm cạnh trường, nút lưu/đóng luôn tiếp cận được kể cả khi bàn phím điện thoại mở. Thông tin không chỉ phân biệt bằng màu hoặc chỉ xem được khi rê chuột.
- **Phản hồi rõ và ổn định:** đang tải, không có dữ liệu, lỗi tải, đang lưu và đã lưu có cách thể hiện khác nhau. Không đưa số 0 thay cho lỗi. Chuyển động nhẹ, tôn trọng nhu cầu giảm chuyển động; cập nhật dữ liệu không làm nhảy hàng hoặc nút đang dùng.
- **Giữ ngữ cảnh:** quay lại danh sách giữ bộ lọc, trang và vị trí phù hợp; đổi tài khoản không để lại dữ liệu của người trước. Lỗi kết nối tạm thời không khiến người dùng bị đăng xuất khỏi phiên còn hợp lệ.

Tiêu chí cụ thể của từng quy trình nằm ngay trong tài liệu tương ứng. Sản phẩm cần đáp ứng cả luồng thông thường và các tình huống thiếu dữ liệu, nhập sai, mất kết nối, thay đổi đồng thời, tên/mã dài và nhiều bản ghi. Các quyết định nghiệp vụ còn thiếu được nêu rõ tại nơi sử dụng, cùng hành vi khi chưa đủ dữ liệu; không tự đặt thêm điều khoản để lấp chỗ trống.
