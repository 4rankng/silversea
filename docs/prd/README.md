# PRD — TTransport / Silver Sea

Yêu cầu sản phẩm nhìn từ khách hàng, chủ sản phẩm và người dùng cuối. Mỗi tài liệu
trong thư mục này mô tả người dùng cần làm gì, quy trình mong muốn, quy tắc nghiệp vụ
và tiêu chí nghiệm thu của một mảng nghiệp vụ.

Silver Sea hỗ trợ toàn bộ công việc từ tiếp nhận lô hàng, lập kế hoạch vận chuyển,
thực hiện giao nhận đến quản lý chi phí, hồ sơ và công nợ. Người dùng phải nhận biết
được việc cần làm, dữ liệu còn thiếu và kết quả của hành động ngay tại nơi làm việc;
không phải nhập lại cùng thông tin hoặc đối chiếu những trạng thái mâu thuẫn giữa các
màn hình.

Lịch sử các quyết định đã có hiệu lực nằm ở [CHANGELOG.md](CHANGELOG.md). Tài liệu
trong thư mục này chỉ mô tả quy tắc **đang áp dụng**.

## 1. Người dùng và kết quả cần đạt

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

Tên vai trò không đồng nghĩa được truy cập mọi dữ liệu hoặc thực hiện mọi hành động.
Mỗi màn hình chỉ cung cấp thông tin và thao tác trong phạm vi người dùng; cùng một
nghiệp vụ phải có ý nghĩa thống nhất giữa các vai trò.

## 2. Nguyên tắc chung

Áp dụng cho mọi nghiệp vụ trong mọi tài liệu của thư mục này. Tài liệu chuyên đề chỉ
bổ sung quy tắc riêng, không lặp lại các nguyên tắc dưới đây.

### 2.1 Thao tác trực tiếp, không phê duyệt nội bộ

- Người có quyền lưu, phát hành, điều chỉnh hoặc hủy **trực tiếp** sau khi đáp ứng
  quy tắc nghiệp vụ. Ứng dụng không có quy trình gửi duyệt, người duyệt, chờ duyệt
  theo cấp tiền hoặc tự động duyệt.
- Quyền thao tác, kiểm tra dữ liệu, lý do điều chỉnh, lịch sử thay đổi và khóa kỳ
  vẫn được giữ đầy đủ.
- Lái xe **nhận lệnh** và khách hàng **xác nhận thực tế giao nhận** là các sự kiện
  nghiệp vụ cần giữ. Xác nhận một thao tác của chính người dùng, chẳng hạn xác nhận
  hủy, không phải bước phê duyệt của người khác.
- **Yêu cầu ứng** chỉ là yêu cầu cấp tiền; chỉ giao dịch thực tế mới ghi tiền
  nhận/chi.

### 2.2 Internet, mất kết nối và thử lại

- Ứng dụng cần Internet để làm việc. Không hứa lưu ngoại tuyến.
- Khi mất kết nối, thông báo rõ chưa thể lưu; giữ nội dung đang nhập trong màn hình
  khi còn có thể và cho người dùng chủ động tiếp tục khi kết nối trở lại. Không tự
  gửi lại thay người dùng.
- Nếu chưa rõ lần lưu trước đã thành công hay chưa, ứng dụng giúp người dùng xác
  định kết quả trước khi thử lại, để không tạo bản ghi trùng.

### 2.3 Trạng thái và nhãn

Ghi nhận chi phí, thiếu chứng từ, hoàn thành vận chuyển, đã thanh toán và đã khóa kỳ
là những tình trạng khác nhau. Mỗi nhãn phải nói đúng sự kiện đã xảy ra; không dùng
một trạng thái chung để suy ra tất cả, và không đưa số 0 thay cho giá trị chưa biết.

### 2.4 Quy tắc cước đang áp dụng

Kẹp phụ phí dầu về 0 khi giá dầu kỳ thấp hơn giá mốc; luôn tính km khứ hồi theo hợp
đồng, kể cả chuyến một chiều; chọn **Ngày vận chuyển** làm mốc áp giá; không hồi tố
cước đã chốt. Giá trị, phạm vi và điều kiện cụ thể nằm trong các tài liệu cước.
Thông số khách hàng chưa xác định không được tự thay bằng số minh họa.

## 3. Chất lượng trải nghiệm cần đạt

- **Dễ nhận biết:** người dùng biết mình đang ở đâu, đang xem lô/công việc/kỳ nào, dữ
  liệu nào còn thiếu và hành động tiếp theo. Tên gọi, ngày, số tiền và trạng thái
  thống nhất trên danh sách, chi tiết và chứng từ.
- **Ít nhập lại:** thông tin đã biết được kế thừa đúng nơi; chọn nhà máy, xe hoặc
  công việc điền dữ liệu liên quan phù hợp. Đổi lựa chọn cập nhật các trường phụ
  thuộc mà không âm thầm mất nội dung đang sửa.
- **Lưu đáng tin cậy:** bấm nhiều lần không tạo bản trùng hoặc phát sinh tiền trùng.
  Khi có người khác sửa cùng dữ liệu, người dùng được xem thay đổi và quyết định cách
  tiếp tục; không bị ghi đè mà không biết.
- **Tận dụng diện tích:** bảng trên máy tính hỗ trợ so sánh; màn hình nhỏ ưu tiên
  định danh, lịch, trạng thái, số liệu chính và hành động. Thông tin phụ có thể mở
  thêm nhưng các mã quan trọng không bị cắt hoặc ngắt thành từng ký tự. Các nhóm
  trường dùng khoảng cách và tiêu đề rõ, tránh nhiều lớp khung.
- **Thao tác thuận tiện:** điều khiển dễ chạm, dùng được bằng bàn phím; chữ dễ đọc,
  lỗi nằm cạnh trường, nút lưu/đóng luôn tiếp cận được kể cả khi bàn phím điện thoại
  mở. Thông tin không chỉ phân biệt bằng màu hoặc chỉ xem được khi rê chuột.
- **Phản hồi rõ và ổn định:** đang tải, không có dữ liệu, lỗi tải, đang lưu và đã lưu
  có cách thể hiện khác nhau. Chuyển động nhẹ, tôn trọng nhu cầu giảm chuyển động;
  cập nhật dữ liệu không làm nhảy hàng hoặc nút đang dùng.
- **Giữ ngữ cảnh:** quay lại danh sách giữ bộ lọc, trang và vị trí phù hợp; đổi tài
  khoản không để lại dữ liệu của người trước. Lỗi kết nối tạm thời không khiến người
  dùng bị đăng xuất khỏi phiên còn hợp lệ.

## 4. Danh mục tài liệu

| Tài liệu | Phạm vi | Không thuộc tài liệu này |
|----------|---------|--------------------------|
| [QuyTrinhO2C.md](QuyTrinhO2C.md) | Quy trình từ tiếp nhận lô đến điều vận, giao nhận, hoàn thành hồ sơ và thu tiền; trách nhiệm từng vai trò | Công thức cước chi tiết, thiết kế bảng giá |
| [MasterDataNhaMay.md](MasterDataNhaMay.md) | Khách hàng, nhà máy, tuyến và địa điểm; lựa chọn dữ liệu theo quan hệ; lệnh chạy ngoài | Cách tính cước, phân xe, lương |
| [LoHangKepKetHop.md](LoHangKepKetHop.md) | Kẹp hai container đồng thời và kết hợp hai công việc nối tiếp; nguồn lực, tiến độ, chi phí và doanh thu | Quy trình chung mỗi lô đơn lẻ |
| [OpsVanHanh.md](OpsVanHanh.md) | Kế hoạch làm hàng, theo dõi phương tiện, tiền ứng, chi phí, chứng từ và quyết toán của nhân viên hiện trường | Lương lái xe, công nợ khách hàng |
| [ManHinhLaiXe.md](ManHinhLaiXe.md) | Hành trình lái xe: nhận lệnh, đọc thông tin, thực hiện, bổ sung ảnh/chứng từ và hoàn thành | Điều vận, kế toán |
| [CuocPhiPhuPhiDau.md](CuocPhiPhuPhiDau.md) | Công thức cước, tham số hợp đồng, bảng số tham chiếu và quy tắc làm tròn | Trải nghiệm cấu hình giá, luồng nhập kỳ giá |
| [CuocPhiThietKeDB.md](CuocPhiThietKeDB.md) | Yêu cầu đối với dữ liệu cước, ngày hiệu lực, giải thích số tiền và bảo toàn lịch sử | Công thức tính cước |
| [PhuongAnTinhCuocTuDong.md](PhuongAnTinhCuocTuDong.md) | Trải nghiệm cấu hình, tính cước theo ngày vận chuyển, xử lý thiếu giá và điều chỉnh giá trên bảng kê | Công thức gốc và bảng giá hợp đồng |

## 5. Nguồn yêu cầu gốc

| Tài liệu | Nguồn |
|----------|-------|
| MasterDataNhaMay.md | `2026.9.6_Logic_nghiep_vu.docx` Phần 1, kèm yêu cầu bổ sung về tên nhà máy, địa chỉ, liên hệ và thông tin xuất hóa đơn |
| LoHangKepKetHop.md | `2026.9.6_Logic_nghiep_vu.docx` Phần 2 |
| OpsVanHanh.md | `2026.9.6_Man_hinh_ops.docx`, `các chi phí.docx` |
| ManHinhLaiXe.md | `2026.8.27_Man_hinh_lai_xe.docx` và yêu cầu màn hình bổ sung |
| CuocPhiPhuPhiDau.md | `18.7 - BG Long Minh T7.xlsx` và trả lời khách hàng |
| CuocPhiThietKeDB.md | Yêu cầu cước và phương án khách hàng |
| PhuongAnTinhCuocTuDong.md | `Phương án tính cước tự động.docx` |
| QuyTrinhO2C.md | Tổng hợp yêu cầu nghiệp vụ |

Các file nguồn là bản minh hoạ logic, không phải bộ dữ liệu đầy đủ: ô trống trong file
nguồn là bình thường và không ảnh hưởng công thức. Khi nguồn và quy tắc đã chốt khác
nhau, quy tắc đã chốt trong tài liệu tương ứng thắng — xem
[CHANGELOG.md](CHANGELOG.md) để biết thời điểm chốt.

## 6. Quy ước đọc tài liệu

- **Thuật ngữ.** *Lô* là một shipment (FCL có thể gồm nhiều container). *Công việc*
  là một phần việc vận chuyển gắn với một container hoặc với hàng lẻ LCL. *Chuyến*
  (trip) là hành trình thực tế của một xe. *Kẹp* là hai container chạy đồng thời trên
  cùng xe; *kết hợp* là hai công việc nối tiếp dùng chung vỏ. *Lệnh chạy ngoài* là lô
  không do SilverSea tạo ra — xem [MasterDataNhaMay.md](MasterDataNhaMay.md) §4.
- **Một quy tắc chỉ có một nơi định nghĩa.** Tài liệu khác tham chiếu, không chép
  lại; khi cần sửa, sửa tại nơi định nghĩa.
- **Số mục ổn định.** Mã tham chiếu dạng `Tài liệu.md §n.m` được dùng trong mã nguồn;
  không đánh số lại mục khi sửa nội dung.
- **Không ghi lịch sử trong tài liệu.** Quyết định đã chốt, việc đã bỏ và lý do nằm ở
  [CHANGELOG.md](CHANGELOG.md) hoặc hồ sơ công việc, không nằm trong yêu cầu sản phẩm.
- **Điểm còn mở** được nêu ở mục cuối của từng tài liệu, kèm hành vi tạm thời khi chưa
  đủ dữ liệu. Không tự đặt thêm điều khoản để lấp chỗ trống.

Tiêu chí cụ thể của từng quy trình nằm ngay trong tài liệu tương ứng. Sản phẩm cần đáp
ứng cả luồng thông thường và các tình huống thiếu dữ liệu, nhập sai, mất kết nối, thay
đổi đồng thời, tên/mã dài và nhiều bản ghi.
