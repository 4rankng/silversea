# Visual regression — Luồng Customer Service đến tài chính

> Bộ ca này dành cho **một agent kiểm thử website bằng trình duyệt thật**. Phạm vi là luồng xuyên suốt:
>
> `Booking → CUS → Điều vận → Chi phí → CUS kiểm tra → Giấy báo nợ → Kế toán duyệt → Hóa đơn/tham chiếu pháp lý → AR/AP → Thu/chi → Lợi nhuận → Dashboard`.
>
> Đây là tài liệu thực thi visual QA, không thay thế các ca nghiệp vụ chi tiết trong
> [`03-module-03-cus.md`](./03-module-03-cus.md),
> [`04-module-04-disbursement-recovery.md`](./04-module-04-disbursement-recovery.md),
> [`05-module-05-ar.md`](./05-module-05-ar.md),
> [`06-module-06-ap.md`](./06-module-06-ap.md),
> [`10-module-10-clerk-app.md`](./10-module-10-clerk-app.md), và
> [`11-module-11-finance-pnl.md`](./11-module-11-finance-pnl.md).

## 1. Hợp đồng thực thi cho agent

### 1.1. Không được tự suy diễn Pass

- Chỉ đánh dấu `PASS` khi đã mở đúng trang, đúng vai trò, đúng viewport và có ảnh bằng chứng.
- Không dùng `ADMIN` thay cho `CLERK`, `ACCOUNTANT`, `MANAGER` hoặc `CUSTOMER`.
- Sau đăng nhập, kiểm tra vai trò thực tế từ giao diện hồ sơ hoặc `/api/auth/me`. Sai vai trò → `BLOCKED_ROLE_FIXTURE`.
- Không dùng mock, dữ liệu giả trong trình duyệt hoặc sửa DOM/CSS để tạo ảnh đẹp.
- Không coi ảnh full-page là bằng chứng duy nhất. App có vùng nội dung cuộn độc lập; hãy chụp **viewport đang thấy**, cuộn đến từng vùng rồi chụp tiếp.
- Mỗi ca phải kiểm tra thêm: lỗi Console, request HTTP thất bại, overflow ngang và trạng thái loading/error.
- Không sửa lỗi trong lượt test. Ghi `FAIL`, mô tả cách tái hiện và lưu bằng chứng.

### 1.2. Quyền thay đổi dữ liệu

| Môi trường | Ca `[READ]` | Ca `[MUTATION]` |
| --- | --- | --- |
| Local hoặc sandbox QA riêng | Được chạy | Được chạy |
| Staging dùng chung | Được chạy | Chỉ chạy khi có phê duyệt thay đổi dữ liệu |
| Production | Chỉ khi có phê duyệt rõ ràng | Không chạy |

Nếu không được phép thay đổi dữ liệu, ghi `NOT_RUN_MUTATION_NOT_AUTHORIZED`; không dùng dữ liệu khách hàng thật để lách giới hạn.

### 1.3. Quy trình tài chính chuẩn

- Quy trình Customer Service → vận hành → tài chính là luồng duy nhất của sản phẩm.
- Server không trả cờ rollout; quyền hiển thị và thao tác chỉ dựa trên role,
  capability và phạm vi dữ liệu.
- Mọi chuyến hoàn thành mới phải có phiên bản hạch toán đang hiệu lực trước khi
  đi tiếp qua khóa chuyến, Giấy báo nợ và báo cáo.

### 1.4. Tài khoản bắt buộc

| Vai trò | Local mặc định | Yêu cầu |
| --- | --- | --- |
| `ADMIN` | `admin` | Đúng role `ADMIN` |
| `MANAGER` | `giamdoc` | Đúng role `MANAGER` |
| `ACCOUNTANT` | `ketoan` | Đúng role `ACCOUNTANT` |
| `CUSTOMER` | `customer` | Được liên kết đúng khách hàng của bộ dữ liệu thử |
| `CLERK` | Không bảo đảm được seed sẵn | Phải tạo/provision user `CLERK` thật và gán đúng phạm vi lô |

Không dùng tên `khachhang` hoặc mật khẩu staging cho local nếu chưa xác minh. Không ghi mật khẩu vào ảnh, log hoặc báo cáo.

### 1.5. Viewport và trình duyệt

Chạy Chrome/Chromium ở cả ba kích thước:

| Tên | Kích thước | Điều cần quan sát |
| --- | --- | --- |
| Mobile | `390 × 844` | Nút chạm ≥ 44px, bottom navigation, modal không vượt màn hình |
| Tablet | `768 × 1024` | Sidebar/drawer, bảng và bộ lọc không che nhau |
| Desktop | `1440 × 900` | Mật độ thông tin, sidebar, bảng và vùng hành động cùng lúc |

Với form CLERK ngoài hiện trường, chạy thêm `375 × 667` để tái hiện màn hình nhỏ.

### 1.6. Quy ước bằng chứng

Mỗi ca lưu ảnh trước/sau, Console errors, failed network responses, URL cuối, role, viewport và mã fixture. Tên ảnh:
`<ID>_<role>_<viewport>_<checkpoint>.png`.

Điều kiện visual chung:

- `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
- Không có chữ bị cắt, lớp phủ sai, sidebar đè nội dung hoặc thanh hành động nằm ngoài viewport.
- Số tiền dùng đầy đủ chữ số `vi-VN`, không rút gọn `k`, `M`, `tr`, `tỷ`.
- Không xuất hiện nhãn tiếng Anh không được duyệt như `Closing time`, `Confirm`, `Submit`.
- Focus nhìn thấy được khi dùng bàn phím; modal trả focus về nút mở sau khi đóng.

## 2. Bộ dữ liệu chuẩn bị

Agent phải ghi ID thực tế vào báo cáo trước khi chạy. Có thể tạo bằng UI trên local/sandbox hoặc dùng fixture đã được chủ môi trường cung cấp.

| Mã fixture | Dữ liệu tối thiểu |
| --- | --- |
| `FX-SHP-01` | Lô được gán cho CLERK; có booking, B/L, tuyến, ngày giao, 2 container, chứng từ và bàn giao điều vận |
| `FX-SHP-02` | Lô khác khách hàng hoặc ngoài phạm vi CLERK để kiểm tra row-scope |
| `FX-EVT-01` | Hai cập nhật khách hàng cho `FX-SHP-01`: một chưa xác nhận và một đã xác nhận |
| `FX-COST-01` | Chi hộ `READY_FOR_REVIEW`, tách rõ tiền chi hộ, phí dịch vụ và số thu khách |
| `FX-COST-02` | Chi hộ bị chặn do thiếu chứng từ hoặc sai phân bổ |
| `FX-COST-03` | Một khoản đã duyệt và một khoản đã từ chối |
| `FX-DN-01` | Giấy báo nợ `PENDING_CONFIRM`, có hạn thanh toán và chi tiết khoản thu hồi |
| `FX-DN-02` | Giấy báo nợ `CONFIRMED` hoặc `PARTIAL_PAID` |
| `FX-AR-01` | Khách hàng có hóa đơn/giấy báo nợ, đã thu một phần, còn nợ và có khoản quá hạn |
| `FX-AP-01` | Nhà cung cấp có một khoản chưa trả, một khoản đã trả và ngày đến hạn khác nhau |
| `FX-TR-01` | Tài khoản tiền mặt đầy đủ và tài khoản ngân hàng coverage một phần; có thu/chi source-linked |
| `FX-PROFIT-01` | Kỳ có chuyến đã chốt, đủ 8 chiều phân tích và ít nhất một chiều thiếu phân bổ |
| `FX-PROFIT-02` | Hơn 50 nhóm cùng chiều và một khóa có hai nhãn lịch sử để kiểm tra phân trang |

Không có fixture và không được phép tạo → `BLOCKED_DATA_FIXTURE`, không phải `PASS`.

## 3. Preflight

### VIS-CSF-001 — Đúng ứng dụng và môi trường `[READ]` · Smoke

- Mở URL được giao, ghi hostname, xác minh nhận diện TransTing/SilverSea và reload với Network mở.
- **Pass:** không nhầm project/port; login render đầy đủ; không có request chính 5xx.
- **Bằng chứng:** login, hostname, Network summary; không chụp thông tin đăng nhập.

### VIS-CSF-002 — Role thật sau đăng nhập `[READ]` · P0

- **Role:** `ADMIN`, `MANAGER`, `ACCOUNTANT`, `CLERK`, `CUSTOMER`.
- Đăng nhập từng account, kiểm tra role qua UI hoặc `/api/auth/me`, ghi home route rồi logout.
- **Pass:** role khớp 100%; không có account quyền rộng thay role hẹp.

### VIS-CSF-003 — Capability và menu theo vai trò `[READ]` · P0

- **Pass:** `CLERK` chỉ có lô được giao/tạo lô/chi phí cần kiểm tra; `ACCOUNTANT` có workspace tài chính nhưng không có Dashboard điều hành; `ADMIN`/`MANAGER` có Dashboard; `CUSTOMER` chỉ có ba mục portal.

### VIS-CSF-010 — Khởi động mặc định dùng quy trình mới `[READ]` · P0

- Khởi động ứng dụng bằng lệnh phát triển chuẩn, không truyền biến môi trường
  kích hoạt quy trình.
- **Pass:** capability đúng vai trò xuất hiện; các route tài chính được bảo vệ
  bằng quyền thay vì trả `503`; một chuyến hoàn thành mới tạo đúng một phiên bản
  hạch toán đang hiệu lực.

## 4. Booking, CUS và bàn giao điều vận

### VIS-CSF-101 — Danh sách lô CLERK `[READ]` · P1

- **Route/viewport:** `/shipments`, Desktop + Mobile.
- Tìm `FX-SHP-01`, thử tìm `FX-SHP-02`, cuộn hết danh sách.
- **Pass:** chỉ lô trong scope; mã/khách hàng/booking/trạng thái rõ; mobile không thành bảng vượt ngang.

### VIS-CSF-102 — Tạo nhanh booking trên màn hình nhỏ `[MUTATION]` · P1

- **Route/viewport:** `/clerk/shipments/new` hoặc `/shipments/new`, `375 × 667`.
- Chọn khách hàng, nhập booking/ngày/tuyến, mở bàn phím ảo và tạo một lần.
- **Pass:** form một cột; nút không bị keyboard che; trạng thái lưu rõ; điều hướng đúng hồ sơ.

### VIS-CSF-103 — Validation booking `[MUTATION]` · P1

- Bỏ trống khách hàng/booking bắt buộc, nhập ngày sai và bấm tạo.
- **Pass:** lỗi sát trường bằng tiếng Việt; focus đến lỗi đầu; không tạo lô; dữ liệu hợp lệ không mất.

### VIS-CSF-104 — Hồ sơ shipment và phân cấp thông tin `[READ]` · P1

- **Role:** `CLERK`, `MANAGER`; **route:** `/shipments/:id`; ba viewport.
- **Pass:** booking/B/L/container/chứng từ/kế hoạch giao/bàn giao được nhóm rõ; trạng thái nổi bật; quyền hành động đúng role; không card lồng sâu/khoảng trắng lãng phí.

### VIS-CSF-105 — Tạo cập nhật khách hàng `[MUTATION]` · P0

- **Role:** `CLERK`; tại `Phối hợp khách hàng`, mở `Tạo cập nhật`, chọn loại, nhập tiêu đề/nội dung và gửi.
- **Pass:** modal rõ đây không phải chat; nút gửi chỉ active khi hợp lệ; timeline có giờ Việt Nam, loại và phiên bản.

### VIS-CSF-106 — Nội dung dài và tiếng Việt `[MUTATION]` · P2

- Nhập nội dung gần 1.000 ký tự, có dấu và mã container dài.
- **Pass:** bộ đếm đúng; chữ wrap; không tràn/mất dấu; vượt giới hạn bị chặn.

### VIS-CSF-107 — Customer xem và xác nhận cập nhật `[MUTATION]` · P0

- **Role/route:** `CUSTOMER`, `/portal/shipments/:id`; Desktop + Mobile.
- Mở `Cập nhật từ bộ phận Customer Service`, xác nhận sự kiện chưa nhận rồi reload.
- **Pass:** chỉ nội dung customer-visible; hiện `Khách hàng đã xác nhận`; reload giữ trạng thái; không lộ ghi chú/ảnh nội bộ.

### VIS-CSF-108 — Row-scope lô hàng `[READ]` · P0

- **Role:** `CUSTOMER`, `CLERK`; nhập ID `FX-SHP-02` ngoài scope vào URL.
- **Pass:** 404/403/redirect an toàn; không flash tên khách khác; Network không trả payload ngoài scope.

## 5. CUS kiểm tra chi hộ

### VIS-CSF-201 — Danh sách và cấu trúc tiền `[READ]` · P0

- **Role/route:** `CLERK`, `ACCOUNTANT`; `/recoverable-costs`; Desktop + Mobile.
- **Pass:** phân biệt `Chi hộ`, `Phí dịch vụ`, `Thu khách`; có khách/lô/ngày/trạng thái; tiền đầy đủ; CLERK đúng scope.

### VIS-CSF-202 — Lọc trạng thái và empty state `[READ]` · P1

- Chọn `Tất cả`, `Chờ kiểm tra`, `Đã duyệt`, `Đã từ chối`, sau đó bộ lọc rỗng.
- **Pass:** số lượng/list đồng bộ; reset page 1; empty state `Không có chi phí phù hợp`; toolbar ổn định.

### VIS-CSF-203 — Khoản bị chặn có lý do `[READ]` · P0

- **Fixture:** `FX-COST-02`.
- **Pass:** badge/lý do rõ, không có nút gửi duyệt, không truyền nghĩa chỉ bằng màu.

### VIS-CSF-204 — Modal đề nghị duyệt `[MUTATION]` · P0

- **Fixture:** `FX-COST-01`; chọn `Đề nghị duyệt`, nhập ghi chú và gửi.
- **Pass:** lựa chọn active rõ; loading khóa nút; modal đóng khi thành công; dòng đổi đúng, không nhân đôi.

### VIS-CSF-205 — Trả lại bổ sung `[MUTATION]` · P1

- Chọn `Trả lại bổ sung`, thử lý do trống, sau đó nhập lý do và gửi.
- **Pass:** khi trống nút disabled; khi hợp lệ trạng thái/lý do đúng; không làm dòng khác đổi.

### VIS-CSF-206 — Double-click và mạng chậm `[MUTATION]` · P0

- Bật Slow 3G, gửi rồi click lần hai/reload lúc chờ.
- **Pass:** một yêu cầu; có `Đang gửi…`; reload nhất quán; lỗi mạng có banner và `Thử lại`.

### VIS-CSF-207 — Phân trang danh sách dày `[READ]` · P1

- **Tiền điều kiện:** >25 khoản; ba viewport.
- **Pass:** trang reachable, tổng đúng, không lặp/mất dòng, danh sách cuộn có giới hạn.

## 6. Giấy báo nợ và AR

### VIS-CSF-301 — Lập Giấy báo nợ từ AR `[MUTATION]` · P0

- **Role/route:** `ACCOUNTANT`; `/debt/:id/billing/new` hoặc CTA từ `/debt/:id`.
- **Pass:** nguồn chi tiết; tổng trước VAT/VAT/tổng thanh toán dễ đối chiếu; không gộp chi hộ với phí dịch vụ; CTA không bị che.

### VIS-CSF-302 — Duyệt và lifecycle `[MUTATION]` · P0

- Dùng maker/checker/approver đúng cấu hình.
- **Pass:** trạng thái chuyển có thứ tự; hành động sai trạng thái ẩn/disabled; version cũ báo tải lại, không ghi đè.

### VIS-CSF-303 — Portal Giấy báo nợ `[READ]` · P1

- **Role/route:** `CUSTOMER`, `/portal/debit-notes`; ba viewport.
- **Pass:** tổng chứng từ, số cần phản hồi, giá trị, trạng thái, hạn và hành động rõ; không lộ draft nội bộ.

### VIS-CSF-304 — Customer xác nhận `[MUTATION]` · P0

- **Fixture:** `FX-DN-01`; bấm `Xác nhận`, đọc modal, xác nhận và reload.
- **Pass:** modal nói nội dung sẽ khóa; notice thành công; badge `Đã xác nhận`; reload vẫn đúng.

### VIS-CSF-305 — Customer tranh chấp `[MUTATION]` · P0

- Mở `Phản hồi`, thử lý do trống rồi nhập lý do và gửi.
- **Pass:** lý do bắt buộc; trạng thái `Đang tranh chấp`; không còn nút xác nhận sai trạng thái.

### VIS-CSF-306 — Xuất PDF/XLSX `[READ]` · P1

- Tải cả hai định dạng của `FX-DN-02`.
- **Pass:** loading đúng; tên/phần mở rộng đúng; không tab trắng/lỗi; card không đổi sau tải.

### VIS-CSF-307 — AR đã thu/còn nợ/quá hạn `[READ]` · P0

- **Role/route:** `ACCOUNTANT`, `MANAGER`; `/debt`, `/debt/:id`.
- **Pass:** Debit/Hóa đơn/Đã thu/Còn nợ/Quá hạn rõ; còn nợ = phải thu − đã thu; nhấn quá hạn có ngày/hạn, không tô đỏ sai.

### VIS-CSF-308 — Customer statement khớp AR `[READ]` · P0

- **Role/route:** `CUSTOMER`, `/portal/statement`.
- **Pass:** đầu kỳ/phát sinh/đã thu/cuối kỳ khớp `FX-AR-01`; đúng pháp nhân; mobile đọc được từng giao dịch.

## 7. AP và ngân quỹ

### VIS-CSF-401 — Danh sách AP và hạn trả `[READ]` · P0

- **Role/route:** `ACCOUNTANT`, `/payables`.
- **Pass:** nhà cung cấp/hóa đơn/hạn/đã trả/chưa trả rõ; filter và tổng không che nhau; quá hạn có nhãn, không chỉ màu.

### VIS-CSF-402 — Chi tiết nhà cung cấp `[READ]` · P1

- **Route:** `/payables/:id`, `/suppliers`.
- **Pass:** giữ ngữ cảnh điều hướng; truy được chứng từ nguồn; khoản đã trả không còn CTA trả; không cộng kép.

### VIS-CSF-403 — Sổ quỹ đầy đủ và một phần `[READ]` · P0

- **Role/route:** `ACCOUNTANT`, `MANAGER`, `ADMIN`; `/finance/treasury`.
- **Pass:** có `Đầu kỳ`, `Thu`, `Chi`, `Số dư ghi sổ`; coverage `Đầy đủ`/`Một phần`; mốc chuyển đổi; không gọi là số dư sao kê.

### VIS-CSF-404 — Empty/error treasury `[READ]` · P1

- **Pass:** empty `Chưa có tài khoản ghi sổ`; error có `Thử lại`; không trang trắng.

### VIS-CSF-405 — Phân quyền treasury `[READ]` · P0

- **Role:** `CLERK`, `CUSTOMER`, `DRIVER`, `FORWARDER`; nhập `/finance/treasury`.
- **Pass:** redirect/403; menu không có treasury; không lộ số dư trong UI/loading/Network.

### VIS-CSF-406 — Hoàn tiền giữ AR và treasury đồng bộ `[MUTATION]` · P0

- Trên sandbox, hoàn một phần khoản thu bằng workflow nguồn rồi mở AR/treasury.
- **Pass:** cả hai đổi đúng chiều; movement gốc vẫn có và có dòng đối ứng; không có nút đảo treasury độc lập.

## 8. Lợi nhuận và Dashboard

### VIS-CSF-501 — Dashboard tài chính điều hành `[READ]` · P0

- **Role/route:** `ADMIN`, `MANAGER`; `/dashboard`; ba viewport.
- **Pass:** doanh thu hôm nay/tháng, chi phí, lợi nhuận, AR, quá hạn, tiền mặt/ngân hàng, top khách/top nợ và chi phí theo loại hiện khi có dữ liệu; tiền đầy đủ; cash/bank ghi `ghi sổ` và coverage.

### VIS-CSF-502 — ACCOUNTANT không thấy Dashboard `[READ]` · P0

- Kiểm tra menu và URL `/dashboard`.
- **Pass:** không menu; redirect/403 trước khi lộ KPI; các workspace tài chính khác vẫn dùng được.

### VIS-CSF-503 — Lợi nhuận theo 8 chiều `[READ]` · P0

- **Role/route:** `MANAGER`, `ACCOUNTANT`, `ADMIN`; `/profit`.
- Chọn Khách hàng, Tuyến, Xe, Điều vận, Kinh doanh, Tháng, Năm, Container.
- **Pass:** label/bảng đồng bộ; reset page 1; có số chuyến/doanh thu/chi phí/lợi nhuận; thiếu phân bổ ghi rõ, không đoán.

### VIS-CSF-504 — Đối chiếu công thức lô mẫu `[READ]` · P0

- Với doanh thu `25.000.000`, chi phí `20.800.000`.
- **Pass:** lợi nhuận `4.200.000`, biên `16,8%`; cùng kỳ/lô không lệch giữa `/profit`, `/finance`, Dashboard.

### VIS-CSF-505 — Phân trang >50 nhóm `[READ]` · P0

- **Fixture:** `FX-PROFIT-02`; chụp trang 1, đi `Trang sau`, quay `Trang trước`.
- **Pass:** `N nhóm · Trang x/y`; trang sau reachable; không mất nhóm cùng key khác nhãn lịch sử; tổng/coverage không đổi.

### VIS-CSF-506 — Chi phí chung chưa phân bổ `[READ]` · P1

- **Pass:** hiện riêng `Chi phí dùng chung chưa phân bổ`; không tự chia vào khách/xe; đối chiếu truy nguồn được.

### VIS-CSF-507 — Kỳ và múi giờ Việt Nam `[READ]` · P0

- So sánh chip kỳ trên shell, `/finance`, `/profit`, `/dashboard`, tốt nhất gần biên tháng.
- **Pass:** cùng kỳ nghiệp vụ Việt Nam; chuyến qua biên ngày không nằm hai kỳ; giờ `vi-VN`.

### VIS-CSF-508 — Dashboard empty/partial `[READ]` · P1

- **Pass:** `Chưa khả dụng`/`Một phần` thay số 0 gây hiểu nhầm; không `NaN`, `undefined`, số âm sai định dạng.

## 9. Responsive, accessibility và phục hồi lỗi

### VIS-CSF-601 — Không overflow ngang `[READ]` · P1

- **Trang:** shipment list/detail, recoverable costs, AR, AP, treasury, profit, dashboard và ba trang portal.
- **Viewport:** Mobile + Tablet.
- **Pass:** không overflow document; bảng cuộn riêng/reflow; không cần zoom out để bấm.

### VIS-CSF-602 — Touch target và navigation `[READ]` · P1

- **Role:** `CLERK`, `CUSTOMER`; Mobile.
- **Pass:** menu/bottom nav không che CTA; nút chính ≥44px; không bấm nhầm; safe area đúng.

### VIS-CSF-603 — Keyboard qua form/modal `[READ]` · P1

- Dùng Tab/Shift+Tab/Enter/Escape trên ba modal cập nhật, kiểm tra chi phí, xác nhận/tranh chấp.
- **Pass:** focus order hợp lý; focus trap; Escape đúng; đóng xong trả focus.

### VIS-CSF-604 — Zoom 200% và chữ dài `[READ]` · P2

- **Pass:** reflow dùng được; badge không đè số; tên/container dài wrap; CTA không mất.

### VIS-CSF-605 — Loading không lộ dữ liệu cũ `[READ]` · P0

- Bật Slow 3G, đổi customer scope hoặc filter/kỳ.
- **Pass:** có loading; không flash khách/kỳ cũ; action khóa khi chưa sẵn sàng.

### VIS-CSF-606 — API lỗi và retry `[READ]` · P1

- Mô phỏng offline/500 có kiểm soát trên local, bật lại mạng và `Thử lại`.
- **Pass:** lỗi tiếng Việt, không trang trắng; retry phục hồi; không tự gửi lại mutation.

### VIS-CSF-607 — Phiên hết hạn giữa modal `[READ]` · P0

- Làm hết hạn phiên rồi bấm gửi.
- **Pass:** không ghi dữ liệu; yêu cầu login; sau login không tự replay; không lộ dữ liệu role cũ.

### VIS-CSF-608 — Console/Network audit `[READ]` · P1

- **Pass:** không uncaught/render crash hoặc 4xx/5xx ngoài ca phân quyền chủ động; warning phải được ghi lại.

## 10. Ma trận quyền âm bắt buộc

| URL | Role được phép | Role phải bị chặn |
| --- | --- | --- |
| `/recoverable-costs` | `CLERK`, `ACCOUNTANT`, `MANAGER`, `ADMIN` có capability | `CUSTOMER`, `DRIVER`, `FORWARDER` |
| `/finance/treasury` | `ACCOUNTANT`, `MANAGER`, `ADMIN` có capability | `CLERK`, `CUSTOMER`, `DRIVER`, `FORWARDER` |
| `/dashboard` điều hành | `ADMIN`, `MANAGER` | `ACCOUNTANT`, `CLERK`, `CUSTOMER`, `DRIVER`, `FORWARDER` |
| `/profit` | `ACCOUNTANT`, `MANAGER`, `ADMIN` | `CLERK`, `CUSTOMER`, `DRIVER`, `FORWARDER` |
| `/shipments/:id` operator | role văn phòng/CLERK đúng scope | `CUSTOMER`, `DRIVER`, `FORWARDER` |
| `/portal/shipments/:id` | `CUSTOMER` đúng scope | role khác và customer ngoài scope |
| `/portal/debit-notes` | `CUSTOMER` | mọi role khác |

**Pass:** redirect đúng home hoặc không đủ quyền; không flash dữ liệu; API 403/404 phù hợp; Back không quay lại nội dung bảo vệ đã cache.

## 11. Thứ tự chạy

1. `001`–`003`, sau đó ma trận quyền âm.
2. `101`–`108` cho Booking/CUS/customer acknowledgement.
3. `201`–`207` cho chi hộ.
4. `301`–`308` cho Giấy báo nợ/AR.
5. `401`–`406` cho AP/treasury.
6. `501`–`508` cho profitability/dashboard.
7. `601`–`608` trên các trạng thái đã tạo.
8. Chạy `VIS-CSF-010` trên một lần khởi động mặc định sạch để xác nhận không còn
   phụ thuộc cờ môi trường.

## 12. Mẫu báo cáo

| ID | Role | Viewport | Kết quả | URL/fixture | Console/Network | Ảnh | Ghi chú |
| --- | --- | --- | --- | --- | --- | --- | --- |
| VIS-CSF-... | ... | ... | PASS / FAIL / BLOCKED_* / NOT_RUN_* | ... | ... | ... | ... |

Tổng kết bắt buộc: số PASS/FAIL/BLOCKED/NOT_RUN; ma trận role × route × viewport;
mutation đã tạo; lỗi theo severity; và hai kết luận riêng **browser visual
readiness** / **new-flow readiness**.

## 13. Phủ scenario theo `ck:scenario`

| Chiều | Ca đại diện |
| --- | --- |
| User types | `002`, `003`, ma trận quyền âm |
| Input extremes | `103`, `106`, `205`, `604` |
| Timing/concurrency | `206`, `507`, `607` |
| Scale | `207`, `505` |
| State transitions | `105`, `107`, `204`, `304`, `305`, `406` |
| Environment | `001`, `601`–`606` |
| Error cascades | `206`, `404`, `606`, `607` |
| Authorization | `002`, `010`, `108`, `405`, ma trận quyền âm |
| Data integrity | `206`, `302`, `406`, `505` |
| Integration | `107`, `301`–`308`, `406`, `504` |
| Compliance/audit | `105`, `107`, `302`, `406`, `608` |
| Business logic | `201`, `203`, `301`, `307`, `401`, `403`, `504`, `506`, `508` |

Tổng: **50 ca** — P0 cho quyền/dữ liệu tài chính/trạng thái/đối chiếu; P1 cho luồng chính/responsive; P2 cho giới hạn nội dung và zoom.
