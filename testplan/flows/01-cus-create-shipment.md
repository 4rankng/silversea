# Luồng 1: Tạo Lô hàng — Nhân viên Chứng từ (CUS)

> **Vai trò sở hữu:** CUS (CLERK) — Nhân viên Chứng từ / CSKH
> **Tài khoản demo:** `cus` (password: `Abc123`)
> **Route chính:** `/shipments/new`, `/shipments`, `/shipments/:id`
> **Vai trò được phép tạo lô:** ADMIN, CUS, MANAGER
> **PRD nguồn:** Module 10 (`docs/prd/Module10.docx`), O2C Flow Bước 1
>
> **Tổng quan luồng:** CUS tiếp nhận Booking từ khách hàng, khởi tạo Lô hàng trên hệ thống với
> thông tin hàng hóa (FCL: container; LCL: bao bì, kg, CBM). Hệ thống tự động áp cước dự kiến
> theo Khách × Tuyến. Sau khi tạo, lô chuyển sang Điều vận để phân xe.

---

## 1.1 — Tạo lô FCL (Full Container Load)

### TC-CUS-CREATE-001 — Tạo lô FCL thành công (luồng thường)

- **Mã PRD:** M10-01-01, TC-MO2C-03
- **Vai trò:** `cus`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Có ít nhất 1 khách hàng active, 1 tuyến đường, 1 bảng giá cước còn hiệu lực
- **Các bước:**
  1. Đăng nhập `cus`. Mở `/shipments/new`.
  2. Chọn Khách hàng từ dropdown.
  3. Nhập Số Booking: `BK-TEST-FCL-01`, Số vận đơn (B/L): `BL-TEST-FCL-01`.
  4. Chọn Tuyến đường.
  5. Thêm 2 dòng container: `CONT-01` (seal `SEAL-01`), `CONT-02` (seal `SEAL-02`).
  6. Nhập ngày giao dự kiến riêng cho từng container.
  7. Bấm "Tạo lô hàng".
- **Kết quả mong đợi (Pass):**
  - Lô tạo thành công, chuyển sang trang chi tiết `/shipments/:id`.
  - Trạng thái = "Mới tạo" (NEW).
  - Mã lô (`shipmentCode`) được sinh tự động, duy nhất.
  - Hiển thị đúng 2 dòng container với container/seal đã nhập.
  - Ngày giao dự kiến lưu riêng theo từng container (không chỉ ở cấp lô).
  - Cước dự kiến tự động lấy theo Khách × Tuyến (read-only, không cho gõ tay).
  - Phụ phí xăng dầu tự tính theo công thức: `(giá dầu hiện tại − giá dầu gốc) × số lít định mức × tỷ lệ chia sẻ`.
  - Ghi người tạo và thời điểm.
- **Kỳ vọng sai (Fail nếu):**
  - Thiếu trường FCL (container, seal, ngày giao theo container).
  - Cước hoặc phụ phí không hiển thị / cho nhập tay.
  - Ngày giao chỉ lưu ở cấp lô.
  - Mã lô trùng hoặc không sinh.
- **Bằng chứng:** ảnh form đã điền + ảnh chi tiết lô + ảnh giá cước read-only

---

### TC-CUS-CREATE-002 — Tạo lô FCL với container trống (cho phép thiếu số cont)

- **Mã PRD:** TC-MO2C-03
- **Vai trò:** `cus`
- **Mức độ:** P1
- **Tiền điều kiện:** như TC-CUS-CREATE-001
- **Các bước:**
  1. Mở `/shipments/new`.
  2. Nhập Booking/BL, chọn khách hàng và tuyến.
  3. Thêm 2 dòng container: chỉ nhập seal cho dòng 1, để trống số container ở dòng 2.
  4. Bấm "Tạo lô hàng".
- **Kết quả mong đợi (Pass):**
  - Hệ thống cho phép lưu khi số container trống (điều vận sẽ bổ sung sau).
  - Lô tạo thành công, hiển thị đúng dữ liệu đã nhập.
- **Kỳ vọng sai (Fail nếu):**
  - Bắt buộc nhập số container khi chưa cần → không linh hoạt cho nghiệp vụ.
- **Bằng chứng:** ảnh form + ảnh chi tiết lô

---

## 1.2 — Tạo lô LCL (Less than Container Load)

### TC-CUS-CREATE-003 — Tạo lô LCL thành công (luồng thường)

- **Mã PRD:** TC-MO2C-03
- **Vai trò:** `cus`
- **Mức độ:** P0
- **Thiết bị:** Desktop
- **Tiền điều kiện:** Có khách hàng, tuyến, bảng giá cước, fuel config
- **Các bước:**
  1. Mở `/shipments/new`.
  2. Chọn Khách hàng, nhập Booking: `BK-TEST-LCL-01`, B/L: `BL-TEST-LCL-01`.
  3. Chọn Tuyến đường.
  4. Nhập quy cách hàng lẻ: loại bao bì, số lượng, khối lượng (kg), CBM.
  5. Nhập kho lấy hàng, ngày giao dự kiến, ghi chú.
  6. Bấm "Tạo lô hàng".
- **Kết quả mong đợi (Pass):**
  - Lô LCL tạo thành công với đầy đủ trường hàng lẻ.
  - Cước dự kiến tự động tính theo Khách × Tuyến.
  - Phụ phí xăng dầu tự tính đúng công thức.
  - Dữ liệu mở lại chính xác sau khi refresh.
- **Kỳ vọng sai (Fail nếu):**
  - Thiếu trường LCL (bao bì, số lượng, kg, CBM).
  - Không có cước hoặc phụ phí.
  - Dữ liệu mở lại sai.
- **Bằng chứng:** ảnh form LCL + ảnh chi tiết + ảnh giá cước

---

## 1.3 — Validation & Xử lý lỗi

### TC-CUS-CREATE-004 — Thiếu trường bắt buộc

- **Vai trò:** `cus`
- **Mức độ:** P1
- **Thiết bị:** Desktop + Mobile
- **Các bước:**
  1. Mở `/shipments/new`.
  2. Không chọn Khách hàng. Bấm "Tạo lô hàng".
  3. Chọn khách hàng nhưng không nhập Booking. Bấm "Tạo lô hàng".
- **Kết quả mong đợi (Pass):**
  - Lần 1: Hiển thị "Vui lòng chọn khách hàng" (tiếng Việt). Không gọi API.
  - Lần 2: Hiển thị cảnh báo thiếu Booking. Không tạo lô.
  - Thông báo lỗi bằng tiếng Việt, rõ ràng, chỉ đúng trường thiếu.
- **Bằng chứng:** ảnh cảnh báo + Network tab (không có POST)

---

### TC-CUS-CREATE-005 — Mất kết nối khi lưu, gửi lại không trùng (idempotency)

- **Mã PRD:** Q23, TC-M10-01-03
- **Vai trò:** `cus`
- **Mức độ:** P1
- **Các bước:**
  1. Nhập đầy đủ thông tin lô.
  2. DevTools → Network → Offline. Bấm "Tạo lô hàng" → quan sát lỗi.
  3. Bật lại Online. Bấm "Tạo lô hàng" lần nữa.
  4. Kiểm tra `/shipments` và DB: đếm số lô có booking vừa tạo.
- **Kết quả mong đợi (Pass):**
  - Offline: thông báo lỗi tiếng Việt dễ hiểu, không có toast thành công giả.
  - Online lại: tạo thành công, đúng **1 lô** (idempotency qua `Idempotency-Key`).
- **Bằng chứng:** ảnh lỗi offline + Network tab (2 request, cùng id) + ảnh danh sách

---

## 1.4 — Bàn giao lô cho Điều vận (Handoff)

### TC-CUS-CREATE-006 — Bàn giao lô cho Điều vận thành công

- **Mã PRD:** M10-03-01, Q17
- **Vai trò:** `cus` (bàn giao) + `dieuvan` (nhận)
- **Mức độ:** P0
- **Thiết bị:** Desktop (cần 2 phiên)
- **Tiền điều kiện:** Lô đã tạo xong, có B/L và ≥1 container
- **Các bước:**
  1. Đăng nhập `cus`. Mở `/shipments/:id`. Bấm "Bàn giao cho Điều vận" (tạo handoff).
  2. Đăng nhập `dieuvan` ở tab khác. Kiểm tra thông báo / màn điều vận.
  3. Quan sát: thông báo, trạng thái handoff, version snapshot.
- **Kết quả mong đợi (Pass):**
  - Điều vận nhận notification kiểu `SHIPMENT_HANDOFF` cho đúng lô.
  - Handoff có `status = UNSEEN`, `handoffVersion` = version hiện tại của lô.
  - Điều vận mở lô → `markSeen` chuyển sang `SEEN`.
  - Lô xuất hiện trên màn `/dispatch` của Điều vận.
- **Kỳ vọng sai (Fail nếu):**
  - Điều vận không nhận được thông báo.
  - Handoff không sinh hoặc sai version.
  - Lô không xuất hiện ở màn dispatch.
- **Bằng chứng:** ảnh thông báo Điều vận + ảnh handoff status + ảnh `/dispatch`

---

### TC-CUS-CREATE-007 — Sửa lô sau khi bàn giao → cảnh báo version conflict

- **Mã PRD:** M10-03-03
- **Vai trò:** `cus` (sửa) + `dieuvan` (đang xem)
- **Mức độ:** P1
- **Các bước:**
  1. Lô đã bàn giao, Điều vận đã mở (handoff SEEN).
  2. `cus` sửa B/L hoặc container trên lô → version tăng.
  3. Điều vận mở lại lô.
- **Kết quả mong đợi (Pass):**
  - Hệ thống cảnh báo Điều vận: "Lô đã có phiên bản mới" (version conflict).
  - Điều vận không thao tác tiếp trên dữ liệu cũ mà không được cảnh báo.
- **Bằng chứng:** ảnh cảnh báo conflict + DB version > handoffVersion

---

## 1.5 — Phân quyền tạo lô

### TC-CUS-CREATE-008 — Vai trò được phép và bị chặn tạo lô

- **Mã PRD:** Q17, TC-M10-01-04
- **Vai trò được phép:** `admin`, `cus`, `giamdoc`
- **Vai trò bị chặn:** `ketoan`, `dieuvan`, `laixe`, `giaonhan`, `customer`
- **Mức độ:** P0
- **Thiết bị:** Desktop
- **Các bước:**
  1. Lần lượt đăng nhập `admin`, `cus`, `giamdoc`; mở `/shipments/new` → phải mở được.
  2. Lần lượt đăng nhập `ketoan`, `dieuvan`, `laixe`, `giaonhan`, `customer`; mở `/shipments/new`.
- **Kết quả mong đợi (Pass):**
  - ADMIN, CUS, MANAGER thấy CTA "Tạo lô mới" và mở được form.
  - Các vai trò còn lại: redirect về màn nhà hoặc "Không có quyền".
  - API cũng trả 403 cho vai trò không có quyền.
- **Bằng chứng:** ảnh redirect / "Không có quyền" + Network tab 403

---

### TC-CUS-CREATE-009 — CUS thấy toàn bộ lô hàng (không giới hạn phạm vi)

- **Mã PRD:** Q17
- **Vai trò:** `cus`
- **Mức độ:** P1
- **Các bước:**
  1. Đăng nhập `cus`. Mở `/shipments`.
  2. Kiểm tra: thấy **tất cả** lô hàng trong hệ thống (mọi khách hàng, mọi đơn vị phụ trách), không giới hạn theo người dùng.
  3. Mở trực tiếp URL `/shipments/:id` của bất kỳ lô nào (kể cả lô do người dùng khác tạo).
- **Kết quả mong đợi (Pass):**
  - Danh sách hiển thị toàn bộ lô hàng — hai tài khoản CUS khác nhau thấy cùng một danh sách.
  - URL trực tiếp của lô bất kỳ mở bình thường (không 404/redirect).
- **Bằng chứng:** ảnh danh sách + ảnh truy cập URL trực tiếp

---

## 1.6 — Trường hợp biên

### TC-CUS-CREATE-010 — Tạo liên tiếp nhiều lô, không lỗi

- **Mã PRD:** TC-M10-01-05
- **Vai trò:** `cus`
- **Mức độ:** P2
- **Các bước:**
  1. Tạo lô A (booking `ROLL-A`). Không reload trang.
  2. Tạo lô B (booking `ROLL-B`). Không reload trang.
  3. Tạo lô C (booking `ROLL-C`).
  4. Mở `/shipments`, kiểm tra 3 lô.
- **Kết quả mong đợi (Pass):**
  - Cả 3 lô tạo thành công, 3 `shipmentCode` khác nhau, không trùng.
  - Form reset về trạng thái trống sau mỗi lần tạo.
- **Bằng chứng:** ảnh danh sách 3 lô + ảnh chi tiết từng lô

---

### TC-CUS-CREATE-011 — Double-submit không tạo bản ghi trùng

- **Mã PRD:** Q23, HT-04
- **Vai trò:** `cus`
- **Mức độ:** P1
- **Các bước:**
  1. DevTools Network → Slow 3G.
  2. Nhập thông tin lô. Bấm "Tạo lô hàng" **2 lần liên tiếp** trước khi request đầu trả về.
  3. Kiểm tra DB: đếm số lô.
- **Kết quả mong đợi (Pass):**
  - Chỉ tạo **1 lô** trong DB.
  - Lần submit thứ 2 trả về kết quả đã có hoặc báo "đã tồn tại".
- **Bằng chứng:** Network tab (2 request, cùng response) + DB (1 bản ghi)

---

## 1.7 — Tạo khách hàng inline (trong form tạo lô)

### TC-CUS-CREATE-012 — Tạo khách hàng inline thành công từ form tạo lô

- **Mã PRD:** 74a17b5c, casbin.ts:38-45
- **Vai trò:** `cus`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Đăng nhập `cus`, mở `/shipments/new`
- **Các bước:**
  1. Ở dropdown "Khách hàng", bấm "Thêm khách hàng" (nút + hoặc link).
  2. Dialog "Thêm khách hàng" mở. Nhập tên: `KH Inline Test E2E`.
  3. Nhập mã số thuế (tùy chọn): `0123456789`.
  4. Bấm "Thêm khách hàng".
- **Kết quả mong đợi (Pass):**
  - Khách hàng tạo thành công (201), không bị403.
  - Dialog đóng, khách hàng mới tự động chọn trong dropdown.
  - Các trường credit/billing (`creditLimit`, `paymentTermDays`, `status`, `isCarrier`) bị strip — chỉ có identity fields.
  - Không có governance action (không qua phê duyệt) vì CUS intake là identity-only.
  - Khách hàng mới có trong danh mục khi tạo lô lần sau, và xuất hiện ngay trong dropdown Khách hàng cho **mọi** vai trò/người dùng (không giới hạn theo người dùng).
- **Kỳ vọng sai (Fail nếu):**
  - Bị 403 "Không có quyền truy cập" — dead-end, không thể tạo lô.
  - Dialog không đóng sau khi tạo.
  - Khách hàng mới không tự động chọn.
  - Các trường credit/billing vẫn được set (rủi ro bảo mật).
- **Bằng chứng:** Network tab (POST /api/customers → 201) + ảnh dialog + ảnh dropdown đã chọn

---

### TC-CUS-CREATE-013 — CUS không thể sửa/xóa khách hàng (create-only)

- **Mã PRD:** casbin.ts:38-45, customer-intake-create.test.ts:158-178
- **Vai trò:** `cus`
- **Mức độ:** P0
- **Thiết bị:** Desktop
- **Các bước:**
  1. Tạo khách hàng inline (TC-CUS-CREATE-012).
  2. Thử sửa tên khách hàng vừa tạo qua API: `PUT /api/customers/:id`.
  3. Thử xóa khách hàng: `DELETE /api/customers/:id`.
- **Kết quả mong đợi (Pass):**
  - PUT trả 403 — Casbin chỉ cho phép POST, không cho PUT/DELETE.
  - DELETE trả 403.
  - Khách hàng không bị thay đổi/xóa.
- **Bằng chứng:** Network tab (PUT → 403, DELETE → 403)

---

### TC-CUS-CREATE-014 — Dispatcher cũng tạo được khách hàng inline

- **Mã PRD:** casbin.ts:38-45
- **Vai trò:** `dieuvan`
- **Mức độ:** P1
- **Thiết bị:** Desktop
- **Tiền điều kiện:** Đăng nhập `dieuvan`, mở trang có dropdown khách hàng
- **Các bước:**
  1. Tạo khách hàng inline qua API: `POST /api/customers` với tên `KH Dispatcher Test`.
  2. Kiểm tra: tạo thành công (201), credit fields bị strip.
- **Kết quả mong đợi (Pass):**
  - Dispatcher tạo được khách hàng inline (201).
  - Credit/billing fields bị strip (tương tự CUS).
- **Bằng chứng:** Network tab (POST → 201) + response body không có creditLimit

---

### TC-CUS-CREATE-015 — Vai trò khác không tạo được khách hàng inline

- **Mã PRD:** casbin.ts:38-45
- **Vai trò bị chặn:** `laixe`, `ketoan`, `giaonhan`, `customer`
- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `laixe`. Gọi `POST /api/customers` qua API.
  2. Đăng nhập `ketoan`. Gọi `POST /api/customers`.
  3. Đăng nhập `giaonhan`. Gọi `POST /api/customers`.
  4. Đăng nhập `customer`. Gọi `POST /api/customers`.
- **Kết quả mong đợi (Pass):**
  - Tất cả bị 403 — Casbin chỉ bypass cho CUS và DISPATCHER.
  - Không tạo được khách hàng.
- **Bằng chứng:** Network tab (403 cho từng vai trò)

---

## 1.8 — Nhà máy/kho trong form tạo lô (báo cáo khách hàng 2026-09-06)

> **Nguồn:** Frank Ng relay 2026-09-06 — "Khi cus tạo lô hàng mới, nhà máy không có dropdown lựa
>> chọn và cũng không nhập mới được". Đã xác minh trên mã hiện tại: dropdown nhà máy tải theo khách
>> hàng đã chọn (`GET /api/shipments/operational-sites?customerId=`) và nút "Thêm nhà máy" đã có sẵn;
>> các case dưới pin hành vi này để không hồi quy.

### TC-CUS-CREATE-016 — Dropdown nhà máy hiển thị đúng theo khách hàng đã chọn

- **Vai trò:** `cus`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Đăng nhập `cus`, mở `/shipments/new`; khách hàng được chọn có ≥1 nhà máy active
- **Các bước:**
  1. Chọn khách hàng có nhà máy (vd LOGCOM).
  2. Để chế độ FCL: kiểm tra dropdown "Nhà máy" của dòng container.
  3. Chuyển sang LCL: kiểm tra dropdown nhà máy ở cấp lô.
  4. Đổi sang khách hàng khác.
- **Kết quả mong đợi (Pass):**
  - Dropdown hiển thị đúng các nhà máy ACTIVE của khách hàng đã chọn (nhà máy "Đã ngưng" không hiện).
  - Đổi khách hàng → danh sách nhà máy tải lại theo khách hàng mới, chọn cũ được reset.
  - Không lỗi "Không thể tải danh sách nhà máy của khách hàng" khi API hoạt động bình thường.
- **Kỳ vọng sai (Fail nếu):** dropdown trống với khách hàng có nhà máy active; danh sách không đổi khi đổi khách hàng.
- **Bằng chứng:** ảnh dropdown mở cho 2 khách hàng khác nhau

---

### TC-CUS-CREATE-017 — Tạo nhà máy inline từ form tạo lô, tự chọn sau khi tạo

- **Vai trò:** `cus`
- **Mức độ:** P0
- **Tiền điều kiện:** đã chọn khách hàng ở form tạo lô
- **Các bước:**
  1. Bấm "Thêm nhà máy" cạnh dropdown nhà máy.
  2. Nhập mã (`NM-INLINE-01`), tên đầy đủ, tên ngắn, địa chỉ; chọn tuyến đường.
  3. Bấm "Thêm nhà máy" trong dialog.
  4. Tiếp tục tạo lô hàng (FCL).
- **Kết quả mong đợi (Pass):**
  - Tạo thành công (POST `/api/shipments/operational-sites` → 201), không 403.
  - Dialog đóng, nhà máy mới tự xuất hiện và **được tự chọn** cho lô/container đang tạo.
  - Chưa chọn khách hàng mà bấm "Thêm nhà máy" → toast hướng dẫn chọn khách hàng trước (không im lặng).
- **Kỳ vọng sai (Fail nếu):** 403/409 dead-end; nhà máy mới không tự chọn; bấm nút không phản ứng.
- **Bằng chứng:** Network (POST → 201) + ảnh dropdown sau khi tạo

---

### TC-CUS-CREATE-019 — Tạo cảng/bãi inline ngay từ ô Cảng nâng/hạ của container

- **Vai trò:** `cus`
- **Mức độ:** P0
- **Nguồn:** báo cáo khách hàng 2026-09-06 14:02 — "Trường nào cho phép input text được CTO nhớ cho phép nhập text nhé, vẫn còn nhiều chỗ chỉ cho chọn dropdown"
- **Các bước:**
  1. Đăng nhập `cus`, mở `/shipments/new`, chọn khách hàng (FCL).
  2. Ở dòng container, focus ô **Cảng nâng** → bấm nút **Thêm** trong ô.
  3. Dialog "Thêm cảng / bãi": nhập tên cảng, mã (tùy chọn), địa chỉ (tùy chọn) → bấm "Thêm cảng / bãi".
  4. Làm tương tự kiểm tra ô **Cảng hạ** và ô **Tuyến đường** (nút Thêm mở dialog tạo tuyến).
- **Kết quả mong đợi (Pass):**
  - POST `/api/ports` → 201 với CUS (allowance route-scoped POST-only, giống customers).
  - Dialog đóng, cảng mới **tự chọn** vào đúng ô đã yêu cầu; không cần mở lại dropdown.
  - Cảng mới xuất hiện trong dropdown Cảng nâng/hạ cho lần sau.
  - PUT/DELETE `/api/ports/:id` với CUS vẫn 403 (create-only).
- **Kỳ vọng sai (Fail nếu):** 403 khi tạo; cảng không tự chọn; nút Thêm không xuất hiện trong ô.
- **Bằng chứng:** Network POST 201 + ảnh ô cảng sau khi tạo (`qa/2026-09-06_factory-customer-creation/` flow E)

---

### TC-CUS-CREATE-018 — Form thêm khách hàng inline có đủ thông tin liên hệ

- **Vai trò:** `cus`
- **Mức độ:** P1
- **Nguồn:** báo cáo khách hàng 2026-09-06 — "Form thêm mới của khách hàng đang không được đầy đủ thông tin"
- **Các bước:**
  1. Ở form tạo lô, bấm "Thêm khách hàng".
  2. Nhập tên, mã số thuế, SĐT, người liên hệ **và địa chỉ / thông tin liên hệ khác**.
  3. Bấm "Thêm khách hàng".
- **Kết quả mong đợi (Pass):**
  - Dialog có trường "Địa chỉ / thông tin liên hệ khác"; giá trị lưu vào `contactInfo` (response có trường).
  - Khách hàng mới tự chọn trong dropdown (giữ nguyên hành vi TC-CUS-CREATE-012).
  - Các trường credit/billing vẫn bị strip phía backend (identity-only).
- **Kỳ vọng sai (Fail nếu):** thiếu trường địa chỉ; `contactInfo` không lưu; credit fields lọt qua.
- **Bằng chứng:** response POST có `contactInfo` + ảnh dialog

---

## 1.9 — Free-text inputs trong form tạo lô (báo cáo khách hàng 2026-09-06)

> **Nguồn:** Frank Ng relay 2026-09-06 — "Trường nào cho phép input text được CTO nhớ cho phép nhập text
> nhé, vẫn còn nhiều chỗ chỉ cho phép chọn dropdown". Hai trường còn dropdown-only đã được mở:
> `Quy cách đóng gói` (free-text) và `Loại container` (+ Thêm inline). Các trường catalog khác
> (Tuyến đường, Nhà máy, Cảng nâng/hạ, Kho lấy hàng) đã có sẵn nút "+ Thêm" để mở rộng danh mục.

### TC-CUS-CREATE-019 — `Quy cách đóng gói` cho phép nhập text tự do

- **Vai trò:** `cus`
- **Mức độ:** P0
- **Nguồn:** báo cáo khách hàng 2026-09-06 — "vẫn còn nhiều chỗ chỉ cho phép chọn dropdown"
- **Các bước:**
  1. Ở form tạo lô, chọn khách hàng, chọn hình thức Nhập khẩu, nhập số Bill.
  2. Chuyển sang chế độ **Hàng lẻ** (LCL).
  3. Tìm trường "Quy cách đóng gói".
- **Kết quả mong đợi (Pass):**
  - Trường là `<input type="text">` tự do, **không phải** dropdown (không có `role="combobox"`,
    không có `aria-haspopup="listbox"`).
  - Schema backend chấp nhận `packageType` dạng string tối đa 100 ký tự
    (`shared/src/schemas/index.ts:1402`).
  - Nhập giá trị bất kỳ (`Thùng carton 5 lớp`, `Bao jumbo 1 tấn`, `Pallet gỗ`, …) đều lưu được
    và xuất hiện đúng ở lô đã tạo.
  - Giá trị cũ `Pallet` / `Roll` / `Carton` vẫn hợp lệ (backward compatible).
- **Kỳ vọng sai (Fail nếu):** trường bị ép về dropdown; không nhập được giá trị ngoài 3 lựa chọn cũ.
- **Bằng chứng:** ảnh trường dạng input tự do + DB `shipments.package_type` đúng giá trị nhập.

---

### TC-CUS-CREATE-020 — Tạo Loại container inline từ form tạo lô, tự chọn sau khi tạo

- **Vai trò:** `cus`
- **Mức độ:** P0
- **Nguồn:** báo cáo khách hàng 2026-09-06 — "vẫn còn nhiều chỗ chỉ cho phép chọn dropdown"
- **Các bước:**
  1. Ở form tạo lô, chọn khách hàng, chọn Nhập khẩu, nhập số Bill.
  2. Ở dòng container, cột "Loại container", bấm nút **+ Thêm** cạnh dropdown.
  3. Nhập mã (vd `45HC`), tên (vd `Container 45' High Cube`), ghi chú (tùy chọn).
  4. Bấm "Thêm loại container".
  5. Tiếp tục tạo lô FCL.
- **Kết quả mong đợi (Pass):**
  - Dialog "Thêm loại container" mở với 3 trường: Mã (bắt buộc, max 20), Tên (bắt buộc, max 50), Ghi chú
    (tùy chọn, max 500).
  - Tạo thành công qua `POST /api/container-types` → 201, không 403.
  - Dialog đóng, loại container mới **tự chọn** cho dòng container đang tạo.
  - Lô tạo xong, container mở ra xem thấy đúng `containerTypeId` mới.
- **Kỳ vọng sai (Fail nếu):** 403 dead-end; loại mới không tự chọn; bấm nút không phản hồi;
  catalog cache không cập nhật.
- **Bằng chứng:** Network POST `/api/container-types` → 201 + ảnh dialog đã điền + ảnh dropdown sau
  khi tạo + DB `shipment_containers.container_type_id` đúng ID mới.

---

## Ghi chú hồi quy 2026-09-05 — Màn "Danh sách container" (/shipments-detail) mặc định lọc theo hôm nay

- **Hành vi thiết kế (không phải bug):** trang danh sách container (hiển thị theo cont) mặc định lọc
  `Từ ngày vận chuyển` = `Đến ngày vận chuyển` = hôm nay. Container có giờ hẹn đóng/trả (hoặc EDD kế thừa)
  **khác hôm nay sẽ không xuất hiện** cho đến khi người dùng mở rộng khoảng ngày hoặc bật xem tất cả.
- **Bối cảnh báo lỗi 2026-09-05:** lô 1 cont đã hoàn thành vận chuyển, giờ hẹn cont là ngày mai (6/9) →
  khách hàng không thấy cont trên màn theo cont. Trạng thái lô KHÔNG ảnh hưởng hiển thị ở đây (chỉ loại
  lô đã hủy); nguyên nhân duy nhất là bộ lọc ngày mặc định.
- **Hướng dẫn QA:** khi nghiệm thu hiển thị trên màn theo cont, mở rộng khoảng ngày vận chuyển quanh
  ngày hẹn của cont trước khi kết luận "mất dữ liệu".

---

## 1.10 — Xoá selections trong ô dropdown container (báo cáo khách hàng 2026-09-07)

> **Nguồn:** Customer relay 2026-09-07 — "mục nhà máy, tuyến đường, cảng nâng, cảng hạ khi đã chọn
> dữ liệu mà muốn xóa đi để tìm lại thông tin đúng chọn lại nhưng không xóa được mà phải kéo chọn
> những data có sẵn".

### TC-CUS-CREATE-021 — Xoá chọn trong ô Nhà máy container rồi chọn lại

- **Vai trò:** `cus`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Đăng nhập `cus`, mở `/shipments/new`; khách hàng có ≥2 nhà máy active
- **Các bước:**
  1. Chọn khách hàng. Thêm 1 dòng container.
  2. Ở cột "Nhà máy", chọn nhà máy A (vd SCONNECT).
  3. Bấm nút **X** (clear) bên phải ô dropdown để xoá chọn.
  4. Kiểm tra: ô Nhà máy hiển thị placeholder "Chọn nhà máy", không còn giữ nhà máy A.
  5. Mở dropdown, chọn nhà máy B khác.
- **Kết quả mong đợi (Pass):**
  - Nút X xuất hiện khi đã có giá trị được chọn trong ô Nhà máy.
  - Sau khi bấm X, giá trị được xoá → ô placeholder hiển thị lại, không còn giữ giá trị cũ.
  - User có thể gõ text tìm kiếm và chọn nhà máy mới mà không cần kéo scroll danh sách.
- **Kỳ vọng sai (Fail nếu):** nút X không hiện; bấm X không xoá; phải kéo scroll để chọn lại.
- **Bằng chứng:** ảnh nút X + ảnh placeholder sau khi xoá + ảnh dropdown đã chọn mới

---

### TC-CUS-CREATE-022 — Xoá chọn trong ô Tuyến đường container

- **Vai trò:** `cus`
- **Mức độ:** P0
- **Các bước:**
  1. Ở dòng container, chọn Tuyến đường đã chọn (vd "KCN ĐỒNG VĂN, HÀ NAM").
  2. Bấm nút **X** (clear) bên phải ô Tuyến đường.
  3. Kiểm tra: ô hiển thị placeholder "Chọn tuyến đường".
  4. Gõ text tìm tuyến khác, chọn tuyến mới.
- **Kết quả mong đợi (Pass):**
  - Nút X hiện khi đã chọn tuyến. Bấm X → xoá, placeholder hiển thị.
  - Có thể gõ text filter và chọn tuyến mới.
- **Kỳ vọng sai (Fail nếu):** không xoá được, phải kéo scroll danh sách.

---

### TC-CUS-CREATE-023 — Xoá chọn trong ô Cảng nâng và Cảng hạ container

- **Vai trò:** `cus`
- **Mức độ:** P0
- **Các bước:**
  1. Ở dòng container, chọn **Cảng nâng** (vd "Cảng VipGreenPort").
  2. Bấm nút **X** (clear) bên phải ô Cảng nâng. → placeholder "Chọn cảng nâng" hiển thị.
  3. Chọn **Cảng hạ**. Bấm nút **X** (clear). → placeholder "Chọn cảng hạ" hiển thị.
  4. Chọn lại cảng mới cho cả hai ô.
- **Kết quả mong đợi (Pass):**
  - Nút X xuất hiện trên cả hai ô khi đã chọn giá trị.
  - Bấm X → xoá chọn, placeholder hiển thị, user gõ text và chọn lại được.
- **Kỳ vọng sai (Fail nếu):** một hoặc cả hai ô không xoá được.

---

### TC-CUS-CREATE-024 — Xoá chọn trong ô dropdown ở chế độ LCL

- **Vai trò:** `cus`
- **Mức độ:** P1
- **Các bước:**
  1. Chuyển sang chế độ **Hàng lẻ (LCL)**.
  2. Ở section "Điểm vận hành & tuyến": chọn Tuyến đường → bấm X → xoá → chọn lại.
  3. Kiểm tra các ô dropdown khác ở LCL có cùng hành vi X clear.
- **Kết quả mong đợi (Pass):**
  - Nút X hoạt động đúng trên các ô dropdown của LCL form.
- **Kỳ vọng sai (Fail nếu):** LCL không có nút X trên dropdown.

---

### TC-CUS-CREATE-025 — Nhấn Escape để revert giá trị dropdown container

- **Vai trò:** `cus`
- **Mức độ:** P1
- **Các bước:**
  1. Ở dòng container, focus ô Nhà máy (đã chọn giá trị A).
  2. Nhấn phím **Escape** thay vì bấm X.
  3. Kiểm tra giá trị hiển thị.
- **Kết quả mong đợi (Pass):**
  - Escape giữ nguyên giá trị A (revert), không thay đổi.
  - Phím Escape không crash hay hoạt động bất thường.

---

## Bảng nghiệm thu — Luồng Tạo lô hàng (CUS)

| Ngày thử | Mã TC | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|-----------|---------|---------|------------|
| __/__/__ | TC-CUS-CREATE-001 | | | FCL luồng thường | |
| __/__/__ | TC-CUS-CREATE-002 | | | Cont trống | |
| __/__/__ | TC-CUS-CREATE-003 | | | LCL luồng thường | |
| __/__/__ | TC-CUS-CREATE-004 | | | Validation | |
| __/__/__ | TC-CUS-CREATE-005 | | | Offline/idempotency | |
| __/__/__ | TC-CUS-CREATE-006 | | | Handoff | |
| __/__/__ | TC-CUS-CREATE-007 | | | Version conflict | |
| __/__/__ | TC-CUS-CREATE-008 | | | RBAC tạo lô | |
| __/__/__ | TC-CUS-CREATE-009 | | | Thấy toàn bộ lô | |
| __/__/__ | TC-CUS-CREATE-010 | | | Tạo liên tiếp | |
| __/__/__ | TC-CUS-CREATE-011 | | | Double-submit | |
| __/__/__ | TC-CUS-CREATE-012 | | | Tạo KH inline thành công | |
| __/__/__ | TC-CUS-CREATE-013 | | | CUS create-only (PUT/DELETE 403) | |
| __/__/__ | TC-CUS-CREATE-014 | | | Dispatcher tạo KH inline | |
| __/__/__ | TC-CUS-CREATE-015 | | | Vai trò khác bị chặn | |
| __/__/__ | TC-CUS-CREATE-016 | | | Dropdown nhà máy theo khách hàng | |
| __/__/__ | TC-CUS-CREATE-017 | | | Tạo nhà máy inline + tự chọn | |
| __/__/__ | TC-CUS-CREATE-018 | | | Form KH inline có địa chỉ | |
| __/__/__ | TC-CUS-CREATE-019 | | | Quy cách đóng gói free-text | |
| __/__/__ | TC-CUS-CREATE-020 | | | Tạo Loại container inline + tự chọn | |
| __/__/__ | TC-CUS-CREATE-019 | | | Tạo cảng/bãi inline từ ô container | |
| __/__/__ | TC-CUS-CREATE-021 | | | Xoá chọn Nhà máy container | |
| __/__/__ | TC-CUS-CREATE-022 | | | Xoá chọn Tuyến đường container | |
| __/__/__ | TC-CUS-CREATE-023 | | | Xoá chọn Cảng nâng/hạ container | |
| __/__/__ | TC-CUS-CREATE-024 | | | Xoá chọn dropdown LCL | |
| __/__/__ | TC-CUS-CREATE-025 | | | Escape revert dropdown container | |
