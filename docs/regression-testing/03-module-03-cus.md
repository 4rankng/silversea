# M03 — CUS: Chăm sóc khách hàng, lô hàng, giấy báo nợ và cổng khách hàng

> **Phân hệ 3** — 7 nhóm nghiệp vụ (3.1–3.7). Nguồn PRD: `docs/prd/Module3.docx` (Trạng thái: *đề xuất của
> TingTing, chưa thành yêu cầu chính thức cho đến khi Silver Sea xác nhận*).
> **Tiêu chí nghiệm thu toàn phân hệ:** `HT-01` … `HT-12` (xem bảng ở cuối tệp và `00-cross-cutting.md`).
> **Đặc thù M03:** thêm hai nhóm HT riêng — `HT-11 Bảo mật` và `HT-12 Đối chiếu cuối kỳ`.
>
> **Màn hình chính cần thử:**
>
> | Màn (URL)                                            | Vai trò thử            |
> | ---------------------------------------------------- | ---------------------- |
> | `/customers`                                         | admin                  |
> | `/customers/:id`                                     | admin                  |
> | `/customers/:id/billing/new`                         | admin                  |
> | `/shipments`                                         | admin / ketoan         |
> | `/shipments/:id`                                     | admin / ketoan         |
> | `/portal/shipments`                                  | customer               |
> | `/portal/shipments/:id`                              | customer               |
> | `/portal/debit-notes`                                | customer               |
>
> Quy ước tên vai trò: `admin` (ADMIN), `ketoan` (ACCOUNTANT), `giaonhan` (FORWARDER — thay thế nhân viên
> CUS trong demo), `customer` (CUSTOMER). Mật khẩu mọi tài khoản: `admin123` (xem `README.md` §2).
>
> **Lưu ý phân quyền đã xác nhận trong code:** `/customers/*` và `/shipments/*` chỉ ADMIN + MANAGER +
> ACCOUNTANT được vào; `giaonhan` và `customer` bị redirect; `/portal/*` chỉ CUSTOMER được vào; `admin` là
> superuser. Khi ca yêu cầu quyền CUS, dùng `admin` thay CUS nếu chưa có role CUS riêng.

---

## 3.1 — Tiếp nhận yêu cầu đặt chỗ và tạo hồ sơ lô hàng

**Quy tắc nghiệp vụ (paraphrase PRD M3-3.1):** Trường bắt buộc khi tạo lô là *khách hàng, số vận đơn hoặc
mã tham chiếu, ngày giao dự kiến, điểm nhận và điểm giao*. Container/seal/tờ khai có thể bổ sung trước khi
điều xe. Một vận đơn được phép có nhiều container (mỗi container có chứng từ riêng); tờ khai mặc định theo
container, chỉ dùng chung nhiều container khi người có thẩm quyền xác nhận ngoại lệ. Mã lô tự sinh, duy nhất,
đề xuất dạng `{customerCode}-{YYMMDD}-{NNN}`. Chỉ nhân viên CUS mới tạo/sửa; khách chỉ gửi yêu cầu qua cổng.

### TC-M03-01-01 — Tạo lô với dữ liệu tối thiểu hợp lệ

- **Mã PRD:** CUS-01-01
- **Vai trò:** `admin`
- **Tiền điều kiện:** có khách A (`/customers`) và một tuyến điểm nhận/điểm giao đã có sẵn trong danh mục.
- **Các bước:**
  1. Mở `/customers/:id` (khách A). Bấm "Tạo lô mới" (hoặc vào `/shipments` → "Tạo lô").
  2. Nhập: khách A, số vận đơn `BL-A001`, ngày giao dự kiến `05/08/2026`, điểm nhận `Cảng Hải Phòng`,
     điểm giao `Kho Long Biên`.
  3. Để trống số công-te-nơ và tờ khai. Bấm "Lưu".
- **Kết quả mong đợi (Pass):**
  - Hệ thống sinh mã lô duy nhất có dạng `{mã khách A}-YYMMDD-NNN` (ví dụ `SSA-260805-001`).
  - Trạng thái lô: `DRAFT` (Đang xử lý / Nháp) — chưa chuyển sang bước điều xe.
  - Lưu đúng `createdBy`, `createdAt` (mở Adminer bảng `shipments`).
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh màn `/shipments/:id` + ảnh Adminer dòng `shipments` mới.

### TC-M03-01-02 — Lưu nháp khi chưa có số công-te-nơ

- **Mã PRD:** CUS-01-02
- **Vai trò:** `admin`
- **Tiền điều kiện:** lô A ở TC-M03-01-01 đã tạo.
- **Các bước:**
  1. Mở `/shipments/:id` của lô A. Bấm "Chuyển sang điều xe".
  2. Quan sát cảnh báo hiển thị.
- **Kết quả mong đợi (Pass):**
  - Bước điều xe **bị chặn**; hiển thị danh sách "Còn thiếu: số công-te-nơ, tờ khai".
  - Lô vẫn ở trạng thái nháp, dữ liệu đã nhập không mất.

### TC-M03-01-03 — Một vận đơn có nhiều công-te-nơ

- **Mã PRD:** CUS-01-03
- **Vai trò:** `admin`
- **Tiền điều kiện:** lô A đã có dữ liệu cơ bản.
- **Các bước:**
  1. Mở `/shipments/:id`. Thêm 2 công-te-nơ: `MSCU1234567` và `MSDU9876543` vào cùng một vận đơn `BL-A001`.
  2. Mỗi công-te-nơ nhập số niêm phong riêng (`SEAL-01`, `SEAL-02`).
  3. Lưu. Tìm lô theo từng số công-te-nơ trên `/shipments` (ô tìm kiếm).
- **Kết quả mong đợi (Pass):**
  - Hai container hiển thị 2 dòng riêng, không mất dữ liệu.
  - Tìm theo `MSCU1234567` hoặc `MSDU9876543` đều ra đúng lô A.

### TC-M03-01-04 — Phát hiện hồ sơ trùng

- **Mã PRD:** CUS-01-04
- **Vai trò:** `admin`
- **Tiền điều kiện:** lô A đã tạo với khách A, `BL-A001`, ngày giao `05/08/2026`.
- **Các bước:**
  1. Mở `/shipments` → "Tạo lô".
  2. Nhập y hệt: khách A, `BL-A001`, ngày giao `05/08/2026`.
  3. Bấm "Lưu".
- **Kết quả mong đợi (Pass):**
  - Cảnh báo "Hồ sơ có khả năng trùng" bằng tiếng Việt, gợi ý lô A đã có.
  - Không cho tiếp tục trừ khi có lý do + quyền phù hợp.

### TC-M03-01-05 — Phân quyền sửa lô (Kiểm soát quyền)

- **Mã PRD:** CUS-01-05
- **Vai trò:** `giaonhan`, `customer`
- **Tiền điều kiện:** lô A đã tạo.
- **Các bước:**
  1. Đăng nhập `giaonhan`. Truy cập trực tiếp `/shipments/:id` của lô A.
  2. Đăng nhập `customer`. Truy cập `/shipments/:id` (route admin, không phải portal).
  3. Quan sát response.
- **Kết quả mong đợi (Pass):**
  - `giaonhan` bị redirect về `/my-forwarder-trips` (không có quyền office staff).
  - `customer` bị redirect về `/portal/shipments` (chỉ được vào portal).
  - API trả 403 (DevTools Network tab). Nhật ký có ghi nhận lần thử truy cập.

### TC-M03-01-06 — Trường hợp biên / gửi lại đồng thời (double-submit khi tạo lô)

- **Mã PRD:** CUS-01-01 + CUS-01-04 (biên)
- **Vai trò:** `admin`
- **Các bước:**
  1. DevTools → Network throttling = "Slow 3G".
  2. `/shipments` → "Tạo lô" với dữ liệu hợp lệ.
  3. Bấm "Lưu" **2 lần liên tiếp** trước khi request đầu trả về.
- **Kết quả mong đợi (Pass):**
  - Chỉ tạo **1 lô** trong DB (kiểm tra Adminer `shipments`).
  - Mã lô sinh ra duy nhất; toast "Đã lưu thành công" đúng 1 lần.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh Network (2 request, cùng `id`) + ảnh Adminer.

### TC-M03-01-07 — Xem rồi mới sửa chi tiết công-te-nơ trong bảng lô

- **Vai trò:** `admin` (hoặc vai trò CUS được cấp quyền sửa lô).
- **Tiền điều kiện:** có một lô trên `/shipments` chứa ít nhất một công-te-nơ và quyền sửa dữ liệu vận hành.
- **Các bước:**
  1. Mở `/shipments`. Xác nhận bảng lô không có cột hay nút riêng tên “Chi tiết”.
  2. Bấm vùng không tương tác của dòng lô. Kiểm tra phần “Chi tiết container” xuất hiện ngay dưới dòng lô.
  3. Kiểm tra danh sách ban đầu chỉ đọc theo hai tầng cho từng container: **Nhận diện** gồm `Số cont`,
     `Loại cont`, `Hãng tàu`, `Điều vận`; **Vận hành** gồm `Nhà xe`, `Biển số xe`, `Nâng`, `Hạ`,
     `Giờ đóng/trả`. Không có ô nhập hoặc nút lưu từng dòng.
  4. Bấm “Chỉnh sửa”, sửa một trường vận hành hợp lệ và lưu dòng công-te-nơ. Bấm “Hoàn tất”.
  5. Mở lại phần chi tiết, sửa nhưng không lưu, rồi bấm “Thu gọn”; xác nhận cảnh báo không làm mất thay đổi
     ngoài ý muốn. Sau đó chọn bỏ thay đổi và thu gọn.
  6. Thử lại ở màn hình rộng, tablet và điện thoại. Trên điện thoại, mở phần chi tiết từ thẻ lô và xác nhận
     cùng dữ liệu hiện trong drawer trước khi bấm “Chỉnh sửa”.
- **Kết quả mong đợi (Pass):**
  - Click dòng là cách mở chi tiết; không thêm cột “Chi tiết” làm giảm không gian dữ liệu của bảng chính.
  - Phần mở rộng là chi tiết container hai tầng, chỉ đọc trước; chỉ “Chỉnh sửa” mới hiển thị ô nhập và nút lưu theo dòng.
  - “Thu gọn” luôn nhìn thấy trong phần chi tiết đang mở, đóng đúng lô và đưa bàn phím trở về dòng vừa mở.
  - `Ngày vận chuyển` và `Phơi phiếu` vẫn ở dòng lô; chi phí chi tiết không xuất hiện trong luồng CUS này.
  - Không có cuộn ngang ở bảng chính hoặc phần chi tiết. Drawer điện thoại có bố cục nhãn–giá trị gọn,
    thao tác chạm được và giữ nguyên dữ liệu khi chưa bắt đầu sửa.
- **Bằng chứng:** ảnh 1440px, tablet, 390px; ảnh trạng thái chỉ đọc và sau khi bấm “Chỉnh sửa”; request lưu
  container và ảnh xác nhận trước khi bỏ thay đổi.

---

## 3.2 — Kiểm tra chứng từ và số liệu lô hàng

**Quy tắc nghiệp vụ (paraphrase PRD M3-3.2):** Kiểm tra mã công-te-nơ theo **ISO 6346** (cấu trúc + chữ số
kiểm tra), kiểm tra tờ khai trống/ký tự lạ/số trùng, đối chiếu số vận đơn lúc tải lên và trước khi điều xe.
Cho phép lưu nháp khi thiếu chứng từ nhưng **chặn mọi mốc nghiệp vụ** yêu cầu chứng từ đó. Thay tệp chứng
từ thì bản mới là bản dùng, bản cũ vẫn tra cứu được trong lịch sử (trường `replacedBy`).

### TC-M03-02-01 — Bộ chứng từ hợp lệ

- **Mã PRD:** CUS-02-01
- **Vai trò:** `admin`
- **Tiền điều kiện:** lô A ở 3.1 đã có container + niêm phong.
- **Các bước:**
  1. Mở `/shipments/:id` → tab "Chứng từ".
  2. Tải lên: vận đơn `BL-A001.pdf`, tờ khai số `DK-2026-001` (mỗi container), lệnh giao hàng `DO-A001.pdf`
     còn hiệu lực.
  3. Bấm "Kiểm tra chứng từ".
- **Kết quả mong đợi (Pass):**
  - Hiển thị nhãn "Đã kiểm tra" tiếng Việt.
  - Nút "Chuyển sang điều xe" mở khóa.

### TC-M03-02-02 — Mã công-te-nơ không hợp lệ (ISO 6346)

- **Mã PRD:** CUS-02-02
- **Vai trò:** `admin`
- **Các bước:**
  1. `/shipments/:id` → sửa một container thành `MSCU1234560` (sai check digit).
  2. Lưu.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo tiếng Việt chỉ rõ vị trí sai (chữ số kiểm tra).
  - Không cho xác nhận chứng từ.
- **Bằng chứng:** ảnh cảnh báo + ảnh highlight trường sai.

### TC-M03-02-03 — Tờ khai trùng có lý do hợp lệ (ngoại lệ được duyệt)

- **Mã PRD:** CUS-02-03
- **Vai trò:** `admin`
- **Các bước:**
  1. Lô có 2 container; gán tờ khai `DK-2026-001` cho cả 2 (phạm vi `SHARED`).
  2. Hệ thống cảnh báo trùng tờ khai. Bấm "Xác nhận ngoại lệ" + nhập lý do.
- **Kết quả mong đợi (Pass):**
  - Lưu được với scope `SHARED`; lý do và người duyệt lưu vào nhật ký.
  - Chỉ người có quyền mới thấy nút "Xác nhận ngoại lệ".

### TC-M03-02-04 — Chứng từ hết hiệu lực (lệnh giao hàng quá hạn)

- **Mã PRD:** CUS-02-04
- **Vai trò:** `admin`
- **Các bước:**
  1. Tải lên lệnh giao hàng `DO-A001.pdf` với `expiresAt = 01/07/2026` (đã quá hạn so với hôm nay 26/07/2026).
  2. Bấm "Chuyển sang điều xe".
- **Kết quả mong đợi (Pass):**
  - Cảnh báo "Lệnh giao hàng đã hết hạn"; **chặn** điều xe.
  - Yêu cầu thay chứng từ hoặc duyệt ngoại lệ.

### TC-M03-02-05 — Thay tệp chứng từ (giữ lịch sử bản cũ)

- **Mã PRD:** CUS-02-05
- **Vai trò:** `admin`
- **Các bước:**
  1. Tải bản mới `BL-A001-v2.pdf` thay cho `BL-A001.pdf`.
  2. Mở lịch sử chứng từ của lô.
- **Kết quả mong đợi (Pass):**
  - Bản mới trở thành bản đang dùng.
  - Bản cũ vẫn tra cứu được (Adminer: `shipment_documents.replaced_by` trỏ sang id bản mới).

### TC-M03-02-06 — Phân quyền / gửi lại đồng thời: tải trùng chứng từ

- **Mã PRD:** CUS-02-01 + CUS-02-04 (biên)
- **Vai trò:** `ketoan`, `customer`
- **Các bước:**
  1. `ketoan` mở `/shipments/:id` (được vào vì là office staff). Tải lên chứng từ → thành công.
  2. `customer` truy cập `/shipments/:id` (route admin) → bị redirect về portal.
  3. `admin` bấm "Tải lên" 2 lần liên tiếp cùng tệp (Slow 3G).
- **Kết quả mong đợi (Pass):**
  - `ketoan` thao tác được; `customer` bị chặn.
  - Double-submit chỉ tạo 1 bản ghi `shipment_documents`.
- **Phụ thuộc:** không

---

## 3.3 — Thông báo tiến độ lô hàng cho khách hàng

**Quy tắc nghiệp vụ (paraphrase PRD M3-3.3):** Cổng thông tin khách hàng là kênh chính, email là kênh dự
phòng; thông báo đẩy trên thiết bị chỉ khi khách đã cho phép. Các mốc: *tiếp nhận, đã lấy cont, đang vận
chuyển, đã giao, chờ xác nhận chi phí, đã lập giấy báo nợ, đã thanh toán*. Tiến độ tự cập nhật từ trạng thái
chuyến; CUS được thêm ghi chú thủ công khi đổi lịch/sự cố. GPS chỉ hiển thị khi được phép và trong khoảng
thời gian vận chuyển (không hiển thị sau khi hoàn thành).

### TC-M03-03-01 — Cập nhật tiến độ thông thường (tự động từ chuyến)

- **Mã PRD:** CUS-03-01
- **Vai trò:** `admin` (đổi trạng thái chuyến), `customer` (xem)
- **Tiền điều kiện:** lô A đã điều xe và có chuyến gắn.
- **Các bước:**
  1. `admin` mở chuyến của lô A, chuyển trạng thái `IN_TRANSIT` (Đang vận chuyển).
  2. Đăng nhập `customer`. Mở `/portal/shipments/:id`.
- **Kết quả mong đợi (Pass):**
  - Cổng hiển thị mốc "Đang vận chuyển" với thời điểm cập nhật.
  - Có thông báo trên cổng + lưu thời điểm gửi/xem.
- **Phụ thuộc:** không (cron email retry phụ thuộc Q05).

### TC-M03-03-02 — Khách chưa bật thông báo trên thiết bị (email dự phòng)

- **Mã PRD:** CUS-03-02
- **Vai trò:** `admin`, `customer`
- **Các bước:**
  1. `customer` tắt thông báo đẩy trên thiết bị (mô phỏng bằng cờ user).
  2. `admin` đổi mốc tiến độ lô.
- **Kết quả mong đợi (Pass):**
  - Vẫn hiển thị mốc mới trên `/portal/shipments`.
  - Email gửi dự phòng nếu đã đăng ký; không cản trở nghiệp vụ.

### TC-M03-03-03 — Thay đổi lịch giao (CUS thêm ghi chú thủ công)

- **Mã PRD:** CUS-03-03
- **Vai trò:** `admin`
- **Các bước:**
  1. `/shipments/:id` → cập nhật ngày/giờ giao mới + nhập lý do "Tắc đường".
  2. Lưu.
- **Kết quả mong đợi (Pass):**
  - `customer` nhận thông báo nêu rõ: lịch cũ, lịch mới, lý do.
  - Lịch sử tiến độ **không bị ghi đè** — có dòng mới kèm lý do.

### TC-M03-03-04 — Gửi lại thông báo thất bại (retry email)

- **Mã PRD:** CUS-03-04
- **Vai trò:** `admin`
- **Các bước:**
  1. `admin` mở `/config/app-settings` và cấu hình Resend API key. Nếu muốn kiểm tra nhánh FAILED/retry,
     dùng điều kiện buộc provider trả lỗi; để trống chỉ kiểm tra console fallback.
  2. Kích hoạt mốc tiến độ.
- **Kết quả mong đợi (Pass):**
  - Hệ thống ghi nhận trạng thái `FAILED`; thử lại theo lịch retry.
  - Có bảng/dashboard cho CUS biết email chưa gửi được.
- **Phụ thuộc:** **Q05** (kênh ưu tiên & retry 3 lần: 15ph, 2h, 24h — `pending`).

### TC-M03-03-05 — Bảo vệ dữ liệu giữa khách hàng (phân quyền chéo)

- **Mã PRD:** CUS-03-05
- **Vai trò:** `customer` (khách A), dữ liệu khách B
- **Các bước:**
  1. Đăng nhập `customer` (liên kết với khách A).
  2. Truy cập trực tiếp `/portal/shipments/<id-lô-của-khách-B>`.
  3. Truy cập trực tiếp URL tệp PDF chứng từ của lô B.
- **Kết quả mong đợi (Pass):**
  - 404/403; không để lộ tên khách B, vị trí GPS, chứng từ.
  - URL tệp PDF yêu cầu auth, không tải được khi chưa đăng nhập đúng khách.

### TC-M03-03-06 — Biên: GPS chỉ hiện trong lúc vận chuyển

- **Mã PRD:** CUS-03-01 + CUS-03-05 (biên)
- **Vai trò:** `customer`
- **Các bước:**
  1. Lô đang `IN_TRANSIT` → mở `/portal/shipments/:id` → kiểm tra có hiển thị GPS.
  2. Chuyển lô sang `DELIVERED` → mở lại trang.
- **Kết quả mong đợi (Pass):**
  - Khi đang vận chuyển và khách đã cho phép: có bản đồ/vị trí.
  - Sau khi đã giao: GPS **không hiển thị** nữa.

---

## 3.4 — Xác nhận giao hàng và trả hoặc rút công-te-nơ

**Quy tắc nghiệp vụ (paraphrase PRD M3-3.4):** Lái xe ghi nhận tại điểm giao, CUS kiểm tra và xác nhận,
khách có thể xác nhận đã nhận. Lưu các mốc: *lấy cont, giao hàng, rút hàng, trả vỏ, hạn giờ cảng/hãng tàu*.
Thời gian miễn phí lưu bãi theo thỏa thuận từng khách/cảng/hãng/loại cont. Giao trễ → cảnh báo sớm + lý do
+ người chịu trách nhiệm; phụ phí chỉ tính theo quy tắc đã chốt. Cho phép xác nhận thủ công khi thiếu định
vị nhưng phải có lý do và quyền.

### TC-M03-04-01 — Xác nhận đủ ba bên

- **Mã PRD:** CUS-04-01
- **Vai trò:** `laixe`, `admin`, `customer`
- **Tiền điều kiện:** lô A có chuyến đã `DELIVERED` (chưa hoàn tất giao).
- **Các bước:**
  1. `laixe` ghi nhận thời điểm giao hàng trên `/my-trips/:id`.
  2. `admin` xác nhận mốc giao (CUS verify).
  3. `customer` xác nhận đã nhận hàng trên `/portal/shipments/:id`.
- **Kết quả mong đợi (Pass):**
  - 3 mốc thời gian + 3 người thực hiện đều lưu.
  - Lô chuyển đúng trạng thái hoàn tất.

### TC-M03-04-02 — Xác nhận thủ công khi thiếu mốc lái xe

- **Mã PRD:** CUS-04-02
- **Vai trò:** `admin`
- **Các bước:**
  1. Khách báo đã nhận nhưng lái xe chưa cập nhật mốc.
  2. `admin` mở `/shipments/:id` → bấm "Xác nhận thay" + nhập lý do + đính chứng cứ.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo "Chưa có mốc từ lái xe", cho xác nhận kèm lý do + chứng cứ.
  - Lưu nhật ký đầy đủ (người xác nhận, lý do, thời điểm).

### TC-M03-04-03 — Giao một phần (lô nhiều container)

- **Mã PRD:** CUS-04-03
- **Vai trò:** `admin`
- **Các bước:**
  1. Lô A có 2 cont; chỉ cont 1 đã giao.
  2. Đánh dấu cont 1 đã hoàn tất, cont 2 chưa.
- **Kết quả mong đợi (Pass):**
  - Chỉ cont 1 ở trạng thái đã giao; cont 2 còn "Chưa giao".
  - Lô tổng hiển thị "Giao một phần".

### TC-M03-04-04 — Trả vỏ quá hạn (tính phí lưu bãi)

- **Mã PRD:** CUS-04-04
- **Vai trò:** `admin`
- **Tiền điều kiện:** đã cấu hình miễn phí lưu bãi cho khách/cảng/loại cont (ví dụ 5 ngày).
- **Các bước:**
  1. Nhập ngày trả vỏ = ngày lấy cont + 8 ngày (vượt 3 ngày miễn phí).
  2. Lưu.
- **Kết quả mong đợi (Pass):**
  - Tính đúng số ngày vượt = 3.
  - Cảnh báo khoản phí lưu bãi dự kiến theo quy tắc giá đã chốt.
- **Phụ thuộc:** bảng giá lưu bãi (M02/M06) phải đã cấu hình.

### TC-M03-04-05 — Múi giờ và thời điểm biên (gần nửa đêm / ngày lễ)

- **Mã PRD:** CUS-04-05
- **Vai trò:** `laixe`
- **Các bước:**
  1. Ghi nhận giao lúc `23:55` ngày 31/12/2025 và lúc `00:05` ngày 01/01/2026.
  2. Xem trên `/shipments/:id` và `/audit-logs`.
- **Kết quả mong đợi (Pass):**
  - Ngày giờ hiển thị nhất quán theo giờ VN (`DD/MM/YYYY HH:mm`).
  - Cách tính ngày theo lịch đã cấu hình (xử lý ngày lễ 01/01).

### TC-M03-04-06 — Phân quyền: customer không được xác nhận thay CUS

- **Mã PRD:** CUS-04-01 (kiểm soát quyền)
- **Vai trò:** `customer`, `laixe`
- **Các bước:**
  1. `customer` mở `/portal/shipments/:id` → chỉ thấy nút "Xác nhận đã nhận hàng" (không có nút "Xác nhận
     thay CUS").
  2. `laixe` thử truy cập `/shipments/:id` (route admin) để xác nhận thay CUS.
- **Kết quả mong đợi (Pass):**
  - `customer` chỉ được xác nhận phía khách; không duyệt thay CUS.
  - `laixe` bị redirect (`/my-trips`); không can thiệp được bảng xác nhận CUS.

---

## 3.5 — Lập giấy báo nợ gửi khách hàng

**Quy tắc nghiệp vụ (paraphrase PRD M3-3.5):** Cấu hình theo từng khách: lập **theo lô** hoặc **theo kỳ**
(mặc định tháng, tuần khi hợp đồng quy định). Tách 4 nhóm: *cước vận tải, phí dịch vụ, chi hộ, khoản điều
chỉnh* — không gộp để giữ khả năng đối chiếu. Mẫu per-customer (logo, thông tin thanh toán, cột, người ký);
lưu nguyên mẫu tại thời điểm phát hành (`debitNoteTemplateSnapshot`). Mỗi dòng VAT hiển thị: trước thuế,
thuế suất, tiền thuế, sau thuế. **Chi hộ chưa duyệt không đưa vào bản chính thức**.

### TC-M03-05-01 — Lập theo kỳ với đủ nhóm khoản thu

- **Mã PRD:** CUS-05-01
- **Vai trò:** `admin`
- **Tiền điều kiện:** khách A có kỳ 08/2026 với cước + phí dịch vụ + chi hộ đã duyệt.
- **Các bước:**
  1. Mở `/customers/:id/billing/new` (hoặc form lập giấy báo nợ).
  2. Chọn khách A, kỳ 08/2026. Bấm "Tổng hợp".
  3. Kiểm tra các dòng và VAT.
- **Kết quả mong đợi (Pass):**
  - Mỗi dòng có: tiền trước thuế, thuế suất, tiền thuế, tổng sau thuế.
  - 4 nhóm tách riêng; không trùng/bỏ sót khoản.
- **Phụ thuộc:** **Q03** (phân bổ thanh toán — `pending`), **Q21** (khóa kỳ per-customer — `pending`).

### TC-M03-05-02 — Còn khoản chi hộ chưa duyệt

- **Mã PRD:** CUS-05-02
- **Vai trò:** `admin`
- **Tiền điều kiện:** kỳ 08/2026 có 1 khoản chi hộ ở trạng thái `PENDING`.
- **Các bước:**
  1. Mở form lập giấy báo nợ cho khách A kỳ 08/2026.
  2. Quan sát cảnh báo.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo tiếng Việt nêu khoản đang chờ duyệt.
  - Khoản đó **bị loại khỏi bản chính thức**; hiển thị danh sách cần xử lý.

### TC-M03-05-03 — Lập lại cùng phạm vi (chống trùng kỳ)

- **Mã PRD:** CUS-05-03
- **Vai trò:** `admin`
- **Các bước:**
  1. Đã lập 1 giấy báo nợ cho khách A kỳ 08/2026.
  2. Lập lại lần 2 cùng khách + cùng kỳ.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo trùng; **không phát hành thêm** nếu chưa hủy/điều chỉnh bản trước.

### TC-M03-05-04 — Số tiền bằng không hoặc âm (dòng giảm trừ)

- **Mã PRD:** CUS-05-04
- **Vai trò:** `admin`
- **Các bước:**
  1. Thêm dòng điều chỉnh `-500.000đ` với lý do "Hoàn cước dư".
- **Kết quả mong đợi (Pass):**
  - Hiển thị đúng dấu âm và lý do/căn cứ.
  - Tổng cộng tính chính xác đến đơn vị đồng.

### TC-M03-05-05 — Xuất và gửi tài liệu (PDF bản chính thức)

- **Mã PRD:** CUS-05-05
- **Vai trò:** `admin`
- **Các bước:**
  1. Bấm "Phát hành". Tải PDF.
  2. Mở PDF; gửi email cho khách.
- **Kết quả mong đợi (Pass):**
  - PDF đúng mẫu per-customer (logo, cột, người ký), không vỡ bảng, đủ trang.
  - Bản gửi và bản lưu có cùng số hiệu và số tiền.
  - Snapshot mẫu lưu tại thời điểm phát hành.

### TC-M03-05-06 — Phân quyền / gửi lại đồng thời

- **Mã PRD:** CUS-05-01 (kiểm soát quyền) + CUS-05-03 (gửi lại)
- **Vai trò:** `giaonhan`, `customer`
- **Các bước:**
  1. `giaonhan` truy cập `/customers/:id/billing/new` → bị redirect (chỉ ADMIN).
  2. `customer` mở `/portal/debit-notes` → chỉ xem, không có nút lập/sửa.
  3. `admin` bấm "Phát hành" 2 lần liên tiếp (Slow 3G).
- **Kết quả mong đợi (Pass):**
  - `giaonhan`, `customer` không được lập giấy báo nợ.
  - Double-submit chỉ tạo 1 giấy báo nợ (cùng số hiệu).
- **Phụ thuộc:** Q03, Q21.

---

## 3.6 — Theo dõi xác nhận và thanh toán giấy báo nợ

**Quy tắc nghiệp vụ (paraphrase PRD M3-3.6):** Trạng thái: *DRAFT, SENT, PENDING_CONFIRM, CONFIRMED,
PARTIAL_PAID, PAID, REJECTED, CANCELED*. Khách xác nhận trên cổng; CUS chỉ xác nhận thay khi có căn cứ +
ghi chú. Thanh toán ghi theo chứng từ ngân hàng; 1 khoản thu có thể phân bổ cho nhiều giấy báo nợ. Nhắc theo
hạn từng khách; dừng khi thanh toán đủ/tranh chấp/tạm dừng. **Khóa nội dung sau khi khách xác nhận** — mọi
thay đổi sau phải qua điều chỉnh.

### TC-M03-06-01 — Luồng xác nhận và thanh toán đủ

- **Mã PRD:** CUS-06-01
- **Vai trò:** `customer`, `admin` (kế toán)
- **Tiền điều kiện:** giấy báo nợ GN-A-001 đã SENT.
- **Các bước:**
  1. `customer` mở `/portal/debit-notes` → bấm "Xác nhận" trên GN-A-001.
  2. `admin` ghi nhận thanh toán đủ theo sao kê ngân hàng.
- **Kết quả mong đợi (Pass):**
  - Trạng thái chuyển đúng thứ tự: `SENT` → `CONFIRMED` → `PAID`.
  - Công nợ giảm đúng số tiền; GN-A-001 bị khóa nội dung.

### TC-M03-06-02 — Thanh toán một phần

- **Mã PRD:** CUS-06-02
- **Vai trò:** `admin`
- **Các bước:**
  1. GN-A-001 tổng 10.000.000đ; ghi nhận thu 4.000.000đ.
- **Kết quả mong đợi (Pass):**
  - Trạng thái `PARTIAL_PAID`.
  - Hiển thị: đã thu 4.000.000đ, còn phải thu 6.000.000đ, hạn còn lại.

### TC-M03-06-03 — Sửa giấy báo nợ đã xác nhận (chặn sửa trực tiếp)

- **Mã PRD:** CUS-06-03
- **Vai trò:** `admin`
- **Tiền điều kiện:** GN-A-001 đã `CONFIRMED`.
- **Các bước:**
  1. Thử sửa số tiền hoặc xóa dòng trên GN-A-001.
- **Kết quả mong đợi (Pass):**
  - **Từ chối** sửa trực tiếp; chỉ có nút "Tạo bản điều chỉnh".
  - Dữ liệu cũ giữ nguyên.

### TC-M03-06-04 — Khách từ chối và nêu lý do (theo dòng)

- **Mã PRD:** CUS-06-04
- **Vai trò:** `customer`
- **Các bước:**
  1. `/portal/debit-notes` → bấm "Từ chối" trên 1 dòng của GN-A-001 + nhập lý do.
- **Kết quả mong đợi (Pass):**
  - Lưu lý do theo dòng; trạng thái `REJECTED` (cho dòng hoặc toàn giấy).
  - Thông báo tới CUS + kế toán; **tạm dừng nhắc** phần đang tranh chấp.
- **Phụ thuộc:** **Q04** (lịch nhắc dừng khi tranh chấp — `pending`).

### TC-M03-06-05 — Ghi nhận trùng chứng từ thanh toán

- **Mã PRD:** CUS-06-05
- **Vai trò:** `admin`
- **Các bước:**
  1. Đã ghi thanh toán với số tham chiếu ngân hàng `BK-001`.
  2. Nhập lại cùng `BK-001` + cùng số tiền cho cùng giấy báo nợ.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo trùng; **ngăn ghi nhận hai lần**.
  - Chỉ cho phép nếu người có quyền xác nhận ngoại lệ (ví dụ bút toán đảo).

### TC-M03-06-06 — Thanh toán thừa (không làm công nợ âm)

- **Mã PRD:** CUS-06-06
- **Vai trò:** `admin`
- **Các bước:**
  1. Còn phải thu 6.000.000đ; ghi nhận thu 8.000.000đ.
- **Kết quả mong đợi (Pass):**
  - 2.000.000đ thừa được ghi nhận rõ (chưa phân bổ hoặc hoàn trả).
  - Công nợ **không âm** ngoài ý muốn.
- **Phụ thuộc:** **Q01** (ngưỡng cảnh báo), **Q02** (phê duyệt vượt), **Q03** (phân bổ), **Q04** (nhắc),
  **Q05** (kênh/retry) — tất cả `pending`.

---

## 3.7 — Đối chiếu hóa đơn và chứng từ khoản chi hộ

**Quy tắc nghiệp vụ (paraphrase PRD M3-3.7):** Danh mục chi hộ cấu hình được: *nâng, hạ, lưu bãi, phí
cảng, cước hãng tàu, hải quan, khác*. Mỗi hạng có quy tắc chứng từ riêng; thiếu hóa đơn thì phải có chứng từ
thay thế hoặc ghi chú. Bắt buộc khi đối chiếu: *số tiền, ngày chứng từ, đơn vị phát hành, số hóa đơn/số tờ
khai, công-te-nơ, lô hàng, tệp*. Dùng bảng giá gợi ý theo cảng/hạng/ngày; sửa đơn giá phải nêu lý do. Đối
chiếu từng khoản theo lô; cuối kỳ tổng hợp theo khách/cảng/hạng.

### TC-M03-07-01 — Khoản chi hộ khớp chứng từ và bảng giá

- **Mã PRD:** CUS-07-01
- **Vai trò:** `admin`
- **Tiền điều kiện:** có khoản chi hộ "Nâng cont 20 inch" cảng Hải Phòng ngày 05/08, bảng giá 1.200.000đ.
- **Các bước:**
  1. Mở khoản chi hộ của lô A. Nhập 1.200.000đ + đính hóa đơn `HD-001.pdf`.
  2. Bấm "Đối chiếu".
- **Kết quả mong đợi (Pass):**
  - Hiển thị "Khớp"; cho duyệt; đưa vào giấy báo nợ **đúng một lần**.

### TC-M03-07-02 — Chênh lệch số tiền

- **Mã PRD:** CUS-07-02
- **Vai trò:** `admin`
- **Các bước:**
  1. Khoản chi hộ nhập 1.300.000đ nhưng hóa đơn 1.250.000đ.
- **Kết quả mong đợi (Pass):**
  - Hiển thị chênh lệch `+50.000đ`.
  - Yêu cầu sửa hoặc nêu lý do trước khi duyệt.

### TC-M03-07-03 — Thiếu chứng từ bắt buộc

- **Mã PRD:** CUS-07-03
- **Vai trò:** `admin`
- **Các bước:**
  1. Khoản thuộc nhóm bắt buộc hóa đơn ("Phí cảng") nhưng chưa đính tệp.
  2. Bấm "Duyệt".
- **Kết quả mong đợi (Pass):**
  - **Không cho duyệt**; nêu rõ "Cần bổ sung hóa đơn".
- **Phụ thuộc:** **Q12** (danh mục & căn cứ thay thế — `pending`).

### TC-M03-07-04 — Chứng từ dùng trùng

- **Mã PRD:** CUS-07-04
- **Vai trò:** `admin`
- **Các bước:**
  1. Gắn số hóa đơn `HD-001` cho 2 khoản chi hộ khác lô.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo trùng; yêu cầu kiểm tra.
  - Không tự động đưa cả 2 vào giấy báo nợ.

### TC-M03-07-05 — Đơn giá thay đổi theo ngày hiệu lực

- **Mã PRD:** CUS-07-05
- **Vai trò:** `admin`
- **Tiền điều kiện:** bảng giá nâng cont: mức cũ đến 31/07 = 1.100.000đ, mức mới từ 01/08 = 1.200.000đ.
- **Các bước:**
  1. Tạo khoản chi hộ phát sinh 05/08 → kiểm tra gợi ý.
  2. Sửa thành 1.150.000đ + nhập lý do.
- **Kết quả mong đợi (Pass):**
  - Gợi ý đúng giá tại 05/08 = 1.200.000đ.
  - Khi sửa: lưu giá gốc + lý do.

### TC-M03-07-06 — Từ chối rồi nộp lại (lịch sử)

- **Mã PRD:** CUS-07-06
- **Vai trò:** `admin` (từ chối), `giaonhan` (sửa và gửi lại)
- **Các bước:**
  1. `admin` từ chối khoản chi hộ (lý do "Thiếu hóa đơn").
  2. `giaonhan` mở lại khoản, sửa/đính kèm, gửi lại.
- **Kết quả mong đợi (Pass):**
  - Giữ lịch sử lần từ chối.
  - Lần nộp lại có trạng thái riêng (ví dụ `RESUBMITTED`).
  - Chỉ bản được duyệt mới tính tiền vào giấy báo nợ.
- **Phụ thuộc:** **Q13** (ngưỡng chi hộ), **Q14** (maker-checker duyệt) — `pending`.

---

## Bảng nghiệm thu M03

Điền một dòng cho mỗi ca kiểm thử sau khi thử.

| Ngày thử | Mã TC          | Người thử | Kết quả (Pass/Fail/Blocked) | Ghi chú | Bằng chứng |
| -------- | -------------- | --------- | --------------------------- | ------- | ---------- |
| __/__/__ | TC-M03-01-01   |           |                             |         |            |
| __/__/__ | TC-M03-01-02   |           |                             |         |            |
| __/__/__ | TC-M03-01-03   |           |                             |         |            |
| __/__/__ | TC-M03-01-04   |           |                             |         |            |
| __/__/__ | TC-M03-01-05   |           |                             |         |            |
| __/__/__ | TC-M03-01-06   |           |                             |         |            |
| __/__/__ | TC-M03-01-07   |           |                             |         |            |
| __/__/__ | TC-M03-02-01   |           |                             |         |            |
| __/__/__ | TC-M03-02-02   |           |                             |         |            |
| __/__/__ | TC-M03-02-03   |           |                             |         |            |
| __/__/__ | TC-M03-02-04   |           |                             |         |            |
| __/__/__ | TC-M03-02-05   |           |                             |         |            |
| __/__/__ | TC-M03-02-06   |           |                             |         |            |
| __/__/__ | TC-M03-03-01   |           |                             |         |            |
| __/__/__ | TC-M03-03-02   |           |                             |         |            |
| __/__/__ | TC-M03-03-03   |           |                             |         |            |
| __/__/__ | TC-M03-03-04   |           |                             |         |            |
| __/__/__ | TC-M03-03-05   |           |                             |         |            |
| __/__/__ | TC-M03-03-06   |           |                             |         |            |
| __/__/__ | TC-M03-04-01   |           |                             |         |            |
| __/__/__ | TC-M03-04-02   |           |                             |         |            |
| __/__/__ | TC-M03-04-03   |           |                             |         |            |
| __/__/__ | TC-M03-04-04   |           |                             |         |            |
| __/__/__ | TC-M03-04-05   |           |                             |         |            |
| __/__/__ | TC-M03-04-06   |           |                             |         |            |
| __/__/__ | TC-M03-05-01   |           |                             |         |            |
| __/__/__ | TC-M03-05-02   |           |                             |         |            |
| __/__/__ | TC-M03-05-03   |           |                             |         |            |
| __/__/__ | TC-M03-05-04   |           |                             |         |            |
| __/__/__ | TC-M03-05-05   |           |                             |         |            |
| __/__/__ | TC-M03-05-06   |           |                             |         |            |
| __/__/__ | TC-M03-06-01   |           |                             |         |            |
| __/__/__ | TC-M03-06-02   |           |                             |         |            |
| __/__/__ | TC-M03-06-03   |           |                             |         |            |
| __/__/__ | TC-M03-06-04   |           |                             |         |            |
| __/__/__ | TC-M03-06-05   |           |                             |         |            |
| __/__/__ | TC-M03-06-06   |           |                             |         |            |
| __/__/__ | TC-M03-07-01   |           |                             |         |            |
| __/__/__ | TC-M03-07-02   |           |                             |         |            |
| __/__/__ | TC-M03-07-03   |           |                             |         |            |
| __/__/__ | TC-M03-07-04   |           |                             |         |            |
| __/__/__ | TC-M03-07-05   |           |                             |         |            |
| __/__/__ | TC-M03-07-06   |           |                             |         |            |

---

## Tiêu chí nghiệm thu toàn phân hệ M03 — HT-01 … HT-12

Module 3 có 12 nhóm HT (xem định nghĩa trong `00-cross-cutting.md` và bảng HT riêng trong
`docs/prd/Module3.docx` §5). Lưu ý bảng HT của M03 sắp xếp khác bảng dùng chung: HT-05 = Tệp đính kèm,
HT-06 = Tìm kiếm, HT-07 = Tiền tệ, HT-09 = Khả năng sử dụng, HT-10 = Khôi phục lỗi. Chạy ca HT tương ứng
trên **màn hình của M03** (`/shipments/:id`, `/portal/debit-notes`…).

| Mã HT  | Nhóm kiểm tra           | Cách thử trên màn M03                                                                                       | Kết quả | Bằng chứng |
| ------ | ----------------------- | ----------------------------------------------------------------------------------------------------------- | ------- | ---------- |
| HT-01  | Ngôn ngữ                | Duyệt `/shipments`, `/portal/debit-notes`; thử lỗi (ISO 6346 sai, thiếu chứng từ).                          |         |            |
| HT-02  | Phân quyền              | `giaonhan`, `customer` truy cập `/shipments/:id`, `/customers/:id/billing/new`; URL tệp PDF chéo khách.    |         |            |
| HT-03  | Nhật ký                 | Tạo/sửa lô, xác nhận giao, từ chối giấy báo nợ, duyệt chi hộ → xem `/audit-logs`.                           |         |            |
| HT-04  | Tính toàn vẹn           | Double-submit: tạo lô, lập giấy báo nợ, ghi thanh toán (Slow 3G).                                          |         |            |
| HT-05  | Tệp đính kèm            | Tải vận đơn/DO; thay tệp; kiểm tra `replacedBy`; tải xuống PDF giấy báo nợ.                                 |         |            |
| HT-06  | Tìm kiếm                | Tìm lô theo mã, BL, số cont, khách, ngày, trạng thái; `customer` không thấy lô khách khác.                  |         |            |
| HT-07  | Tiền tệ                 | `/portal/debit-notes` > 1 tỷ VNĐ; so sánh với PDF xuất, phép cộng các dòng.                                |         |            |
| HT-08  | Ngày giờ                | Ghi nhận giao lúc 23:55 và 00:05 qua ngày lễ; so sánh `/shipments/:id` vs `/audit-logs`.                    |         |            |
| HT-09  | Khả năng sử dụng        | `/portal/shipments` trên iPhone SE (375×667); bảng giấy báo nợ không vỡ, nút không che.                     |         |            |
| HT-10  | Khôi phục lỗi           | Offline khi tải chứng từ / ghi thanh toán; dữ liệu form không mất.                                          |         |            |
| HT-11  | Bảo mật                 | Hết hạn phiên (mặc định 8h); URL PDF giấy báo nợ yêu cầu auth; không tải được khi logout.                   |         |            |
| HT-12  | Đối chiếu cuối kỳ      | Tổng giấy báo nợ + đã thu + còn phải thu + chi hộ trên portal = admin `/debt/:id`; truy ngược chứng từ.    |         |            |

> **Liên phân hệ cần chạy kèm khi M03 đổi:**
>
> - **M04 (Chi hộ):** thay đổi trạng thái chi hộ ở M03 phải khớp `/expenses` của M04.
> - **M05 (AR):** giấy báo nợ M03.5/3.6 phải khớp công nợ `/debt/:id` và phân bổ thanh toán.
> - **M06 (AP):** khoản chi hộ đối chiếu ở M03.7 phải khớp `/payables` nhà cung cấp.
> - **M11 (Finance):** tổng giấy báo nợ kỳ phải khớp doanh thu + chi hộ kỳ trên `/finance`.
