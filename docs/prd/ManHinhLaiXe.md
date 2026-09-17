# Màn Hình & Luồng Vận Hành App Lái Xe

**Dự án:** TTransport — Silver Sea

**Nguồn nghiệp vụ:** `2026.8.27_Man_hinh_lai_xe.docx` và yêu cầu bổ sung về thông tin công việc, ảnh chứng từ và bố cục màn hình lái xe.

**Liên quan:** [Tổng quan PRD](README.md), [Quy trình O2C](QuyTrinhO2C.md), [Kẹp và Kết hợp](LoHangKepKetHop.md), [Master data nhà máy](MasterDataNhaMay.md), [Vận hành Ops](OpsVanHanh.md).

Tài liệu xác định sản phẩm phục vụ lái xe từ lúc nhận lệnh đến khi hoàn thành công việc. Lái xe cần biết đi đâu, làm gì, liên hệ ai và nộp chứng từ nào; Điều vận, CUS và Ops cần theo dõi đúng tiến độ của phần việc liên quan.

## 1. Phạm Vi Và Nguyên Tắc Vận Hành

- App **cần Internet** để xem thông tin hiện hành và ghi nhận thao tác. Khi mất kết nối, giải thích rõ việc chưa thể lưu; không cho làm việc ngoại tuyến hoặc tự gửi lại thao tác khi có mạng.
- Không có bước phê duyệt nội bộ, người kiểm tra/người duyệt hoặc trạng thái chờ duyệt để hoàn thành công việc. **Lái xe nhận lệnh vận chuyển** là xác nhận tiếp nhận công việc thật, vẫn được giữ.
- Lái xe chỉ thực hiện công việc được giao và còn quyền thao tác. Giữ ràng buộc an toàn xe/tài xế/moóc, thứ tự vận hành và yêu cầu bằng chứng; các bước liên quan đến Ops phản ánh công việc thực tế.
- Ảnh, biên lai và chi phí thuộc đúng công việc, chỉ người có quyền mới được thêm hoặc sửa.
- Dữ liệu trọng tâm xuất hiện trước, trình bày gọn trên điện thoại, máy tính bảng và máy tính. Không dùng chữ quá lớn, khoảng đệm dư hoặc nhiều lớp thẻ trang trí.

## 2. Điều Hướng Và Đơn Vị Công Việc

Điều hướng chính gồm bốn tab: **Hành trình**, **Thu nhập**, **Kỷ luật**, **Tài khoản**. Màn hình **Hành trình** có ba tab: **Lệnh mới**, **Đã nhận**, **Lịch sử**. Số lượng và trạng thái trong các tab phải theo công việc thực tế của tài khoản đang đăng nhập.

### 2.1 Lô Hàng, Container Và Công Việc Vận Chuyển

Một **lô hàng nguồn** có thể gồm nhiều container. Mỗi công việc vận chuyển có mã nhận diện, phân xe, tiến độ và bằng chứng riêng, đồng thời vẫn thuộc đúng lô hàng nguồn.

- Với FCL, mỗi thẻ thể hiện một công việc gắn với một container. Không gộp nhiều container có tiến độ khác nhau thành một thẻ chung của lô.
- Container chưa có số vẫn có thẻ: hiển thị **Chưa có số container**, loại container đã biết, công việc và lịch đã có. Không ẩn loại container chỉ vì thiếu số.
- Với LCL, thẻ thể hiện công việc vận chuyển hàng lẻ của lô, với thông tin hàng và ngày vận chuyển phù hợp. Không tạo container giả, không yêu cầu ảnh/số container không tồn tại chỉ để đi qua luồng FCL.
- Quan hệ giữa các thẻ KẸP/KẾT HỢP lấy từ cặp ghép có hiệu lực. Giữ từng thẻ riêng, đặt liền kề và có dấu hiệu chung đủ rõ; không suy ra quan hệ chỉ vì trùng biển số hoặc trùng ngày.

### 2.2 Thẻ Tổng Quát

Thẻ cần đủ dữ liệu để lái xe nhận diện và chọn đúng công việc mà không phải mở lần lượt từng thẻ.

| Thứ tự | Nội dung |
|---------|----------|
| Nhận diện công việc | Phân loại ĐƠN/KẸP/KẾT HỢP và lịch đóng/trả đầy đủ ngày, giờ khi đã có |
| Nhà máy | Tên ngắn nhà máy ở vị trí nổi bật; thiếu tên ngắn thì dùng tên đầy đủ |
| Tuyến | Tuyến vận chuyển ngay dưới nhà máy; không thay tuyến bằng địa chỉ đường phố |
| Container và thao tác | Mỗi số container đi cùng **loại của chính container đó**, ví dụ `EMCU6163403 · 20DC`; thể hiện **TRẢ HÀNG/ĐÓNG HÀNG** đúng công việc |
| Cảng | Cảng nâng và cảng hạ có nhãn riêng, đúng chiều nhập/xuất và nguồn của công việc |
| Chỉ dẫn | Dòng nhiệm vụ viết hoa; ghi chú dành cho lái xe ở dòng riêng, giữ cách viết và xuống dòng có nghĩa |
| Thao tác | Mở chi tiết; nội dung nút phù hợp với trạng thái thực tế, không hứa nhiều thao tác nhưng chỉ thực hiện một thao tác |

Điều vận chọn tác vụ phù hợp; lái xe nhìn thấy đúng nhãn đã chọn trong danh mục sau:

| Tác vụ | Tác vụ |
|--------|--------|
| HẾT HẠN | ĐẢO VỎ |
| ĐẶT ĐUÔI | ĐẶT ĐẦU |
| KIỂM HÓA | QUAY ĐẦU |
| GỬI VỎ BÃI ĐĂNG KHOA | QUÁ TẢI |
| ĐẢO HÀNG | HẠ VỎ ICD QUẾ VÕ |
| GẮP VỎ ICD QUẾ VÕ | |

Đây là 11 nhãn tác vụ. Chọn tác vụ không thay thế ghi chú tự do; nhãn **QUÁ TẢI** không cho phép bỏ qua giới hạn tải hoặc ràng buộc an toàn.

Không lặp lại biển số, tài xế hoặc mã tham chiếu trên mọi dòng khi chúng không giúp chọn công việc. Mã công việc vẫn phải truy cập được trong chi tiết và trong thông báo chỉ rõ công việc đang chặn. Phân loại ghép và trạng thái vận hành là hai thông tin khác nhau; không dùng riêng màu sắc để truyền đạt trạng thái cần hành động.

Giờ hẹn tại nhà máy, giờ tiếp nhận lệnh và thời điểm thực tế bắt đầu chạy phải có nhãn đúng nghĩa. Không hiển thị giờ hẹn như bằng chứng xe đã xuất phát. Ngày nghiệp vụ theo Việt Nam; giữ đủ phút khi phát lệnh và đọc lại, không tự đổi thành giờ tròn.

### 2.3 Cảng Theo Chiều Vận Chuyển

- Với hàng nhập, **Cảng hạ** là nơi trả vỏ rỗng của công việc. Điểm giao hàng/nhà máy không được dùng thay cho nơi trả vỏ chỉ vì trường đó có dữ liệu.
- Với hàng xuất, cảng nâng/hạ thể hiện đúng điểm lấy vỏ và điểm hạ hàng theo lệnh.
- Nếu điểm giao hàng khác nơi trả vỏ, giữ cả hai dưới nhãn đúng nghĩa. Hai điểm có thể trùng tên nhưng khác vai trò; nhãn vẫn phải giúp lái xe hiểu đúng điểm cần đến.
- Khi chưa xác định được điểm cần thiết, hiển thị rõ **Chưa có thông tin** và hướng bổ sung phù hợp quyền; không tạo địa điểm giả hoặc mượn địa điểm của công việc khác.

### 2.4 Thu Nhập, Kỷ Luật Và Tài Khoản

- **Thu nhập:** Lái xe xem thu nhập của chính mình theo kỳ đã chọn, các khoản cấu thành, tổng và khoản điều chỉnh có giải thích. Phân biệt khoản tạm tính, kỳ đã chốt và tiền đã trả theo sự kiện thực tế; không coi đã chốt là đã thanh toán. Cách tính và mức tiền tuân theo quy tắc lương đang áp dụng, không đặt công thức riêng trên màn hình lái xe.
- **Kỷ luật:** Lái xe xem các biên bản của mình, ngày vi phạm, lý do, số tiền hoặc ảnh hưởng liên quan và trạng thái hiện hành. Biên bản đã hủy vẫn có thể xem lại nhưng không còn được cộng vào khoản khấu trừ hiện hành. Số tổng và chi tiết phải khớp nhau, không chỉ phân biệt bằng màu.
- **Tài khoản:** Hiển thị đúng tên đăng nhập, họ tên, thông tin liên hệ và xe hiện được giao khi có. Chỉ cho sửa thông tin thuộc quyền của lái xe; thông tin không được tự sửa phải thể hiện rõ. Sau đăng xuất, không còn xem được dữ liệu của tài khoản trước; đăng nhập tài khoản khác chỉ hiển thị dữ liệu được phép của tài khoản mới.

Cả ba tab dùng bố cục gọn trên điện thoại, máy tính bảng và máy tính. Số tiền, kỳ, ngày và biển số đọc được nguyên cụm; trạng thái rỗng giải thích rõ thay vì khiến người dùng hiểu thành chưa tải xong hoặc mất dữ liệu.

## 3. Chi Tiết Lệnh

Mở thẻ vào màn hình chi tiết đầy đủ. Tiêu đề tác vụ ưu tiên tên viết tắt nhà máy, tuyến đường nằm ngay dưới. Có thể thu gọn phần phụ để tiết kiệm diện tích, nhưng tên nhà máy, tuyến và trạng thái công việc vẫn dễ nhận biết. Tuyến đã xuất hiện ở tiêu đề không lặp thành một dòng trong phần thông tin lệnh; phần đó hiển thị địa chỉ nhà máy.

### 3.1 Thứ Tự Thông Tin

| Nhóm | Yêu cầu |
|------|---------|
| Lịch và địa điểm làm hàng | Lịch đóng/trả, tên ngắn và tên đầy đủ nhà máy khi có, **Địa chỉ nhà máy**, rồi tên người liên hệ cùng **Số điện thoại liên hệ** ngay dưới địa chỉ |
| Hàng hóa | Số container gắn với loại tương ứng, số chì và thao tác của chính công việc; số lượng tổng chỉ bổ sung, không thay cặp số–loại |
| Lộ trình | Cảng nâng, cảng hạ và điểm giao/điểm trả vỏ riêng khi có khác biệt nghiệp vụ |
| Nhiệm vụ và ghi chú | Nhiệm vụ viết hoa ở dòng riêng; ghi chú lái xe và quy định tại điểm làm hàng giữ nguyên nội dung có nghĩa |
| Thông tin xuất hóa đơn | Tiêu đề từng bên/nhóm thông tin đặt **trước** tên, địa chỉ, mã số thuế của bên đó |
| Bằng chứng và hành động | Ảnh container/chì/biên bản; thao tác phù hợp giai đoạn và luồng e-POD |

Tên liên hệ và số điện thoại phải cùng nhóm với địa chỉ nhà máy, gọi được qua liên kết điện thoại. Không lặp lại cùng người/số trong các dòng kho bãi và liên hệ khác nhau. Nếu có người liên hệ khác với vai trò thật sự khác, giữ họ ở chi tiết kèm nhãn vai trò; không xóa thông tin hữu ích chỉ để rút ngắn màn hình.

Tác vụ và ghi chú lái xe đặt ngay sau thông tin công việc, trước thông tin xuất hóa đơn, để hướng dẫn vận chuyển được đọc trước dữ liệu thanh toán. Hai dòng này vẫn hiển thị khi thu gọn thông tin lệnh hoặc hóa đơn. Không hiển thị thêm dòng đầu kéo và moóc trong khối chi tiết lệnh.

Lịch kế hoạch trên thẻ và chi tiết phải thống nhất. Khi chưa có ngày giờ kế hoạch xác định, hiển thị **Chưa chốt lịch**; không suy ra giờ hẹn từ một ngày xuất phát không có giờ.

Nhà máy, khách hàng và đơn vị xuất hóa đơn là các chủ thể riêng. Không lấy tên/mã số thuế khách hàng thay cho hồ sơ nhà máy đang thiếu. Các nhóm hóa đơn nâng, hạ, vệ sinh dùng hồ sơ tương ứng theo [Master data nhà máy](MasterDataNhaMay.md); không âm thầm gộp các hồ sơ khác nhau. Thiếu hồ sơ phải được thể hiện rõ, kể cả khi toàn bộ nhóm chưa có dữ liệu.

Các phần dài có thể thu gọn độc lập. Tiêu đề phần có tóm tắt đủ nhận diện, biểu thị trạng thái mở/đóng và điều khiển được bằng bàn phím. Thông tin cốt lõi về công việc không bị đẩy xuống dưới một vùng minh họa hoặc thẻ dịch vụ rỗng lớn.

## 4. Nhận Lệnh, Thực Hiện Và Hoàn Thành

### 4.1 Lệnh Mới

Sau khi Điều vận phát lệnh hợp lệ cho đúng tài xế, công việc xuất hiện ở **Lệnh mới**. Thông báo phải mở đúng công việc; khi đang trực tuyến, danh sách cần làm mới để thấy lệnh mới và phân công mới. Khi mở thông báo, lái xe phải thấy phân công và trạng thái hiện hành.

Bấm **Nhận lệnh vận chuyển** xác nhận tiếp nhận công việc trực tiếp. Chỉ chuyển sang **Đã nhận** khi hệ thống xác nhận đã ghi nhận thành công. Ghi nhận thời điểm tiếp nhận; không tự coi tiếp nhận là một sự kiện xuất phát vật lý khác nếu chưa có sự kiện đó trong luồng vận hành.

Nếu xe/tài xế/moóc còn bận ở công việc khác, giữ ràng buộc đúng và hiển thị bền vững lý do cùng mã/liên kết tới công việc đang chặn mà người dùng được quyền xem. Hướng dẫn bước cần làm; không chỉ đưa nút tải lại khiến lái xe lặp lại cùng lỗi. Cặp KẸP hợp lệ được xử lý theo quan hệ dùng chung tài nguyên, không được coi thành xung đột giữa hai thành viên.

### 4.2 Thực Hiện Công Việc

- Tiến độ và ảnh cập nhật đúng công việc/container đang mở; không làm hoàn thành các phần việc khác trong cùng lô hàng.
- KẸP vận chuyển đồng thời hai container, nhưng từng công việc vẫn giữ mốc và bằng chứng riêng.
- KẾT HỢP thực hiện nối tiếp: hoàn thành trả hàng Lệnh 1 rồi mới được bắt đầu đóng hàng Lệnh 2. Màn hình phải nêu lý do khi phần việc sau chưa thể bắt đầu.
- Khi công việc đã được người khác phân lại, hủy hoặc sửa, giải thích thay đổi và giữ nội dung đang nhập để người dùng đối chiếu. Chỉ cho tiếp tục thao tác phù hợp với phân công hiện hành; không âm thầm ghi đè thay đổi của người khác.

### 4.3 e-POD Và Hoàn Thành

Bấm **Hoàn tất lệnh vận chuyển** mở màn hình chứng từ giao nhận điện tử (e-POD) của công việc. Với công việc container (FCL), giữ hai nhóm bằng chứng bắt buộc:

1. **Phiếu hạ bãi / trả hàng** (phiếu bãi/phiếu hạ phù hợp với loại công việc).
2. **Biên bản giao nhận**, có dấu hoặc chữ ký theo yêu cầu chứng từ.

Ảnh chụp container/chì và e-POD có dấu thời gian thực tế; ảnh tải lên thuận tiện và vẫn đọc được số cùng nội dung chứng từ. Không ghi đè thời điểm chụp bằng thời điểm thử tải lại. Với ảnh có sẵn, không diễn giải thời điểm chọn/tải lên thành thời điểm chụp nếu không biết.

Giữ thao tác hoàn thành gọn đã được xác định: lái xe phải tự **Nhận lệnh** và có đủ hai nhóm bằng chứng đã lưu; nút **HOÀN THÀNH CHUYẾN** gửi hồ sơ e-POD và hoàn thành trong một thao tác. Không bắt lái xe nhập thêm từng mốc lấy vỏ, đóng/trả, hạ bãi nếu còn thiếu: hệ thống có thể suy ra các mốc sau nhận lệnh từ chính hành động hoàn thành. Các mốc này phải ghi rõ nguồn **suy ra từ hoàn thành**, không mô tả thành thời điểm quan sát thực tế/GPS hoặc bịa thời gian đã xảy ra. Các mốc thực tế đã có phải được giữ nguyên.

Ảnh tải đến 100% chưa đồng nghĩa hồ sơ đã lưu thành công; người dùng phải biết ảnh nào đã lưu và có thể mở lại. Thiếu bằng chứng phải có chỉ dẫn cụ thể; đủ bằng chứng không tạo thêm bước chờ phê duyệt e-POD hoặc kế toán. Vẫn kiểm tra quyền sở hữu, trạng thái còn cho phép hoàn thành và thứ tự KẾT HỢP; không yêu cầu nhập thêm các mốc thủ công chỉ để đủ thủ tục. Ảnh container/chì, vé cầu đường, thu hồi chứng từ gốc, đối soát chi phí hoặc xác nhận doanh thu bằng 0 không trở thành điều kiện bổ sung để lái xe đóng chuyến.

Khi hệ thống xác nhận hoàn thành, thẻ chuyển sang **Lịch sử** và Điều vận/CUS/Ops thấy tiến độ mới. Lô hàng có nhiều phần việc chỉ hoàn thành khi các phần bắt buộc đã xong; một container xong không đồng nghĩa mọi container trong lô đã xong.

Với LCL, ghi nhận hoàn thành cho công việc hàng lẻ, không phụ thuộc vào container. Bộ chứng từ thay cho phiếu hạ container chưa được xác định đầy đủ và phải làm rõ theo nghiệp vụ hàng lẻ; không tự coi bộ chứng từ FCL là bắt buộc cho mọi công việc LCL. Không yêu cầu số container hoặc ảnh container giả để đóng lệnh.

## 5. Ảnh, Biên Lai Và Khôi Phục Khi Có Lỗi

Mỗi loại ảnh có một vị trí quản lý rõ ràng. Cùng một ảnh biên bản không xuất hiện thành hai khối tải/xóa độc lập. Giữ ảnh thu nhỏ gọn; bấm hoặc dùng bàn phím để xem toàn ảnh, phóng to và di chuyển để đọc nội dung. Đóng bằng Esc được và vị trí điều khiển bàn phím trở về ảnh vừa mở.

- Phân biệt ảnh đang chọn, đang tải, đã lưu, tải thất bại và chưa xác định được kết quả. Chỉ hiển thị thành công khi hệ thống xác nhận đã lưu.
- Nếu một ảnh thất bại sau khi ảnh khác đã lưu, giữ tiến độ từng ảnh và cho thử lại ảnh lỗi. Không buộc chụp lại ảnh còn trong màn hình, không tạo thêm công việc hoặc bản sao ảnh đã lưu.
- Khi mất Internet, báo rõ chưa thể lưu và giữ nội dung đang làm trên màn hình. Cảnh báo trước khi người dùng rời hoặc tải lại trang nếu việc đó làm mất nội dung chưa lưu. Không tự gửi khi kết nối trở lại.
- Khi mạng trở lại, người dùng chủ động tiếp tục. Nếu chưa biết lần lưu trước đã thành công hay chưa, hệ thống cần làm rõ kết quả trước khi cho thử lại; không báo kết quả sai hoặc tạo thêm ảnh/khoản chi trùng lặp.
- Xóa/thay ảnh cần cập nhật theo kết quả đã lưu và quyền sở hữu hiện hành. Nếu công việc đã giao cho người khác hoặc người dùng hết quyền, giải thích rõ và ngừng cho sửa/xóa.
- Luồng lưu ảnh/biên lai của một khoản chi đã có phải giữ đúng khoản chi đó; không yêu cầu tạo lại khoản chi để bổ sung chứng từ.

## 6. Giao Diện Và Khả Năng Truy Cập

- Ưu tiên cuộn dọc và nhiều thông tin hữu ích trong một màn hình. Tận dụng chiều rộng điện thoại, tránh nhiều lớp lề hoặc thẻ trang trí lồng nhau.
- Văn bản và trường nhập dễ đọc, đủ tương phản. Không thu nhỏ dữ liệu quan trọng để ép vừa, cũng không dùng tiêu đề hoặc thẻ quá khổ.
- Nút dễ chạm, không chồng lấn hoặc bị bàn phím ảo che. Nếu giữ nút chính ở đáy màn hình, không che dữ liệu, lỗi hoặc vùng điều hướng của thiết bị.
- Số container, loại container, biển số và số tiền giữ nguyên từng cụm; có thể xuống dòng giữa các cụm, không ngắt từng ký tự. Tên dài vẫn đọc được bằng chạm/bàn phím, không chỉ xem được khi rê chuột.
- Người dùng bàn phím và công cụ đọc màn hình nhận biết được từng trường, nút và trạng thái mở/đóng. Lỗi nằm sát trường cần sửa; vị trí đang điều khiển luôn rõ.
- Khi thu gọn/đổi tab/quay lại danh sách, giữ ngữ cảnh công việc phù hợp. Trạng thái mạng và lỗi không được chiếm toàn bộ màn hình hoặc lặp lại thành nhiều thông báo giống nhau.

## 7. Tiêu Chí Nghiệm Thu

1. Kiểm tra cùng một bộ dữ liệu ở điện thoại, máy tính bảng và máy tính: nhà máy trước tuyến trên thẻ; đủ thao tác, cảng, số–loại; tên dài không vỡ mã hoặc che hành động.
2. Lô nhiều container tạo đúng số phần việc FCL; container thiếu số vẫn hiện loại; LCL đi qua tạo, phân xe, phát lệnh, nhận lệnh và đọc lại mà không có container giả.
3. Chi tiết giữ nhà máy–địa chỉ–liên hệ cùng nhóm; tiêu đề hóa đơn đứng trước đúng bên; hàng nhập phân biệt nơi giao hàng với nơi trả vỏ.
4. Nhiệm vụ viết hoa và ghi chú riêng; sửa ghi chú giữ khoảng trắng/xuống dòng có nghĩa, không biến toàn bộ ghi chú thành chữ hoa.
5. Nhận lệnh, chặn xe bận, KẸP, thứ tự KẾT HỢP và phân lại cho kết quả đúng, có chỉ dẫn xử lý rõ, không bỏ qua quyền hoặc ràng buộc vận hành.
6. Ảnh container/chì/e-POD đọc được; ảnh đã lưu mở xem được; thất bại một phần, phản hồi bị mất, thay/xóa ảnh và thử lại không tạo bản sao hoặc mất ảnh đã xác nhận.
7. Mất mạng không có thao tác ghi, trạng thái thành công giả hoặc tự phát lại khi có mạng. Sau khi đọc lại, người dùng chủ động tiếp tục được trên dữ liệu mới.
8. Với FCL, sau nhận lệnh thủ công và đủ hai nhóm e-POD đã lưu, một thao tác hoàn thành gửi hồ sơ và suy ra các mốc sau nhận còn thiếu. Không thêm bước nhập mốc thủ công hoặc phê duyệt; mốc suy ra không mang nghĩa quan sát thực tế/GPS. Kiểm tra tổng hợp trạng thái lô nhiều công việc và làm mới các vai trò liên quan.
9. Lái xe chụp/chọn, xem, thay và xóa ảnh được trên điện thoại phù hợp; chứng từ vẫn đọc rõ. Các thao tác chính dùng được bằng bàn phím trên máy tính, thông báo lỗi đọc được và bàn phím ảo không che nút cần dùng.
10. Thu nhập hiển thị đúng tài khoản và kỳ, phân biệt tạm tính/đã chốt/đã trả; Kỷ luật thể hiện lý do, ngày, ảnh hưởng và loại biên bản đã hủy khỏi khấu trừ hiện hành. Tài khoản hiển thị đúng danh tính/xe, chỉ sửa theo quyền và không lộ dữ liệu tài khoản trước sau đăng xuất hoặc đổi người đăng nhập.

## 8. Chi phí lái xe

**Nguồn:** `các chi phí.docx`, phần chi phí lái xe, cập nhật 16/09/2026. Lái xe cần khai báo tại đúng công việc và xem lại kết quả. Không phải dùng màn quản trị hay nhập lại thông tin lô, xe và tài xế đã có.

Giữ nguyên phụ cấp tiền đường và ca đã thỏa thuận. Phần cầu đường dùng ước tính khi chưa có số thực tế đã đối chiếu; khi có thì số thực tế thay phần ước tính, không cộng thêm cả hai. Ví dụ ước tính 100.000đ, vé đối chiếu 80.000đ: tổng giảm 20.000đ, phụ cấp không đổi. Phát sinh riêng chỉ tính một lần; công việc kẹp/kết hợp dùng chung nguồn phí, không nhân theo số container. Điều chỉnh/hủy đối chiếu cập nhật theo nguồn còn hiệu lực và giữ lịch sử.

### 8.1 Nhóm chi phí

| Nhóm | Loại phí | Quy tắc thu khách và thanh toán |
|---|---|---|
| Chi phí lô hàng có hóa đơn | Nâng, hạ, vệ sinh, lưu bãi, lưu kho và phí có hóa đơn khác | Mặc định thu khách, có số hóa đơn; kế toán đối chiếu và đưa đúng khoản vào chi hộ phải thu, không tự đánh dấu khách đã trả |
| Chi phí lô hàng không hóa đơn | Công nhân tại kho, hàn container, cân lốp, đảo vỏ, đóng/trả hai điểm, đảo hàng, xe nâng/hạ Đăng Khoa và tên phí tự nhập | Công ty chịu, không thu khách; theo dõi chi phí xe và khoản cần thanh toán cho người thực chi; có thể có phiếu thu/biên lai viết tay |
| Tiền đường | Tiền tuyến, vé cầu đường, phụ cấp phát sinh và sửa chữa dọc đường | Không thu khách; theo dõi trong tiền đường để kế toán đối chiếu/thanh toán và tính chi phí xe |

Mỗi khoản có ngày chi, công việc, nhóm/tên phí, số tiền thực tế, người trả tiền, hóa đơn nếu có, ảnh/chứng từ và ghi chú. Lái xe chỉ khai báo trong công việc của mình; không được tự thay đổi số thu khách hoặc ghi đã thanh toán từ quỹ công ty. Kế toán được sửa số sai khi còn điều kiện, có lý do và lịch sử.

### 8.2 Mức tham chiếu và nhập thực tế

| Khoản | Mức trong yêu cầu khách hàng |
|---|---:|
| Phụ cấp làm nâng/hạ Lạch Huyện, TIL, Hateco | 50.000đ |
| Trả đêm | 100.000đ |
| Chạy hàng quay đầu | 100.000đ |
| Chạy quá tải | 200.000đ |
| Đảo chuyển ICD/Đăng Khoa | 200.000đ |
| Chạy chủ nhật | 200.000đ |
| Lưu ca | 200.000đ |
| Container 45’HC hoặc container lạnh | 200.000đ |

Đây là mức gợi ý khi người dùng chọn khoản phát sinh thực tế; không tự phát sinh tiền chỉ vì tên cảng, thứ trong tuần hoặc loại container trùng điều kiện. Phụ cấp 50.000đ khác với phí nâng/hạ có hóa đơn. Cách tính theo lượt/chuyến/container/ngày và cộng dồn trong kẹp/kết hợp phải theo định mức được cấu hình rõ; không tự nhân theo số dòng container. Tiền tuyến, soi, kiểm hóa và sửa chữa chưa có giá trong tài liệu phải nhập thực tế hoặc theo định mức đã xác định, không tự đặt giá 0.

### 8.3 Tiêu chí nghiệm thu

| Mã | Tình huống và kết quả cần đạt |
|---|---|
| AC-CP-LX-01 | Lái xe mở khai báo chi phí từ chuyến được giao; thông tin lô/xe/tài xế đúng, chọn được chi phí lô hoặc tiền đường; lưu và mở lại được trên điện thoại. |
| AC-CP-LX-02 | Phí nâng có hóa đơn 500.000đ xuất hiện đúng nhóm chi hộ lô; số hóa đơn đọc được; ghi nhận/đối chiếu không đồng nghĩa đã thu khách hay đã trả lái xe. |
| AC-CP-LX-03 | Chi công nhân 100.000đ không hóa đơn giữ phiếu thu nếu có, không tạo phải thu khách, được tính vào chi phí xe đúng một lần. |
| AC-CP-LX-04 | Ước tính cầu đường 100.000đ, thực tế đối chiếu 80.000đ thì tổng giảm 20.000đ, không đổi phụ cấp; điều chỉnh/đảo giữ nguồn và không cộng trùng. Vé cầu đường/sửa đèn/vá lốp được nhập số tiền và chứng từ thực tế; xuất hiện trong tiền đường và khoản thanh toán lái xe, không vào debit khách. |
| AC-CP-LX-05 | Chọn trả đêm gợi ý 100.000đ, quá tải gợi ý 200.000đ; người dùng biết là mức gợi ý, chưa lưu thì chưa tạo chi phí; kế toán điều chỉnh có lý do. |
| AC-CP-LX-06 | Thiếu định mức tuyến/soi/kiểm hóa được báo rõ và cho ghi thực tế theo quyền; không hiển thị đã tính đủ bằng 0đ. |
| AC-CP-LX-07 | Phụ cấp 50.000đ và phí nâng có hóa đơn là hai loại khác nhau; kẹp/kết hợp không tự tạo hai khoản giống nhau vì có hai dòng công việc. |
| AC-CP-LX-08 | Khoản do công ty trả trực tiếp không đồng thời trở thành tiền phải hoàn cho lái xe; phân biệt người ghi và người thực chi. |
| AC-CP-LX-09 | Bấm lưu hai lần/thử lại sau mất phản hồi chỉ có một khoản; ảnh lỗi cho bổ sung trên khoản đã có, không phải ghi tiền lại. |
| AC-CP-LX-10 | Không thêm/sửa tiền ngoài phân công hoặc kỳ khóa; chuyến hủy không tạo khoản mới. Thiếu đối chiếu chi phí không chặn hoàn thành vận chuyển khi đủ điều kiện giao nhận. |

## 9. Điểm Còn Cần Làm Rõ

- Bộ chứng từ bắt buộc phù hợp với công việc LCL, thay cho phiếu hạ container; không áp đặt yêu cầu ảnh container khi không có container.
- Khi có nhiều người liên hệ hoặc bên xuất hóa đơn hợp lệ, cần thống nhất bên nào được sử dụng cho từng công việc và loại phí.

Các điểm này cần được làm rõ với người phụ trách nghiệp vụ trước khi xác định yêu cầu chi tiết.

### Kết nối và thử lại

Ứng dụng gửi yêu cầu nghiệp vụ bình thường; nếu backend không khả dụng thì báo lỗi API và giữ nội dung chưa lưu trong màn hình để người dùng thử lại. Không heartbeat, kiểm tra sức khỏe trước thao tác hoặc tự gửi lại mutation khi mạng phục hồi.

- Chi phí trên chuyến đang tồn tại nhưng chưa gắn lô hàng vẫn nhập và xem lại được theo quyền hiện hành. Chỉ liên kết sổ đối chiếu lô khi có lô thật; không tạo lô/chuyến giả và không mất người chi, chứng từ hoặc số tiền đã nhập.
