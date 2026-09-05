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
