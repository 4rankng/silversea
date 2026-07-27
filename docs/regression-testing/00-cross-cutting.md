# Ca kiểm thử dùng chung — HT và Q

Tệp này gom các ca kiểm thử áp dụng **cho mọi phân hệ** (10–12 tiêu chí HT) và **23 câu hỏi logic
nghiệp vụ (Q01–Q23)** từ `docs/prd/business-logic-qa-proposals.md`.

Mỗi phân hệ có một bảng HT riêng trong PRD (`M0X-HT-01`…`M0X-HT-10`, Module 3 dùng `HT-01`…`HT-12`).
Các tiêu chí này giống nhau về mặt ý nghĩa; tệp này viết ca kiểm thử cụ thể cho từng tiêu chí. Khi thử
ở một phân hệ cụ thể, chạy ca HT tương ứng **trên màn hình của phân hệ đó**.

---

## A. Tiêu chí nghiệm thu dùng chung (HT)

### TC-HT-01 — Ngôn ngữ

- **Tiêu chí (HT-01):** Nhãn, hướng dẫn và thông báo lỗi hiển thị bằng tiếng Việt; chỉ giữ CUS, tên riêng
  và mã tiêu chuẩn cần thiết.
- **Các bước:**
  1. Đăng nhập bằng `admin`.
  2. Duyệt qua ít nhất 5 màn: `/dashboard`, `/trips`, `/finance`, `/salary`, `/config`.
  3. Cố tình gây lỗi (bỏ trống trường bắt buộc, bấm lưu) để xem thông báo lỗi.
- **Kết quả mong đợi (Pass):**
  - Mọi nhãn nút, menu, dialog, breadcrumb, thông báo lỗi đều bằng tiếng Việt.
  - Chỉ xuất hiện thuật ngữ tiếng Anh: `CUS`, mã chuẩn (ISO 6346, VAT), tên riêng thương mại.
  - Không còn text dịch máy cứng (ví dụ "Confirm" thay vì "Xác nhận").
- **Bằng chứng:** ảnh chụp 5 màn + 1 ảnh thông báo lỗi.

### TC-HT-02 — Phân quyền (URL trực tiếp)

- **Tiêu chí (HT-02):** Người dùng chỉ xem và thao tác đúng chức năng, đơn vị và dữ liệu được giao; đường
  dẫn trực tiếp không vượt quyền.
- **Vai trò thử (mỗi vai trò thử một lượt):** `laixe`, `giaonhan`, `customer`, `ketoan`.
- **Các bước:**
  1. Đăng nhập bằng `laixe`. Truy cập trực tiếp các URL: `/finance`, `/trips`, `/debt`, `/customers`, `/portal/debit-notes`.
  2. Đăng nhập bằng `customer`. Truy cập trực tiếp: `/finance`, `/trips`, `/debt/:id` (lấy id không thuộc customer).
  3. Đăng nhập bằng `ketoan`. Truy cập `/audit-logs`, `/users`.
  4. Đăng nhập bằng `giaonhan`. Truy cập `/salary`, `/penalties`.
- **Kết quả mong đợi (Pass):**
  - Mỗi URL không thuộc vai trò: redirect về màn nhà của vai trò **hoặc** hiển thị trang "Không có quyền".
  - **Không để lộ dữ liệu** trong nội dung trang (ví dụ loading state có show tên khách hàng khác).
  - API cũng trả 403 (kiểm tra DevTools Network tab).
- **Bằng chứng:** ảnh màn "Không có quyền" + ảnh DevTools Network 403.

### TC-HT-03 — Nhật ký thao tác

- **Tiêu chí (HT-03):** Tạo, sửa, duyệt, chốt, hủy và xử lý ngoại lệ ghi đủ người, thời điểm, thay đổi và lý do.
- **Tiền điều kiện:** đã có một chuyến ở trạng thái "Mới tạo".
- **Các bước:**
  1. Dùng `admin` sửa một trường (ví dụ tiền cước) trên chuyến → lưu.
  2. Chuyển trạng thái chuyến → "Đang chạy".
  3. Hủy thao tác cuối cùng (nếu có nút undo) hoặc tạo điều chỉnh.
  4. Mở `/audit-logs`, lọc theo chuyến đó.
- **Kết quả mong đợi (Pass):**
  - Mỗi thao tác có 1 dòng nhật ký: người thực hiện, thời điểm (giờ VN), loại thao tác, giá trị cũ → mới, lý do (nếu có).
  - Nhật ký không thể sửa/xóa từ UI.
- **Bằng chứng:** ảnh trang nhật ký + ảnh chi tiết 1 dòng.

### TC-HT-04 — Tính toàn vẹn (double-submit)

- **Tiêu chí (HT-04):** Gửi lại do mạng chập chờn hoặc bấm hai lần không tạo bản ghi, chứng từ hay bút toán trùng.
- **Cách thử (áp dụng cho mọi form tạo/chốt):**
  1. Mở DevTools Network throttling = "Slow 3G".
  2. Tạo một bản ghi (ví dụ: chuyến mới / khoản chi / giấy báo nợ).
  3. Bấm nút "Lưu" **2 lần liên tiếp** trước khi request đầu trả về.
- **Kết quả mong đợi (Pass):**
  - Chỉ tạo **1 bản ghi** trong DB.
  - Lần submit thứ 2 trả về kết quả đã có (cùng id) hoặc báo "đã tồn tại".
  - Toast hiển thị "Đã lưu thành công" đúng 1 lần.
- **Bằng chứng:** ảnh Network tab (2 request cùng response) + ảnh DB (1 bản ghi).

### TC-HT-05 — Tiền tệ

- **Tiêu chí (HT-05):** Số tiền dùng VNĐ, không có số lẻ; dấu phân cách đúng; màn hình khớp tệp xuất.
- **Các bước:**
  1. Mở `/debt` (công nợ phải thu).
  2. Chọn một khách có phát sinh > 1 tỷ VND.
  3. Kiểm tra định dạng: `1.234.567.890 ₫` (dấu chấm hàng nghìn, không số lẻ).
  4. Xuất Excel/PDF, mở ra và so sánh.
- **Kết quả mong đợi (Pass):**
  - Tổng cộng trên màn = tổng cộng trong tệp xuất, chính xác đến đơn vị đồng.
  - Phép cộng các dòng bằng tổng (kiểm tra bằng tay 3 dòng).
- **Bằng chứng:** ảnh màn + ảnh tệp Excel/PDF mở ra.

### TC-HT-06 — Ngày giờ

- **Tiêu chí (HT-06):** Hiển thị theo giờ Việt Nam; thứ tự sự kiện và quy tắc kỳ không đổi giữa các màn.
- **Các bước:**
  1. Tạo một chuyến với giờ chạy lúc `23:55` ngày hôm nay.
  2. Kiểm tra trên `/trips` (danh sách), `/trips/:id` (chi tiết), `/audit-logs`.
  3. So sánh định dạng ngày giờ.
- **Kết quả mong đợi (Pass):**
  - Định dạng nhất quán: `DD/MM/YYYY HH:mm` (hoặc có thứ trong tuần).
  - Thời điểm không lệch múi giờ giữa các màn.
  - Sự kiện trong nhật ký theo đúng thứ tự thời gian.
- **Bằng chứng:** ảnh 3 màn cho cùng chuyến.

### TC-HT-07 — Thiết bị (responsive)

- **Tiêu chí (HT-07):** Tác vụ chính dùng được trên máy tính và điện thoại mà không che nút, vỡ bảng hoặc
  mất dữ liệu đã nhập.
- **Cách thử:** mở DevTools Device Toolbar, thử 2 kích cỡ:
  - Desktop: 1440×900
  - Mobile: iPhone SE (375×667) — quan trọng cho M08/M09/M10
- **Màn cần thử trên mobile:** `/my-trips/:id` (laixe), `/my-settlements/new` (giaonhan), `/clerk/shipments/new` (clerk), `/portal/shipments` (customer).
- **Kết quả mong đợi (Pass):**
  - Bảng dài có thanh cuộn ngang hoặc biến thành card stack.
  - Nút "Lưu"/"Gửi" không bị che bởi keyboard trên mobile.
  - Form đã nhập dữ liệu không mất khi xoay ngang → dọc.
- **Bằng chứng:** ảnh mobile + ảnh desktop cho 1 màn khó.

### TC-HT-08 — Khôi phục lỗi

- **Tiêu chí (HT-08):** Mất kết nối hoặc máy chủ tạm lỗi có thông báo dễ hiểu; người dùng thử lại an toàn
  và không mất dữ liệu đã lưu.
- **Cách thử:**
  1. Mở form tạo chuyến, nhập một số trường.
  2. DevTools → Network → Offline.
  3. Bấm "Lưu".
- **Kết quả mong đợi (Pass):**
  - Toast đỏ thông báo "Mất kết nối" hoặc tương đương tiếng Việt.
  - Dữ liệu đã nhập vẫn ở trên form sau khi network back online.
  - Sau khi online lại, bấm Lưu lại → thành công.
- **Bằng chứng:** ảnh toast offline + ảnh form còn dữ liệu.

### TC-HT-09 — Tìm kiếm & xuất dữ liệu

- **Tiếu chí (HT-09):** Kết quả tìm kiếm đúng phạm vi quyền; tệp xuất mở được, đủ cột, đúng tổng và không
  vỡ bố cục.
- **Các bước:**
  1. Đăng nhập `customer`. Mở `/portal/shipments`. Tìm theo mã lô của khách khác (lấy mã từ DB).
  2. Đăng nhập `admin`. Mở `/trips`. Tìm theo biển số xe. Xuất Excel.
  3. Mở Excel, kiểm tra số cột, tổng số chuyến, tổng doanh thu.
- **Kết quả mong đợi (Pass):**
  - Customer không tìm thấy lô của khách khác.
  - Excel mở được, có đủ cột (không cắt cột), tổng = tổng màn hình, layout không vỡ.
- **Bằng chứng:** ảnh kết quả tìm kiếm + ảnh Excel.

### TC-HT-10 — Đối chiếu liên phân hệ

- **Tiêu chí (HT-10):** Dữ liệu của phân hệ X khớp nguồn và đích liên quan; mọi chênh lệch truy ngược được
  tới chứng từ hoặc thao tác.
- **Bài toán mẫu:**
  - Chuyến C-001 đã chốt: doanh thu = 10.000.000đ.
  - Khoản chi hộ cho lô của chuyến = 2.000.000đ.
  - Giấy báo nợ kỳ tháng: phải có dòng cước 10.000.000 + dòng chi hộ 2.000.000.
  - Công nợ phải thu của khách: phải tăng 12.000.000đ (kể cả cước + chi hộ).
- **Các bước:**
  1. Mở `/finance` kỳ tháng. Ghi chú doanh thu.
  2. Mở `/debt/:customerId`. Ghi chú tổng phát sinh.
  3. So sánh tổng doanh thu (kỳ) với tổng phát sinh công nợ (kỳ).
- **Kết quả mong đợi (Pass):**
  - Hai số bằng nhau (nếu không có doanh thu phi vận tải và không có điều chỉnh).
  - Nếu lệch, có thể click vào từng dòng để truy về chứng từ gốc.
- **Bằng chứng:** ảnh 2 màn + ảnh click-through tới chứng từ.

### TC-HT-11 — Bảo mật (chỉ Module 3 / cổng khách hàng)

- **Tiêu chí (HT-11):** Phiên đăng nhập hết hạn đúng quy định; đường dẫn trực tiếp không vượt quyền; chứng
  từ không công khai ngoài hệ thống.
- **Cách thử:**
  1. Đăng nhập `customer`. Mở `/portal/debit-notes`. Lấy URL một tệp PDF giấy báo nợ.
  2. Đăng xuất. Mở lại URL đó trực tiếp.
  3. Đăng nhập `admin`. Lấy URL một tệp PDF của customer khác. Đăng nhập `customer` và thử mở.
- **Kết quả mong đợi (Pass):**
  - URL tệp phải yêu cầu auth; không cho tải khi chưa đăng nhập hoặc không có quyền.
  - Token hết hạn sau khoảng thời gian quy định (mặc định 8h).
- **Bằng chứng:** ảnh browser 403/401 + ảnh redirect login.

### TC-HT-12 — Đối chiếu cuối kỳ (chỉ Module 3)

- **Tiêu chí (HT-12):** Tổng giấy báo nợ, khoản đã thu, số còn phải thu và chi hộ khớp báo cáo chi tiết;
  mọi chênh lệch truy ngược được đến chứng từ.
- **Các bước:**
  1. Cuối kỳ: mở `/portal/debit-notes` (customer) + `/debt/:id` (admin).
  2. Liệt kê: tổng giấy báo nợ, tổng khoản đã thu, tổng còn phải thu, tổng chi hộ.
  3. So sánh với báo cáo chi tiết trong `/finance` và `/debt`.
- **Kết quả mong đợi (Pass):**
  - Tổng trên cổng customer = tổng trên trang admin.
  - Chênh lệch nếu có → truy ngược tới dòng giấy báo nợ hoặc khoản thu cụ thể.
- **Bằng chứng:** ảnh 2 màn + ảnh click-through.

---

## B. 23 câu hỏi logic nghiệp vụ (Q01–Q23)

> **Trạng thái thẩm quyền:** SilverSea đã chấp thuận toàn bộ đề xuất TingTing
> Q01–Q23 ngày 27/07/2026. Các hành vi dưới đây là tiêu chí nghiệm thu chính
> thức. Trạng thái `accepted` không đồng nghĩa đã triển khai hoặc đã Pass.

### Q01 — Ngưỡng cảnh báo sớm hạn mức công nợ

- **Đề xuất:** cảnh báo sớm ở **80%** hạn mức, cảnh báo vượt ở **100%**. Mức 80% dùng chung khi tạo khách
  mới nhưng cấu hình được theo từng khách.
- **Ca kiểm thử:**
  1. `admin` tạo khách A với hạn mức 100.000.000đ. Mặc định ngưỡng cảnh báo sớm = 80%.
  2. Tạo phát sinh công nợ cho A đến 79.000.000đ → không cảnh báo.
  3. Tạo thêm phát sinh đến 80.000.000đ → cảnh báo "Gần đạt hạn mức" (vàng).
  4. Tạo thêm đến 100.000.000đ → cảnh báo "Vượt hạn mức" (đỏ).
  5. Đổi ngưỡng riêng cho A = 70%. Quay lại bước 2, kiểm tra cảnh báo chuyển sang 70%.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo hiển thị đúng ngưỡng; ngưỡng cấu hình per-customer ghi đè default 80%.
  - Số dùng để kiểm tra: dư nợ + khoản duyệt chưa thu + giá trị dự kiến lô/chuyến mới.

### Q02 — Phê duyệt vượt hạn mức

- **Đề xuất:** CUS/điều vận không được tự cho vượt. Trưởng phòng Tài chính/Kế toán duyệt ngoại lệ cấp 1
  khi phần vượt ≤10% và ≤ ngưỡng tiền cấu hình; Giám đốc duyệt phần lớn hơn/lặp lại. Mỗi phê duyệt chỉ áp
  dụng cho 1 lô/chuyến hoặc đến ngày hết hạn, bắt buộc ghi lý do.
- **Ca kiểm thử:**
  1. Tạo lô cho khách đang vượt hạn mức.
  2. `giaonhan` thử cho vượt → bị từ chối.
  3. `ketoan` duyệt ngoại lệ 8% (trong thẩm quyền) → được, lý do bắt buộc.
  4. `ketoan` thử duyệt 15% → bị từ chối (vượt thẩm quyền).
  5. `giamdoc` duyệt 15% → được.
  6. Kiểm tra: duyệt chỉ áp dụng cho lô đó; lô khác vẫn bị chặn.
- **Kết quả mong đợi (Pass):**
  - Phân cấp phê duyệt đúng; lý do bắt buộc; giới hạn phạm vi 1 lô.

### Q03 — Phân bổ thanh toán không chỉ định

- **Đề xuất:** ưu tiên chỉ dẫn khách. Nếu không có → **phân bổ theo khoản đến hạn cũ nhất**; cùng ngày
  đến hạn → theo ngày phát hành cũ nhất. Tiền thừa giữ chưa phân bổ.
- **Ca kiểm thử:**
  1. Khách có 3 giấy báo nợ: GN-1 (hạn 01/08), GN-2 (hạn 10/08), GN-3 (hạn 05/08).
  2. Nhận thanh toán 5.000.000đ không chỉ định.
  3. Kiểm tra hệ thống gợi ý phân bổ: GN-1 trước.
  4. Xác nhận. GN-1 giảm đúng 5.000.000đ.
  5. Thử tiền thừa: nhận 15.000.000đ (vượt tổng nợ 12.000.000đ) → 3.000.000đ giữ "chưa phân bổ".

### Q04 — Lịch nhắc thanh toán

- **Đề xuất:** trước hạn 3 ngày, đúng hạn, sau hạn 3 ngày, sau đó mỗi 7 ngày. Chỉ gửi 08:00–17:30 ngày
  làm việc; cuối tuần/lễ → 09:00 ngày làm việc tiếp theo. Tối đa 1 thông báo/khách/ngày. Dừng khi đã thanh
  toán đủ/tranh chấp/tạm dừng.
- **Ca kiểm thử (cần job scheduler):**
  1. Tạo giấy báo nợ đến hạn vào thứ 7.
  2. Chạy job reminder → kiểm tra lịch gửi chuyển sang thứ 2 lúc 09:00.
  3. Tạo 2 giấy báo nợ cùng khách, cùng hạn → chỉ nhận 1 thông báo gộp.
  4. Thanh toán đủ 1 giấy → job ngừng nhắc giấy đó.

### Q05 — Kênh ưu tiên & retry

- **Đề xuất:** Khách → email chính, in-app dự phòng. Nhân viên nội bộ → in-app chính. Email lỗi retry 3
  lần (sau 15 phút, 2 giờ, 24 giờ); sau đó báo CUS xử lý.
- **Ghi chú setup:** Resend API key được cấu hình trong ADMIN `/config/app-settings`. Để trống giữ
  nguyên giá trị hiện tại; xóa là thao tác riêng. Nếu để trống trong dev/test thì hệ thống đi vào
  console fallback, nên không dùng được để kiểm tra nhánh FAILED/retry.
- **Ca kiểm thử:** (cần một lần gửi đi thực sự tới Resend hoặc một điều kiện buộc provider trả lỗi)
  1. Tạo khách với email giả lỗi.
  2. Kích hoạt nhắc → kiểm tra log retry: lần 1 tại T, lần 2 tại T+15ph, lần 3 tại T+2h, lần 4 tại T+24h.
  3. Sau lần 4 → trạng thái "thất bại" + thông báo CUS.

### Q06 — Hóa đơn nhiên liệu nhiều xe

- **Đề xuất:** cho phép 1 hóa đơn nhiều xe. Lưu 1 lần, có các dòng phân bổ theo xe theo số lit thực tế.
  Không chia đều; thiếu căn cứ → giữ chưa phân bổ, không cho duyệt.
- **Ca kiểm thử:**
  1. Tạo hóa đơn 100 lit, 2.000.000đ cho 2 xe: xe A 60 lit, xe B 40 lit.
  2. Hệ thống tính: A 1.200.000đ, B 800.000đ theo đơn giá.
  3. Thử để trống 10 lit → cảnh báo "chưa phân bổ đủ", không cho duyệt.

### Q07 — Một nhà cung cấp nhiều nhóm dịch vụ

- **Đề xuất:** 1 NCC thuộc nhiều nhóm, có 1 nhóm chính. Mỗi hóa đơn/khoản chi vẫn ghi đúng nhóm thực tế.
  Nhóm chính không tự thay đổi phân loại giao dịch.
- **Ca kiểm thử:**
  1. Tạo NCC "Petrolimex" với nhóm chính "Nhiên liệu", nhóm phụ "Cảng".
  2. Tạo hóa đơn Phí cảng cho Petrolimex → phân loại "Cảng", không phải "Nhiên liệu".
  3. Báo cáo tổng hợp theo nhóm chính → Petrolimex xuất hiện ở "Nhiên liệu".

### Q08 — Khách hàng ⇄ nhà cung cấp; đối trừ

- **Đề xuất:** 1 hồ sơ đối tác chung theo mã số thuế, gắn 2 vai trò. AR/AP tách. Đối trừ **không tự động**:
  cùng pháp nhân, cùng tiền, có biên bản + phê duyệt, **số đối trừ ≤ min(AR, AP)**.
- **Ca kiểm thử:**
  1. Tạo đối tác D có cả AR 10.000.000đ và AP 7.000.000đ.
  2. `ketoan` tạo yêu cầu đối trừ 7.000.000đ → ở trạng thái "Chờ duyệt".
  3. `giamdoc` phê duyệt → 2 bút toán liên kết: AR giảm 7tr, AP giảm 7tr.
  4. Thử đối trừ 8.000.000đ (>AP) → bị từ chối.
  5. Hủy sau duyệt → tạo bút toán hoàn tác, dấu vết còn.

### Q09 — Phạm vi kỳ lương

- **Đề xuất:** chốt theo kỳ lương chung toàn công ty / đơn vị trả lương cấu hình, không chốt từng lái xe.
  Trước chốt, lái xe ở trạng thái Sẵn sàng/Chờ xử lý.
- **Ca kiểm thử:**
  1. Mở `/salary`. Chọn kỳ tháng 07/2026.
  2. Kiểm tra: toàn bộ lái xe active có mặt.
  3. Thử "chốt riêng từng lái xe" → không có nút này (chỉ có "Chốt kỳ").
  4. Trạng thái từng lái xe: Sẵn sàng hoặc Chờ xử lý.

### Q10 — Chặn chốt kỳ khi còn lỗi

- **Đề xuất:** mặc định **chặn chốt toàn kỳ** nếu còn lỗi ảnh hưởng số tiền. Cho chốt phần còn lại chỉ khi
  người có thẩm quyền phê duyệt loại lái xe đó khỏi kỳ; lái xe đó → Chờ bổ sung + kỳ bổ sung/điều chỉnh.
- **Ca kiểm thử:**
  1. Tạo 5 lái xe, 1 lái (LX-A) thiếu dữ liệu chuyến (xung đột).
  2. Thử chốt kỳ → bị chặn, thông báo "Còn lỗi ở LX-A".
  3. `giamdoc` phê duyệt loại LX-A khỏi kỳ → LX-A chuyển "Chờ bổ sung".
  4. Chốt kỳ → thành công cho 4 lái còn lại.
  5. LX-A được xử lý ở kỳ bổ sung kế tiếp.

### Q11 — Sau chốt: điều chỉnh hoặc mở lại

- **Đề xuất:** ưu tiên điều chỉnh ở kỳ đang mở. Mở lại chỉ khi chưa phát hành phiếu/chưa thanh toán/chưa
  hạch toán. Kế toán lập, Trưởng phòng Tài chính/Kế toán chốt, **Giám đốc mới mở lại**.
- **Ca kiểm thử:**
  1. Chốt kỳ 07 → phát hành phiếu cho 5 lái.
  2. `ketoan` thử mở lại → bị từ chối (chỉ Giám đốc).
  3. `giamdoc` thử mở lại sau khi đã phát hành → bị từ chối.
  4. `giamdoc` tạo **khoản điều chỉnh** ở kỳ 08 cho 1 lái → được.
  5. Kiểm tra: kỳ 07 không thay đổi, kỳ 08 có dòng điều chỉnh liên kết kỳ 07.

### Q12 — Khoản chi hộ không hóa đơn: hạng mục & căn cứ

- **Đề xuất:** danh sách hạng mục được phép: bốc xếp/lao động thời vụ, vé bãi/đò/phí nhỏ, xử lý khẩn cấp,
  vật tư nhỏ. Căn cứ thay thế: phiếu thu/biên nhận, chuyển khoản/ví điện tử, ảnh hiện trường có thời gian
  địa điểm, xác nhận ký. Bắt buộc: số tiền, ngày, người nhận, lô/chuyến, lý do, ≥1 bằng chứng.
- **Ca kiểm thử:**
  1. `giaonhan` tạo khoản chi hộ "Bốc xếp" 500.000đ, đính kèm ảnh hiện trường có geotag.
  2. Hệ thống cho lưu ở trạng thái "Chờ".
  3. Thử hạng mục "Hối lộ" (không trong list) → không có trong dropdown.
  4. Thử khoản không có ảnh/geotag → bắt buộc bổ sung.

### Q13 — Ngưỡng khoản chi hộ

- **Đề xuất:** 1.000.000đ/khoản, 5.000.000đ/người/ngày. Cấu hình được theo hạng mục/chức danh. Hệ thống
  cộng gộp cùng người, cùng ngày, cùng hạng để chống chia nhỏ.
- **Ca kiểm thử:**
  1. `giaonhan` tạo 2 khoản "Vé bãi" cho cùng người, cùng ngày: 600.000 + 500.000 = 1.100.000đ.
  2. Hệ thống cảnh báo: vượt 1.000.000/khoản? — kiểm tra quy tắc. Cảnh báo vượt 1.000.000/khoản nếu một
     trong hai > 1tr; cảnh báo tổng người/ngày nếu > 5tr.
  3. Đẩy tổng đến 5.500.000đ với 6 khoản → cảnh báo "Tổng trong ngày vượt 5.000.000".

### Q14 — Quá ngưỡng/thiếu căn cứ

- **Đề xuất:** thiếu bằng chứng tối thiểu → **trả về để bổ sung** (không duyệt). Vượt ngưỡng đủ căn cứ →
  Trưởng phòng Tài chính/Kế toán duyệt ≤5.000.000/khoản; >5tr hoặc >10tr/ngày → Giám đốc. Người tạo không
  tự duyệt; lý do bắt buộc.
- **Ca kiểm thử:**
  1. `giaonhan` tạo khoản 4.000.000đ đủ ảnh → chờ duyệt.
  2. `ketoan` duyệt (≤5tr, trong thẩm quyền).
  3. `giaonhan` tự duyệt khoản của mình → bị từ chối (maker-checker).
  4. Tạo khoản 6.000.000đ → `ketoan` thử duyệt → bị từ chối (>5tr), cần `giamdoc`.

### Q15 — Maker/Checker/Approver/Viewer

- **Đề xuất:** tách người tạo, người kiểm tra, người duyệt cho tiền, giá, công nợ, ngoại lệ, chốt kỳ,
  điều chỉnh. Người tạo không tự duyệt. Cập nhật vận hành thường (tiến độ, chứng từ) tự lưu được; đổi
  tiền/trạng thái đã chốt → phải duyệt.
- **Ca kiểm thử:** thử trên 5 bề mặt:
  1. Lệnh vận chuyển: `admin` tạo, `admin` không tự duyệt (nếu có bước duyệt).
  2. Khoản chi hộ: `giaonhan` tạo, `ketoan` duyệt.
  3. Giấy báo nợ: `ketoan` lập, `giamdoc` phê duyệt phát hành.
  4. Chốt kỳ lương: `ketoan` lập, `giamdoc` chốt.
  5. Điều chỉnh giá: `admin` đề xuất, `giamdoc` duyệt.
- **Kết quả mong đợi (Pass):** mọi bề mặt đều tách maker/checker/approver.

### Q16 — Phạm vi tài khoản khách hàng

- **Đề xuất:** 1 tài khoản CUSTOMER chỉ xem 1 pháp nhân. Nhiều khách chỉ cho tài khoản tập đoàn/đại lý,
  admin liên kết. Không cấp quyền dựa trên tên miền email.
- **Ca kiểm thử:**
  1. `customer` đăng nhập → chỉ thấy lô/giấy báo nợ của chính mình.
  2. Mở URL `/portal/shipments/<id- khách-khác>` → 404/403.
  3. `admin` liên kết tài khoản customer với khách thứ 2 → customer thấy cả 2 (test pool đặc biệt).

### Q17 — Nhân viên chứng từ (CLERK)

- **Đề xuất:** tạo/sửa hồ sơ lô, vận đơn, công-te-nơ, niêm phong, tờ khai, lệnh giao hàng, điểm nhận/giao,
  tệp chứng từ. Trước chuyển điều vận → sửa trực tiếp; sau chuyển → chỉ bổ sung không đổi kế hoạch. Đổi
  khách/container/thời gian/địa điểm → tạo phiên bản mới + thông báo điều vận. Phạm vi: đơn vị phụ trách
  + khách/lô giao. Không quyền sửa giá/chi phí/công nợ/lương.
- **Ca kiểm thử:**
  1. `clerk` tạo lô mới → được.
  2. `clerk` sửa lô chưa chuyển điều vận → được.
  3. `clerk` sửa khách hàng của lô đã chuyển điều vận → bắt buộc tạo phiên bản mới.
  4. `clerk` thử sửa tiền cước → không có trường (read-only).
  5. `clerk` chỉ thấy lô trong đơn vị phụ trách của mình.

### Q18 — Sửa dữ liệu đã duyệt/chốt

- **Đề xuất:** không sửa trực tiếp. Tạo điều chỉnh/hoàn tác. Mở lại chỉ ngoại lệ trước phát hành. Bắt buộc
  lý do, lưu giá trị trước/sau, người thực hiện, người duyệt. Quản lý nghiệp vụ xử lý vận hành; Trưởng
  phòng Tài chính/Kế toán xử lý tiền; mở kỳ do Giám đốc.
- **Ca kiểm thử:** thử sửa 3 thực thể đã chốt:
  1. Chuyến đã chốt: `admin` thử sửa tiền cước → chỉ có nút "Tạo điều chỉnh".
  2. Giấy báo nợ đã phát hành: `ketoan` thử sửa dòng → chỉ có nút "Tạo bản điều chỉnh".
  3. Kỳ lương đã chốt: `ketoan` thử sửa → khóa; `giamdoc` mở lại (nếu chưa phát hành).

### Q19 — Hạn thanh toán vào cuối tuần/lễ

- **Đề xuất:** mặc định chuyển sang ngày làm việc tiếp theo, nhưng vẫn lưu + hiển thị ngày gốc theo hợp
  đồng. Tính quá hạn + gửi nhắc theo ngày đã điều chỉnh. Hợp đồng ưu tiên nếu quy định khác.
- **Ca kiểm thử:**
  1. Tạo giấy báo nợ hạn thanh toán = Chủ nhật 02/08/2026.
  2. Hệ thống hiển thị: ngày gốc 02/08 (Chủ nhật), ngày điều chỉnh 03/08 (Thứ 2).
  3. Tính quá hạn tính từ 03/08. Nhắc gửi theo 03/08.

### Q20 — Chuyến qua hai kỳ

- **Đề xuất:** doanh thu/lương/số chuyên/lợi nhuận → kỳ của ngày hoàn thành. Chấm công/nhiên liệu/khoản
  chi → ngày phát sinh. Chuyến chưa hoàn thành cuối kỳ → "Đang thực hiện", không vào số chính thức.
- **Ca kiểm thử:**
  1. Tạo chuyến bắt đầu 31/07, hoàn thành 01/08.
  2. Mở báo cáo kỳ 07: chuyến không vào (vì chưa hoàn thành trong kỳ 07).
  3. Mở báo cáo kỳ 08: doanh thu + lương chuyến vào kỳ 08.
  4. Nhiên liệu đổ 31/07 → vào kỳ 07. Khoản chi 01/08 → vào kỳ 08.

### Q21 — Khóa kỳ

- **Đề xuất:** Lương + nhiên liệu khóa theo **tháng**. Giấy báo nợ khóa theo **chu kỳ thanh toán khách**
  (mặc định tháng, tuần chỉ khi hợp đồng quy định). Dữ liệu muộn → kỳ đang mở dạng điều chỉnh liên kết kỳ
  gốc; không sửa kỳ cũ. Chỉ mở lại trước phát hành/thanh toán, có phê duyệt.
- **Ca kiểm thử:**
  1. Kỳ lương tháng 07 đã chốt. Nhập nhiên liệu muộn của 31/07 → tạo dòng điều chỉnh kỳ 08 liên kết kỳ 07.
  2. Thử sửa trực tiếp kỳ 07 → bị từ chối.
  3. Khách A có hợp đồng thanh toán theo tuần → giấy báo nợ khóa theo tuần.

### Q22 — Nguồn chân lý & tái tính vs điều chỉnh

- **Đề xuất:** nguồn chính: lô (khách, hàng, container), chuyến (xe, lái, thời gian, trạng thái), khoản
  chi đã duyệt (chi phí), giấy báo nợ đã phát hành (phải thu), khoản tiền về (đã thu, còn nợ). Trước chốt:
  nguồn đổi → tự tính lại + cảnh báo liên quan. Sau chốt: không ghi đè, tạo phiên bản/điều chỉnh/hoàn tác.
- **Ca kiểm thử:**
  1. Sửa trọng lượng lô (trước chốt chuyến) → doanh thu tạm tính tự tính lại.
  2. Sửa doanh thu chuyến đã chốt → không đổi; phải tạo điều chỉnh.
  3. Kiểm tra lịch sử: có thể xem cả 2 phiên bản.

### Q23 — Double-submit, mạng chập, concurrent edit/approve

- **Đề xuất:** mỗi thao tác có mã giao dịch duy nhất; gửi lại cùng mã → trả kết quả cũ, không tạo bản ghi
  mới. Số lô/chuyến/chứng từ có quy tắc duy nhất. 2 người cùng sửa → người lưu sau phải tải lại, không ghi
  đè. 2 người cùng duyệt → duyệt đầu tiên thắng, lần sau bị từ chối. Mọi lần thử/xung đột lưu nhật ký.
- **Ca kiểm thử:**
  1. Mở 2 tab với cùng chuyến, 2 người sửa khác trường, cùng bấm lưu → người thứ 2 nhận 409 "phiên bản cũ".
  2. 2 người cùng bấm "Duyệt" khoản chi → 1 thắng, 1 nhận "đã được duyệt".
  3. Nhật ký ghi cả 2 lần thử.
- **Kết quả mong đợi (Pass):**
  - HTTP 409 trên conflict version, không ghi đè.
  - First-approve-wins rõ ràng.
  - Audit log có dấu vết.

---

## C. Bảng nghiệm thu

Sau khi thử các HT và Q, điền:

| Ngày thử | Mã (HT-x / Q-y) | Người thử | Kết quả | Ghi chú | Bằng chứng |
| -------- | --------------- | --------- | ------- | ------- | ---------- |
| __/__/__ | HT-01           |           |         |         |            |
| …        | …               |           |         |         |            |
| __/__/__ | Q01             |           |         |         |            |
| …        | …               |           |         |         |            |
