# Luồng 4: e-POD & Hoàn thành chuyến — Lái xe (Driver)

> **Vai trò sở hữu:** Lái xe (DRIVER)
> **Tài khoản test:** chọn theo môi trường qua [`../testaccounts.txt`](../testaccounts.txt) — runner tự map role `DRIVER` → username phù hợp (local: `DRIVER`; staging: prod-mirror như `bqhuong`).
> **Route chính:** `/my-trips/:tripId` (chi tiết), `/my-trips/:fulfillmentId/pod` (e-POD, hoàn thành), `/shipments/:id` (e-POD panel)
> **Thiết bị mặc định:** Mobile (iPhone SE 375×667)
> **PRD nguồn:** `docs/prd/ManHinhLaiXe.md` hiện hành; Module 08, O2C Bước 3, TC-MO2C-05, TC-MO2C-07
>
> **Tổng quan luồng:** Sau khi nhận lệnh (IN_TRANSIT), lái xe nộp e-POD (2 slot bắt buộc) rồi
> bấm "HOÀN THÀNH CHUYẾN" để chốt chuyến — lô tự động chuyển `Hoàn thành` (full-close path,
> độc lập với việc kế toán đối chiếu chi phí).
>
> **Phạm vi hiện hành:** TC-001..006 cũ không được dùng làm cổng bắt buộc mới. Chi phí lái xe đang hoạt động theo AC-CP-LX-01..10; container/seal là hồ sơ bổ sung. Sau khi đã nhận lệnh thật và đủ hai nhóm e-POD lưu thành công, một nút hoàn thành tự ghi các mốc còn thiếu với dấu suy ra, giữ nguyên mốc thực tế đã có. Không yêu cầu đối chiếu chi phí, ảnh cont/seal hay vé cầu đường để hoàn thành.

---

## 4.1 — Nộp e-POD (2 slot bắt buộc)

### TC-LX-TIENDO-007 — Nộp e-POD thành công với đủ 2 slot

- **Mã PRD:** TC-MO2C-07
- **Vai trò:** `DRIVER`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip IN_TRANSIT, sẵn sàng upload e-POD
- **Các bước:**
  1. Mở chi tiết `/my-trips/:tripId`, dùng CTA tới `/my-trips/:fulfillmentId/pod`.
  2. Tải slot 1: "Phiếu bãi / phiếu hạ" (`yard-drop-test.jpg`).
  3. Tải slot 2: "Biên bản giao nhận có ký nhận" (`signed-delivery-test.pdf`).
  4. Xác nhận hai nhóm đã lưu/mở được; bấm "Hoàn thành chuyến" để lưu hồ sơ rồi hoàn thành. Không cần nút gửi riêng.
- **Kết quả mong đợi (Pass):**
  - Hồ sơ được ghi nhận trực tiếp; không có nhãn "Chờ duyệt" hoặc người duyệt.
    Mã lưu trữ tương thích `SUBMITTED` không trở thành approval gate.
  - Submission ID, version, status được ghi nhận.
  - e-POD neo đúng trip/fulfillment và phiên bản hiện tại.
  - Mở `/shipments/:id` xác nhận đúng trip/fulfillment.
- **Kỳ vọng sai (Fail nếu):**
  - Thiếu 1 slot vẫn gửi được.
  - Submission gắn sai trip.
  - Không có version/history.
  - Lưu hồ sơ riêng tự kết thúc vận chuyển khi chưa có hành động hoàn thành,
    hoặc yêu cầu duyệt trước khi cho phép hoàn thành.
- **Bằng chứng:** ảnh 2 slot đã tải + ảnh status SUBMITTED + ảnh `/shipments/:id`

---

### TC-LX-TIENDO-008 — Chặn gửi e-POD khi thiếu slot bắt buộc (negative)

- **Mã PRD:** TC-MO2C-07
- **Vai trò:** `DRIVER`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Các bước:**
  1. Mở e-POD. Chỉ tải "Phiếu bãi / phiếu hạ" (slot 1).
  2. **Không** tải "Biên bản giao nhận" (slot 2). Thử bấm "Hoàn thành chuyến".
  3. Thử ngược lại: chỉ tải slot 2, thiếu slot 1.
- **Kết quả mong đợi (Pass):**
  - Bị chặn: "Thiếu hồ sơ bắt buộc" hoặc nút disabled.
  - Không gửi được e-POD.
  - Thông báo rõ ràng slot nào thiếu.
- **Kỳ vọng sai (Fail nếu):**
  - Thiếu 1 file vẫn gửi được.
  - Không thông báo slot thiếu.
- **Bằng chứng:** ảnh thông báo chặn khi thiếu slot 1 + ảnh khi thiếu slot 2

---

### TC-LX-TIENDO-009 — Vé cầu đường là tùy chọn

- **Mã PRD:** TC-MO2C-07
- **Vai trò:** `DRIVER`
- **Mức độ:** P2
- **Các bước:**
  1. Tải đủ 2 slot bắt buộc. Không tải vé cầu đường.
  2. Bấm "Hoàn thành chuyến".
- **Kết quả mong đợi (Pass):**
  - Gửi thành công. Vé cầu đường không bắt buộc.
- **Bằng chứng:** ảnh e-POD SUBMITTED không có vé cầu đường

---

## 4.2 — Hoàn thành chuyến (full-close path)

### TC-LX-TIENDO-010 — Bấm "HOÀN THÀNH CHUYẾN" sau khi hoàn tất (full-close path 2026-08-29)

- **Mã PRD:** TC-MO2C-05
- **Vai trò:** `DRIVER`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip IN_TRANSIT, đã nộp e-POD (2 slot bắt buộc)
- **Các bước:**
  1. Mở `/my-trips/:id`. Bấm "HOÀN THÀNH CHUYẾN" (footer hoặc màn e-POD).
  2. Kiểm tra trạng thái trip + shipment từ `DRIVER`, `CUS`, `DISPATCHER`.
- **Kết quả mong đợi (Pass):**
  - Trip chuyển sang `COMPLETED` (chốt luôn, không qua "Chờ duyệt phí").
  - Shipment chỉ chuyển `COMPLETED` khi tất cả công việc cần thiết đã hoàn thành; không bỏ qua các công việc còn lại. Thiếu đối chiếu chi phí/hồ sơ kế toán không chặn đóng vận chuyển.
  - CUS workspace badge hiển thị "Hoàn thành" (PENDING_LOCK bucket + status label).
  - CUS container ledger: `dispatchStatus: COMPLETED` → "Hoàn thành".
  - Dispatcher trips list: trip `status: COMPLETED` → "Hoàn thành" (TRIP_STATUS_LABELS).
  - Driver app footer: nút "Đã hoàn thành chuyến" (disabled).
  - **Cache báo cáo (fix 2026-09-01):** ngay khi chốt chuyến, các cache báo cáo chịu ảnh hưởng bị invalidate (dashboard, dashboard:executive, P&L, total-AR, entity-results, fuel-variance, dashboard-widgets) — không đợi TTL. Trước 2026-09-01 full-close không bust cache nào (dashboard/P&L stale đến hết TTL). Kiểm chứng tự động: test `driver-fulfillment-progress` đặt sentinel key rồiassert đã bị xóa.
  - **Lưu ý:** Đối chiếu chi phí và hồ sơ kế toán là nghiệp vụ độc lập, không là
    điều kiện duyệt để hoàn thành vận chuyển. Điều chỉnh sau ghi sổ giữ lịch sử.
- **Kỳ vọng sai (Fail nếu):**
  - Trip vẫn `IN_TRANSIT` sau khi bấm "HOÀN THÀNH CHUYẾN" (regression).
  - Shipment vẫn `IN_TRANSIT` (recompute không theo driver close).
  - CUS/Dispatcher vẫn hiển thị "Đang chạy" / "Chờ duyệt phí" sau completion.
  - Láy xe khác trip_id có thể đóng trip của người khác (ownership leak).
  - Dashboard/P&L vẫn serve dữ liệu cũ (stale cache) sau khi lái xe chốt chuyến.
- **Bằng chứng:** ảnh trip COMPLETED trên `/my-trips/:id` + ảnh CUS workspace "Hoàn thành" + ảnh Dispatcher trips list "Hoàn thành" + ảnh DB status_history (IN_TRANSIT → COMPLETED).

---

## 4.3 — Xem thu nhập & Phiếu lương

### TC-LX-TIENDO-011 — Xem thu nhập cá nhân

- **Mã PRD:** M08
- **Vai trò:** `DRIVER`
- **Mức độ:** P1
- **Thiết bị:** Mobile
- **Các bước:**
  1. Mở `/my-earnings`. Kiểm tra tổng thu nhập, danh sách chuyến đã hoàn thành.
  2. Mở `/my-payslips`. Kiểm tra phiếu lương đã phát hành.
- **Kết quả mong đợi (Pass):**
  - Thu nhập hiển thị đúng theo chuyến đã hoàn thành.
  - Phiếu lương xem được, mở được file PDF.
  - Chỉ thấy dữ liệu của chính mình.
- **Bằng chứng:** ảnh `/my-earnings` + ảnh `/my-payslips`

---

### TC-LX-TIENDO-012 — Xem khoản phạt cá nhân

- **Mã PRD:** M08
- **Vai trò:** `DRIVER`
- **Mức độ:** P1
- **Thiết bị:** Mobile
- **Các bước:**
  1. Mở `/my-penalties`. Kiểm tra danh sách khoản phạt (nếu có).
- **Kết quả mong đợi (Pass):**
  - Hiển thị đúng khoản phạt của chính mình.
  - Nếu không có: empty state rõ ràng.
  - Không lộ dữ liệu phạt của lái xe khác.
- **Bằng chứng:** ảnh `/my-penalties`

---

## 4.4 — Khóa nộp lại & hoàn thành chuyến sau khi gửi e-POD (regression 2026-08-29)

> Ba lỗi được báo trong ngày trial 08-29: (1) lái xe bấm lại "Chụp" trên e-POD
> đã ghi nhận luôn dính lỗi 409 "Đã có một e-POD đang mở cho tác vụ này" vì
> nút chưa bị khóa; (2) khi bấm "HOÀN THÀNH CHUYẾN" mà bước gửi e-POD thất bại
> (mất mạng/conflict), hệ thống vẫn cố hoàn thành chuyến → bị server từ chối
> ngầm, chuyến kẹt ở "Đang chạy"/"Đã nhận" thay vì "Lịch sử"; (3) ở màn rộng
> ≥700px, 2 thẻ e-POD bắt buộc đè chữ/nút lên nhau.

### TC-LX-TIENDO-013 — Giữ nguyên phiên bản hồ sơ đã ghi nhận

- **Vai trò:** `DRIVER`; **Mức độ:** P0; **Thiết bị:** Mobile.
- **Tiền điều kiện:** chuyến đã lưu đủ hồ sơ; có một phiên bản hồ sơ được ghi nhận.
- **Các bước:** mở lại hồ sơ; thử thay ảnh trực tiếp của phiên bản đã ghi nhận.
- **Kết quả mong đợi:** ảnh và lịch sử đã ghi nhận vẫn xem được; phiên bản không
  bị sửa đè. Nếu cần bổ sung, dùng hành động cập nhật phiên bản phù hợp quyền và
  trạng thái hiện hành. Nhãn phản ánh đã lưu/đã hoàn thành, không chờ người duyệt.
- **Fail:** sửa đè lịch sử; nút gây lỗi 409 vì tạo hồ sơ mở thứ hai; dựng bước duyệt.
- **Bằng chứng:** ảnh hồ sơ, phiên bản và lỗi/quyền tương ứng từ API.

---

### TC-LX-TIENDO-014 — Bổ sung hồ sơ thiếu hoặc sửa sai có lịch sử

- **Vai trò:** `DRIVER` và vai trò có quyền sửa hồ sơ hiện hành; **Mức độ:** P0.
- **Tiền điều kiện:** hồ sơ cần bổ sung/sửa sai; gồm mẫu lịch sử có trạng thái
  `REJECTED` để kiểm tra tương thích, không tạo quyết định từ chối mới.
- **Các bước:** mở hồ sơ và ghi chú; dùng thao tác bổ sung đang được phép, tải
  ảnh đúng; lưu rồi đọc lại lịch sử và kiểm tra bằng người không có quyền.
- **Kết quả mong đợi:** sửa trực tiếp sau kiểm tra quyền, phiên bản và chứng từ;
  giữ bản trước và lý do. Không cần người duyệt, gửi lại duyệt hay thay trạng thái
  tài chính/vận chuyển chỉ vì thêm ảnh. Người không có quyền vẫn bị chặn.
- **Fail:** không thể bổ sung hồ sơ hợp lệ do approval gate; sửa đè hoặc tạo tiền.
- **Bằng chứng:** hồ sơ trước/sau, phiên bản mới và API từ chối sai quyền.

---

### TC-LX-TIENDO-015 — "HOÀN THÀNH CHUYẾN" không được tiến hành nếu bước gửi e-POD thất bại

- **Vai trò:** `DRIVER`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** e-POD đang ở DRAFT (chưa gửi), đủ 2 slot bắt buộc; có thể mô phỏng mất mạng/conflict trong lúc gửi (tắt mạng ngay sau khi bấm, hoặc dùng phiên bản trip đã lỗi thời — expectedVersion sai)
- **Các bước:**
  1. Mở `/my-trips/:fulfillmentId/pod`, đủ 2 slot bắt buộc, e-POD còn DRAFT.
  2. Ngắt mạng (hoặc để trip bị đổi version ở tab khác) rồi bấm "HOÀN THÀNH CHUYẾN".
  3. Quan sát: lệnh gửi e-POD thất bại; không được xếp hàng ngoại tuyến.
  4. Bật lại mạng, tải lại trang, kiểm tra trạng thái chuyến.
- **Kết quả mong đợi (Pass):**
  - Khi bước gửi e-POD chưa xác nhận DONE, lệnh "HOÀN THÀNH CHUYẾN" (COMPLETE) **không được gửi lên server**.
  - Chuyến vẫn ở màn e-POD, chưa điều hướng về `/my-trips`.
  - Sau khi mạng ổn định và e-POD gửi thành công, bấm lại "HOÀN THÀNH CHUYẾN" mới chuyển chuyến sang "Lịch sử"/"Hoàn thành".
- **Kỳ vọng sai (Fail nếu):**
  - Lệnh COMPLETE vẫn được gửi dù e-POD chưa SUBMITTED thành công (server từ chối ngầm, chuyến kẹt ở "Đang chạy"/"Đã nhận", không rõ lý do cho lái xe).
- **Bằng chứng:** ảnh trạng thái mạng lỗi + ảnh chuyến vẫn ở màn e-POD + ảnh sau khi hoàn thành lại thành công

---

### TC-LX-TIENDO-016 — Bố cục 2 thẻ e-POD không đè lên nhau ở màn rộng (visual)

- **Vai trò:** `DRIVER`
- **Mức độ:** P1
- **Thiết bị:** Mobile ngang / tablet nhỏ, chiều rộng ~700–1000px (đúng ngưỡng breakpoint)
- **Tiền điều kiện:** Chuyến có e-POD với 2 slot (bất kỳ trạng thái DRAFT/SUBMITTED/REJECTED)
- **Các bước:**
  1. Mở `/my-trips/:fulfillmentId/pod` trên thiết bị/trình duyệt rộng ~700–1000px.
  2. Quan sát 2 thẻ "Phiếu bãi / phiếu hạ" và "Biên bản giao nhận có ký nhận" cạnh nhau.
- **Kết quả mong đợi (Pass):**
  - 2 thẻ hiển thị tách bạch, có đường phân cách, không chữ/nút nào đè lên thẻ còn lại.
  - Tiêu đề, badge "1 tệp", nút/khu vực khóa đều đọc được rõ ràng.
- **Kỳ vọng sai (Fail nếu):**
  - Chữ hoặc nút của thẻ 1 đè lên thẻ 2 (hoặc ngược lại).
- **Bằng chứng:** ảnh chụp màn hình ở độ rộng ~700–1000px

### TC-LX-TIENDO-017 — Lưu hồ sơ và hoàn thành vận chuyển là hai sự kiện riêng

- **Mã PRD:** O2C Bước 3 → Bước 4, TC-MO2C-07 + fix 2026-08-29 (driver full-close)
- **Vai trò:** `DRIVER` (driver-side) + `CUS` (CUS-side) + `DISPATCHER` (dispatch-side)
- **Mức độ:** P0
- **Thiết bị:** Mobile + Desktop
- **Tiền điều kiện:** Trip IN_TRANSIT; e-POD DRAFT đủ 2 slot bắt buộc. Lưu
  hồ sơ riêng không hoàn thành vận chuyển. Khi tài xế bấm "HOÀN THÀNH CHUYẾN",
  lưu hồ sơ thành công rồi hoàn thành trực tiếp; không cần duyệt kế toán.
- **Các bước:**
  1. Đăng nhập DRIVER, tải đủ hai nhóm e-POD. Lưu tệp chỉ cập nhật hồ sơ DRAFT; chưa bấm hoàn thành. Kiểm tra thêm API nộp hồ sơ độc lập nếu cần chứng minh SUBMITTED không tự đóng chuyến (không dựng nút gửi riêng trong UI).
  2. Mở tab khác, đăng nhập `CUS`, mở `/shipments` hoặc chi tiết lô hàng. Quan sát cột trạng thái.
  3. Mở tab khác, đăng nhập `DISPATCHER`, mở `/dispatch` (Kế hoạch tổng quát/chi tiết) hoặc `/trips`. Quan sát.
  4. Quay lại tab lái xe, bấm "HOÀN THÀNH CHUYẾN". Refresh CUS + điều vận, quan sát lại.
- **Kết quả mong đợi (Pass):**
  - Sau bước 1 (submit e-POD): CUS + điều vận vẫn thấy lô ở **"Đang chạy"** (IN_TRANSIT; wording unified 2026-09-01) — KHÔNG nhảy sang "Chờ duyệt phí".
  - Sau bước 4 ("HOÀN THÀNH CHUYẾN"): CUS + điều vận thấy lô chuyển sang **"Hoàn thành"** (COMPLETED).
  - Lịch sử trạng thái có dòng IN_TRANSIT → COMPLETED, kèm `changedBy` = tài xế và timestamp.
  - Không có nhánh "Chờ duyệt phí" (PENDING_EXPENSE_APPROVAL). Đối chiếu
    chi phí, thiếu chứng từ, hoàn thành và thanh toán là các tình trạng riêng.
- **Kỳ vọng sai (Fail nếu):**
  - Sau bước 1: lô nhảy sang "Chờ duyệt phí" hoặc cần người khác duyệt.
  - Sau bước 4: lô không chuyển "Hoàn thành" (full-close path bị break).
- **Bằng chứng:** ảnh trạng thái CUS + điều vận sau bước 1 (vẫn IN_TRANSIT) + ảnh trạng thái CUS + điều vận sau bước 4 (COMPLETED)

---

## 4.5 — Cổng e-POD bắt buộc & xử lý ảnh (đặc tả app lái xe 2026-08-27)

> **Nguồn:** `2026.8.27_Man_hinh_lai_xe.docx` Phần 4 · PRD
> [`docs/prd/ManHinhLaiXe.md`](../../docs/prd/ManHinhLaiXe.md) §4.
>
> Đặc tả yêu cầu: bấm `Hoàn tất lệnh vận chuyển` **không** kết thúc chuyến ngay mà
> **nhảy bắt buộc** sang màn Upload E-POD; ảnh phải **tự nén trên máy** và **gắn
> timestamp thực tế**; nút `HOÀN THÀNH CHUYẾN` chỉ sáng khi **cả hai nhóm chứng từ đã lưu và mở được**. Tiến trình truyền byte 100% chưa đủ. Ảnh thư viện không rõ giờ chụp không được đóng giờ tải lên thay thế.

### TC-LX-TIENDO-018 — "Hoàn tất lệnh vận chuyển" nhảy bắt buộc sang màn E-POD

- **Vai trò:** `laixe`
- **Mức độ:** **P0**
- **Thiết bị:** Mobile (375 × 667)
- **Tiền điều kiện:** chuyến đang `IN_TRANSIT`, đã hạ cont tại cảng hạ, chưa nộp e-POD
- **Các bước:**
  1. Ở tab `Đã nhận` / `Đang chạy`, mở chuyến, bấm `Hoàn tất lệnh vận chuyển`.
  2. Quan sát điều hướng ngay sau khi bấm.
  3. Thử bấm nút back của trình duyệt/thiết bị.
- **Kết quả mong đợi (Pass):**
  - App **không** kết thúc chuyến ngay; **chuyển thẳng sang màn Upload E-POD**.
  - Chuyến vẫn ở trạng thái đang chạy cho tới khi hoàn tất e-POD.
  - Back quay lại chi tiết chuyến an toàn — **không** để chuyến rơi vào trạng thái nửa vời.
- **Kỳ vọng sai (Fail nếu):** chuyến kết thúc luôn mà bỏ qua e-POD; back làm hỏng trạng thái.
- **Bằng chứng:** ảnh trước/sau khi bấm + ảnh trạng thái chuyến

---

### TC-LX-TIENDO-019 — Màn E-POD: đúng 2 khu vực tải ảnh, cả hai bắt buộc

- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Các bước:**
  1. Ở màn E-POD, đọc nhãn 2 khu vực tải ảnh.
  2. Tải **chỉ** ảnh khu vực 1. Quan sát nút `HOÀN THÀNH CHUYẾN`.
  3. Tải nốt ảnh khu vực 2.
- **Kết quả mong đợi (Pass):**
  - Đúng **2 khu vực**: `Phiếu bãi / Phiếu hạ` và `Biên bản giao nhận` (biên bản **phải có dấu / chữ ký**).
  - Sau bước 2 (mới 1 ảnh): nút `HOÀN THÀNH CHUYẾN` **vẫn mờ / không bấm được**.
  - Sau bước 3 (đủ 2 ảnh, đã lưu thành công, mở được): nút **sáng** và bấm được.
  - Không có đường vòng nào kết thúc chuyến khi thiếu ảnh (kể cả gọi API trực tiếp → bị chặn).
- **Kỳ vọng sai (Fail nếu):** nút sáng khi mới 1 ảnh; nút sáng khi upload còn đang chạy (< 100%); API cho phép đóng chuyến thiếu ảnh.
- **Bằng chứng:** ảnh nút mờ sau 1 ảnh + ảnh nút sáng sau 2 ảnh + Network 4xx của API trực tiếp

---

### TC-LX-TIENDO-020 — Ảnh e-POD tự nén trên thiết bị trước khi tải lên

- **Vai trò:** `laixe`
- **Mức độ:** P1
- **Tiền điều kiện:** ảnh gốc dung lượng lớn (≥ 4 MB, ví dụ ảnh camera 12 MP)
- **Các bước:**
  1. Ghi lại dung lượng file gốc.
  2. Tải ảnh đó vào khu vực `Phiếu bãi / Phiếu hạ`.
  3. Mở DevTools → Network, xem `Content-Length` của request upload.
  4. Mở lại ảnh đã lưu, kiểm tra còn đọc được nội dung phiếu.
- **Kết quả mong đợi (Pass):**
  - Kích thước **truyền đi nhỏ hơn đáng kể** file gốc (nén xảy ra **trên máy**, trước khi truyền).
  - Ảnh sau nén **vẫn đọc rõ** chữ/số trên phiếu — nén không phá mất bằng chứng.
  - Trên mạng chậm (Slow 3G) vẫn tải xong trong thời gian chấp nhận được, có thanh tiến trình.
- **Kỳ vọng sai (Fail nếu):** upload nguyên file gốc; ảnh nén tới mức không đọc được phiếu.
- **Bằng chứng:** dung lượng gốc vs `Content-Length` + ảnh sau nén phóng to

---

### TC-LX-TIENDO-021 — Ảnh e-POD gắn timestamp thực tế

- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Các bước:**
  1. Ghi giờ thiết bị. Chụp và tải cả 2 ảnh e-POD.
  2. Xem lại 2 ảnh trong hồ sơ chuyến (cả trên app lái xe và màn hồ sơ của Kế toán).
- **Kết quả mong đợi (Pass):**
  - Cả 2 ảnh mang **timestamp thực tế lúc chụp**, xem lại được ở cả 2 phía.
  - Giờ theo `Asia/Ho_Chi_Minh`, lệch ≤ 1 phút so với đồng hồ thiết bị.
  - Timestamp là **giờ chụp**, không phải giờ upload hay giờ ghi nhận. Ảnh thư viện/PDF thiếu metadata giờ chụp giữ trạng thái chưa biết; không suy từ lastModified hoặc thời điểm chọn tệp. Thử lại giữ nguyên thời điểm/byte đã chuẩn bị.
- **Kỳ vọng sai (Fail nếu):** thiếu timestamp; sai múi giờ; dùng giờ upload.
- **Bằng chứng:** ảnh đồng hồ thiết bị + 2 ảnh e-POD có timestamp + ảnh màn Kế toán

---

### TC-LX-TIENDO-022 — Hoàn thành ⇒ thẻ sang tab Lịch sử ⇒ đồng bộ Dashboard Điều vận

- **Vai trò:** `laixe` → `dieuvan`
- **Mức độ:** P0
- **Các bước:**
  1. `laixe` bấm `HOÀN THÀNH CHUYẾN` (sau khi đủ 2 ảnh).
  2. Kiểm tra 3 tab con của `Hành trình`.
  3. `dieuvan` mở dashboard, không thao tác gì đặc biệt.
- **Kết quả mong đợi (Pass):**
  - Thẻ **rời** tab `Đã nhận` và **xuất hiện ở tab `Lịch sử`**.
  - Dashboard Điều vận phản ánh trạng thái hoàn thành **không cần thao tác thủ công**.
  - Không xuất hiện lại ở `Lệnh mới`.
- **Kỳ vọng sai (Fail nếu):** thẻ kẹt ở tab cũ; điều vận phải bấm gì đó mới thấy cập nhật.
- **Bằng chứng:** ảnh 3 tab con + ảnh dashboard điều vận trước/sau

---

## Bảng nghiệm thu — Luồng e-POD & Hoàn thành chuyến (Lái xe)

> TC-LX-TIENDO-001..006 là mã lịch sử. Chi phí và hồ sơ bổ sung kiểm tra theo PRD hiện hành và AC-CP-LX; không dùng ghi chú lịch sử này để ẩn tính năng đang có. Kết quả cũ không thay thế lần chạy hiện tại.

| Ngày thử | Mã TC | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|-----------|---------|---------|------------|
| __/__/__ | TC-LX-TIENDO-007 | | | e-POD đủ 2 slot | |
| __/__/__ | TC-LX-TIENDO-008 | | | e-POD thiếu slot | |
| __/__/__ | TC-LX-TIENDO-009 | | | Vé cầu đường tùy chọn | |
| __/__/__ | TC-LX-TIENDO-010 | | | HOÀN THÀNH CHUYẾN — full-close path | |
| __/__/__ | TC-LX-TIENDO-011 | | | Thu nhập/Phiếu lương | |
| __/__/__ | TC-LX-TIENDO-012 | | | Khoản phạt | |
| __/__/__ | TC-LX-TIENDO-013 | | | Giữ nguyên phiên bản hồ sơ đã ghi nhận | |
| __/__/__ | TC-LX-TIENDO-014 | | | Bổ sung/sửa hồ sơ, tương thích lịch sử | |
| __/__/__ | TC-LX-TIENDO-015 | | | Không hoàn thành chuyến nếu gửi e-POD lỗi | |
| __/__/__ | TC-LX-TIENDO-016 | | | Bố cục 2 thẻ e-POD không đè nhau | |
| __/__/__ | TC-LX-TIENDO-017 | | | e-POD submit giữ "Đang chạy"; chỉ "HOÀN THÀNH CHUYẾN" mới chuyển "Hoàn thành" độc lập kế toán | |
| __/__/__ | TC-LX-TIENDO-018 | | | Nhảy bắt buộc sang màn E-POD (P0) | |
| __/__/__ | TC-LX-TIENDO-019 | | | 2 khu vực ảnh, gate hai nhóm lưu thành công (P0) | |
| __/__/__ | TC-LX-TIENDO-020 | | | Ảnh tự nén trên máy | |
| __/__/__ | TC-LX-TIENDO-021 | | | Timestamp thực tế lúc chụp (P0) | |
| __/__/__ | TC-LX-TIENDO-022 | | | Sang tab Lịch sử + đồng bộ Điều vận (P0) | |
