# Luồng 5: Kế hoạch làm hàng, Theo dõi phương tiện & Quỹ tạm ứng — Ops (Hiện trường)

> **Vai trò sở hữu:** Nhân viên vận hành / hiện trường (OPS)
> **Vai trò tham gia:** Kế toán (ACCOUNTANT) — ghi nhận tiền thực giao/nhận, đối chiếu và quyết toán trực tiếp; Điều vận — gán chuyến
> **Tài khoản:** theo `testplan/testaccounts.txt` (mục `demoUsers` — chỉ tồn tại trên local dev)
> **Route chính:** `/ops/orders`, `/ops/fleet-tracking`, `/ops/wallet`
> **PRD nguồn:** [Vận hành Ops](../../docs/prd/OpsVanHanh.md), [Quy trình O2C §7](../../docs/prd/QuyTrinhO2C.md)
> **Kiểm thử bổ sung:** [Chi phí — yêu cầu ngày 16/09/2026](../2026-09-16-expense-requirements.md).
>
> **Bản đồ route:** các màn `/ops/*` là bộ màn mới
> (`frontend/src/pages/ops/OpsOrdersPage.tsx`, `OpsFleetTrackingPage.tsx`,
> `OpsWalletPage.tsx`). Bộ `/my-orders`, `/my-advances`, `/my-settlements` cũ vẫn tồn tại
> song song và được regression riêng ở [`../roles/06-vanhanh.md`](../roles/06-vanhanh.md)
> Flow 1–6; nếu tài liệu cũ còn kỳ vọng phê duyệt thì dùng PRD hiện hành và ca trong tệp này. Xác nhận route thực tế của môi trường trước khi chạy; ghi rõ yêu cầu chưa triển khai hoặc điều kiện thử bị chặn, không ghi PASS khi chưa quan sát được kết quả.
>
> **Ghi chú lịch sử:** slot Luồng 5 trước đây là "Chi phí phát sinh (Ops)" đã bị gỡ 2026-09.
> Tệp này thay thế slot đó bằng đặc tả Ops mới ngày 2026-09-06; các kỳ vọng dưới đây được cập nhật theo PRD hiện hành ngày 16/09/2026.
>
> **Hợp nhất 2026-09-07:** từng tồn tại song song một tệp `05-ops-vi.md` viết cho **cùng
> đặc tả này** với dải mã `TC-OPS-VI-*` **trùng** dải mã ở §5.3 dưới đây. Tệp đó đã được
> gộp vào đây và xoá. **Tệp này là bản chuẩn duy nhất cho Luồng 5.**

---

## Quy tắc chạy và thay thế ca cũ

- Giữ nguyên mã ca để truy vết. `VI-001/002` thay xin/duyệt ứng bằng ghi tiền ứng thực giao; `VI-003` thay bốn nhóm duyệt bằng số dư từ giao dịch; `VI-004` kiểm tra kết quả lưu có thật; `VI-005/011/014` thay từ chối/duyệt bằng bổ sung chứng từ, đối chiếu và quyết toán trực tiếp. Kết quả PASS cũ theo luồng phê duyệt không chứng minh các ca mới đã đạt.
- Không có gửi duyệt, người duyệt thứ hai hoặc hàng đợi phê duyệt. Xác nhận thao tác, đối chiếu kế toán và kỳ khóa không phải cấp duyệt.
- Internet là điều kiện làm việc. Không có hàng đợi ngoại tuyến hoặc tự gửi lại nghiệp vụ khi nối mạng/đổi tài khoản.
- Chạy trên mobile 390px, tablet 820px và desktop; nhập bằng bàn phím lẫn chọn/chạm, dùng tên dài, số tiền lớn hợp lệ và dữ liệu rỗng. Kiểm tra trường/nút cùng chiều cao, nhãn rõ, không tràn toàn trang, không thẻ lồng thẻ hay lề làm hẹp dữ liệu.
- Ghi số dư đầu, nguồn quỹ, người thực chi, người nhập, ngày và mã khoản trước khi đối chiếu. Tách số tính cho khách, tiền đã thu thực tế và tiền thực chi. Các quy tắc chưa chốt nằm trong tài liệu kiểm thử bổ sung; không tự chọn đáp án để ghi PASS.

---

## 5.1 — Màn hình 1: Kế hoạch làm hàng & Lệnh phụ trách (`/ops/orders`)

### TC-OPS-KH-001 — Danh sách tổng thể lô hàng theo ngày

- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Thiết bị:** Desktop + Mobile (390 × 844)
- **Tiền điều kiện:** có ≥ 3 lô hàng của công ty trong ngày hôm nay
- **Các bước:**
  1. Đăng nhập `giaonhan`, mở `/ops/orders`.
  2. Đọc danh sách mặc định.
  3. Đổi bộ chọn ngày sang một ngày cụ thể trong quá khứ, rồi sang một ngày tương lai.
  4. Tìm kiếm theo mã lô, theo tên khách hàng, theo số container.
- **Kết quả mong đợi (Pass):**
  - Bộ chọn ngày **mặc định hôm nay**; trục ngày = `expected_delivery_date` (Ngày giao dự kiến).
  - Hiển thị **toàn bộ lô hàng của công ty** trong ngày — không giới hạn theo lô được gán riêng cho Ops này.
  - Lô hủy không lẫn công việc đang làm nhưng vẫn tra cứu được; lô chưa chốt lịch có nhóm riêng và không bị gán ngày giả.
  - Cột đầy đủ: `Mã lô` | `Khách hàng` | `Tuyến` | `Cont` (số lượng + danh sách số vỏ) | `Bill/Booking` | `Trạng thái` | hành động.
  - Trạng thái có nhãn chữ rõ, không phụ thuộc riêng màu sắc.
  - Tra cứu được ngày quá khứ **và** tương lai; tìm kiếm khớp cả 3 tiêu chí; URL giữ trạng thái ngày/tìm kiếm.
  - Nhãn tiếng Việt, vùng chạm dễ dùng; thích ứng 390px/820px/desktop mà vẫn đọc được mã, tiền và hành động; không ép mọi cột vào bảng chật hoặc làm tràn ngang toàn trang.
- **Kỳ vọng sai (Fail nếu):** chỉ thấy lô của riêng mình; lô hủy lẫn việc đang làm hoặc không tra cứu lại được; không đổi được ngày; lô chưa lịch biến mất.
- **Bằng chứng:** ảnh danh sách hôm nay + ảnh sau khi đổi ngày + ảnh kết quả tìm kiếm

---

### TC-OPS-KH-002 — Ghim lệnh: lô được ghim lên đầu danh sách

- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Các bước:**
  1. Mở `/ops/orders`. Ghi lại thứ tự 5 lô đầu tiên.
  2. Cuộn xuống chọn 1 lô ở giữa/cuối danh sách, bấm `[📍 Ghim]`.
  3. Tải lại trang (F5).
  4. Bấm bỏ ghim.
- **Kết quả mong đợi (Pass):**
  - Trong kết quả phù hợp bộ lọc, lô ghim đứng đầu; lô mới ghim trước. Nếu chưa lưu được thì thông báo rõ, không giả trạng thái đã ghi.
  - Sau F5, lô vẫn ở trên cùng (ghim **bền vững**, không phải state tạm trên client).
  - Bỏ ghim ⇒ lô trở về vị trí sắp xếp tự nhiên.
- **Kỳ vọng sai (Fail nếu):** ghim mất sau reload; ghim không đưa lô lên đầu.
- **Bằng chứng:** ảnh trước ghim / sau ghim / sau F5 / sau bỏ ghim

---

### TC-OPS-KH-003 — Ghim là sổ tay CÁ NHÂN, không rò sang Ops khác

- **Vai trò:** `giaonhan` + 1 tài khoản OPS thứ hai
- **Mức độ:** **P0** (rò dữ liệu cá nhân)
- **Tiền điều kiện:** có 2 tài khoản OPS
- **Các bước:**
  1. `giaonhan` ghim lô X.
  2. Đăng xuất, đăng nhập tài khoản OPS thứ hai, mở `/ops/orders`.
- **Kết quả mong đợi (Pass):**
  - Lô X **không** được ghim trên tài khoản thứ hai; danh sách ở thứ tự tự nhiên.
  - Ghim lưu theo `user_id`, hoạt động như bookmark cá nhân.
- **Kỳ vọng sai (Fail nếu):** Ops thứ hai thấy lô X ghim sẵn (ghim bị lưu global).
- **Bằng chứng:** ảnh 2 tài khoản cạnh nhau

---

### TC-OPS-KH-004 — Khai báo chi phí đúng lô, container và người thực chi

- **Vai trò:** `giaonhan`; **Mức độ:** P0; **PRD:** Ops §3.3, §9.1, AC-CP-OPS-01/02/03/05.
- **Tiền điều kiện:** lô nhập có Bill và hai container; lô xuất có Booking; một lô LCL; danh mục phí đang hoạt động và quyền nhập thay đã xác định.
- **Các bước:**
  1. Mở khai báo từ từng loại lô; chọn container hoặc phí chung, không nhập lại mã lô/Bill/Booking.
  2. Thử thực chi rỗng, 0, âm, thập phân, sai định dạng; sau đó nhập 100.000đ và ngày/người thực chi.
  3. Ghi phí không hóa đơn 100.000đ, số tính cho khách 0đ với lý do nằm trong hợp đồng; người có quyền thử khoản thực chi 120.000đ/thu khách 150.000đ.
  4. Ghi phí có hóa đơn kèm số hóa đơn; mở lại trên tài khoản được phép. Thử người nhập A ghi thay người thực chi B.
- **Kết quả mong đợi:**
  - Ngữ cảnh đúng lô; nhập dùng Bill, xuất dùng Booking; chỉ chọn container của lô; LCL/phí chung không cần container giả.
  - Thực chi là số nguyên dương VND; trường sai có lỗi rõ, không tự đổi số. 0đ thu khách khác rỗng và được giữ có chủ ý.
  - Nhóm có/không hóa đơn theo danh mục; giữ tên phí, ngày, người thực chi, người nhập và chứng từ. Không tự áp định mức nâng/hạ cho khoản Ops thực chi.
  - Ops không tự được cấp quyền sửa số thu khách. CUS/kế toán được cấp quyền giữ hai số độc lập; khoản đã bao gồm trong giá không thu thêm.
  - Ảnh có thể bổ sung vào khoản đã lưu; không yêu cầu ảnh để ghi nhận một khoản đã thực chi. Nhập thay không đổi người thực chi thành người đang đăng nhập.
- **Bằng chứng:** form/lỗi và bản ghi mở lại của nhập, xuất, LCL; số chi/thu, người nhập/người chi.
---

### TC-OPS-KH-005 — Lưu thực chi cập nhật quỹ đúng một lần

- **Vai trò:** `giaonhan`; **Mức độ:** P0; **PRD:** Ops §5.2, AC-CP-OPS-04/06.
- **Tiền điều kiện:** ghi số dư `S0`; khoản thử do Ops thực trả từ quỹ của mình, không có giao dịch khác trong lúc đối chiếu.
- **Các bước:**
  1. Từ `/ops/orders`, lưu thực chi 500.000đ cho đúng lô.
  2. Mở `/ops/wallet`, mở lại khoản vừa lưu; bổ sung biên lai rồi cho kế toán đối chiếu.
- **Kết quả mong đợi:** khoản đã ghi xuất hiện ở cả hai nơi; số dư `S0 − 500.000đ`; không có trạng thái chờ duyệt. Bổ sung ảnh/đối chiếu không trừ lần hai. Khoản công ty trả trực tiếp không trừ thêm vào ví Ops.
- **Bằng chứng:** số dư trước/sau, mã khoản và lịch sử chứng từ/đối chiếu.
---

## 5.2 — Màn hình 2: Theo dõi phương tiện được giao (`/ops/fleet-tracking`)

### TC-OPS-XE-001 — Chuyến tự xuất hiện khi Điều vận gán xe thuộc danh sách Ops

- **Vai trò:** `dieuvan` + `giaonhan`
- **Mức độ:** P0
- **Tiền điều kiện:** xe `15C-284.56` được cấu hình do `giaonhan` quản lý
- **Các bước:**
  1. `giaonhan` mở `/ops/fleet-tracking`, ghi lại danh sách hiện có. **Không tải lại trang nữa.**
  2. `dieuvan` gán 1 chuyến mới cho xe `15C-284.56`.
  3. Quan sát lần cập nhật tự động khi có mạng; ghi thời gian thực tế, không bấm F5.
- **Kết quả mong đợi (Pass):**
  - Chuyến mới xuất hiện kịp thời khi cập nhật; không cần Ops nhận/claim. Nếu chưa lấy được dữ liệu mới thì nói rõ thời điểm đang xem; không khẳng định trạng thái cũ là hiện tại.
  - Xe/lệnh đúng phân công hiện hành; chuyển phân công thu hồi phạm vi cũ, không cấp nhầm quyền ghi chi.
  - Việc gán xe ↔ Ops do **Admin** cấu hình ở trang Đội xe (trường "Ops phụ trách"); một xe chỉ có **một** Ops active.
- **Kỳ vọng sai (Fail nếu):** Ops phải bấm nút/F5 để thấy chuyến; chuyến không xuất hiện.
- **Bằng chứng:** ảnh trước/sau **kèm đồng hồ** + ảnh thao tác gán của `dieuvan`

---

### TC-OPS-XE-002 — Danh sách đủ xe, lệnh, tài xế và tiến độ

- **Vai trò:** `giaonhan`
- **Mức độ:** P1
- **Các bước:** mở `/ops/fleet-tracking`, đọc cấu trúc bảng.
- **Kết quả mong đợi (Pass):**
  - Đọc được biển số, rơ-moóc, lệnh/mã lô, tài xế, tiến độ và lần cập nhật gần nhất.
  - Phân biệt chưa có lệnh, chờ lái xe nhận, đã nhận/đang thực hiện và hoàn thành; dữ liệu chưa cập nhật có thông tin thời điểm.
- **Bằng chứng:** danh sách và chi tiết trên ba kích thước màn hình

---

### TC-OPS-XE-003 — Trạng thái đồng bộ trực tiếp từ thao tác của Lái xe

- **Vai trò:** `laixe` + `giaonhan`
- **Mức độ:** P0
- **Tiền điều kiện:** chuyến của xe `15C-284.56` đang ở `Chờ nhận lệnh`
- **Các bước:**
  1. `giaonhan` mở `/ops/fleet-tracking`, xác nhận trạng thái `Chờ nhận lệnh`.
  2. `laixe` bấm **"Nhận lệnh vận chuyển"** trên app.
  3. `giaonhan` tải lại màn theo dõi.
- **Kết quả mong đợi (Pass):**
  - Trạng thái cho biết lái xe đã nhận, khớp bước tiến độ thực tế; không tự khẳng định đã di chuyển khi mới nhận lệnh.
  - Không chờ một bước phê duyệt; thời điểm cập nhật đọc được.
- **Bằng chứng:** ảnh trạng thái trước/sau + ảnh thao tác của `laixe`

---

### TC-OPS-XE-004 — Màn hình read-only tuyệt đối

- **Vai trò:** `giaonhan`
- **Mức độ:** **P0**
- **Các bước:**
  1. Mở `/ops/fleet-tracking`. Rà toàn bộ màn hình tìm nút/ô nhập.
  2. Thử click vào dòng, vào ô trạng thái.
- **Kết quả mong đợi (Pass):**
  - **Không có** nút xác nhận, duyệt, sửa, hủy — bất kỳ mutation nào.
  - Click vào dòng chỉ mở xem chi tiết (nếu có), không mở form sửa.
- **Kỳ vọng sai (Fail nếu):** tồn tại bất kỳ thao tác ghi nào trên màn này.
- **Bằng chứng:** ảnh toàn màn + danh sách phần tử tương tác (DOM)

---

### TC-OPS-XE-005 — Ops chỉ thấy xe được giao cho mình

- **Vai trò:** `giaonhan` + OPS thứ hai
- **Mức độ:** **P0** (phạm vi dữ liệu)
- **Các bước:**
  1. `giaonhan` mở `/ops/fleet-tracking`, ghi danh sách biển số.
  2. Đăng nhập OPS thứ hai, so sánh.
- **Kết quả mong đợi (Pass):** mỗi Ops chỉ thấy đúng các đầu xe được giao quản lý; 2 danh sách khác nhau.
- **Bằng chứng:** ảnh 2 danh sách

---

### TC-OPS-XE-006 — Ops chưa được gán xe nào: trang trống có hướng dẫn

- **Vai trò:** tài khoản OPS chưa được gán xe
- **Mức độ:** P1
- **Các bước:** đăng nhập tài khoản OPS chưa được Admin gán xe, mở `/ops/fleet-tracking`.
- **Kết quả mong đợi (Pass):**
  - Trang trống hiển thị thông điệp **"Chưa có xe nào được giao cho bạn quản lý"** + gợi ý liên hệ Admin.
  - **Không** lỗi JS, không bảng rỗng không nhãn, không spinner treo.
- **Kỳ vọng sai (Fail nếu):** màn trắng; lỗi console; hiện toàn bộ đội xe của công ty.
- **Bằng chứng:** ảnh trang trống + console sạch

---

## 5.3 — Quỹ tạm ứng cá nhân, chi phí và hoàn ứng (`/ops/wallet`)

### TC-OPS-VI-001 — Chỉ tiền đã thực giao mới là tiền ứng thực nhận

- **Vai trò:** `giaonhan`, `ketoan`; **Mức độ:** P0; **PRD:** Ops §5.1; O2C AC-CP-KT-07/09.
- **Các bước:**
  1. Mở thao tác ghi ứng với người nhận, số tiền 5.000.000đ, ngày, nguồn/tài khoản và chứng từ theo quy định; chưa lưu hoặc hủy.
  2. Xem số dư Ops và quỹ nguồn; kiểm tra một yêu cầu ứng lịch sử chưa có chứng cứ giao tiền.
  3. Người có quyền ghi khoản đã thực giao, rồi mở lại.
- **Kết quả mong đợi:** chưa lưu/yêu cầu cũ chưa có giao tiền không tăng số dư. Ghi tiền thực giao trực tiếp có người/ngày/nguồn; không qua hàng chờ duyệt và không tuyên bố ứng dụng đã chuyển tiền ngân hàng. Tài khoản chưa cấu hình có hướng xử lý, không dùng số minh họa.
- **Bằng chứng:** số dư trước/sau, phiếu thực giao và nguồn quỹ.

---

### TC-OPS-VI-002 — Ghi ứng một lần, quỹ nguồn và ví Ops khớp nhau

- **Vai trò:** `ketoan`, `giaonhan`; **Mức độ:** P0; **PRD:** Ops §5.1–5.2; O2C AC-CP-KT-09/12.
- **Các bước:** ghi số dư Ops `S0` và quỹ nguồn `Q0`; ghi thực giao 5.000.000đ; bấm lặp/thử lại cùng thao tác; mở lại hai nơi và lịch sử.
- **Kết quả mong đợi:** số dư Ops `S0 + 5.000.000đ`, quỹ nguồn `Q0 − 5.000.000đ`, một giao dịch liên kết đúng người nhận. Không phát sinh lần hai do tải lại, bấm lặp hoặc xác nhận kế toán.
- **Bằng chứng:** mã phiếu/giao dịch, hai số dư và lịch sử.

---

### TC-OPS-VI-003 — Số dư từ tiền thực tế, không từ trạng thái duyệt

- **Vai trò:** `giaonhan`; **Mức độ:** P0; **PRD:** Ops §5.2, §7.
- **Dữ liệu:** số dư đầu 100.000đ; nhận 500.000đ; thực chi từ quỹ 120.000đ; đã hoàn 50.000đ; không có điều chỉnh/giao dịch khác. Một phần chi đang thiếu ảnh.
- **Các bước:** đọc số dư, mở từng tổng tiền nhận/đã chi/đã hoàn; thêm ảnh rồi đối chiếu khoản chi, lập bảng kê; tải lại.
- **Kết quả mong đợi:** `100.000 + 500.000 − 120.000 − 50.000 = 430.000đ` trước và sau thêm ảnh/đối chiếu/bảng kê. Tổng truy ra đúng giao dịch; thiếu ảnh không hoàn lại tiền. Số dư âm ở dữ liệu khác vẫn đọc được, không gán nguyên nhân chưa có căn cứ. Tổng gọn, lịch sử xuất hiện sớm trên mobile; không dùng bốn nhóm chờ/đã duyệt/từ chối.
- **Bằng chứng:** các giao dịch nguồn và phép tính; ảnh mobile/tablet/desktop.

---

### TC-OPS-VI-004 — Lưu chậm, lỗi và chưa rõ kết quả không tạo tiền giả

- **Vai trò:** `giaonhan`; **Mức độ:** P0; **PRD:** Ops §6; O2C AC-CP-KT-12/22.
- **Các bước:**
  1. Ghi chi 300.000đ khi phản hồi chậm; bấm Lưu lặp. Kiểm tra trạng thái đang lưu và số dư đã ghi.
  2. Thử lỗi chắc chắn chưa ghi; thử mất phản hồi sau khi máy chủ đã ghi.
  3. Tra lại kết quả rồi chủ động thử lại cùng thao tác; thử mất mạng, nối lại và đổi tài khoản.
- **Kết quả mong đợi:** phân biệt đang lưu/đã lưu/lỗi/chưa rõ kết quả. Không trình bày khoản chưa xác nhận như tiền đã ghi; lỗi thật giữ nội dung để sửa. Phản hồi mất cho tra cứu trước khi nhập lại; chỉ một khoản 300.000đ được ghi. Không xếp hàng ngoại tuyến hay tự gửi khi nối mạng/đổi tài khoản; ảnh lỗi không bắt ghi lại tiền.
- **Bằng chứng:** trạng thái từng tình huống, mã khoản, số dư sau đọc lại.

---

### TC-OPS-VI-005 — Thiếu hoặc mờ chứng từ không hoàn tiền vào ví

- **Vai trò:** `ketoan`, `giaonhan`; **Mức độ:** P0; **PRD:** Ops §5.2–5.3, AC-CP-OPS-04.
- **Các bước:** lưu khoản 300.000đ với ảnh mờ/thiếu ảnh; ghi nhận tình trạng chứng từ; Ops bổ sung/thay ảnh trên khoản cũ; mở lại ví và ảnh.
- **Kết quả mong đợi:** nói rõ tài liệu còn thiếu/chưa đọc được; không có từ chối rồi gửi duyệt lại. Tiền vẫn là khoản đã thực chi 300.000đ, không cộng ngược rồi trừ lại. Ảnh mới thuộc đúng khoản, lịch sử còn truy được; không tạo chi phí trùng.
- **Bằng chứng:** mã khoản cố định, số dư không đổi và ảnh trước/sau.

---

### TC-OPS-VI-006 — Phân biệt hóa đơn, biên lai và giấy tờ còn thiếu

- **Vai trò:** `giaonhan`; **Mức độ:** P0; **PRD:** Ops §5.3, §8; AC-CP-OPS-04.
- **Các bước:** dùng loại phí có quy tắc chứng từ đã xác định; lưu một khoản thiếu tài liệu, một khoản đủ; dùng thêm loại không cần hóa đơn nhưng có biên lai; lọc nợ chứng từ rồi bổ sung đúng tài liệu.
- **Kết quả mong đợi:** nhãn bằng chữ nêu đúng tài liệu thiếu, không chỉ dựa vào màu. Có ảnh không tự coi đã có hóa đơn; không hóa đơn không tự coi thiếu mọi chứng từ. Bổ sung đủ bỏ cảnh báo phù hợp nhưng không đổi tiền hay tình trạng đã thanh toán. Loại chưa có quy tắc được ghi là cần làm rõ, không tự đặt giấy tờ bắt buộc.
- **Bằng chứng:** danh mục/quy tắc dùng thử, ba khoản và kết quả lọc.

---

### TC-OPS-VI-007 — Gom theo lô, giữ riêng người nhập và người thực chi

- **Vai trò:** hai Ops, `ketoan`; **Mức độ:** P0; **PRD:** AC-CP-OPS-05; O2C AC-CP-KT-04.
- **Các bước:** Ops A và B ghi hai khoản cho cùng lô; trong phạm vi cho phép, A ghi thay khoản B thực chi; kế toán xem tổng theo lô rồi theo nhân viên.
- **Kết quả mong đợi:** tổng lô chứa mỗi khoản một lần; còn đọc được người nhập và người thực chi khác nhau. Ví/hoàn ứng theo người và nguồn thực tế, không tự lấy người nhập làm người trả. Xem kế hoạch toàn công ty không cấp quyền đọc khoản/ảnh ngoài phạm vi.
- **Bằng chứng:** mã lô/khoản, hai trường người và đối chiếu tổng.

---

### TC-OPS-VI-008 — Dữ liệu và ảnh nhất quán trên ba thiết bị khi có mạng

- **Vai trò:** `giaonhan`; **Mức độ:** P1; **PRD:** Ops §6.
- **Các bước:** trên điện thoại ghi khoản chi/chụp hoặc chọn ảnh; mở lại trên desktop và tablet; thay ảnh rồi mở lại trên mobile. Thử tên dài, trường tiền, ngày, ghi chú và bàn phím ảo.
- **Kết quả mong đợi:** cùng số tiền/ảnh/trạng thái sau tải lại trực tuyến; không cần nhập lại. Ảnh đầy đủ và phóng xem được; lỗi ảnh cho thử lại đúng khoản. Trường/nút nhất quán, không tràn toàn trang, hành động không bị bàn phím che; không hiện thanh cuộn dọc trên mobile nhưng nội dung vẫn cuộn/chạm được.
- **Bằng chứng:** cùng mã khoản trên 390px/820px/desktop và ảnh đọc lại.

---

### TC-OPS-VI-009 — Bảng kê theo lô và hai nhóm hóa đơn

- **Vai trò:** `giaonhan`; **Mức độ:** P0; **PRD:** Ops §5.4, §9.2; AC-CP-OPS-09.
- **Dữ liệu:** ít nhất bốn khoản thực chi chưa quyết toán thuộc hai lô; có/không hóa đơn; thêm khoản đã quyết toán và khoản ngoài quyền.
- **Các bước:** lập bảng kê trong phạm vi ngày/đợt được chọn; xem danh sách nguồn và số lượng/tổng trước lưu; mở lại theo lô rồi theo nhân viên.
- **Kết quả mong đợi:** nhóm đúng Bill/Booking và có/không hóa đơn; đúng người thực chi và tổng từng nhóm. Không lấy lại khoản đã quyết toán/nằm trong phiếu khác, khoản bị hủy hoặc ngoài quyền. Chọn tất cả nói rõ phạm vi; không phụ thuộc nhãn phê duyệt cũ.
- **Bằng chứng:** mã bảng kê, danh sách nguồn và tổng; lý do dòng không đủ điều kiện.

---

### TC-OPS-VI-010 — Xuất Excel, in A4 và kế toán xem cùng bảng kê

- **Vai trò:** `giaonhan`, `ketoan`; **Mức độ:** P1; **PRD:** Ops §5.4, AC-CP-OPS-09.
- **Các bước:** xuất Excel và mở bản in A4 từ bảng kê; kế toán có quyền mở đúng mã trong màn chi phí Ops/hoàn ứng.
- **Kết quả mong đợi:** đủ nhóm lô, người chi, hai nhóm hóa đơn, ngày/đợt và tổng đúng như bản đã lưu; kế toán không cần Ops nhập/gửi lại khoản chi. Xuất/in/xem không thay tiền hoặc trạng thái thanh toán. PDF lưu từ bản in nếu dùng phải khớp bản in; không bắt buộc thêm một trình xuất PDF riêng.
- **Bằng chứng:** mã bảng kê, Excel, bản in và màn kế toán.

---

### TC-OPS-VI-011 — Đối chiếu kế toán trực tiếp, không trừ quỹ lần hai

- **Vai trò:** `ketoan`; **Mức độ:** P0; **PRD:** AC-CP-OPS-06; O2C AC-CP-KT-06.
- **Dữ liệu:** khoản đủ dữ liệu, khoản thiếu chứng từ bắt buộc theo quy tắc đã xác định, khoản bị khóa/đã đổi đồng thời.
- **Các bước:** chọn một/nhiều khoản ghi nhận đối chiếu; thử với các dòng không còn đủ điều kiện; bổ sung chứng từ hợp lệ rồi thao tác lại.
- **Kết quả mong đợi:** người có quyền đối chiếu trực tiếp, ghi đúng người/ngày. Dòng bị chặn có lý do thực tế và cách xử lý, không tạo hàng đợi duyệt hoặc thông báo thành công toàn bộ khi còn lỗi. Số dư không bị trừ lại; đối chiếu không chứng minh đã chuyển tiền hoặc nhận chứng từ giấy. Hoàn thành chuyến không phụ thuộc thao tác này.
- **Bằng chứng:** kết quả từng dòng, lịch sử người/ngày, số dư trước/sau.

---

### TC-OPS-VI-012 — Mã bảng kê riêng, không dùng trùng chi phí hoặc tiền ứng

- **Vai trò:** `giaonhan`, `ketoan`; **Mức độ:** P0; **PRD:** Ops §5.4; AC-CP-OPS-09.
- **Các bước:** lập và chốt bảng kê thứ nhất; ghi thêm chi phí; mở lại bảng kê cũ; lập đợt thứ hai; thử chọn lại khoản chi và phân bổ toàn bộ khoản ứng đã dùng ở đợt trước.
- **Kết quả mong đợi:** mã riêng; bảng đã chốt không tự thêm chi phí mới. Mỗi chi phí thuộc đúng đợt, phần ứng đã phân bổ không được dùng trùng. Tổng chi/phần ứng/đã thanh toán/còn lại truy được nguồn; đợt thứ hai không lấy toàn bộ ứng lần nữa.
- **Bằng chứng:** hai mã bảng kê, nguồn chi/ứng và phép tính phân bổ.

---

### TC-OPS-VI-013 — Bản in A4 đọc được và khớp hồ sơ

- **Vai trò:** `giaonhan`; **Mức độ:** P1; **PRD:** Ops §5.4.
- **Các bước:** mở bản in của bảng kê có nhiều lô, tên dài và đủ dòng để sang trang; đối chiếu bản đã lưu.
- **Kết quả mong đợi:** không menu/sidebar, không cắt cột/số tiền; đủ mã phiếu, người lập, ngày/đợt, lô, nhóm hóa đơn và tổng. Chữ ký trên giấy nếu có không tạo cấp duyệt trong ứng dụng. Không mất dòng khi sang trang.
- **Bằng chứng:** print preview/PDF từ bản in và tổng đối chiếu.

---

### TC-OPS-VI-014 — Hoàn ứng đúng chiều và điều chỉnh không ghi đè lịch sử

- **Vai trò:** `ketoan`, `giaonhan`; **Mức độ:** P0; **PRD:** AC-CP-OPS-07/08/10; O2C AC-CP-KT-20.
- **Dữ liệu:** hai đợt độc lập, mỗi đợt có số dư đầu 0 và nhận ứng thực tế 1.000.000đ, không có giao dịch khác. Đợt A chi 1.200.000đ; đợt B chi 800.000đ.
- **Các bước:**
  1. Lập/đối chiếu/quyết toán các đợt trực tiếp khi đủ dữ liệu; xem nghĩa vụ còn lại và ví.
  2. Ghi công ty trả bổ sung 200.000đ cho A; ghi Ops hoàn trả thực tế 200.000đ cho B; thử lại cùng thao tác.
  3. Thử sửa khoản trong kỳ khóa/đã thanh toán; ở trường hợp được phép, thực hiện điều chỉnh có lý do và liên kết khoản gốc.
- **Kết quả mong đợi:** A: công ty cần trả 200.000đ, ví −200.000đ trước trả bổ sung. B: Ops cần hoàn 200.000đ, ví +200.000đ trước hoàn. Lập/đối chiếu bảng không tự chuyển tiền; sau ghi thanh toán/hoàn thực tế mỗi nghĩa vụ và ví về 0 một lần. Không ép số ví cùng dấu với `chi − ứng`. Khóa kỳ không tự mở; điều chỉnh giữ số cũ, số mới, lý do, người và thời điểm. Không duyệt từng khoản rồi duyệt cả phiếu, không khóa vĩnh viễn chỉ vì từng có nhãn duyệt.
- **Bằng chứng:** báo cáo hai đợt, phiếu tiền liên kết, số dư và lịch sử điều chỉnh.

---

## 5.4 — Phân quyền

### TC-OPS-RBAC-001 — Vai trò khác không vào được `/ops/*`

- **Vai trò thử:** `laixe`, `cus`, `dieuvan`, `customer`
- **Mức độ:** P0
- **Các bước:** với từng vai trò, mở trực tiếp `/ops/orders`, `/ops/fleet-tracking`, `/ops/wallet`.
- **Kết quả mong đợi (Pass):**
  - Bị chuyển hướng im lặng về màn nhà của vai trò; không nháy nội dung bị cấm.
  - API trả 403; body không lộ dữ liệu.
  - Sidebar không hiển thị mục `/ops/*` cho các vai trò này.
- **Bằng chứng:** ảnh redirect từng vai trò + Network 403

---

### TC-OPS-RBAC-002 — Ops không vào được màn văn phòng

- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Các bước:** mở `/dispatch`, `/dispatch-detail`, `/shipments`, `/finance`, `/audit-logs`.
- **Kết quả mong đợi (Pass):** tất cả bị chặn, redirect về `/ops/orders`.
- **Bằng chứng:** ảnh redirect từng route

---

## Bảng nghiệm thu — Luồng Ops

| Ngày thử | Mã TC | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|-----------|---------|---------|------------|
| __/__/__ | TC-OPS-KH-001 | | | Danh sách tổng thể lô hàng theo ngày | |
| __/__/__ | TC-OPS-KH-002 | | | Ghim lệnh: lô được ghim lên đầu danh sách | |
| __/__/__ | TC-OPS-KH-003 | | | Ghim là sổ tay CÁ NHÂN, không rò sang Ops khác | |
| __/__/__ | TC-OPS-KH-004 | | | Khai báo chi phí đúng lô, container và người thực chi | |
| __/__/__ | TC-OPS-KH-005 | | | Lưu thực chi cập nhật quỹ đúng một lần | |
| __/__/__ | TC-OPS-XE-001 | | | Chuyến tự xuất hiện khi Điều vận gán xe thuộc danh sách Ops | |
| __/__/__ | TC-OPS-XE-002 | | | Danh sách đủ xe, lệnh, tài xế và tiến độ | |
| __/__/__ | TC-OPS-XE-003 | | | Trạng thái đồng bộ trực tiếp từ thao tác của Lái xe | |
| __/__/__ | TC-OPS-XE-004 | | | Màn hình read-only tuyệt đối | |
| __/__/__ | TC-OPS-XE-005 | | | Ops chỉ thấy xe được giao cho mình | |
| __/__/__ | TC-OPS-XE-006 | | | Ops chưa được gán xe nào: trang trống có hướng dẫn | |
| __/__/__ | TC-OPS-VI-001 | | | Chỉ tiền đã thực giao mới là tiền ứng thực nhận | |
| __/__/__ | TC-OPS-VI-002 | | | Ghi ứng một lần, quỹ nguồn và ví Ops khớp nhau | |
| __/__/__ | TC-OPS-VI-003 | | | Số dư từ tiền thực tế, không từ trạng thái duyệt | |
| __/__/__ | TC-OPS-VI-004 | | | Lưu chậm, lỗi và chưa rõ kết quả không tạo tiền giả | |
| __/__/__ | TC-OPS-VI-005 | | | Thiếu hoặc mờ chứng từ không hoàn tiền vào ví | |
| __/__/__ | TC-OPS-VI-006 | | | Phân biệt hóa đơn, biên lai và giấy tờ còn thiếu | |
| __/__/__ | TC-OPS-VI-007 | | | Gom theo lô, giữ riêng người nhập và người thực chi | |
| __/__/__ | TC-OPS-VI-008 | | | Dữ liệu và ảnh nhất quán trên ba thiết bị khi có mạng | |
| __/__/__ | TC-OPS-VI-009 | | | Bảng kê theo lô và hai nhóm hóa đơn | |
| __/__/__ | TC-OPS-VI-010 | | | Xuất Excel, in A4 và kế toán xem cùng bảng kê | |
| __/__/__ | TC-OPS-VI-011 | | | Đối chiếu kế toán trực tiếp, không trừ quỹ lần hai | |
| __/__/__ | TC-OPS-VI-012 | | | Mã bảng kê riêng, không dùng trùng chi phí hoặc tiền ứng | |
| __/__/__ | TC-OPS-VI-013 | | | Bản in A4 đọc được và khớp hồ sơ | |
| __/__/__ | TC-OPS-VI-014 | | | Hoàn ứng đúng chiều và điều chỉnh không ghi đè lịch sử | |
| __/__/__ | TC-OPS-RBAC-001 | | | Vai trò khác không vào được `/ops/*` | |
| __/__/__ | TC-OPS-RBAC-002 | | | Ops không vào được màn văn phòng | |
