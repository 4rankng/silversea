# Luồng 4: Cập nhật tiến độ & e-POD — Lái xe (Driver)

> **Vai trò sở hữu:** Lái xe (DRIVER)
> **Tài khoản demo:** `laixe` (password: `Abc123`)
> **Route chính:** `/my-trips/:id` (milestone, chi phí, e-POD), `/shipments/:id` (e-POD panel)
> **Thiết bị mặc định:** Mobile (iPhone SE 375×667)
> **PRD nguồn:** Module 08, O2C Bước 3, TC-MO2C-05, TC-MO2C-06, TC-MO2C-07
>
> **Tổng quan luồng:** Sau khi nhận lệnh (IN_TRANSIT), lái xe thực hiện 4 milestone theo thứ tự:
> (1) Đã lấy vỏ / Lấy hàng (PICKED_UP) → (2) Đang đóng / Trả hàng (LOADING_OR_RETURNING)
> → (3) Đã hạ bãi / Giao hàng xong (DELIVERED). Song song, lái xe ghi nhận chi phí đi đường,
> nhiên liệu, container/seal, và nộp e-POD (2 slot bắt buộc).

---

## 4.1 — 4 Milestone vận hành (theo thứ tự)

### TC-LX-TIENDO-001 — Hoàn thành 4 milestone đúng thứ tự

- **Mã PRD:** TC-MO2C-05, O2C Bước 3
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip IN_TRANSIT (đã nhận lệnh gốc)
- **Các bước:**
  1. Mở `/my-trips/:id`. Bấm "Đã lấy vỏ / Lấy hàng" (PICKED_UP). Ghi timestamp.
  2. Bấm "Đang đóng / Trả hàng" (LOADING_OR_RETURNING). Ghi timestamp.
  3. Bấm "Đã hạ bãi / Giao hàng xong" (DELIVERED). Ghi timestamp.
- **Kết quả mong đợi (Pass):**
  - Mỗi milestone lưu đúng **một lần**, đúng **thứ tự**.
  - Mỗi milestone có timestamp và audit (người thực hiện, thời điểm).
  - Trạng thái trip cập nhật tương ứng sau mỗi milestone.
  - Hoàn tất vận hành (DELIVERED) **chưa tự biến** O2C thành COMPLETED.
- **Kỳ vọng sai (Fail nếu):**
  - Milestone đảo thứ tự (ví dụ DELIVERED trước PICKED_UP).
  - Ghi trùng milestone (bấm lại cùng milestone).
  - Hoàn tất vận hành → tự chuyển COMPLETED (quá sớm, thiếu e-POD + chi phí).
  - Không có timestamp/audit.
- **Bằng chứng:** ảnh trước/sau từng milestone + timestamp + audit

---

### TC-LX-TIENDO-002 — Thử bấm milestone kế trước thứ tự (negative)

- **Mã PRD:** TC-MO2C-05
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip IN_TRANSIT, chưa bấm milestone nào
- **Các bước:**
  1. Thử bấm "Đang đóng / Trả hàng" (bước 2) trước khi bấm "Đã lấy vỏ" (bước 1).
  2. Thử bấm "Đã hạ bãi" (bước 3) trước khi bấm bước 1 và 2.
- **Kết quả mong đợi (Pass):**
  - Hệ thống **chặn** bấm milestone sai thứ tự.
  - Thông báo: "Vui lòng hoàn thành bước trước" hoặc nút disabled.
  - Không thay đổi trạng thái trip.
- **Kỳ vọng sai (Fail nếu):**
  - Cho phép bấm milestone sai thứ tự.
  - Trạng thái trip bị nhảy cóc.
- **Bằng chứng:** ảnh nút disabled/ảnh thông báo chặn

---

### TC-LX-TIENDO-003 — Bấm milestone đã hoàn thành trước đó (idempotent)

- **Vai trò:** `laixe`
- **Mức độ:** P2
- **Tiền điều kiện:** Đã bấm PICKED_UP
- **Các bước:**
  1. Thử bấm lại PICKED_UP.
- **Kết quả mong đợi (Pass):**
  - Nút disabled hoặc thông báo "Đã hoàn thành".
  - Không ghi timestamp mới, không thay đổi audit.
- **Bằng chứng:** ảnh nút disabled

---

## 4.2 — Ghi nhận chi phí đi đường

### TC-LX-TIENDO-004 — Nhập tiền đường thực tế theo container

- **Mã PRD:** TC-MO2C-06
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip đang chạy, có container
- **Các bước:**
  1. Mở `/my-trips/:id`. Vào mục "Chi phí".
  2. Nhập tiền đường thực tế riêng theo container.
  3. Lưu.
  4. Refresh trang.
- **Kết quả mong đợi (Pass):**
  - Chi phí gắn đúng trip/container.
  - Không trộn giữa các container.
  - Dữ liệu tồn tại sau refresh.
- **Kỳ vọng sai (Fail nếu):**
  - Chi phí trộn giữa container.
  - Dữ liệu mất sau refresh.
- **Bằng chứng:** ảnh trước/sau nhập + ảnh sau refresh

---

## 4.3 — Ghi nhận nhiên liệu

### TC-LX-TIENDO-005 — Ghi nhận nhiên liệu với ảnh cột bơm

- **Mã PRD:** TC-MO2C-06, M12
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip đang chạy
- **Các bước:**
  1. Mở chi phí trip. Chọn "Nhiên liệu".
  2. Nhập số lít, đơn giá.
  3. Tải ảnh cột bơm/hóa đơn (`fuel-test.jpg`).
  4. Lưu.
- **Kết quả mong đợi (Pass):**
  - Số lít và đơn giá được bóc tách hiển thị.
  - Ảnh cột bơm được lưu kèm.
  - Chi phí nhiên liệu gắn đúng trip.
  - Dữ liệu tồn tại sau refresh.
- **Kỳ vọng sai (Fail nếu):**
  - Cho lưu thiếu ảnh bắt buộc.
  - Không có bóc tách/đối chiếu nhiên liệu.
  - Chi phí không gắn đúng trip.
- **Bằng chứng:** ảnh form nhiên liệu + ảnh đã lưu + ảnh sau refresh

---

## 4.4 — Ghi nhận Container / Seal

### TC-LX-TIENDO-006 — Ghi số container/seal và ảnh

- **Mã PRD:** TC-MO2C-06
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip đang chạy
- **Các bước:**
  1. Mở chi tiết trip. Nhập số container thực tế, số seal thực tế.
  2. Tải ảnh container (`container-test.jpg`) và ảnh seal (`seal-test.jpg`).
  3. Lưu.
- **Kết quả mong đợi (Pass):**
  - Số container/seal lưu đúng.
  - Ảnh đính kèm xem được.
  - Dữ liệu tồn tại sau refresh.
- **Bằng chứng:** ảnh form + ảnh đã lưu + ảnh sau refresh

---

## 4.5 — Nộp e-POD (2 slot bắt buộc)

### TC-LX-TIENDO-007 — Nộp e-POD thành công với đủ 2 slot

- **Mã PRD:** TC-MO2C-07
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip IN_TRANSIT, đã hoàn tất milestone vận hành (DELIVERED)
- **Các bước:**
  1. Mở e-POD trên `/my-trips/:id` hoặc `/shipments/:id`.
  2. Tải slot 1: "Phiếu bãi / phiếu hạ" (`yard-drop-test.jpg`).
  3. Tải slot 2: "Biên bản giao nhận có ký nhận" (`signed-delivery-test.pdf`).
  4. Bấm "Gửi e-POD".
- **Kết quả mong đợi (Pass):**
  - Trạng thái e-POD chuyển sang "Chờ duyệt" (SUBMITTED). — wording unified 2026-09-01 per user decision
  - Submission ID, version, status được ghi nhận.
  - e-POD neo đúng trip/fulfillment và phiên bản hiện tại.
  - Mở `/shipments/:id` xác nhận đúng trip/fulfillment.
- **Kỳ vọng sai (Fail nếu):**
  - Thiếu 1 slot vẫn gửi được.
  - Submission gắn sai trip.
  - Không có version/history.
  - Submit tự duyệt hoặc tự hoàn thành trip.
- **Bằng chứng:** ảnh 2 slot đã tải + ảnh status SUBMITTED + ảnh `/shipments/:id`

---

### TC-LX-TIENDO-008 — Chặn gửi e-POD khi thiếu slot bắt buộc (negative)

- **Mã PRD:** TC-MO2C-07
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Các bước:**
  1. Mở e-POD. Chỉ tải "Phiếu bãi / phiếu hạ" (slot 1).
  2. **Không** tải "Biên bản giao nhận" (slot 2). Thử bấm "Gửi e-POD".
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
- **Vai trò:** `laixe`
- **Mức độ:** P2
- **Các bước:**
  1. Tải đủ 2 slot bắt buộc. Không tải vé cầu đường.
  2. Bấm "Gửi e-POD".
- **Kết quả mong đợi (Pass):**
  - Gửi thành công. Vé cầu đường không bắt buộc.
- **Bằng chứng:** ảnh e-POD SUBMITTED không có vé cầu đường

---

## 4.6 — Gửi chờ duyệt phí (kết thúc phần lái xe)

### TC-LX-TIENDO-010 — Bấm "HOÀN THÀNH CHUYẾN" sau khi hoàn tất (full-close path 2026-08-29)

- **Mã PRD:** TC-MO2C-05, TC-MO2C-06
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Đã hoàn tất milestone DELIVERED, đã nhập chi phí, đã nộp e-POD (2 slot bắt buộc)
- **Các bước:**
  1. Mở `/my-trips/:id`. Bấm "HOÀN THÀNH CHUYẾN" (footer hoặc màn e-POD).
  2. Kiểm tra trạng thái trip + shipment từ `laixe`, `cus`, `dieuvan`.
- **Kết quả mong đợi (Pass):**
  - Trip chuyển sang `COMPLETED` (chốt luôn, không qua "Chờ duyệt phí").
  - Shipment tự động cập nhật sang `COMPLETED` (nhánh `allCompletedViaDriverClose` bỏ qua expense-scope + podRecoveredAt).
  - CUS workspace badge hiển thị "Hoàn thành" (PENDING_LOCK bucket + status label).
  - CUS container ledger: `dispatchStatus: COMPLETED` → "Hoàn thành".
  - Dispatcher trips list: trip `status: COMPLETED` → "Hoàn thành" (TRIP_STATUS_LABELS).
  - Driver app footer: nút "Đã hoàn thành chuyến" (disabled).
  - **Cache báo cáo (fix 2026-09-01):** ngay khi chốt chuyến, các cache báo cáo chịu ảnh hưởng bị invalidate (dashboard, dashboard:executive, P&L, total-AR, entity-results, fuel-variance, dashboard-widgets) — không đợi TTL. Trước 2026-09-01 full-close không bust cache nào (dashboard/P&L stale đến hết TTL). Kiểm chứng tự động: test `driver-fulfillment-progress` đặt sentinel key rồiassert đã bị xóa.
  - **Lưu ý:** Kế toán review (đối soát phí, POD giấy) sẽ build sau — hiện tại lái xe chốt trực tiếp, cost edit sau đó sẽ surface qua AR snapshot + dirty flag (O2C dev-rev1 §Bước 4).
- **Kỳ vọng sai (Fail nếu):**
  - Trip vẫn `IN_TRANSIT` sau khi bấm "HOÀN THÀNH CHUYẾN" (regression).
  - Shipment vẫn `IN_TRANSIT` / `PENDING_EXPENSE_APPROVAL` (recompute không theo driver close).
  - CUS/Dispatcher vẫn hiển thị "Đang chạy" / "Chờ duyệt phí" sau completion.
  - Láy xe khác trip_id có thể đóng trip của người khác (ownership leak).
  - Dashboard/P&L vẫn serve dữ liệu cũ (stale cache) sau khi lái xe chốt chuyến.
- **Bằng chứng:** ảnh trip COMPLETED trên `/my-trips/:id` + ảnh CUS workspace "Hoàn thành" + ảnh Dispatcher trips list "Hoàn thành" + ảnh DB status_history (IN_TRANSIT → COMPLETED).

---

## 4.7 — Xem thu nhập & Phiếu lương

### TC-LX-TIENDO-011 — Xem thu nhập cá nhân

- **Mã PRD:** M08
- **Vai trò:** `laixe`
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
- **Vai trò:** `laixe`
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

## 4.8 — Khóa nộp lại & hoàn thành chuyến sau khi gửi e-POD (regression 2026-08-29)

> Ba lỗi được báo trong ngày trial 08-29: (1) lái xe bấm lại "Chụp" trên e-POD
> đã gửi duyệt luôn dính lỗi 409 "Đã có một e-POD đang mở cho tác vụ này" vì
> nút chưa bị khóa; (2) khi bấm "HOÀN THÀNH CHUYẾN" mà bước gửi e-POD thất bại
> (mất mạng/conflict), hệ thống vẫn cố hoàn thành chuyến → bị server từ chối
> ngầm, chuyến kẹt ở "Đang chạy"/"Đã nhận" thay vì "Lịch sử"; (3) ở màn rộng
> ≥700px, 2 thẻ e-POD bắt buộc đè chữ/nút lên nhau.

### TC-LX-TIENDO-013 — Khóa nút Chụp/Tải tệp khi e-POD đã gửi duyệt (SUBMITTED/ACCEPTED)

- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Đã nộp e-POD thành công (TC-LX-TIENDO-007), trạng thái "Chờ duyệt" hoặc "Đã duyệt" (wording unified 2026-09-01)
- **Các bước:**
  1. Mở `/my-trips/:id/pod` của chuyến đã có e-POD SUBMITTED/ACCEPTED.
  2. Quan sát khu vực 2 slot bắt buộc.
  3. Thử bấm vào nơi trước đây có nút "Chụp"/"Tải tệp".
- **Kết quả mong đợi (Pass):**
  - Không còn nút "Chụp"/"Tải tệp" cho 2 slot — thay bằng dòng chữ "e-POD đã gửi duyệt — không thể chụp hoặc tải lại tệp cho phiên bản này".
  - Không xuất hiện lỗi "Đã có một e-POD đang mở cho tác vụ này".
- **Kỳ vọng sai (Fail nếu):**
  - Nút "Chụp"/"Tải tệp" vẫn hiện & bấm được.
  - Bấm vào sinh lỗi 409 "Đã có một e-POD đang mở cho tác vụ này".
- **Bằng chứng:** ảnh màn e-POD ở trạng thái SUBMITTED/ACCEPTED, không còn nút chụp/tải

---

### TC-LX-TIENDO-014 — Vẫn nộp lại được sau khi e-POD bị từ chối (REJECTED)

- **Vai trò:** `laixe` (nộp) + người duyệt e-POD (từ chối trước)
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** e-POD của chuyến đã bị từ chối (REJECTED), có lý do từ chối
- **Các bước:**
  1. Mở `/my-trips/:id/pod` của chuyến có e-POD REJECTED.
  2. Kiểm tra banner lý do từ chối hiển thị.
  3. Bấm "Chụp" hoặc "Tải tệp" cho 1 trong 2 slot bắt buộc, tải file mới.
- **Kết quả mong đợi (Pass):**
  - Nút "Chụp"/"Tải tệp" vẫn hiện & bấm được (KHÔNG bị khóa như case SUBMITTED).
  - Tải file mới thành công, tạo phiên bản e-POD mới (submissionVersion tăng).
- **Kỳ vọng sai (Fail nếu):**
  - Nút bị khóa/ẩn giống trạng thái SUBMITTED, lái xe không nộp lại được.
  - Lỗi "Đã có một e-POD đang mở cho tác vụ này" xuất hiện dù bản trước đã REJECTED.
- **Bằng chứng:** ảnh banner từ chối + ảnh sau khi tải file mới thành công

---

### TC-LX-TIENDO-015 — "HOÀN THÀNH CHUYẾN" không được tiến hành nếu bước gửi e-POD thất bại

- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** e-POD đang ở DRAFT (chưa gửi), đủ 2 slot bắt buộc; có thể mô phỏng mất mạng/conflict trong lúc gửi (tắt mạng ngay sau khi bấm, hoặc dùng phiên bản trip đã lỗi thời — expectedVersion sai)
- **Các bước:**
  1. Mở `/my-trips/:id/pod`, đủ 2 slot bắt buộc, e-POD còn DRAFT.
  2. Ngắt mạng (hoặc để trip bị đổi version ở tab khác) rồi bấm "HOÀN THÀNH CHUYẾN".
  3. Quan sát: lệnh gửi e-POD thất bại/queued offline.
  4. Bật lại mạng, tải lại trang, kiểm tra trạng thái chuyến.
- **Kết quả mong đợi (Pass):**
  - Khi bước gửi e-POD chưa xác nhận DONE, lệnh "HOÀN THÀNH CHUYẾN" (COMPLETE) **không được gửi lên server**.
  - Chuyến vẫn ở màn e-POD, chưa điều hướng về `/my-trips`.
  - Sau khi mạng ổn định và e-POD gửi thành công, bấm lại "HOÀN THÀNH CHUYẾN" mới chuyển chuyến sang "Lịch sử"/"Chờ duyệt phí".
- **Kỳ vọng sai (Fail nếu):**
  - Lệnh COMPLETE vẫn được gửi dù e-POD chưa SUBMITTED thành công (server từ chối ngầm, chuyến kẹt ở "Đang chạy"/"Đã nhận", không rõ lý do cho lái xe).
- **Bằng chứng:** ảnh trạng thái mạng lỗi + ảnh chuyến vẫn ở màn e-POD + ảnh sau khi hoàn thành lại thành công

---

### TC-LX-TIENDO-016 — Bố cục 2 thẻ e-POD không đè lên nhau ở màn rộng (visual)

- **Vai trò:** `laixe`
- **Mức độ:** P1
- **Thiết bị:** Mobile ngang / tablet nhỏ, chiều rộng ~700–1000px (đúng ngưỡng breakpoint)
- **Tiền điều kiện:** Chuyến có e-POD với 2 slot (bất kỳ trạng thái DRAFT/SUBMITTED/REJECTED)
- **Các bước:**
  1. Mở `/my-trips/:id/pod` trên thiết bị/trình duyệt rộng ~700–1000px.
  2. Quan sát 2 thẻ "Phiếu bãi / phiếu hạ" và "Biên bản giao nhận có ký nhận" cạnh nhau.
- **Kết quả mong đợi (Pass):**
  - 2 thẻ hiển thị tách bạch, có đường phân cách, không chữ/nút nào đè lên thẻ còn lại.
  - Tiêu đề, badge "1 tệp", nút/khu vực khóa đều đọc được rõ ràng.
- **Kỳ vọng sai (Fail nếu):**
  - Chữ hoặc nút của thẻ 1 đè lên thẻ 2 (hoặc ngược lại).
- **Bằng chứng:** ảnh chụp màn hình ở độ rộng ~700–1000px

### TC-LX-TIENDO-017 — Sau khi nộp e-POD, lô hàng vẫn ở "Đang chạy" (skip kế toán: chờ "HOÀN THÀNH CHUYẾN" mới chuyển)

- **Mã PRD:** O2C Bước 3 → Bước 4, TC-MO2C-07 + fix 2026-08-29 (driver full-close)
- **Vai trò:** `laixe` (driver-side) + `cus` (CUS-side) + `dieuvan` (dispatch-side)
- **Mức độ:** P0
- **Thiết bị:** Mobile + Desktop
- **Tiền điều kiện:** Trip IN_TRANSIT; e-POD ở trạng thái DRAFT với đủ 2 slot bắt buộc. **Quan trọng:** kế toán flow chưa build (theo instruction "skip kế toán for now, we build later") — vì vậy submit e-POD alone **không được** advance shipment sang "Chờ duyệt phí" vì không có ai để approve. Lô chỉ chuyển "Hoàn thành" khi tài xế bấm "HOÀN THÀNH CHUYẾN".
- **Các bước:**
  1. Đăng nhập `laixe`, mở `/my-trips/:id/pod`. Upload 2 tệp bắt buộc, bấm "Gửi e-POD" (status SUBMITTED). **Chưa** bấm "HOÀN THÀNH CHUYẾN".
  2. Mở tab khác, đăng nhập `cus`, mở `/shipments` hoặc chi tiết lô hàng. Quan sát cột trạng thái.
  3. Mở tab khác, đăng nhập `dieuvan`, mở `/dispatch` (Kế hoạch tổng quát/chi tiết) hoặc `/trips`. Quan sát.
  4. Quay lại tab lái xe, bấm "HOÀN THÀNH CHUYẾN". Refresh CUS + điều vận, quan sát lại.
- **Kết quả mong đợi (Pass):**
  - Sau bước 1 (submit e-POD): CUS + điều vận vẫn thấy lô ở **"Đang chạy"** (IN_TRANSIT; wording unified 2026-09-01) — KHÔNG nhảy sang "Chờ duyệt phí".
  - Sau bước 4 ("HOÀN THÀNH CHUYẾN"): CUS + điều vận thấy lô chuyển sang **"Hoàn thành"** (COMPLETED).
  - Lịch sử trạng thái có dòng IN_TRANSIT → COMPLETED, kèm `changedBy` = tài xế và timestamp.
  - Khi kế toán flow build lại, test case này sẽ cần thêm 1 nhánh: sau bước 1 lô → "Chờ duyệt phí" (PENDING_EXPENSE_APPROVAL); sau bước 4 lô → "Hoàn thành" (COMPLETED). Comment trong `shipment-status-transitions.service.ts` chỉ chỗ re-enable.
- **Kỳ vọng sai (Fail nếu):**
  - Sau bước 1: lô nhảy sang "Chờ duyệt phí" — sai vì không có kế toán approve (hành vi trước fix vô tình tái hiện).
  - Sau bước 4: lô không chuyển "Hoàn thành" (full-close path bị break).
- **Bằng chứng:** ảnh trạng thái CUS + điều vận sau bước 1 (vẫn IN_TRANSIT) + ảnh trạng thái CUS + điều vận sau bước 4 (COMPLETED)

---

## Bảng nghiệm thu — Luồng Tiến độ & e-POD (Lái xe)

| Ngày thử | Mã TC | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|-----------|---------|---------|------------|
| __/__/__ | TC-LX-TIENDO-001 | | | 4 milestone đúng thứ tự | |
| __/__/__ | TC-LX-TIENDO-002 | | | Milestone sai thứ tự | |
| __/__/__ | TC-LX-TIENDO-003 | | | Milestone idempotent | |
| __/__/__ | TC-LX-TIENDO-004 | | | Tiền đường | |
| __/__/__ | TC-LX-TIENDO-005 | | | Nhiên liệu + ảnh | |
| __/__/__ | TC-LX-TIENDO-006 | | | Container/Seal | |
| __/__/__ | TC-LX-TIENDO-007 | | | e-POD đủ 2 slot | |
| __/__/__ | TC-LX-TIENDO-008 | | | e-POD thiếu slot | |
| __/__/__ | TC-LX-TIENDO-009 | | | Vé cầu đường tùy chọn | |
| __/__/__ | TC-LX-TIENDO-010 | | | Gửi chờ duyệt phí | |
| __/__/__ | TC-LX-TIENDO-011 | | | Thu nhập/Phiếu lương | |
| __/__/__ | TC-LX-TIENDO-012 | | | Khoản phạt | |
| __/__/__ | TC-LX-TIENDO-013 | | | Khóa nút khi đã SUBMITTED/ACCEPTED | |
| __/__/__ | TC-LX-TIENDO-014 | | | Nộp lại được khi REJECTED | |
| __/__/__ | TC-LX-TIENDO-015 | | | Không hoàn thành chuyến nếu gửi e-POD lỗi | |
| __/__/__ | TC-LX-TIENDO-016 | | | Bố cục 2 thẻ e-POD không đè nhau | |
| __/__/__ | TC-LX-TIENDO-017 | | | e-POD submit giữ "Đang chạy"; chỉ "HOÀN THÀNH CHUYẾN" mới chuyển "Hoàn thành" (skip kế toán) | |
