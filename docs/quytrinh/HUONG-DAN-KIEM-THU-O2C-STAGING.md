# HƯỚNG DẪN KHÁCH HÀNG KIỂM THỬ O2C TRÊN STAGING

**Mục đích:** Hướng dẫn nhóm khách hàng tự chạy một luồng Order-to-Cash (O2C) hoàn chỉnh trên môi trường staging, từ tạo lô hàng đến Debit Note, công nợ và xác nhận trên cổng khách hàng.

**Môi trường:** [https://vantai.tingting.vip/](https://vantai.tingting.vip/)  
**Không dùng môi trường production.** Mật khẩu được nhận qua kênh bảo mật đã được phê duyệt; không chép mật khẩu vào bảng kết quả, ảnh chụp hoặc tài liệu này.

## 1. Kết luận sẵn sàng về tài khoản

Tám tài khoản staging dưới đây đã được cấp đúng vai trò và đăng nhập thành công (xác nhận 2026-08-03). Toàn bộ vai trò O2C đã sẵn sàng; không còn case nào bị BLOCKED vì thiếu tài khoản.

| Tài khoản staging | Vai trò | Việc thực hiện trong đợt test | Trạng thái dùng cho O2C |
| --- | --- | --- | --- |
| `admin` | ADMIN | Hỗ trợ kỹ thuật hoặc xử lý ngoại lệ được phê duyệt; không nằm trong bước chốt O2C chuẩn | Không dùng để thay vai trò nghiệp vụ |
| `giamdoc` | MANAGER | Xem đối soát P&L và hỗ trợ xử lý ngoại lệ được phê duyệt | Không cần cho bước chốt O2C chuẩn |
| `ketoan` | ACCOUNTANT | Duyệt chi phí, e-POD/POD giấy, chọn VAT, bấm Hoàn thành, tạo Debit Note, kiểm tra AR/AP/P&L | Có |
| `cus` | CLERK / CUS | Tạo FCL/LCL và gửi sang Điều phối | Có |
| `dieuvan` | DISPATCHER | Tiếp nhận, gán xe/tài xế và phát lệnh | Có |
| `giaonhan` | FORWARDER / Ops | Khai báo phí nâng/hạ và các phạm vi chi phí | Có |
| `laixe`, `thu`, `quyet`, `pho` | DRIVER | Nhận lệnh, cập nhật mốc chuyến, chi phí, ảnh và e-POD | Có (mỗi tài xế gán 1 xe) |
| `customer` | CUSTOMER | Chỉ xác nhận dữ liệu của khách hàng trên cổng khách hàng | Có, bước xác nhận cuối |

Không dùng `admin` để giả lập CUS, Điều phối, Ops, Driver hoặc Customer. Nếu một tài khoản đăng nhập được nhưng không thấy đúng màn hình/hành động của role, ghi **BLOCKED** và dừng tại bước đó.

## 2. Chuẩn bị trước khi bắt đầu

1. Chỉ định một người điều phối đợt test và sáu đến tám người dùng tương ứng bảng trên. Mỗi người dùng một cửa sổ ẩn danh hoặc trình duyệt riêng; luôn đăng xuất trước khi đổi vai trò.
2. Có phê duyệt tạo dữ liệu staging và một khách hàng/dữ liệu **dedicated** cho đợt test. Không dùng dữ liệu thật, không sửa hoặc hủy dữ liệu của đợt khác.
3. Tạo mã đợt chạy: `MAN-O2C-YYYYMMDD-HHMM-<VIET_TAT>`; dùng mã này trong Booking, BL, ghi chú và tên file.
4. Kiểm tra trước với người quản trị dữ liệu: có khách hàng, tuyến đường, bảng giá cước, định mức và giá dầu, xe nhà, xe ngoài, tài xế, nhà cung cấp, bảng giá nâng/hạ cảng/bãi. Thiếu bất kỳ dữ liệu nào thì ghi **BLOCKED**, không tự tạo dữ liệu nền ngoài phạm vi được phê duyệt.
5. Chuẩn bị hai lô riêng:
   - **FCL:** Booking/BL có mã đợt chạy, hai container và hai seal khác nhau; sẽ đi bằng xe nhà.
   - **LCL:** Booking/BL có mã đợt chạy, có bao bì, số lượng, kg và CBM; sẽ đi bằng xe ngoài.
   - File minh chứng: ảnh nhiên liệu, container, seal. Chuẩn bị **ba cặp** e-POD: hai cặp cho hai fulfillment/container FCL và một cặp cho chuyến LCL. Mỗi cặp gồm một ảnh phiếu bãi/phiếu hạ và một PDF biên bản giao nhận có ký; tổng cộng **sáu file bắt buộc**.
6. Mở một bảng ghi nhận gồm: mã đợt chạy, người thao tác, thời gian, mã lô/chuyến/chứng từ, trạng thái trước-sau, ảnh chụp và kết quả PASS/FAIL/BLOCKED.

## 3. Phân công và luồng chạy liên phòng ban

| Thứ tự | Người đăng nhập | Hành động phải hoàn tất | Bàn giao cho |
| ---: | --- | --- | --- |
| 1 | CUS (cần cấp) | Tạo lô FCL và LCL; kiểm tra cước/fuel tự tính, chỉ đọc; gửi sang Điều phối | Dispatcher |
| 2 | Dispatcher (cần cấp) | Tiếp nhận; rã FCL thành hai phần việc; FCL gán xe nhà, LCL gán xe ngoài; phát lệnh | Driver |
| 3 | `laixe` | Nhận lệnh, chạy đủ bốn mốc, ghi chi phí/nhiên liệu/container/seal, gửi đủ hai file e-POD cho từng fulfillment/chuyến | Ops và Accountant |
| 4 | `giaonhan` | Nhập phí nâng/hạ, chi phí có/không hóa đơn, hoàn tất từng phạm vi chi phí | Accountant và Driver |
| 5 | `ketoan` hoặc CUS | Duyệt chi phí, kiểm e-POD/POD giấy, chọn VAT và bấm Hoàn thành | Accountant |
| 6 | `ketoan` → `giamdoc` | Tạo/xuất Debit Note; đối chiếu AR, AP và P&L | Customer |
| 7 | `customer` | Xác nhận chỉ thấy đúng dữ liệu của khách hàng test và chứng từ liên quan | Người điều phối đợt test |

## 4. Các bước thao tác chi tiết

### Bước 1 — CUS tạo hai lô và bàn giao

1. Đăng nhập tài khoản CUS, mở **Tạo lô hàng mới** (`/shipments/new`).
2. Tạo lô FCL với Booking/BL có mã đợt chạy, hai dòng container. Có thể để trống số container; nhập ngày giao dự kiến riêng theo từng container. Bấm **Tạo lô hàng**, kiểm tra lại sau khi mở lại lô.
3. Tạo lô LCL đối chứng với đầy đủ bao bì, số lượng, kg, CBM và ghi chú.
4. Form tạo lô chỉ thu thập dữ liệu vận hành (Booking/BL, container/seal, tuyến, ngày); không có trường giá để nhập tay. Ngay khi tạo lô, hệ thống phải tự áp mã tính cước theo bảng giá. Kế toán/CUS nhập tham số **giá dầu hiện tại** theo dữ liệu được phê duyệt; hệ thống tự tính phụ phí xăng dầu từ tham số này, giá dầu gốc, định mức và tỷ lệ chia sẻ. Mở lại lô để kiểm tra các giá đã tính là chỉ đọc.
5. Ghi mã lô và trạng thái tự động. Lô có ngày giao ở cấp LCL, ngày giao trên container FCL, hạn hạ hoặc thời điểm trả container phải xuất hiện để Điều phối tiếp nhận; lô thiếu các mốc này ở trạng thái chờ chốt lịch.

### Bước 2 — Dispatcher điều xe

1. Đăng nhập Dispatcher, mở **Điều phối chuyến xe** (`/dispatch`) và chỉ tiếp nhận hai lô vừa được gửi.
2. Kiểm tra FCL được rã thành đúng hai phần việc/container.
3. Gán FCL cho **Xe nhà** và LCL cho **Xe ngoài**, cùng tài xế/thời gian hợp lệ.
4. Thử gán cùng xe nhà vào một thời gian chồng lấn để xác nhận hệ thống chặn xung đột; sau đó sửa về lịch hợp lệ.
5. Bấm **Phát hành lệnh điều xe**. Ghi riêng hai mã phần việc/chuyến của FCL theo từng container, mã chuyến LCL và xác nhận lô chuyển `DISPATCHED/Đã điều xe`.

### Bước 3 — Driver vận hành và nộp e-POD

1. `laixe` đăng nhập, mở **Chuyến của tôi** (`/my-trips`) và kiểm tra Booking/BL, xe, container và thời gian đúng lệnh cho **từng** chuyến/fulfillment.
2. Với từng chuyến, thực hiện theo thứ tự: **Đã nhận lệnh gốc** → **Đã lấy vỏ/Lấy hàng** → **Đang đóng/Trả hàng** → **Đã hạ bãi/Giao hàng xong**. Ghi thời điểm mỗi mốc.
3. Nhập phí đường/nhiên liệu theo container; tải ảnh nhiên liệu, ảnh container và ảnh seal; tải lại trang để kiểm tra dữ liệu còn nguyên.
4. Với **mỗi** chuyến/fulfillment, trong e-POD thử gửi khi chỉ có phiếu bãi/phiếu hạ để xác nhận bị chặn; sau đó tải thêm biên bản giao nhận có ký và gửi e-POD. Ghi ID, trạng thái `SUBMITTED/Đã gửi duyệt` và phiên bản của từng submission.

> **Quy tắc chứng từ theo fulfillment/chuyến:** FCL của đợt test có hai fulfillment/chuyến độc lập và LCL có một chuyến đối chứng. Mỗi fulfillment/chuyến phải có riêng ảnh container/seal, một phiếu bãi/phiếu hạ và một biên bản giao nhận có ký. Vì vậy FCL cần tối thiểu **hai e-POD submissions, bốn file bắt buộc**; LCL cần thêm một submission và hai file. e-POD hiện tại của từng chuyến phải được duyệt, đồng thời POD giấy của đúng chuyến phải được xác nhận, trước khi hoàn thành lô tương ứng.

### Bước 4 — Ops và kế toán hoàn tất chi phí

1. `giaonhan` đăng nhập, mở **Chuyến hiện trường** (`/my-forwarder-trips`), lần lượt chọn từng chuyến FCL và vào **Chi phí phát sinh**.
2. Thêm chi phí nâng/hạ theo đúng cảng/bãi, cỡ container, Hàng/Rỗng, chiều Nâng/Hạ và ngày hiệu lực. Đơn giá phải tự lấy, không gõ tay.
3. Tạo một khoản có hóa đơn (đính hóa đơn) và một khoản không hóa đơn (người nhận, lý do, chứng từ thay thế).
4. Hoàn tất scope chung và scope riêng của từng container. `ketoan` duyệt chi phí; kiểm tra khoản tạm ứng được cấn trừ đúng và còn số dư nếu có.
5. Khi mọi scope đã kê xong, ghi hành động bàn giao mà UI hiện hành cung cấp (ví dụ nút **Gửi chờ duyệt phí**) hoặc ghi rõ nếu trạng thái tự chuyển. Dù cơ chế UI là gì, chỉ chấp nhận `PENDING_EXPENSE_APPROVAL/Chờ duyệt phí` sau khi mọi scope bắt buộc đã hoàn tất; ghi trạng thái và thời điểm chuyển.

### Bước 5 — Kế toán/CUS duyệt chứng từ và hoàn thành lô

1. `ketoan` mở chi tiết lô, tải và kiểm tra hai file e-POD của **từng** chuyến/fulfillment. Duyệt từng e-POD và chỉ xác nhận **đã thu hồi POD giấy** khi chứng từ gốc của đúng chuyến đó thực sự đã về văn phòng.
2. Trước khi mọi e-POD hiện tại được duyệt và mọi POD giấy được xác nhận, thử bấm **Hoàn thành** để xác nhận hệ thống chặn; lô không được chuyển `COMPLETED`.
3. Khi chi phí đã được duyệt, e-POD hợp lệ và POD giấy đã xác nhận cho tất cả fulfillment/chuyến, `ketoan` hoặc CUS chọn VAT phù hợp rồi bấm **Hoàn thành**. Không cần `giamdoc` hoặc `admin` phê duyệt bước này theo quy trình O2C đã được phê duyệt.
4. Kiểm tra lô và chuyến chuyển `COMPLETED/Hoàn thành` đúng một lần; ghi người thao tác, thời điểm, VAT và mã lô/chuyến.

> Nguồn quy trình: [`docs/prd/O2C Flow.md`](../prd/O2C%20Flow.md) và [`docs/prd/O2C dev-rev1.md`](../prd/O2C%20dev-rev1.md) — Bước 4 chỉ định Kế toán/CUS chọn VAT và bấm "Hoàn thành", không yêu cầu chuỗi phê duyệt. Nếu staging bắt buộc tạo yêu cầu qua Trung tâm phê duyệt hoặc yêu cầu ba người (`ketoan` → `giamdoc` → `admin`) mới được Hoàn thành, ghi **FAIL**: đây là khác với quy trình O2C đã được phê duyệt, không phải bước khách hàng cần thực hiện.

### Bước 6 — Debit Note, đối soát và cổng khách hàng

1. `ketoan` mở **Công nợ phải thu** (`/debt`), chọn đúng khách hàng/kỳ có lô đã hoàn thành, tạo và lưu Debit Note, sau đó xuất XLSX.
2. Kiểm tra file có các cột đã cấu hình theo template (mặc định: ngày đi, mã chứng từ, diễn giải, đơn vị, số cont, thành tiền). Các biến `billNumber` (Booking/BL), `tripCode` (mã chuyến), `freightAmount`/`totalAmount` (doanh thu/tổng) có sẵn để bật thêm nếu template yêu cầu. Lưu ý: hiện không có biến riêng cho `VAT`/`tổng sau VAT` — nếu cần tách VAT, báo BLOCKED để cấu hình template riêng trước đợt test.
3. `ketoan` và `giamdoc` mở `/debt`, `/payables`, `/finance`; đối chiếu doanh thu, VAT, AR, chi phí, AP và lợi nhuận. Xe nhà và xe ngoài phải được phân biệt đúng.
4. `customer` đăng nhập cổng khách hàng, xác nhận chỉ xem được dữ liệu của khách hàng test và có thể nhận biết lô/chứng từ của mã đợt chạy.

## 5. Điều kiện PASS, FAIL và BLOCKED

- **PASS:** Mọi bước hoàn thành, trạng thái đúng chuỗi `NEW/Mới tạo → DISPATCHED/Đã điều xe → IN_TRANSIT/Đang chạy → PENDING_EXPENSE_APPROVAL/Chờ duyệt phí → COMPLETED/Hoàn thành`, số liệu đối soát được và có ảnh/mã chứng từ. (Lưu ý: từ trạng thái chưa chốt, lô cũng có thể chuyển `CANCELED/Đã hủy`; code cho phép lùi trạng thái trước COMPLETED khi e-POD bị reject — đây là hành vi đúng, không phải FAIL.)
- **FAIL:** Hệ thống sai quyền, sai trạng thái, sai số liệu, mất dữ liệu sau tải lại, cho tự sửa giá, cho tự duyệt hoặc tạo tài chính trùng. Ghi lỗi kèm ảnh và mã lô/chuyến; không đổi kỳ vọng để khớp với màn hình.
- **BLOCKED:** Chưa có tài khoản đúng role, chưa được phép tạo dữ liệu staging, thiếu master data, hoặc hạ tầng không sẵn sàng. Ghi rõ owner cần xử lý và điều kiện chạy lại.

Không reset, xóa, hủy hoặc hoàn tác dữ liệu staging sau đợt test nếu chưa có phê duyệt cleanup riêng. Khi cần sửa dữ liệu đã duyệt, dùng workflow điều chỉnh/hoàn tác có lưu vết.

## 6. Gói kết quả gửi lại

Người điều phối gửi một thư mục/kho chia sẻ chứa:

1. Bảng kết quả từng bước, có người thao tác và PASS/FAIL/BLOCKED.
2. Mã lô, từng phần việc/chuyến, ID/phiên bản e-POD, xác nhận POD giấy và Debit Note của đợt chạy.
3. Ảnh màn hình trước/sau các thay đổi trạng thái và ảnh lỗi nếu có.
4. File Debit Note XLSX đã xuất và bảng đối chiếu doanh thu, VAT, AR, chi phí, AP, lợi nhuận.
5. Danh sách blocker/defect, người phụ trách và điều kiện chạy lại.

Tài liệu kiểm thử chi tiết nội bộ và tiêu chí đầy đủ nằm tại [`docs/prd/quytrinh-o2c-qa-test-plan.md`](../prd/quytrinh-o2c-qa-test-plan.md). Bước chốt trực tiếp của tài liệu này và `TC-MO2C-12` trong kế hoạch nội bộ cùng dùng thẩm quyền Kế toán/CUS; không thay bằng chuỗi phê duyệt ba người.
