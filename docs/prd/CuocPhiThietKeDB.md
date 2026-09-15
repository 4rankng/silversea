# Yêu cầu dữ liệu cước và lịch sử giá

> **Yêu cầu sản phẩm — cập nhật 14/09/2026.** Người có quyền lưu trực tiếp dữ liệu
> cước và điều chỉnh được phép, không qua phê duyệt nội bộ. Giữ quyền truy cập,
> ngày hiệu lực, lịch sử và kỳ đã khóa. Cần Internet để làm việc. Tài liệu mô tả
> sản phẩm cần đạt; xem [mục lục PRD](README.md).

## 1. Mục tiêu và người sử dụng

Kế toán, CUS và Điều vận cần biết một mức cước được tính từ đâu, áp dụng cho
khách/tuyến nào và có hiệu lực từ khi nào. Khi giá dầu hoặc hợp đồng thay đổi,
họ vẫn phải giải thích được số tiền đã báo hoặc phát hành trước đó.

Sản phẩm phải hỗ trợ:

- Nhập và tra cứu đúng biểu cước của từng khách hàng, tuyến và loại xe.
- Tính giá theo Ngày vận chuyển, độ trễ và điều khoản hợp đồng đã xác định.
- Giữ bản cước đã khóa, giá cuối đàm phán và chứng từ đã phát hành tách biệt.
- Xem ai thay đổi giá, thay đổi gì, khi nào, vì sao và từ ngày nào có hiệu lực.
- Nhận biết dữ liệu còn thiếu; không nhầm ô trống, số 0 và giá minh hoạ.

Công thức và toàn bộ bảng số Long Minh nằm tại
[Quy tắc cước và phụ phí dầu](CuocPhiPhuPhiDau.md). Quy trình sử dụng nằm tại
[Phương án tính cước tự động](PhuongAnTinhCuocTuDong.md).

## 2. Thông tin cần quản lý

| Nhóm thông tin | Người dùng cần biết | Quy tắc sản phẩm |
|---|---|---|
| Khách hàng và tuyến | Biểu cước thuộc hợp đồng nào; nhà máy nào thuộc nhóm tuyến nào | Một khách có thể có nhiều mức chia sẻ theo tuyến; không lấy mức của khách/tuyến khác |
| Loại xe | Tên loại xe và định mức tương ứng | Dùng cách gọi nhất quán, tránh chọn nhầm CONT20/CONT40 hoặc loại tải khác |
| Giá gốc | Giá trước chia sẻ và phụ phí dầu | Theo khách, tuyến, loại xe và ngày hiệu lực; không lấy tổng cước kỳ cũ làm giá gốc |
| Điều khoản tuyến | % chia sẻ, km một chiều, giá dầu mốc và độ trễ | Theo thỏa thuận của khách/tuyến; Long Minh luôn tính km ×2 |
| Định mức tính phụ phí | Số lít/km theo loại xe | Phân biệt với lượng dầu thực tế cấp cho xe hoặc chi phí nhiên liệu nội bộ |
| Kỳ giá dầu | Giá, ngày bắt đầu áp dụng và nguồn công bố | Biết kỳ nào được dùng; giá tương lai chưa có hiệu lực không áp sớm |
| Ngưỡng điều chỉnh | Dùng ngưỡng % hay số tiền/lít, mức ngưỡng và cách áp dụng | Chỉ dùng khi đủ thỏa thuận; không nhầm chưa điền với không dùng ngưỡng |
| Bản cước đã khóa | Giá gốc, điều khoản, định mức, kỳ dầu và kết quả từng thành phần | Giữ đúng các đầu vào đã dùng để giải thích lại số tiền |
| Giá cuối trên Bảng kê / Debit Note | Giá thực tế đàm phán, lý do và người thay đổi | Không ghi đè phần cước tính theo hợp đồng đã được giữ lại |

Các giá trị trung gian phải giữ đủ độ chính xác để không đổi kết quả làm tròn
cuối. Việc mở lại, xuất bản kê hoặc xem lịch sử phải cho cùng một số tiền; không
được lệch một đồng chỉ vì số hiển thị đã được rút gọn.

## 3. Dữ liệu Long Minh đã ghi nhận

Long Minh là một khách hàng có ba nhóm tuyến, không phải ba khách hàng khác nhau:

| Tuyến | % chia sẻ | Km một chiều | Giá dầu mốc | Độ trễ áp giá |
|---|---:|---:|---:|---|
| Hải Phòng–NEWEB | 2,00% | 130 | 19.270 / 1,08 = 17.842,5926 đ/lít khi hiển thị đến 4 số lẻ | 1 ngày |
| ASKEY | 4,00% | 100 | Cùng mốc hợp đồng trên | Chưa có số của khách |
| SUNRISE+SJ | 2,50% | 120 | Cùng mốc hợp đồng trên | Chưa có số của khách |

Hai kỳ giá trong bảng tham chiếu của khách:

| Kỳ | Giá dầu chưa VAT |
|---|---:|
| 11/7 | 21.740 đ/lít |
| 18/7 | 27.620 đ/lít |

Đây là giá tham chiếu trong tài liệu nguồn, không phải thông báo giá dầu hiện
hành. Ba giá gốc 15T còn thiếu. Không tự lấy 0, giá của loại xe khác hoặc số
minh hoạ để điền vào hợp đồng.

## 4. Hiệu lực và thao tác thay đổi giá

- Người có quyền nhập kỳ dầu hoặc điều khoản mới, chọn ngày hiệu lực và ghi
  nguồn/lý do cần thiết, rồi **lưu trực tiếp**. Không có yêu cầu gửi duyệt giá.
- Sau lưu, người dùng thấy dữ liệu đã ghi nhận, ai ghi nhận và ngày áp dụng.
  Phân biệt “đã lưu” với “đang có hiệu lực”; bản tương lai chưa áp cho ngày cũ.
- Với một ngày, khách, tuyến và loại xe, kết quả phải rõ ràng. Không để hai mức
  giá cùng cạnh tranh mà người dùng không biết mức nào được áp.
- Sửa một bản đã được dùng không được làm mất nội dung cũ hoặc tự thay số trên
  chứng từ trước đó. Người dùng xem được bản trước/sau và thời điểm áp dụng.
- Nếu có người khác sửa trong lúc biểu mẫu đang mở, giữ nội dung đang nhập và
  cho đối chiếu trước khi lưu; không âm thầm ghi đè.
- Người không có quyền chỉ xem trong phạm vi được cấp. Bỏ phê duyệt nội bộ không
  mở rộng quyền chỉnh giá hoặc cho phép vượt kỳ đã khóa.

## 5. Khóa cước và bảo toàn lịch sử

**Mốc khóa cước:** khi CUS/Điều vận nhập Ngày vận chuyển và có đủ đầu vào, sản phẩm
xác định cước theo ngày đó và giữ bản cước đã khóa. Lô chưa có ngày hoặc còn thiếu
giá vẫn có thể lưu thông tin; phải thể hiện rõ chưa xác định được cước.

**Khi mở kỳ dầu mới:** cước đã khóa hoặc đã phát hành không tự đổi. Đây là quyết
định không hồi tố của khách hàng.

**Khi đổi Ngày vận chuyển:** nếu hồ sơ còn được phép sửa, cho thấy ảnh hưởng đến
giá, lưu bản cước kế tiếp và giữ bản cũ. Chứng từ đã phát hành không tự bị thay
số theo bản mới; điều chỉnh chứng từ phải là thao tác riêng có quyền và lý do.

**Khi đàm phán giá cuối:** Kế toán có quyền nhập trực tiếp giá cuối hoặc khoản
giảm giá theo thỏa thuận, giữ cước hợp đồng để so sánh. Nếu giá cuối khác giá
tính tự động, lý do phải có nội dung. Không chờ người khác duyệt và không dùng
nhãn “đã duyệt” thay cho kết quả lưu.

**Với dữ liệu cũ:** giữ số và căn cứ ban đầu; thiếu nguồn phải được ghi rõ. Không
suy đoán một kỳ dầu để tính lại tiền cũ, không tự phát hành thêm chứng từ hoặc
ghi thêm khoản nợ khi bổ sung lịch sử.

## 6. Yêu cầu sử dụng và phản hồi

- Có thể tìm theo khách, tuyến, loại xe và ngày hiệu lực; xem được mức đang áp
  cùng lịch sử liên quan mà không phải mở nhiều màn hình.
- Dữ liệu chính và thao tác lưu ở gần nhau. Bảng giá gọn, so sánh được trên máy
  tính; số tiền và nhãn đọc đủ trên điện thoại/máy tính bảng. Tránh thẻ lồng nhau
  và khối thông tin phụ quá dài trước bảng giá.
- Lỗi nêu rõ trường cần sửa: thiếu giá, trùng hiệu lực, giá không hợp lệ, không
  có quyền hoặc hồ sơ đã khóa. Không dùng cùng một thông báo chung cho mọi lỗi.
- Bấm lưu lại không tạo hai bản giá hoặc hai khoản tiền. Nếu mất kết nối sau
  khi gửi và chưa rõ đã lưu hay chưa, người dùng phải kiểm tra được kết quả
  trước khi thử lại; không tự gửi lại khi có mạng.
- Khi chưa gửi được, báo chưa lưu và giữ phần đang nhập trên màn hình hiện tại.
  Không hứa lưu ngoại tuyến hoặc tự đồng bộ sau.

## 7. Tiêu chí chấp nhận

1. Chọn đúng khách/tuyến/loại xe/Ngày vận chuyển cho ra giá theo các điều khoản
   có hiệu lực, giải thích đủ từng thành phần và nguồn đã dùng.
2. Mở lại bản cước hoặc chứng từ cũ sau khi có giá dầu mới vẫn thấy số cũ; không
   xuất hiện thay đổi tiền ngoài thao tác được phép.
3. Đổi ngày hợp lệ tạo bản cước tiếp theo, xem được bản trước; kỳ/chứng từ đã
   khóa được bảo vệ và lý do không sửa được hiển thị rõ.
4. Kế toán có quyền lưu giá cuối trực tiếp với lý do, không thay mất giá hợp
   đồng. Người ngoài phạm vi không đọc hoặc sửa được thông tin đó.
5. Thiếu giá gốc 15T hoặc lag/ngưỡng/kỳ dầu không tạo giá tự động giả; người dùng
   biết cần bổ sung gì hoặc nhập giá có căn cứ trong phạm vi được cấp.
6. Số tiền không thay đổi vì làm tròn đầu vào khi xem lại; bấm lặp, mở hai cửa
   sổ sửa hoặc mất kết nối không làm mất lịch sử hay tạo tiền trùng.
7. Các thao tác trên dùng được trên điện thoại, máy tính bảng và máy tính với
   dữ liệu dài, nhiều dòng, rỗng và lỗi; nhãn, số và nút không bị che/cắt.

## 8. Đầu vào nghiệp vụ còn mở

- Giá gốc 15T của ba tuyến; lag ASKEY và SUNRISE+SJ.
- Mức ngưỡng % hoặc số tiền/lít theo hợp đồng; đúng tại ngưỡng áp hay chưa áp;
  lấy giá kỳ liền trước hay mốc đã áp, giữ mốc thế nào qua nhiều kỳ và khi bắt
  đầu hợp đồng. Phải phân biệt chưa biết với đã thỏa thuận không dùng ngưỡng.
- Biểu cước của khách ngoài Long Minh; nguồn giá dầu dùng chung hay riêng; lịch
  áp giá và cách quy đổi VAT cho các kỳ tương lai.

Xem [câu hỏi khách hàng](CauHoiKhachHang_CuocPhi_2026-09-08.md). Các đầu vào này
không được tự điền từ ví dụ và không làm phát sinh quy trình phê duyệt nội bộ.
