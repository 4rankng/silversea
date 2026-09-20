# Phương án tính cước tự động — Yêu cầu sản phẩm

Tài liệu mô tả trải nghiệm cấu hình giá và quy tắc tính cước tự động theo Ngày vận
chuyển, cách xử lý khi thiếu giá và cách điều chỉnh giá trên bảng kê. Xem thêm:
[mục lục PRD](README.md), [công thức cước](CuocPhiPhuPhiDau.md),
[dữ liệu cước](CuocPhiThietKeDB.md).

## 1. Mục tiêu và phạm vi

CUS/Điều vận không phải tính lại cước ngoài bảng tính mỗi khi lập lô có Ngày vận
chuyển. Kế toán có thể giải thích cước hợp đồng, giữ số đã khóa và ghi giá cuối
đàm phán khi lập Bảng kê / Debit Note.

Phạm vi có căn cứ hiện nay là **Long Minh**, gồm NEWEB, ASKEY và SUNRISE+SJ. Không
tự áp biểu cước này cho khách khác khi chưa biết hợp đồng của họ.

| Người sử dụng | Công việc cần thực hiện |
|---|---|
| CUS / Điều vận | Nhập thông tin lô và Ngày vận chuyển; xem giá tự tính hoặc lý do chưa tính được |
| Kế toán / CUS được cấp quyền | Nhập kỳ giá dầu, ngày hiệu lực và nguồn; xem lịch sử giá |
| Người được cấp quyền quản lý biểu cước | Lưu trực tiếp giá gốc, điều khoản tuyến và định mức theo hợp đồng |
| Kế toán được cấp quyền | Đối soát, nhập giá cuối và lý do khi lập Bảng kê / Debit Note |

Vai trò không có quyền không được sửa giá; bỏ bước duyệt không đồng nghĩa mở
quyền tài chính cho mọi người.

## 2. Quy tắc tính cước

```
Số lít tính cước = Km một chiều × 2 × Định mức lít/km
Giá sau chia sẻ J = Giá gốc I × (1 + % chia sẻ)
Phụ phí dầu H = max(0, (Giá dầu kỳ G − Giá dầu mốc F) × Số lít)
Tổng cước K = J + H
```

- Làm tròn **riêng J và H đến từng đồng** rồi cộng K; phần lẻ đúng nửa đồng làm
  tròn lên. Giữ đủ độ chính xác của các đầu vào để không làm đổi kết quả tiền.
- `% chia sẻ` cộng vào giá gốc; không chỉ thu một tỷ lệ phần trăm của phụ phí dầu.
- Long Minh luôn tính **km ×2**, kể cả chuyến một chiều hoặc có hàng chiều về.
  Ghép/Kết hợp không làm thay đổi cước hợp đồng của từng lệnh.
- Khi dầu dưới mốc, H=0; tổng cước không thấp hơn phần giá gốc đã chia sẻ.
- Cước đã khóa/phát hành không tự tính lại khi mở kỳ dầu mới.
- **Ngày vận chuyển** là mốc chọn kỳ và khóa cước. NEWEB áp giá sau **1 ngày**;
  không suy ra số ngày trễ cho hai tuyến còn lại.

Các số tham chiếu trong tài liệu này không phải thông báo giá hiện hành; đầu vào chưa
chốt được nêu ở §8. Quy tắc và công thức gốc giữ tại
[Quy tắc cước và phụ phí dầu](CuocPhiPhuPhiDau.md).

## 3. Bốn nhóm điều khoản áp giá

### 3.1. Độ trễ theo tuyến

Nếu giá dầu công bố ngày D và hợp đồng có độ trễ N ngày, mức giá đó áp từ D+N.
Ngày dùng để đối chiếu giá bằng **Ngày vận chuyển trừ số ngày trễ**.

NEWEB đã có N=1. ASKEY/SUNRISE+SJ chưa có số. Ví dụ “áp ngay” N=0 hoặc N=2 trong
phương án chỉ minh hoạ lựa chọn, không phải câu trả lời cho hai tuyến này. Khi
chưa có lag, sản phẩm báo thiếu điều khoản thay vì tự dùng 0.

### 3.2. Ngưỡng kích hoạt điều chỉnh

Phương án khách hàng nêu hai cách theo hợp đồng:

- Theo phần trăm thay đổi giá dầu, ví dụ **vượt 5%**.
- Theo số tiền thay đổi trên mỗi lít, ví dụ **vượt 1.500đ/lít**.

Chọn tối đa một cách cho cùng điều khoản; không đồng thời áp cả hai. Các mức ví
dụ không tự thành ngưỡng của Long Minh.

Đúng bằng ngưỡng được tính là **đạt** ngưỡng: thay đổi giá dầu đúng bằng ngưỡng
đã đủ điều kiện mở kỳ giá mới.

Cần làm rõ trước khi áp hợp đồng có ngưỡng: so với kỳ liền trước hay mốc đang
được áp; nếu nhiều kỳ liên tiếp chưa đạt ngưỡng thì giữ mốc nào; kỳ đầu áp thế
nào.

Phân biệt **đã thỏa thuận không dùng ngưỡng** với **chưa điền thông tin**. Nếu
không dùng ngưỡng, áp kỳ phù hợp theo ngày và độ trễ; nếu còn thiếu điều khoản,
hiển thị chưa đủ căn cứ để tính tự động.

### 3.3. Hiệu lực của kỳ giá mới

Kế toán/CUS có quyền nhập giá dầu và ngày hiệu lực, lưu trực tiếp một kỳ mới.
Kỳ tương lai được hiển thị rõ, không áp cho ngày trước hiệu lực. Không chọn kỳ
mới nhất bất kể ngày chỉ vì thiếu giá phù hợp.

Kỳ mới tham gia các lần tính đủ điều kiện; không tự thay cước đã khóa hoặc số
đã phát hành. Nếu không có kỳ phù hợp, sản phẩm chỉ rõ thiếu kỳ giá để người có
quyền bổ sung hoặc nhập giá có căn cứ.

### 3.4. Thời điểm khóa cước

Khi nhập Ngày vận chuyển và đủ đầu vào, sản phẩm xác định và giữ bản cước của
lô/chuyến theo ngày đó. Không dùng ngày tạo lô hoặc ngày lập hóa đơn thay thế.

- Lô tạo hôm nay, vận chuyển ngày mai: tra giá theo ngày mai trừ lag.
- Lô chưa có ngày: lưu được thông tin, ghi rõ chưa xác định cước, không đặt ngày giả.
- Đổi ngày khi hồ sơ còn được phép sửa: người dùng thấy ảnh hưởng đến giá, lưu
  bản cước tiếp theo và vẫn xem được bản trước.
- Chứng từ đã phát hành không tự đổi theo lần sửa ngày. Điều chỉnh giá/chứng từ
  là thao tác riêng có quyền và lý do, tuân thủ kỳ đã khóa.

## 4. Luồng sử dụng

### 4.1. Nhập kỳ giá dầu

1. Kế toán/CUS có quyền mở lịch sử giá, nhập giá dầu mới, ngày hiệu lực và nguồn.
2. Sản phẩm kiểm tra giá hợp lệ và kỳ áp dụng rõ ràng; lỗi xuất hiện ở thông tin
   cần sửa, giữ nội dung đã nhập.
3. Người dùng lưu trực tiếp. Sau thành công, thấy kỳ vừa ghi nhận và thời điểm
   áp dụng; không phải chờ người khác duyệt.

Giá phải cùng cơ sở so sánh với mốc hợp đồng, chẳng hạn giá chưa VAT. Nguồn và
cách quy đổi phải có căn cứ; mốc Long Minh `19.270 / 1,08` không tự đổi vì giá
thị trường hoặc chính sách thuế thay đổi.

### 4.2. Tính cước khi lập hoặc bổ sung lô

1. CUS/Điều vận chọn khách, tuyến, loại xe và nhập Ngày vận chuyển.
2. Sản phẩm xác định điều khoản và kỳ giá phù hợp, tính J/H/K.
3. Nếu đủ dữ liệu, hiển thị cước đã khóa cùng cách tính và nguồn. Nếu thiếu, chỉ
   rõ thiếu giá gốc, ngày, lag, ngưỡng hay kỳ giá; không báo 0 là cước đã tính đúng.
4. Lô còn thiếu giá có thể tiếp tục lưu thông tin không phụ thuộc giá. Người
   có quyền bổ sung giá có căn cứ; chưa đủ giá thì chưa được coi là đã sẵn sàng
   phát hành số tiền cho khách.

Không mượn giá của tuyến/loại xe khác và không coi tiền phụ phí đơn thuần của
15T là tổng giá hợp lệ khi chưa có giá gốc.

### 4.3. Xem và sửa lịch/giá

Người dùng xem cước đã khóa, từng thành phần và ngày áp dụng ngay trên hồ sơ.
Nếu còn quyền sửa ngày, sản phẩm cho thấy giá cũ/mới và lưu lịch sử. Nếu hồ sơ
đã khóa, giải thích vì sao không được sửa và cách điều chỉnh hợp lệ theo quyền;
không thêm bước xin duyệt.

## 5. Đối soát và giá cuối trên Bảng kê / Debit Note

Cước tự tính là giá chuẩn theo hợp đồng. Kế toán có quyền được nhập **giá cuối
thực tế đàm phán** hoặc khoản giảm giá khi lập bảng kê gửi khách.

- Giữ cước hợp đồng ở chế độ chỉ đọc để so sánh với giá cuối.
- Nếu giá cuối khác giá hợp đồng, yêu cầu lý do có nội dung và thể hiện phần
  chênh lệch cùng tổng tiền sau thay đổi.
- Lưu trực tiếp trong phạm vi được cấp; không có người kiểm tra/người duyệt
  khác, hàng đợi chờ duyệt hoặc nhãn “tự động duyệt”.
- Cho xem ai sửa, lúc nào, giá cũ/mới và lý do. Giá cuối không thay mất các đầu
  vào dùng tính cước ban đầu.
- Chứng từ hoặc kỳ đã khóa được bảo vệ. Điều chỉnh được phép phải có dấu vết và
  ảnh hưởng tiền đúng một lần; không tự biến chứng từ đã phát hành thành bản nháp.
- Kết quả thao tác thể hiện đúng đã lưu, chưa lưu hoặc chưa rõ kết quả, không
  báo chờ duyệt khi số đã đổi.

Ngoại lệ giá hoặc công nợ, khi nằm trong quyền được cấp, là thao tác trực tiếp
với phạm vi, hạn mức, thời hạn và lý do hợp lệ. Không chọn một “yêu cầu đã duyệt”
để tiếp tục. Bỏ phê duyệt không có nghĩa bỏ giới hạn công nợ hoặc tự đặt điều
khoản khách hàng chưa trả lời.

## 6. Trạng thái, lỗi và trải nghiệm

| Tình huống | Người dùng cần nhìn thấy / thực hiện |
|---|---|
| Chưa có ngày hoặc đầu vào | Biết chưa xác định cước và thông tin cần bổ sung |
| Đủ dữ liệu | Xem từng thành phần, tổng cước, kỳ áp dụng và bản cước đã khóa |
| Giá cuối đã điều chỉnh | Xem giá hợp đồng, giá cuối và lý do, không nhầm hai giá |
| Người khác vừa sửa giá | Đối chiếu bản đang nhập với thông tin mới trước khi lưu |
| Hồ sơ đã khóa hoặc không có quyền | Biết vì sao không sửa được; không thấy hành động hứa sai quyền |
| Mất Internet trước khi gửi | Báo chưa lưu, giữ nội dung trên màn hình hiện tại để thử lại chủ động |
| Chưa rõ kết quả sau khi gửi | Kiểm tra bản đã lưu trước khi thử lại; không tự gửi lại khi có mạng |

Bảng giá, bộ lọc và thao tác chính phải gọn và gần nhau. Máy tính hỗ trợ so sánh
theo cột; điện thoại/máy tính bảng giữ đọc đủ số, nhãn và nút. Thông tin phụ có
thể mở thêm, tránh nhiều thẻ lồng nhau. Lỗi gắn với trường và nói rõ cách sửa;
trạng thái đang tải, không có dữ liệu và lỗi phải khác nhau.

Không có chế độ lưu ngoại tuyến hay tự đồng bộ lệnh. Bấm lưu nhiều lần không
tạo tiền hoặc chứng từ trùng. Lịch sử và số đã phát hành không mất khi giá thay đổi.

## 7. Tiêu chí chấp nhận

1. Với dữ liệu hợp lệ, cước khớp bảng tham chiếu và có thể giải thích từng thành
   phần; dầu dưới/bằng mốc cho H=0, km luôn ×2, J/H làm tròn riêng.
2. Ngày vận chuyển, độ trễ và ngày hiệu lực quyết định kỳ giá đúng. Không dùng
   kỳ tương lai khi thiếu dữ liệu hoặc tự dùng số minh hoạ làm giá thật.
3. Nhập ngày và đủ giá tạo bản cước đã khóa; đổi ngày hợp lệ giữ bản trước.
   Mở kỳ dầu mới không thay số đã khóa hoặc chứng từ đã phát hành.
4. Kế toán/CUS theo quyền lưu kỳ giá trực tiếp; Kế toán có quyền lưu giá cuối
   với lý do. Không có bước chờ duyệt, nhưng người ngoài phạm vi vẫn không sửa được.
5. Thiếu giá 15T, lag, ngưỡng hay kỳ phù hợp được hiển thị đúng; không trình bày
   số 0 hoặc riêng phụ phí như tổng cước đã đủ căn cứ.
6. Bấm lặp, hai người sửa và mất kết nối không tạo số tiền trùng, mất lịch sử
   hoặc ghi đè âm thầm. Kết nối trở lại không tự thực hiện thao tác ghi.
7. Trên điện thoại, máy tính bảng và máy tính, người dùng tìm được giá, xem cách
   tính, sửa thông tin có quyền và đọc lỗi rõ ràng với dữ liệu dài/nhiều dòng.

## 8. Điểm cần khách hàng/chủ sản phẩm làm rõ

| Điểm còn mở | Thông tin cần có |
|---|---|
| Biểu cước khách ngoài Long Minh | Khách nào dùng cùng mô hình, khách nào có cách tính khác |
| Lag ASKEY/SUNRISE+SJ | Số ngày thực tế theo từng hợp đồng/tuyến |
| Giá gốc 15T | Ba mức giá thật, không phải số 0 hoặc giá ví dụ |
| Ngưỡng điều chỉnh | % hoặc số tiền/lít và giá trị; đúng bằng ngưỡng đã tính là đạt, phần giá trị theo hợp đồng còn thiếu |
| Mốc so sánh qua nhiều kỳ | So với giá kỳ liền trước hay giá đã áp; giữ mốc thế nào khi nhiều kỳ chưa đạt ngưỡng; áp kỳ đầu thế nào |
| Không dùng ngưỡng | Xác nhận rõ là không dùng, không suy từ ô còn trống |
| Nguồn giá dầu | Dùng chung hay riêng theo khách; lịch áp giá, nguồn công bố và cách quy đổi VAT |

Các lựa chọn chưa trả lời không được thay bằng giả định. Ví dụ 5%, 1.500đ/lít
hoặc lag 0 chỉ để giải thích cách cấu hình, không phải giá trị đã được khách
chấp nhận. Không cần hỏi lại ba câu đã chốt hoặc mốc Ngày vận chuyển.

Xem [đầu vào nghiệp vụ còn mở](CuocPhiThietKeDB.md#8-đầu-vào-nghiệp-vụ-còn-mở) và
[yêu cầu dữ liệu/lịch sử](CuocPhiThietKeDB.md).
