# Master Data: Khách Hàng — Nhà Máy — Tuyến Đường — Vị Trí

**Dự án:** TTransport — Silver Sea

**Nguồn nghiệp vụ:** `2026.9.6_Logic_nghiep_vu.docx` — Phần 1 và yêu cầu bổ sung về tên nhà máy, địa chỉ, liên hệ và thông tin xuất hóa đơn.

**Liên quan:** [Tổng quan PRD](README.md), [Quy trình O2C](QuyTrinhO2C.md), [Màn hình lái xe](ManHinhLaiXe.md).

CUS và Điều vận cần chọn đúng khách hàng, nhà máy và địa điểm khi lập công việc. Lái xe và Ops cần biết chính xác nơi làm hàng cùng người liên hệ. Người quản lý danh mục cần cập nhật thông tin thuận tiện, còn Kế toán cần phân biệt đúng khách hàng và các bên xuất hóa đơn.

## 1. Hai Luồng Tạo Lô

| Luồng | Phạm vi | Quy tắc chính |
|-------|---------|---------------|
| Luồng chuẩn | Khách hàng và nhà máy thuộc danh mục | Chọn khách hàng → chọn nhà máy của khách hàng → điền tuyến và vị trí theo nhà máy |
| Lệnh chạy ngoài | Cuốc vãng lai để tối ưu xe rỗng | Cho phép thông tin riêng của công việc và không bắt buộc có định mức cước; vẫn giữ phân quyền và các điều kiện hợp lệ khác |

Lựa chọn **Lệnh chạy ngoài (Tối ưu xe rỗng)** ở đầu form phân biệt hai luồng. Cho phép thông tin ngoài danh mục không có nghĩa tự thêm danh mục hoặc bỏ kiểm tra dữ liệu.

App cần Internet để xem danh mục hiện hành và lưu thay đổi. Người được phân quyền tạo/sửa danh mục thao tác trực tiếp, không qua phê duyệt nội bộ. Người chỉ được lập công việc không tự có thêm quyền quản lý danh mục. Lịch sử thay đổi phải cho biết ai đã sửa, sửa nội dung gì và khi nào.

## 2. Quan Hệ Và Thông Tin Cần Quản Lý

### 2.1 Khách Hàng, Nhà Máy, Tuyến Và Vị Trí

- Một khách hàng có thể có nhiều nhà máy.
- Mỗi nhà máy thuộc một khách hàng, có một vị trí đóng/trả hàng và một tuyến vận chuyển được cấu hình. Nhiều nhà máy có thể cùng thuộc một tuyến.
- Trong luồng chuẩn, tuyến và vị trí lấy theo nhà máy đã chọn. Không cho chọn một tuyến khác trái với tuyến nhà máy đã cấu hình.
- Hai nhà máy có cùng tên ngắn vẫn là hai nhà máy riêng; người dùng phải phân biệt được bằng tên đầy đủ, khách hàng hoặc địa chỉ.
- Nhà máy và kho là các loại địa điểm khác nhau. Quy tắc tuyến cố định của nhà máy không mặc nhiên áp dụng cho mọi địa điểm khác.

### 2.2 Phạm Vi Trong Lô Nhiều Container

Một lô hàng nguồn có thể gồm nhiều container. Nhà máy, tuyến và vị trí phải thuộc đúng công việc của từng container. Các container trong cùng lô có thể làm hàng tại các nhà máy hoặc tuyến khác nhau; không ép cả lô dùng chung một tuyến.

Cảng nâng, cảng hạ và nơi trả vỏ cũng thuộc đúng công việc. Với hàng nhập, nơi giao hàng tại nhà máy khác với nơi trả vỏ: **Cảng hạ** trên thông tin lái xe là nơi trả vỏ của công việc, không được thay bằng địa chỉ nhà máy.

Với LCL, lưu và hiển thị địa điểm, lịch cùng thông tin công việc hàng lẻ mà không cần container. Trường bắt buộc phải phù hợp với loại hàng; không yêu cầu container giả để nhập tuyến hoặc lịch.

### 2.3 Dữ Liệu Hiển Thị Của Nhà Máy

| Nhóm | Yêu cầu |
|------|---------|
| Tên | Có tên đầy đủ và tên ngắn riêng. Thẻ/danh sách ưu tiên tên ngắn; thiếu tên ngắn thì dùng tên đầy đủ. Chi tiết đọc được tên đầy đủ |
| Địa chỉ và tuyến | Có nhãn riêng; không dùng địa chỉ đường phố làm tên tuyến hoặc nhãn “Tuyến” cho địa chỉ |
| Liên hệ vận hành | Tên người liên hệ và **Số điện thoại liên hệ** nằm cùng nhóm, ngay dưới địa chỉ nhà máy; có thể gọi điện từ app |
| Thông tin xuất hóa đơn | Giữ đúng tên, địa chỉ, mã số thuế của bên xuất hóa đơn nâng, hạ, vệ sinh; không gộp những bên khác nhau |
| Quy định tại điểm làm hàng | Giữ nội dung chỉ dẫn cho lái xe; không trộn với danh sách tác vụ hoặc đổi toàn bộ ghi chú thành chữ hoa |

Nhà máy, khách hàng và bên xuất hóa đơn không thay thế cho nhau. Nếu thiếu thông tin của một bên, phải thể hiện rõ phần thiếu; không mượn thông tin của bên khác. Tiêu đề từng bên đứng trước tên, địa chỉ và mã số thuế của chính bên đó.

Không lặp cùng người và số điện thoại ở nhiều dòng với nhãn khác nhau. Nếu có nhiều người liên hệ thực sự khác vai trò, giữ thông tin riêng và ghi rõ vai trò.

### 2.4 Thông Tin Hiện Hành Và Lịch Sử

Thông tin danh mục mới được dùng cho công việc lập mới. Sửa tên, địa chỉ, liên hệ hoặc bên xuất hóa đơn trong danh mục không tự thay đổi công việc đã hoàn thành hoặc hồ sơ tài chính đã phát hành. Những hồ sơ này phải giữ thông tin nhận diện, địa chỉ và bên xuất hóa đơn đã sử dụng để người dùng tra cứu, giải thích và đối chiếu lịch sử.

Với công việc đang thực hiện, kể cả lệnh đã phát hoặc lái xe đã nhận, thay đổi cần thiết phải do người có quyền chủ động cập nhật. Trước khi lưu, người đó thấy rõ thông tin cũ và mới cùng công việc bị ảnh hưởng. Sau khi lưu, giữ lịch sử ai thay đổi, nội dung và thời điểm; thông báo cho lái xe/Ops bị ảnh hưởng để họ biết hướng thực hiện mới.

Không âm thầm đổi tuyến, địa điểm làm hàng hoặc bên xuất hóa đơn do một lần sửa danh mục. Việc điều chỉnh hồ sơ tài chính đã phát hành thực hiện theo quy tắc tài chính tương ứng, không bằng cách sửa ngầm danh mục. Nhà máy đổi tên hoặc ngừng hoạt động vẫn phải tra cứu được trong công việc cũ.

## 3. Giao Diện Luồng Chuẩn

Áp dụng khi không bật **Lệnh chạy ngoài** trên form của CUS hoặc Điều vận có chọn nhà máy.

### 3.1 Chọn Theo Quan Hệ Khách Hàng — Nhà Máy

1. Chọn khách hàng.
2. Xem các nhà máy còn được sử dụng của khách hàng đó.
3. Chọn nhà máy cho đúng container/công việc.
4. Xem tuyến và vị trí được điền theo nhà máy; thông tin đã cấu hình không cho sửa tùy ý trên công việc. Ngoại lệ nhà máy cũ thiếu tuyến theo §3.2.

Chưa chọn khách hàng thì chưa thể chọn nhà máy. Khi đổi khách hàng, không giữ nhà máy cũ nếu không còn hợp lệ; chỉ rõ trường cần chọn lại. Danh sách đang tải hoặc tìm kiếm trước đó không được làm mất lựa chọn mới nhất của người dùng.

Tuyến/vị trí không cho sửa vẫn phải có nhãn và dễ đọc. Khi cần, dùng chỉ dẫn ngắn **Theo nhà máy** để giải thích; không chỉ dùng màu xám khiến người dùng không biết vì sao không sửa được.

### 3.2 Dữ Liệu Thiếu Và Không Còn Hoạt Động

| Tình huống | Hành vi cần có |
|------------|----------------|
| Nhà máy cũ chưa cấu hình tuyến | Cho chọn tuyến hợp lệ cho công việc và chỉ rõ nhà máy còn thiếu cấu hình. Không phát lệnh nếu tuyến bắt buộc vẫn chưa có. Người có quyền có thể bổ sung danh mục riêng |
| Khách hàng chưa có nhà máy | Giải thích danh sách rỗng, có tạo nhanh khi người dùng đủ quyền; không đưa nhà máy của khách hàng khác vào thay |
| Nhà máy ngừng hoạt động | Không chọn cho công việc mới; công việc cũ vẫn xem được nhà máy đã sử dụng |
| Danh mục đang tải hoặc tải lỗi | Phân biệt với danh sách rỗng, giữ nội dung đang nhập và cho thử lại |
| Người khác sửa thông tin trong lúc đang nhập | Giữ nội dung đang làm, hiển thị thay đổi liên quan để người dùng đối chiếu trước khi tiếp tục; không âm thầm ghi đè |

Ngoại lệ chọn tuyến chỉ dành cho nhà máy cũ **chưa có tuyến cấu hình**. Tuyến chọn thuộc công việc hiện tại, không tự sửa danh mục nhà máy và không cho ghi đè tuyến đã cấu hình. Nhà máy tạo mới phải có tuyến; việc sửa danh mục là thao tác riêng của người có quyền.

### 3.3 Tạo Nhanh Danh Mục

Người có quyền được tạo nhanh khách hàng, nhà máy hoặc danh mục liên quan ngay khi lập công việc. Tạo nhanh là thêm mục dùng chung thật sự, khác với nhập tên riêng cho lệnh chạy ngoài.

Sau khi lưu thành công, mục mới xuất hiện ngay trong danh sách lựa chọn và có thể dùng tiếp mà không tải lại cả trang. Nếu chưa lưu được, giữ nội dung để sửa hoặc thử lại; không hiển thị như đã tạo thành công.

Lỗi nằm trong form đang mở, sát trường cần sửa và đọc được khi hộp thoại mở. Người dùng bàn phím được đưa đến vị trí cần xử lý; không phải đóng form mới thấy lỗi.

## 4. Lệnh Chạy Ngoài

**Bản chất nghiệp vụ.** Lệnh chạy ngoài là những lô/con hàng **không do SilverSea tạo ra**, mà đi xin từ bên ngoài để tránh xe chạy rỗng trong những hôm không đủ lệnh hoặc đoạn chạy xa nhà. Đây là **một dạng lô hàng đặc biệt**:

- Doanh thu chỉ gồm **cước do khách báo giá** và **các phí chi hộ** — không áp bảng định mức cước nội bộ.
- Là lô đặc biệt được **bỏ qua nhiều thao tác hoặc chi phí** không áp dụng; danh sách bước bỏ qua cụ thể cần chốt lại với nghiệp vụ khi triển khai.
- Vẫn là lô hàng đầy đủ về quy trình vận hành (xem các mục dưới): chỉ nới phần thuộc danh mục và định mức, không nới chất lượng dữ liệu và phân quyền.

### 4.1 Lựa Chọn Và Phạm Vi Áp Dụng

Lựa chọn **Lệnh chạy ngoài (Tối ưu xe rỗng)** mặc định tắt và nằm ở vị trí dễ thấy đầu form.

- Khi bật, cho nhập thông tin ngoài danh mục cùng tuyến/vị trí phù hợp với lô; không bắt buộc có định mức cước phí mới lưu được.
- Khi tắt, trở lại luồng chuẩn. Nếu còn thông tin riêng không hợp lệ với luồng chuẩn, chỉ rõ trường cần chọn lại từ danh mục trước khi lưu.
- Bật/tắt không âm thầm xóa nội dung đã gõ. Mở lại công việc phải thấy đúng lựa chọn và thông tin đã lưu.
- Vẫn kiểm tra quyền, trường bắt buộc, ngày, số lượng, số tiền và định dạng container phù hợp với công việc. Không dùng số container tùy ý hoặc container giả để vượt điều kiện.

### 4.2 Chọn Danh Mục Hoặc Nhập Thông Tin Riêng

Khách hàng, nhà máy, tuyến và cảng nâng/hạ có thể được chọn từ danh mục hoặc nhập riêng cho công việc khi chạy ngoài.

| Cách nhập | Ý nghĩa với người dùng | Tác động danh mục |
|----------|------------------------|-------------------|
| Chọn từ danh sách | Dùng đúng khách hàng/nhà máy/tuyến/cảng đã có | Không thêm mục mới |
| Nhập thông tin riêng | Dùng tên và thông tin chỉ dành cho công việc này | Không tự thêm danh mục |
| Chọn **+ Tạo mới** | Tạo mục có thể sử dụng chung sau khi lưu thành công | Chỉ thực hiện khi có quyền và đủ thông tin bắt buộc |

Quy tắc:

1. Mỗi trường thể hiện rõ đang dùng một mục danh mục hay thông tin riêng. Không hiển thị một tên nhưng sử dụng một lựa chọn khác còn sót lại; trường bắt buộc không được bỏ trống.
2. Có thể phối hợp thông tin riêng và danh mục, ví dụ khách hàng nhập riêng cùng cảng đã có. Quan hệ của các mục đã chọn vẫn phải hợp lệ; không gán nhà máy của khách hàng khác.
3. Nhập thông tin riêng không tự thêm khách hàng, nhà máy, tuyến hoặc cảng vào danh mục.
4. Nếu không chọn nhà máy có sẵn, dùng địa điểm/tuyến riêng đã nhập; không lấy thông tin của một nhà máy khác thay thế.
5. Tên đã lưu phải đọc lại được trên các màn hình liên quan. Không bỏ trống, hiện mã lỗi hoặc gộp các lô riêng biệt vì cùng không dùng danh mục.
6. Cảng và địa điểm vẫn thuộc đúng container/công việc trong lô nhiều container.

### 4.3 Tìm Kiếm Và Thao Tác Bàn Phím

- Bấm để xem danh sách, gõ để tìm; không phân biệt hoa/thường hoặc dấu tiếng Việt.
- Khi luồng cho phép nhập riêng, tên chưa có trong danh mục không bị mất khi chuyển sang trường khác, bấm ngoài hoặc nhấn Esc.
- Dùng phím mũi tên để duyệt, Enter để chọn mục đang được chỉ đến. Khi không chọn mục danh mục, có thể dùng Enter để xác nhận tên riêng hợp lệ.
- Chỉ dẫn ngắn phân biệt thông tin danh mục và thông tin riêng; người dùng không hiểu nhầm rằng tên vừa gõ đã tạo mục dùng chung.
- **+ Tạo mới** là hành động riêng và vẫn dùng được theo quyền khi bật chạy ngoài.
- Người dùng công cụ đọc màn hình nhận biết được tên trường, mục đang chọn và kết quả tìm kiếm.

### 4.4 Sử Dụng Thông Tin Ở Các Phân Hệ

| Phân hệ | Yêu cầu |
|---------|---------|
| Danh sách và chi tiết lô | Giữ đúng tên đã lưu và phân biệt từng lô. Có nhãn **Chạy ngoài** gọn ở vị trí nhận diện lô để phân biệt với lệnh chuẩn; danh sách cho lọc riêng lệnh chạy ngoài khi cần |
| Điều vận | Phân xe và phát lệnh được cho lô chạy ngoài hợp lệ; không chặn chỉ vì khách hàng hoặc nhà máy không thuộc danh mục |
| Lái xe và Ops | Có đủ địa điểm, tuyến và liên hệ cần thiết theo công việc đã giao |
| Kế toán/công nợ | Không tự gộp lô nhập riêng vào khách hàng danh mục chỉ vì trùng tên; vẫn nhận diện được công việc để đối soát |
| Báo cáo | Nhận diện được nhóm chạy ngoài và giữ tên đã nhập, không làm mất hoặc trộn lô |
| Danh mục | Chỉ tăng số mục khi người có quyền thực hiện **+ Tạo mới**, không tăng khi chỉ lưu thông tin riêng |

Nhãn **Chạy ngoài** xuất hiện một lần tại vị trí nhận diện phù hợp của mỗi lô, không lặp cạnh mọi trường. Bộ lọc và chi tiết dùng cùng ý nghĩa với lựa chọn chạy ngoài đã lưu.

Đối soát công nợ phải giữ đúng chủ thể và công việc. Không thêm bước phê duyệt nội bộ cho lô chạy ngoài; các quy tắc công nợ và xuất hóa đơn áp dụng theo nghiệp vụ tương ứng.

## 5. Yêu Cầu Giao Diện Dùng Chung

Danh mục nhiều dữ liệu cần tìm kiếm thuận tiện và xem được nhiều bản ghi hữu ích. Máy tính giữ bảng gọn; máy tính bảng và điện thoại ưu tiên tên, khách hàng, địa điểm và hành động cần dùng, mở thông tin phụ khi cần. Tránh một bản ghi biến thành nhiều hàng cao hoặc có hàng trống cho dữ liệu không tồn tại.

Form khách hàng/nhà máy/tuyến có nhãn và nút rõ, các trường liên quan đặt gần nhau. Trên điện thoại, dùng đủ chiều rộng và chuyển trường thành một cột khi hai cột quá hẹp. Tránh lề cộng dồn, thẻ trang trí lồng nhau, tiêu đề quá lớn hoặc khoảng trắng làm người dùng cuộn nhiều.

Tên dài, số điện thoại và mã nhận diện vẫn đọc được. Nút dễ chạm, không chồng nhau; thao tác dùng được bằng bàn phím, vị trí đang điều khiển rõ. Khi mở bàn phím ảo, người dùng vẫn xem được lỗi, đóng form hoặc lưu mà không mất nội dung.

Mất kết nối phải báo rõ chưa thể lưu, giữ nội dung đang làm trên màn hình và cảnh báo nếu rời trang sẽ làm mất phần chưa lưu. Khi có mạng, người dùng chủ động tiếp tục. Nếu chưa biết lần lưu trước đã thành công hay chưa, hệ thống cần làm rõ kết quả trước khi thử lại để tránh tạo mục trùng. Không có chế độ làm việc ngoại tuyến hoặc tự gửi lại thao tác.

## 6. Tiêu Chí Nghiệm Thu

1. Chọn khách hàng chỉ thấy nhà máy hợp lệ của khách hàng đó; đổi khách hàng không giữ nhà máy cũ sai quan hệ. Việc tìm kiếm hoặc tải danh sách không làm mất lựa chọn mới nhất.
2. Luồng chuẩn điền đúng tuyến/vị trí của từng nhà máy. Một lô có hai container tại hai nhà máy khác nhau vẫn giữ đúng tuyến và địa điểm của mỗi công việc.
3. Nhà máy cũ thiếu tuyến cho phép chọn tuyến hợp lệ riêng cho công việc; không phát lệnh khi còn thiếu, không sửa ngầm danh mục và không ghi đè tuyến đã có. Tạo nhà máy mới phải có tuyến.
4. Nhà máy ngừng hoạt động, danh sách rỗng, đang tải và lỗi tải có thông báo khác nhau cùng bước xử lý phù hợp. Công việc cũ vẫn xem được nhà máy đã sử dụng.
5. Tên ngắn, tên đầy đủ, địa chỉ, liên hệ và thông tin xuất hóa đơn đúng chủ thể. Chi tiết lái xe giữ thứ tự và nhãn theo [Màn hình lái xe](ManHinhLaiXe.md), không lấy khách hàng thay cho nhà máy thiếu thông tin.
6. Lệnh chạy ngoài mặc định tắt; bật/tắt giữ nội dung đang nhập và áp dụng đúng quy tắc. Lô đủ thông tin hợp lệ vẫn lưu được khi chưa có định mức cước.
7. Chọn danh mục hoặc nhập riêng rồi mở lại đều giữ đúng thông tin. Phối hợp hai cách nhập không làm sai quan hệ hoặc tự tăng danh mục. Người không có quyền quản lý danh mục không thể dùng tạo nhanh để thêm mục.
8. Tạo nhanh thành công thì chọn được ngay. Lỗi, gián đoạn hoặc thử lại không tạo mục trùng, không làm mất bản nháp và không báo thành công sai.
9. Lô chạy ngoài hợp lệ đi qua lập lô, phân xe, phát lệnh và được CUS, Điều vận, lái xe, Ops đọc đúng tên/địa điểm. LCL đi qua công việc phù hợp mà không có container giả; hàng nhập phân biệt điểm giao với nơi trả vỏ.
10. Danh mục, tìm kiếm và form dùng được trên điện thoại, máy tính bảng và máy tính với nhiều bản ghi, tên dài và bàn phím. Người có quyền thao tác trực tiếp khi có Internet, không có phê duyệt nội bộ hoặc tự gửi lại sau mất mạng.
11. Sửa danh mục áp dụng cho công việc mới; công việc hoàn thành và hồ sơ tài chính đã phát hành giữ đúng thông tin đã sử dụng. Cập nhật công việc đang thực hiện là thao tác chủ động theo quyền, xem được nội dung cũ/mới, có lịch sử và thông báo đến lái xe/Ops liên quan.
12. Danh sách và chi tiết nhận diện gọn lệnh chạy ngoài, lọc ra đúng các lệnh đã chọn chạy ngoài và không lặp nhãn cạnh từng trường.

## 7. Câu Hỏi Nghiệp Vụ Còn Mở

Khi một công việc hoặc loại phí có nhiều người liên hệ hay bên xuất hóa đơn cùng hợp lệ, cần thống nhất bên nào được sử dụng và người dùng cần thấy những lựa chọn nào. Trong khi chưa rõ, phải thể hiện các bên theo đúng vai trò đã biết và chỉ rõ phần cần bổ sung; không lấy thông tin của bên khác để che phần thiếu.
