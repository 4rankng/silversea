# Luồng 1: Tạo Lô hàng — Nhân viên Chứng từ (CUS)

> Typography update (2026-09-14): earlier numeric font-size expectations in this document are superseded by `testplan/qa/2026-09-14_typography-coherence.md`: 12px body/data/controls/actions, 11px labels/captions, 14px section titles, 16px overlay titles, 18px page titles and 20px principal metrics. Other behavior and layout requirements remain unchanged. Historical measurements below are retained as evidence.


> **Vai trò sở hữu:** CUS (CLERK) — Nhân viên Chứng từ / CSKH
> **Tài khoản test:** chọn theo môi trường qua [`../testaccounts.txt`](../testaccounts.txt) — runner tự map role `CUS` → username phù hợp (local: `CUS`; staging: prod-mirror như `thanhdc`).
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
- **Vai trò:** `CUS`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Có ít nhất 1 khách hàng active, 1 tuyến đường, 1 bảng giá cước còn hiệu lực
- **Các bước:**
  1. Đăng nhập `CUS`. Mở `/shipments/new`.
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
- **Vai trò:** `CUS`
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
- **Vai trò:** `CUS`
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

- **Vai trò:** `CUS`
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
- **Vai trò:** `CUS`
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
- **Vai trò:** `CUS` (bàn giao) + `DISPATCHER` (nhận)
- **Mức độ:** P0
- **Thiết bị:** Desktop (cần 2 phiên)
- **Tiền điều kiện:** Lô đã tạo xong, có B/L và ≥1 container
- **Các bước:**
  1. Đăng nhập `CUS`. Mở `/shipments/:id`. Bấm "Bàn giao cho Điều vận" (tạo handoff).
  2. Đăng nhập `DISPATCHER` ở tab khác. Kiểm tra thông báo / màn điều vận.
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
- **Vai trò:** `CUS` (sửa) + `DISPATCHER` (đang xem)
- **Mức độ:** P1
- **Các bước:**
  1. Lô đã bàn giao, Điều vận đã mở (handoff SEEN).
  2. `CUS` sửa B/L hoặc container trên lô → version tăng.
  3. Điều vận mở lại lô.
- **Kết quả mong đợi (Pass):**
  - Hệ thống cảnh báo Điều vận: "Lô đã có phiên bản mới" (version conflict).
  - Điều vận không thao tác tiếp trên dữ liệu cũ mà không được cảnh báo.
- **Bằng chứng:** ảnh cảnh báo conflict + DB version > handoffVersion

---

## 1.5 — Phân quyền tạo lô

### TC-CUS-CREATE-008 — Vai trò được phép và bị chặn tạo lô

- **Mã PRD:** Q17, TC-M10-01-04
- **Vai trò được phép:** `ADMIN`, `CUS`, `MANAGER`
- **Vai trò bị chặn:** `ACCOUNTANT`, `DISPATCHER`, `DRIVER`, `OPS`, `CUSTOMER`
- **Mức độ:** P0
- **Thiết bị:** Desktop
- **Các bước:**
  1. Lần lượt đăng nhập `ADMIN`, `CUS`, `MANAGER`; mở `/shipments/new` → phải mở được.
  2. Lần lượt đăng nhập `ACCOUNTANT`, `DISPATCHER`, `DRIVER`, `OPS`, `CUSTOMER`; mở `/shipments/new`.
- **Kết quả mong đợi (Pass):**
  - ADMIN, CUS, MANAGER thấy CTA "Tạo lô mới" và mở được form.
  - Các vai trò còn lại: redirect về màn nhà hoặc "Không có quyền".
  - API cũng trả 403 cho vai trò không có quyền.
- **Bằng chứng:** ảnh redirect / "Không có quyền" + Network tab 403

---

### TC-CUS-CREATE-009 — CUS thấy toàn bộ lô hàng (không giới hạn phạm vi)

- **Mã PRD:** Q17
- **Vai trò:** `CUS`
- **Mức độ:** P1
- **Các bước:**
  1. Đăng nhập `CUS`. Mở `/shipments`.
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
- **Vai trò:** `CUS`
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
- **Vai trò:** `CUS`
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
- **Vai trò:** `CUS`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Đăng nhập `CUS`, mở `/shipments/new`
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
- **Vai trò:** `CUS`
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
- **Vai trò:** `DISPATCHER`
- **Mức độ:** P1
- **Thiết bị:** Desktop
- **Tiền điều kiện:** Đăng nhập `DISPATCHER`, mở trang có dropdown khách hàng
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
- **Vai trò bị chặn:** `DRIVER`, `ACCOUNTANT`, `OPS`, `CUSTOMER`
- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `DRIVER`. Gọi `POST /api/customers` qua API.
  2. Đăng nhập `ACCOUNTANT`. Gọi `POST /api/customers`.
  3. Đăng nhập `OPS`. Gọi `POST /api/customers`.
  4. Đăng nhập `CUSTOMER`. Gọi `POST /api/customers`.
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

- **Vai trò:** `CUS`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Đăng nhập `CUS`, mở `/shipments/new`; khách hàng được chọn có ≥1 nhà máy active
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

- **Vai trò:** `CUS`
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

- **Vai trò:** `CUS`
- **Mức độ:** P0
- **Nguồn:** báo cáo khách hàng 2026-09-06 14:02 — "Trường nào cho phép input text được CTO nhớ cho phép nhập text nhé, vẫn còn nhiều chỗ chỉ cho chọn dropdown"
- **Các bước:**
  1. Đăng nhập `CUS`, mở `/shipments/new`, chọn khách hàng (FCL).
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

- **Vai trò:** `CUS`
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

- **Vai trò:** `CUS`
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

- **Vai trò:** `CUS`
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

- **Vai trò:** `CUS`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Đăng nhập `CUS`, mở `/shipments/new`; khách hàng có ≥2 nhà máy active
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

- **Vai trò:** `CUS`
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

- **Vai trò:** `CUS`
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

- **Vai trò:** `CUS`
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

- **Vai trò:** `CUS`
- **Mức độ:** P1
- **Các bước:**
  1. Ở dòng container, focus ô Nhà máy (đã chọn giá trị A).
  2. Nhấn phím **Escape** thay vì bấm X.
  3. Kiểm tra giá trị hiển thị.
- **Kết quả mong đợi (Pass):**
  - Escape giữ nguyên giá trị A (revert), không thay đổi.
  - Phím Escape không crash hay hoạt động bất thường.

---

---

## 1.10 — Nhà máy ở trang chi tiết hiển thị khi đã gán cho container (báo cáo khách hàng 2026-09-07)

> **Nguồn:** Khách hàng báo cáo 2026-09-07 — "ở giao diện cus: hiện đã nhập có nhà máy đóng trả hàng rồi mà
> ở phần chi tiết lô hàng đang thể hiện chưa có nhà máy". Tái hiện trên staging sau `make stgdb` 2026-09-07:
> lô id=2 (Long Minh, EGLV149607019409) có `shipment_containers.operational_site_id = 6` (ASKEY-2) trong DB
> nhưng trang chi tiết `/shipments/:id` hiển thị "Nhà máy / công trường: —".
> Nguyên nhân: trang chi tiết dùng `getShipmentDetail` (shared) → trả `shipment.factoryName` legacy (rỗng)
> mà không tra `shipment.operationalSiteId` / `shipment_containers.operationalSiteId` qua catalog
> `operational_sites` để ra `effectiveFactoryName`. Các case dưới pin hành vi đã sửa.

### TC-CUS-CREATE-023 — Nhà máy gán ở container hiển thị trên trang chi tiết `/shipments/:id`

- **Mã PRD:** Q17, factory-display-pin (báo cáo 2026-09-07)
- **Vai trò:** `CUS` (longminh-side account, vd `thanhdc`)
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Lô có `shipment_containers.operational_site_id` được set nhưng
  `shipments.factory_name` rỗng và `shipments.operational_site_id` rỗng
  (vd lô id=2 của Long Minh sau `make stgdb`).
- **Các bước:**
  1. Đăng nhập CUS (vd `thanhdc`), mở thẳng `/shipments/2` (Long Minh, EGLV149607019409).
  2. Quan sát ô "Nhà máy / công trường" trong thẻ thông tin chung.
- **Kết quả mong đợi (Pass):**
  - Ô hiển thị **"ASKEY-2"** (short name tra từ `operational_sites` qua `shipment_containers.operational_site_id = 6`).
  - Không hiển thị "—" / "Chưa có nhà máy" khi container đã có `operationalSiteId` set.
- **Kỳ vọng sai (Fail nếu):**
  - Hiển thị "—" (hồi quy bug 2026-09-07).
  - Hiển thị `shipment.factoryName` rỗng thay vì đã resolve.
- **Bằng chứng:** ảnh trang chi tiết + DB `shipment_containers.operational_site_id=6` → `operational_sites.shortName='ASKEY-2'`.

### TC-CUS-CREATE-024 — Nhà máy ở shipment-level vẫn ưu tiên khi cả hai đều set

- **Vai trò:** `CUS`
- **Mức độ:** P1
- **Tiền điều kiện:** Lô có cả `shipments.factory_name` (free-text) **và** `shipments.operational_site_id` đều set.
- **Các bước:**
  1. Tạo/sửa lô: `factoryName = 'Xưởng cũ'`, chọn nhà máy catalog ASKEY-1 cho shipment-level.
  2. Mở `/shipments/:id`.
- **Kết quả mong đợi (Pass):**
  - Ô hiển thị theo thứ tự ưu tiên: `factoryName` free-text > `operationalSiteId` catalog > `container.operationalSiteId` catalog.
  - Cụ thể: 'Xưởng cũ' nếu `factoryName` set, ngược lại short name từ `operationalSiteId`, ngược lại short name từ container.
- **Kỳ vọng sai (Fail nếu):** ưu tiên ngược (catalog đè free-text); fallback nhảy qua `factoryName`.
- **Bằng chứng:** ảnh trang chi tiết + DB `shipments.factory_name='Xưởng cũ'`, `shipments.operational_site_id` set.

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
| __/__/__ | TC-CUS-CREATE-023 | | | Nhà máy gán ở container hiển thị trên /shipments/:id (regression bug 2026-09-07) | |
| __/__/__ | TC-CUS-CREATE-024 | | | Ưu tiên factoryName free-text > operationalSiteId > container.operationalSiteId | |
| __/__/__ | TC-CUS-CREATE-021 | | | Xoá chọn Nhà máy container | |
| __/__/__ | TC-CUS-CREATE-022 | | | Xoá chọn Tuyến đường container | |
| __/__/__ | TC-CUS-CREATE-023 | | | Xoá chọn Cảng nâng/hạ container | |
| __/__/__ | TC-CUS-CREATE-024 | | | Xoá chọn dropdown LCL | |
| __/__/__ | TC-CUS-CREATE-025 | | | Escape revert dropdown container | |
| __/__/__ | TC-CUS-CREATE-026 | | | Chặn tạo lô trùng BL/Tờ khai (regression bug 2026-09-07) | |
| __/__/__ | TC-CUS-CREATE-027 | | | Cảnh báo inline khi gõ BL/Tờ khai đã tồn tại (regression bug 2026-09-07) | |
| __/__/__ | TC-CUS-CREATE-028 | | | Màn Tổng quan không báo "Chưa chốt ngày" khi FCL đã có lịch container | |
| __/__/__ | TC-CUS-CREATE-029 | | | Hiển thị nút "Xác nhận" bên cạnh ô ngày giờ giao container | |
| __/__/__ | TC-CUS-CREATE-030 | | | Lưu thành công lịch giao khi click nút "Xác nhận" | |
| __/__/__ | TC-CUS-CREATE-031 | | | Tương thích ngược — Enter vẫn lưu lịch giao | |
| __/__/__ | TC-CUS-CREATE-032 | | | Validate để trống ngày hoặc giờ khi nhấn Xác nhận | |
| __/__/__ | TC-CUS-CREATE-033 | | | Double-click nút "Xác nhận" không duplicate request | |
| __/__/__ | TC-CUS-CREATE-034 | | | Đồng bộ 2 chiều ngày giao giữa Tổng quan và Chi tiết | |
| __/__/__ | TC-CUS-CREATE-035 | | | Không bị khóa cập nhật ngày giao khi có nhiều lô (tránh xung đột B/L) | |
| __/__/__ | TC-CUS-CREATE-036 | | | Lô nhiều cont partial delivery dates (chưa chốt hết) | |
| __/__/__ | TC-CUS-CREATE-037 | | | Dropdown Hãng tàu: mở đúng danh sách, không treo, lọc + backspace OK (bug 2026-09-08) | |
| __/__/__ | TC-CUS-CREATE-038 | | | Dropdown Cảng nâng / Tuyến đường che nút +Thêm khi trigger ở giữa/cuối màn hình → phải flip lên trên hoặc +Thêm vẫn click được (regression bug 2026-09-08) | |
| __/__/__ | TC-CUS-CREATE-039 | | | Sửa Ngày/Giờ đóng hàng của container — không còn `Invalid datetime (customerAppointmentAt)` (regression bug 2026-09-08) | |
| __/__/__ | TC-CUS-CREATE-040 | | | Không lộ thông báo lỗi nội bộ (tiếng Anh + tên field) ra giao diện khách hàng (regression bug 2026-09-08) | |

---

## 1.11 — Trùng Số Bill / Số tờ khai khi tạo lô (báo cáo khách hàng 2026-09-07)

> **Nguồn:** Khách hàng (CUS) báo cáo 2026-09-07 — "lập trình giúp em là báo trùng với ạ, khi 1 lô hàng
> đã nhập trước đó có số bil hoặc số tờ khai. mà sau lại nhập trùng cùng 1 số bil hoặc số tờ khai đó
> hệ thống sẽ cảnh báo lô hàng đó đã được nhập bởi tài khoản nào và k được nhập lô đó nữa".
>
> **Root cause đã xác minh:** `shipments.bl_number` và `shipment_declarations.declaration_number` là
> `varchar` thường, không có unique constraint ở DB
> (`backend/src/db/schema/shipments.ts:25,110`). Service `createShipment()`
> (`backend/src/services/shipment-create.service.ts:132-135`) chèn thẳng, không pre-check
> duplicate. `assertShipmentDocumentReferences()` chỉ validate hướng Bill/Booking (NHẬP vs XUẤT),
> không check "đã tồn tại ở lô khác chưa".
>
> **Hệ quả:** Cùng 1 BL `JJCTCHPDY260305` được CUS tạo 2 lần → 2 lô tách biệt cùng BL/Tờ khai,
> dẫn đến 2 màn Tổng quan / Chi tiết lô hiển thị khác nhau (1 lô "Chưa chốt ngày", 1 lô đã có lịch),
> thao tác chỉnh ngày trên lô "Chưa chốt" bị vô hiệu vì lô kia đã chốt.

### TC-CUS-CREATE-026 — Chặn tạo lô trùng Số Bill / Số Booking / Số tờ khai (regression bug 2026-09-07)

- **Mã PRD:** duplicate-bill-guard (báo cáo 2026-09-07)
- **Vai trò:** `CUS`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Lô đã tồn tại với BL `BL-DUP-001` (Hàng Nhập), Tờ khai `TK-DUP-001`, do tài
  khoản `CUS` khác (hoặc cùng `CUS`) tạo trước đó. Lô cũ chưa xóa.
- **Các bước:**
  1. Đăng nhập `CUS`, mở `/shipments/new`.
  2. Chọn khách hàng (vd LONG MINH), hình thức **Nhập khẩu**, nhập `Số Bill = BL-DUP-001`.
  3. Hoàn tất các trường còn lại, bấm **Tạo lô hàng**.
  4. Đợi response từ backend, quan sát thông báo lỗi.
  5. Lặp lại với `Số Booking = BK-DUP-001` ở lô **Xuất khẩu** mới.
  6. Lặp lại với `Số tờ khai = TK-DUP-001` trên một lô Hàng Nhập khác.
- **Kết quả mong đợi (Pass):**
  - Lần 1 (trùng BL): API trả `409 Conflict` với body kiểu
    `{ error: "Số Bill đã được nhập bởi tài khoản <username>. Vui lòng kiểm tra lại.", code: "BILL_DUPLICATE", conflict: { shipmentId, shipmentCode, createdBy: { id, username, fullName }, createdAt } }`.
  - Frontend (modal hoặc toast) hiển thị tiếng Việt: *"Số Bill BL-DUP-001 đã được nhập bởi tài khoản
    <username> lúc <dd/MM/yyyy HH:mm>. Không thể tạo lô trùng."*, kèm link "Xem lô đã nhập" mở
    `/shipments/:id` của lô trùng.
  - Lần 2 (trùng Booking): cùng hành vi với message thay "Số Booking".
  - Lần 3 (trùng Tờ khai): cùng hành vi với message "Số tờ khai", và lỗi ở endpoint
    `POST /api/shipments/:id/declarations` (vì tờ khai lưu ở `shipment_declarations`, không phải
    root shipment row).
  - Không có row mới trong DB (đếm số shipment có `BL-DUP-001` trước/sau = nhau).
- **Kỳ vọng sai (Fail nếu):**
  - Tạo lô thành công, có 2 shipment cùng BL.
  - Lỗi 500 thay vì 409 (chưa handle duplicate).
  - Không hiển thị "đã nhập bởi tài khoản X" — chỉ báo chung "đã tồn tại".
  - Vẫn cho phép cập nhật BL/Booking của cùng 1 shipment về giá trị trùng chính nó (update chính
    shipment từ `BL-DUP-001` sang `BL-DUP-001` không được block — phải exclude chính nó).
- **Bằng chứng:** ảnh toast + DB count trước/sau = nhau + Network (409 + body có `conflict.createdBy.username`).

---

### TC-CUS-CREATE-027 — Cảnh báo inline trong form khi gõ Số Bill / Số Booking / Tờ khai đã tồn tại

- **Vai trò:** `CUS`
- **Mức độ:** P0
- **Tiền điều kiện:** giống TC-CUS-CREATE-026
- **Các bước:**
  1. Mở `/shipments/new`, chọn khách hàng, chọn **Nhập khẩu**.
  2. Gõ vào ô **Số Bill**: `BL-DUP-001` (đã có lô khác).
  3. Đợi 300–500ms (debounce), quan sát thông báo dưới ô input.
  4. Nhập xong form, thử bấm "Tạo lô hàng".
- **Kết quả mong đợi (Pass):**
  - Dưới ô Số Bill hiển thị cảnh báo tiếng Việt (màu warning):
    *"Số Bill này đã được nhập bởi <username> lúc <dd/MM HH:mm>. Vui lòng kiểm tra trước khi tạo."*
    kèm link "Xem lô đã nhập".
  - Nút "Tạo lô hàng" vẫn cho phép bấm (chưa hard-disable) nhưng khi submit sẽ nhận 409 và toast
    lỗi như TC-CUS-CREATE-026 (defense in depth: server là nguồn quyết định cuối cùng).
  - Cảnh báo clear khi đổi sang giá trị Số Bill khác (không tồn tại).
  - Cùng hành vi cho Số Booking (Xuất khẩu) và Số tờ khai (LCL/Nhập — xem modal tờ khai nếu có).
  - Trước khi chọn hình thức nhập/xuất hoặc khi BL rỗng → không hiện cảnh báo.
- **Kỳ vọng sai (Fail nếu):** không có cảnh báo inline; cảnh báo nhưng không hiện tên user; debounce
  không hoạt động (gõ mỗi ký tự 1 request).
- **Bằng chứng:** ảnh cảnh báo inline + Network (1 request GET kiểm tra duplicate sau khi gõ xong) +
  ảnh link "Xem lô đã nhập" mở được `/shipments/:id` đúng.

---

### TC-CUS-CREATE-028 — Màn Tổng quan không báo "Chưa chốt ngày" khi FCL đã có lịch container

- **Vai trò:** `CUS`
- **Mức độ:** P1
- **Nguồn:** báo cáo 2026-09-07 — màn Tổng quan lô hàng báo "Chưa chốt ngày" cho BL
  `JJCTCHPDY260305` dù trang Chi tiết lô đã hiển thị ngày `07/09/2026 08:00`.
- **Root cause:** `cus-workspace-builders.service.ts:82-86` chỉ kiểm tra
  `shipment.expectedDeliveryDate` cho `scheduleReadiness`, không tính
  `shipment_containers.customerAppointmentAt` (nguồn ngày thật của FCL).
- **Các bước:**
  1. Tạo lô FCL với 1 container, `customerAppointmentAt` = hôm nay 09:00, **không** set
     `expectedDeliveryDate` ở shipment-level.
  2. Mở `/shipments` (màn Tổng quan lô hàng của CUS).
  3. Tìm lô vừa tạo trong danh sách, quan sát cột **Lịch trình & điều xe** và badge trạng thái.
- **Kết quả mong đợi (Pass):**
  - Cột "Lịch trình & điều xe" hiển thị ngày `07/09/2026 09:00 · ...` (lấy từ container), **không**
    hiển thị "Chưa chốt ngày".
  - `scheduleReadiness` = `SCHEDULED` (không phải `WAITING_DATE`).
  - Badge "Chờ chốt lịch" không hiển thị trong cột Trạng thái.
- **Kỳ vọng sai (Fail nếu):** vẫn hiển thị "Chưa chốt ngày" dù container đã có
  `customerAppointmentAt`.
- **Bằng chứng:** ảnh cột Lịch trình hiển thị ngày + DB `shipment_containers.customer_appointment_at`
  khác null.

---

## Ghi chú hồi quy (bổ sung bug 2026-09-07)

- **Nguyên nhân gốc:** cho phép tạo trùng BL/Booking/Tờ khai không giới hạn. Khi CUS vô tình nhập
  trùng, hệ thống không phát hiện → phát sinh 2 lô tách biệt cùng nhận diện chứng từ. Mọi nghiệp
  vụ downstream (chốt lịch, điều xe, chốt tài chính) chỉ apply được trên một trong hai lô, lô còn
  lại "đứng hình" gây bối rối cho người dùng.
- **Cách sửa:** thêm duplicate guard ở cả backend (pre-check trước INSERT) và frontend (cảnh báo
  inline khi gõ). Trên form chỉnh sửa, exclude chính shipment hiện tại để không tự khóa.

---

## 1.12 — Nút "Xác nhận" bổ sung lịch giao hàng (Ngày & Giờ) trên thuộc tính container (báo cáo khách hàng 2026-09-07)

> **Nguồn:** Khách hàng yêu cầu 2026-09-07 — "hiện tại chỉ ấn được Enter, cần thêm nút Xác nhận
> khi điền ngày giờ giao". Khách hàng muốn có thêm nút bấm rõ ràng bên cạnh ô chọn ngày giờ,
> giúp thao tác lưu lịch giao trực quan và dễ nhận biết hơn.

### TC-CUS-CREATE-029 — Hiển thị nút "Xác nhận" bên cạnh ô chọn Ngày Giờ giao container

- **Vai trò:** `CUS`
- **Mức độ:** P1
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Container chưa có ngày giao hàng.
- **Các bước:**
  1. Mở màn hình Chi tiết thuộc tính của container chưa có lịch giao.
  2. Nhấp vào trường chọn "Lịch giao" / "Giờ đóng/hạ".
  3. Quan sát giao diện ô nhập liệu / datepicker popup.
- **Kết quả mong đợi (Pass):**
  - Hiển thị rõ ràng nút "Xác nhận" (hoặc biểu tượng Lưu / Checkmark V) ngay cạnh hoặc bên dưới trường nhập ngày giờ.
  - Nút có trạng thái hover, focus và nhãn rõ ràng ("Xác nhận" / "Lưu lịch giao").
- **Kỳ vọng sai (Fail nếu):** không có nút Xác nhận; chỉ lưu được bằng phím Enter.
- **Bằng chứng:** ảnh ô nhập ngày giờ + ảnh nút "Xác nhận" visible

---

### TC-CUS-CREATE-030 — Lưu thành công lịch giao khi click nút "Xác nhận" (không dùng Enter)

- **Vai trò:** `CUS`
- **Mức độ:** P1
- **Dữ liệu kiểm thử:** Ngày giao = "07/09/2026", Giờ giao = "11:00"
- **Các bước:**
  1. Chọn ngày "07/09/2026" từ datepicker.
  2. Chọn/nhập giờ "11:00".
  3. Dùng chuột nhấp trực tiếp vào nút "Xác nhận" (KHÔNG nhấn phím Enter).
- **Kết quả mong đợi (Pass):**
  - Hệ thống gửi request lưu lịch giao thành công.
  - Hiển thị toast thông báo: "Cập nhật lịch giao hàng thành công!".
  - Giá trị "11:00 07/09/2026" được hiển thị chính thức trên thuộc tính cont, ô nhập đóng lại hoặc chuyển sang trạng thái hiển thị tĩnh.
- **Kỳ vọng sai (Fail nếu):** nút Xác nhận không gửi request; dữ liệu không được lưu; toast không hiển thị.
- **Bằng chứng:** ảnh toast thành công + ảnh giá trị đã lưu + Network tab (PUT/PATCH → 200)

---

### TC-CUS-CREATE-031 — Tương thích ngược: vẫn hỗ trợ nhấn phím Enter để lưu lịch giao

- **Vai trò:** `CUS`
- **Mức độ:** P2
- **Dữ liệu kiểm thử:** Ngày = "08/09/2026", Giờ = "14:30"
- **Các bước:**
  1. Nhập ngày và giờ vào ô input.
  2. Nhấn phím Enter trên bàn phím (không click chuột vào nút Xác nhận).
- **Kết quả mong đợi (Pass):**
  - Dữ liệu vẫn được lưu bình thường như thao tác nhấn nút Xác nhận.
  - Đảm bảo trải nghiệm thuận tiện cho người dùng thao tác nhanh bằng bàn phím.
- **Kỳ vọng sai (Fail nếu):** Enter không lưu được; phải click nút mới lưu được.

---

### TC-CUS-CREATE-032 — Validate khi nhấn nút "Xác nhận" nhưng để trống ngày hoặc giờ

- **Vai trò:** `CUS`
- **Mức độ:** P2
- **Các bước:**
  1. Chỉ chọn Ngày "07/09/2026", để trống phần Giờ (hoặc ngược lại).
  2. Nhấn nút "Xác nhận".
- **Kết quả mong đợi (Pass):**
  - Hệ thống cảnh báo: "Vui lòng nhập đầy đủ cả Ngày và Giờ giao hàng!".
  - Không gửi dữ liệu rác/lỗi lên server.
- **Bằng chứng:** ảnh cảnh báo validate + Network tab (không có request)

---

### TC-CUS-CREATE-033 — Double-click nút "Xác nhận" không tạo duplicate request

- **Vai trò:** `CUS`
- **Mức độ:** P2
- **Các bước:**
  1. Điền ngày và giờ giao.
  2. Nhấp liên tiếp 2-3 lần rất nhanh vào nút "Xác nhận".
- **Kết quả mong đợi (Pass):**
  - Nút "Xác nhận" tự động disable sau cú nhấp đầu tiên (hoặc hiển thị loading spinner).
  - Chỉ có duy nhất 1 request API gửi lên server, không gây duplicate request hoặc treo trình duyệt.
- **Bằng chứng:** Network tab (đếm request = 1) + ảnh nút disabled/spinner

---

## 1.13 — Đồng bộ dữ liệu ngày giao giữa Tổng quan và Chi tiết lô hàng (báo cáo khách hàng 2026-09-07)

> **Nguồn:** Khách hàng phản ánh 2026-09-07 — "bổ sung ngày giao bên Tổng quan không được nhưng
> Chi tiết lại hiện đã có ngày". Kỹ thuật (Trung Kiên) xác nhận nguyên nhân do có 2 lô trùng B/L
> làm khóa, thao tác trên lô này bị ảnh hưởng bởi lô kia. Các case dưới pin hành vi đồng bộ
> 2 chiều sau khi duplicate B/L đã được chặn (§1.11).

### TC-CUS-CREATE-034 — Đồng bộ 2 chiều về Ngày giao giữa Tổng quan và Chi tiết

- **Vai trò:** `CUS`
- **Mức độ:** P1
- **Tiền điều kiện:** Lô hàng có 2 container, cả 2 chưa chốt ngày giao.
- **Các bước:**
  1. Tại màn hình "Tổng quan lô hàng" (`/shipments`), bổ sung ngày giao cho lô (ví dụ: ngày 07/09/2026).
  2. Bấm Lưu.
  3. Mở màn hình "Chi tiết lô hàng" (`/shipments/:id`) kiểm tra lịch trình của các container thuộc lô này.
  4. Ngược lại: Sửa lịch trình container tại "Chi tiết lô hàng", sau đó quay lại "Tổng quan lô hàng".
- **Kết quả mong đợi (Pass):**
  - Khi cập nhật ở Tổng quan, Chi tiết phản ánh ngay ngày giao tương ứng cho container.
  - Khi cập nhật ở Chi tiết, Tổng quan cập nhật đúng trạng thái (không còn "Chưa chốt ngày" nếu tất cả cont đã có ngày).
  - Không xuất hiện vênh dữ liệu (Tổng quan báo "Chưa có ngày" nhưng Chi tiết báo "Đã có ngày").
- **Kỳ vọng sai (Fail nếu):** 2 màn hình hiển thị khác nhau cho cùng lô; cập nhật bên này không sang bên kia.
- **Bằng chứng:** ảnh Tổng quan sau khi cập nhật + ảnh Chi tiết khớp + ảnh Chi tiết sau khi sửa + ảnh Tổng quan cập nhật lại

---

### TC-CUS-CREATE-035 — Không bị khóa/chặn thao tác cập nhật ngày giao khi có nhiều lô (tránh xung đột theo B/L)

- **Vai trò:** `CUS`
- **Mức độ:** P1
- **Nguồn:** kỹ thuật xác nhận 2026-09-07 — khi có 2 lô trùng B/L (trước khi duplicate guard), thao tác
  trên lô này bị vô hiệu vì lô kia đã chốt. Sau fix duplicate guard, case này kiểm tra tính độc lập.
- **Tiền điều kiện:**
  - Có 2 lô hàng riêng biệt (Lô A và Lô B), khác `shipment_id`.
  - Lô A đã được chốt ngày giao hàng.
  - Lô B hiện đang ở trạng thái "Chưa chốt ngày".
- **Các bước:**
  1. Vào màn hình Tổng quan lô hàng, chọn Lô B.
  2. Thao tác bổ sung "Ngày giao" (Từ ngày giao / Đến ngày giao).
  3. Nhấn Lưu cập nhật.
- **Kết quả mong đợi (Pass):**
  - Lô B lưu ngày giao thành công, không bị báo lỗi hoặc bị disable do ảnh hưởng từ Lô A.
  - Truy vấn độc lập theo `shipment_id` duy nhất, không query nhầm theo mã chứng từ dùng chung.
- **Kỳ vọng sai (Fail nếu):** Lô B bị disable/ẩn do nhầm lẫn ID với Lô A; lưu không được mà không có lý do.
- **Bằng chứng:** ảnh Lô B lưu thành công + DB `shipments` 2 rows riêng biệt

---

### TC-CUS-CREATE-036 — Lô nhiều cont nhưng chỉ mới chốt ngày cho 1 số cont (Partial delivery dates)

- **Vai trò:** `CUS`
- **Mức độ:** P2
- **Tiền điều kiện:** Lô hàng có 3 container (Cont 1 đã chốt ngày 07/09; Cont 2 & 3 chưa có ngày).
- **Các bước:**
  1. Quan sát trạng thái lô hàng tại màn hình "Tổng quan lô hàng".
  2. Bổ sung ngày giao cho Cont 2.
  3. Quan sát lại trạng thái lô.
- **Kết quả mong đợi (Pass):**
  - Trạng thái lô hiển thị rõ ràng: "Đã chốt 2/3 cont" hoặc vẫn giữ cảnh báo cho các cont còn lại.
  - Không bị xung đột giữa cont đã chốt và cont chưa chốt.
  - Badge "Chưa chốt ngày" chỉ tắt khi TẤT CẢ cont đã có ngày.
- **Kỳ vọng sai (Fail nếu):** badge tắt khi chỉ 1/3 cont có ngày; hệ thống không phân biệt partial.
- **Bằng chứng:** ảnh trạng thái sau khi chốt 2/3 + ảnh badge "Chưa chốt" vẫn hiển thị

---

## 1.14 — Sửa lịch trình container trên "Danh sách container" (báo cáo khách hàng 2026-09-08)

> **Nguồn:** Khách hàng báo cáo 2026-09-08 — "Tôi thử sửa ngày giao của 1 cont chưa phân xe thì không
> sửa được", kèm ảnh dialog "Chỉnh sửa lịch trình · Container số 2" hiện dòng đỏ
> `Invalid datetime (customerAppointmentAt)`.
>
> **Nguyên nhân gốc:** editor gửi ISO có offset Việt Nam (`localDateTimeToIso` →
> `2026-09-08T08:00:00+07:00`), nhưng `shipmentCusContainerLineUpdateSchema.customerAppointmentAt`
> dùng `z.string().datetime()` — biến thể này CHỈ nhận hậu tố `Z` nên mọi lần lưu đều 400. Cùng
> trường này ở `shared/src/schemas/index.ts` đã dùng `datetime({ offset: true })`, nên đường ghi
> CUS container-line là ngoại lệ duy nhất. Việc "chưa phân xe" chỉ là trùng hợp, không phải điều kiện lỗi.
>
> **Lỗi thứ hai (cùng ảnh):** thông báo lỗi nội bộ tiếng Anh + tên field kỹ thuật bị hiển thị nguyên
> văn cho người dùng cuối.

### TC-CUS-CREATE-039 — Sửa Ngày/Giờ đóng hàng của container (regression bug 2026-09-08)

- **Mã bug:** BUG-2026-09-08-APPT-OFFSET
- **Vai trò:** `CUS`, `ADMIN`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:**
  1. Đăng nhập `CUS`, mở `/shipments-detail` (Danh sách container).
  2. Có ít nhất 1 container **chưa gán biển số** (cột điều xe hiển thị "Chưa gán biển số") và đã có
     sẵn ngày đóng hàng (ví dụ 07/09/2026 08:00).
- **Các bước:**
  1. Click ô "Lịch trình & điều xe" của container đó → dialog "Chỉnh sửa lịch trình · Container số N" mở ra.
  2. Đổi "Ngày đóng hàng" từ `07/09/2026` sang `08/09/2026`, giữ "Giờ đóng hàng" `08:00 AM`.
  3. Bấm **Lưu** (và lặp lại 1 lần bằng phím Enter để phủ cả 2 đường lưu).
  4. Quan sát dialog + giá trị trong bảng sau khi lưu.
  5. Lặp lại với 1 container **đã gán biển số** (nếu lô còn ở trạng thái cho sửa) để xác nhận không
     có khác biệt theo trạng thái phân xe.
- **Kết quả mong đợi (Pass):**
  - Dialog đóng, không có dòng lỗi đỏ nào.
  - Ô "Lịch trình & điều xe" hiển thị `08/09/2026 · 08:00 · đóng hàng`.
  - Reload trang → giá trị vẫn là 08/09/2026 08:00 (đã lưu DB, không chỉ optimistic UI).
  - `shipment_containers.customer_appointment_at` của container đó = `2026-09-08 01:00:00+00`
    (08:00 giờ Việt Nam).
  - Kết quả giống nhau cho container đã và chưa gán biển số.
- **Kỳ vọng sai (Fail nếu):**
  - Xuất hiện `Invalid datetime (customerAppointmentAt)` hoặc bất kỳ lỗi 400 nào.
  - Lưu được trên UI nhưng reload lại về ngày cũ.
  - Chỉ container đã phân xe sửa được.
- **Bằng chứng:** `qa/<YYYY-MM-DD>_container-schedule-edit_ui-before.png` (dialog trước khi lưu) +
  `qa/<YYYY-MM-DD>_container-schedule-edit_ui-after.png` (sau khi lưu, không có lỗi) +
  `qa/<YYYY-MM-DD>_container-schedule-edit_ui-driver.log` + output SQL của
  `customer_appointment_at` sau khi lưu.
- **Regression ID:** REG-APPT-OFFSET-20260908

---

### TC-CUS-CREATE-040 — Không lộ thông báo lỗi nội bộ ra giao diện khách hàng (regression bug 2026-09-08)

- **Mã bug:** BUG-2026-09-08-INTERNAL-ERROR-LEAK
- **Vai trò:** `CUS`
- **Mức độ:** P1
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Đang ở dialog "Chỉnh sửa lịch trình" của một container.
- **Các bước:**
  1. Trong dialog, xoá trắng "Giờ đóng hàng" nhưng vẫn giữ "Ngày đóng hàng" → bấm Lưu.
  2. Ghi lại nguyên văn thông báo lỗi hiển thị.
  3. (Nếu dựng được) buộc backend trả 400 cho `customerAppointmentAt` (ví dụ gửi
     `08/09/2026 08:00` qua devtools) và ghi lại thông báo hiển thị.
- **Kết quả mong đợi (Pass):**
  - Mọi thông báo lỗi hiển thị cho người dùng đều là **tiếng Việt**, mô tả được việc cần làm
    (ví dụ "Vui lòng nhập đầy đủ cả Ngày và Giờ giao hàng.", "Ngày giờ đóng/trả hàng không hợp lệ.").
  - Không hiển thị: chuỗi tiếng Anh của thư viện validate (`Invalid datetime`, `Expected string`),
    tên field kỹ thuật (`customerAppointmentAt`), tên bảng/cột DB, stack trace, mã lỗi nội bộ.
- **Kỳ vọng sai (Fail nếu):** thông báo chứa tên field kỹ thuật hoặc chuỗi lỗi tiếng Anh của Zod.
- **Bằng chứng:** `qa/<YYYY-MM-DD>_error-message-vi_ui.png` + nguyên văn thông báo đã trích dẫn.
- **Regression ID:** REG-ERRMSG-VI-20260908

---

## Ghi chú hồi quy (bổ sung bug 2026-09-07 —_FACTORY_NAME_DISPLAY)

### TC-REGRESSION-FNAME-001 — Chi tiết lô hàng hiển thị tên nhà máy (effectiveFactoryNames)

- **Mã bug:** BUG-2026-09-07-FNAME
- **Vai trò:** `ADMIN`, `CUS`, `MANAGER`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:**
  1. Có lô hàng đã tạo với ít nhất 1 container có nhà máy được gán.
  2. Trang "Tổng quan lô hàng" (`/shipments`) hiển thị đúng tên nhà máy (ví dụ: ASKEY-1, ASKEY-2).
- **Các bước:**
  1. Đăng nhập `ADMIN`.
  2. Mở trang "Tổng quan lô hàng" (`/shipments`).
  3. Tìm lô hàng có nhà máy (ví dụ: khách hàng Long Minh).
  4. Xác nhận cột "Khách hàng & nhà máy" hiển thị tên nhà máy (ví dụ: ASKEY-1, SUNRISE).
  5. Click vào lô hàng để mở trang "Chi tiết lô hàng" (`/shipments/:id`).
  6. Kiểm tra cột "Khách hàng & lộ trình" trong bảng container.
- **Kết quả mong đợi (Pass):**
  - Trang Chi tiết lô hàng hiển thị tên nhà máy giống như Tổng quan lô hàng.
  - Nếu lô có nhiều nhà máy, hiển thị dưới dạng "ASKEY-1 + ASKEY-2".
  - Nếu chưa có nhà máy, hiển thị "Chưa có nhà máy".
- **Kỳ vọng sai (Fail nếu):**
  - Chi tiết lô hàng hiển thị "Chưa có nhà máy" trong khi Tổng quan lô hàng hiển thị đúng tên.
  - Tên nhà máy bị thiếu hoặc sai so với dữ liệu thực tế.
- **Bằng chứng:** ảnhcreenshot Tổng quan lô hàng + ảnh Chi tiết lô hàng so sánh cùng tên nhà máy
- **Regression ID:** REG-FNAME-20260907

---

## 1.15 — Binding dữ liệu Dropdown "Hãng tàu" tại Form tạo mới lô hàng (QA Matrix v2.0)

### TC_LINE_01 — Binding danh sách 20 hãng tàu chuẩn quốc tế và đối tác nhà cung cấp
- **Vai trò:** `CUS`, `ADMIN`
- **Mức độ:** P1
- **Tiền điều kiện:** Đăng nhập hệ thống, mở form tạo lô mới `/shipments/new`.
- **Các bước:**
  1. Click vào ô input "Hãng tàu".
  2. Quan sát danh sách gợi ý mở ra.
  3. Gõ tìm kiếm thử "Maersk", "MSC", "COSCO", "Evergreen".
- **Kết quả mong đợi (Pass):**
  - Dropdown hiển thị đầy đủ tối thiểu 20 hãng tàu phổ biến quốc tế kết hợp cùng các đối tác hãng tàu trong cơ sở dữ liệu.
  - Tìm kiếm và lọc mượt mà theo ký tự gõ vào.
- **Bằng chứng:** `qa/2026-09-08_phan1_hang-tau-dropdown.png`
- **Regression ID:** REG-LINE-01-20260908

### TC_LINE_02 — Cho phép nhập tự do tên hãng tàu mới
- **Vai trò:** `CUS`, `ADMIN`
- **Mức độ:** P2
- **Các bước:**
  1. Trong ô Hãng tàu, gõ trực tiếp một tên hãng tàu tùy ý (ví dụ: "NEW_SHIPPING_LINE_EXP").
  2. Chuyển sang ô nhập liệu khác hoặc bấm Lưu.
- **Kết quả mong đợi (Pass):**
  - Input giữ nguyên chuỗi người dùng nhập, không bị xóa trắng hay ép buộc chọn từ catalog.
- **Bằng chứng:** `qa/2026-09-08_phan1_hang-tau-dropdown.png`
- **Regression ID:** REG-LINE-02-20260908

### TC_LINE_03 — Nút "+ Thêm hãng tàu" bên dưới ô nhập
- **Vai trò:** `CUS`, `ADMIN`
- **Mức độ:** P2
- **Các bước:**
  1. Quan sát khu vực trường Hãng tàu.
  2. Bấm vào nút "+ Thêm hãng tàu".
- **Kết quả mong đợi (Pass):**
  - Nút "+ Thêm hãng tàu" hiển thị trực quan ngay dưới ô input.
  - Nhấp nút mở modal thêm mới nhà cung cấp / đối tác hãng tàu nếu cần lưu dài hạn.
- **Bằng chứng:** `qa/2026-09-08_phan1_hang-tau-dropdown.png`
- **Regression ID:** REG-LINE-03-20260908

---

## 1.16 — UI Responsive & Hướng mở Popover form tạo lô (QA Matrix v2.0)

### TC_RESP_01 — Đảm bảo không tràn màn hình ngang ở độ phân giải 1366 × 768
- **Vai trò:** `CUS`, `ADMIN`
- **Mức độ:** P1
- **Thiết bị:** Desktop 1366 × 768 (độ phân giải văn phòng phổ biến)
- **Các bước:**
  1. Đặt viewport trình duyệt về 1366 × 768, mở `/shipments/new`.
  2. Kiểm tra thanh cuộn ngang của trang (`window.scrollX` / `scrollWidth`).
- **Kết quả mong đợi (Pass):**
  - Giao diện vừa vặn hoàn toàn màn hình, `document.documentElement.scrollWidth <= window.innerWidth`.
  - Không xuất hiện horizontal scrollbar ngoài ý muốn; các trường và nút "+ Thêm" không bị xô lệch.
- **Bằng chứng:** `qa/2026-09-08_phan2_responsive-1366.png`
- **Regression ID:** REG-RESP-01-20260908

### TC_RESP_02 — Hiển thị chuẩn mực ở độ phân giải 1920 × 1080 (Full HD)
- **Vai trò:** `CUS`, `ADMIN`
- **Mức độ:** P1
- **Thiết bị:** Desktop 1920 × 1080
- **Các bước:**
  1. Đặt viewport 1920 × 1080, mở `/shipments/new`.
  2. Quan sát bố cục form và bảng danh sách container.
- **Kết quả mong đợi (Pass):**
  - Bố cục dàn đều, ngay ngắn, không bị méo mó giao diện.
- **Bằng chứng:** `qa/2026-09-08_phan2_responsive-1920.png`
- **Regression ID:** REG-RESP-02-20260908

### TC_RESP_03 — Popover mở lên trên không đè nút "+ Thêm..." kề dưới
- **Vai trò:** `CUS`, `ADMIN`
- **Mức độ:** P1
- **Các bước:**
  1. Tại form tạo lô hàng, click mở dropdown Cảng nâng, Cảng hạ, Tuyến đường.
  2. Quan sát hướng mở của popover danh sách chọn.
- **Kết quả mong đợi (Pass):**
  - Popover mở theo hướng bung lên trên (`popoverPlacement="top"`).
  - Nút "+ Thêm..." nằm ngay bên dưới trường chọn hoàn toàn không bị che khuất và click được bình thường.
- **Bằng chứng:** `qa/2026-09-08_cus-create-popover-flip_ui-driven.log`
- **Regression ID:** REG-RESP-03-20260908

---

## 1.17 — Hiển thị Nút "Lưu" và "Hủy" trên Bảng kê container (QA Matrix v2.0)

### TC_BTN_01 — Nút "Lưu" (xanh thương hiệu) & "Hủy" trực quan tại ô sửa lịch
- **Vai trò:** `CUS`, `ADMIN`
- **Mức độ:** P1
- **Thiết bị:** Desktop (1440 × 900)
- **Các bước:**
  1. Mở Bảng kê container (`/shipments/containers`).
  2. Click ô Ngày giao / Giờ giao hoặc bấm icon sửa lịch trình của container.
  3. Quan sát cụm điều khiển submit.
- **Kết quả mong đợi (Pass):**
  - Hiển thị rõ ràng nút "Lưu" với màu xanh thương hiệu (`bg-brand-solid text-white`) và nút "Hủy" kế bên.
  - Người dùng không phải băn khoăn tìm cách lưu thay đổi.
- **Bằng chứng:** `qa/2026-09-08_phan4_modal-lich-giao.png`
- **Regression ID:** REG-BTN-01-20260908

### TC_BTN_02 — Hỗ trợ lưu bằng cả phím Enter và Click chuột
- **Vai trò:** `CUS`, `ADMIN`
- **Mức độ:** P1
- **Các bước:**
  1. Sửa ngày giao cho container A, bấm phím `Enter` trên bàn phím.
  2. Sửa ngày giao cho container B, nhấp chuột vào nút "Lưu".
- **Kết quả mong đợi (Pass):**
  - Cả 2 thao tác đều lưu thành công giá trị lịch trình mới vào hệ thống.
- **Regression ID:** REG-BTN-02-20260908

### TC_BTN_03 — Toast thông báo cập nhật thành công bằng tiếng Việt
- **Vai trò:** `CUS`, `ADMIN`
- **Mức độ:** P2
- **Các bước:**
  1. Nhấn Lưu cập nhật lịch trình.
  2. Quan sát góc thông báo (toast) trên màn hình.
- **Kết quả mong đợi (Pass):**
  - Xuất hiện toast màu xanh thông báo: "Cập nhật lịch trình container thành công!".
- **Regression ID:** REG-BTN-03-20260908

---

## 1.18 — Phân quyền cập nhật lịch trình Container chưa gán xe (QA Matrix v2.0)

### TC_UNAS_01 — Quyền ADMIN cập nhật lịch trình container chưa gán xe
- **Vai trò:** `ADMIN`
- **Mức độ:** P1
- **Tiền điều kiện:** Lô hàng đang ở trạng thái `DISPATCHED` hoặc `IN_PROGRESS`, có container chưa gán chuyến (`tripId == null`).
- **Các bước:**
  1. Đăng nhập tài khoản `ADMIN`.
  2. Cập nhật `customerAppointmentAt` cho container chưa gán xe đó.
  3. Bấm Lưu.
- **Kết quả mong đợi (Pass):**
  - Request thành công với HTTP 200 OK.
  - Cơ sở dữ liệu ghi nhận ngày giờ mới trong cột `shipment_containers.customer_appointment_at`.
- **Bằng chứng:** `qa/2026-09-08_qa-matrix-v2_ui-driver.log` (HTTP 200 OK, cont id=14592)
- **Regression ID:** REG-UNAS-01-20260908

### TC_UNAS_02 — Quyền MANAGER cập nhật lịch trình container chưa gán xe
- **Vai trò:** `MANAGER` (MANAGER)
- **Mức độ:** P1
- **Các bước:**
  1. Đăng nhập tài khoản `MANAGER`.
  2. Thực hiện cập nhật lịch hẹn cho container chưa gán chuyến xe.
  3. Bấm Lưu.
- **Kết quả mong đợi (Pass):**
  - Request trả về HTTP 200 OK, lịch được lưu chuẩn xác.
- **Bằng chứng:** `qa/2026-09-08_qa-matrix-v2_ui-driver.log` (HTTP 200 OK, cont id=14592)
- **Regression ID:** REG-UNAS-02-20260908

### TC_UNAS_03 — Chặn cập nhật lịch khi container đã có chuyến xe thực tế
- **Vai trò:** `ADMIN`, `MANAGER`, `CUS`
- **Mức độ:** P1
- **Tiền điều kiện:** Container đã được phân chuyến xe (`tripId != null`, ví dụ chuyến `TRP-202608-0008`).
- **Các bước:**
  1. Cố gắng cập nhật ngày giao cho container này qua API hoặc giao diện bảng kê.
- **Kết quả mong đợi (Pass):**
  - Hệ thống chặn lại ngay lập tức với mã lỗi HTTP 409 Conflict.
  - Thông báo lỗi rõ ràng bằng tiếng Việt: "Container đã gắn chuyến xe (TRP-202608-0008). Vui lòng đổi lịch trên chuyến xe hoặc gỡ phân xe trước khi sửa."
- **Bằng chứng:** `qa/2026-09-08_qa-matrix-v2_ui-driver.log` (HTTP 409 Conflict)
- **Regression ID:** REG-UNAS-03-20260908

---

## 1.19 — Quyền sở hữu phân loại Đơn / Kẹp / Kết hợp và cờ Đóng kết hợp cấp lô thuộc về CUS

> **Nguyên tắc nghiệp vụ cốt lõi (CUS's Call):**
> 1. Phân loại hình thức vận chuyển Đơn (`SINGLE`), Kẹp (`DOUBLE`), Kết hợp (`COMBINED`), Lẻ (`LCL`) và cờ đóng kết hợp cấp lô (`shipments.is_combined`) là **quyết định của nhân viên Chứng từ (CUS)** khi tiếp nhận Booking từ khách hàng.
> 2. ~~Điều vận KHÔNG quyết định phân loại này~~ **Cập nhật 2026-09-08:** Điều vận **được quyền chọn/đổi phân loại Đơn/Kẹp/Kết hợp cho từng dòng** trong dialog "Chỉnh sửa điều phối" (Kế hoạch chi tiết); cờ Đóng kết hợp cấp lô và phân loại Lẻ (hàng lẻ LCL) vẫn thuộc CUS/hình thức lô — chi tiết tại `02-dieuvan-dispatch.md §2.13` và `TC-DV-DISPATCH-041/044`.
> 3. Khi CUS tạo lô hàng với `isCombined = true`, tất cả các fulfillments FCL tạo ra tự động mang phân loại `COMBINED`. Ngược lại, nếu `isCombined = false`, fulfillments mang phân loại `SINGLE`.
> 4. Khi CUS cập nhật cờ `isCombined` trên lô chưa điều phối, hệ thống tự động đồng bộ hóa phân loại của các fulfillments FCL tương ứng.

### TC_CUS_COMB_01 — CUS tạo lô FCL có tích chọn "Đóng kết hợp" tự động gán phân loại COMBINED
- **Vai trò:** `CUS`, `ADMIN`
- **Mức độ:** P0
- **Tiền điều kiện:** Đang ở màn hình tạo mới lô hàng `/shipments/new`.
- **Các bước:**
  1. Đăng nhập tài khoản `CUS`.
  2. Chọn khách hàng, tuyến đường, chọn loại hàng FCL.
  3. Tích chọn ô "Đóng kết hợp" (`isCombined = true`).
  4. Thêm container và bấm "Tạo lô hàng".
- **Kết quả mong đợi (Pass):**
  - Lô hàng được tạo với `shipments.is_combined = true`.
  - Mọi fulfillment FCL được hệ thống tự động khởi tạo với `dispatchClassification = 'COMBINED'`.
  - Tại bảng kê container của CUS (`/shipments/containers`), cột Phân loại hiển thị "KẾT HỢP", cờ `isCombined` là `true`.
- **Bằng chứng & Kiểm thử:**
  - Backend unit test: `cus-shipment-workspace.test.ts` (`CUS call: FCL shipment created with isCombined=true defaults classification to COMBINED, isCombined=false to SINGLE`)
- **Regression ID:** REG-CUS-COMB-01-20260908

### TC_CUS_COMB_02 — CUS tạo lô FCL không tích chọn "Đóng kết hợp" mặc định phân loại SINGLE
- **Vai trò:** `CUS`, `ADMIN`
- **Mức độ:** P0
- **Tiền điều kiện:** Mở `/shipments/new`.
- **Các bước:**
  1. Nhập thông tin lô FCL, giữ nguyên ô "Đóng kết hợp" không tích (`isCombined = false`).
  2. Thêm container và bấm "Tạo lô hàng".
- **Kết quả mong đợi (Pass):**
  - Lô hàng được lưu với `shipments.is_combined = false`.
  - Mọi fulfillment FCL khởi tạo mang `dispatchClassification = 'SINGLE'`.
  - Tại bảng kê container của CUS, hiển thị phân loại "ĐƠN".
- **Bằng chứng & Kiểm thử:**
  - Backend unit test: `cus-shipment-workspace.test.ts`
- **Regression ID:** REG-CUS-COMB-02-20260908

### TC_CUS_COMB_03 — CUS cập nhật cờ isCombined đồng bộ phân loại fulfillments chưa điều phối
- **Vai trò:** `CUS`
- **Mức độ:** P0
- **Tiền điều kiện:** Lô hàng FCL đang ở trạng thái tiếp nhận (`PENDING_DATE` hoặc `READY_FOR_DISPATCH`), chưa phát hành lệnh điều xe.
- **Các bước:**
  1. CUS mở chi tiết lô hàng hoặc chỉnh sửa lô hàng.
  2. Đổi cờ `isCombined` từ `false` sang `true` và bấm Lưu.
  3. Kiểm tra bảng kê container và danh sách fulfillments.
  4. Tiếp tục đổi cờ `isCombined` từ `true` về `false` và bấm Lưu.
- **Kết quả mong đợi (Pass):**
  - Khi CUS bật `isCombined = true`: Các fulfillments FCL chưa bị hủy tự động chuyển sang `dispatchClassification = 'COMBINED'`.
  - Khi CUS tắt `isCombined = false`: Các fulfillments FCL tự động đồng bộ về `dispatchClassification = 'SINGLE'`.
  - Thay đổi được thực thi trực tiếp (DIRECT change mode) do lô đang ở trạng thái tiếp nhận.
- **Bằng chứng & Kiểm thử:**
  - Backend unit test: `cus-shipment-workspace.test.ts` (`CUS call: updating shipment isCombined synchronizes unassigned FCL fulfillments to COMBINED or SINGLE`)
- **Regression ID:** REG-CUS-COMB-03-20260908

### TC_CUS_COMB_04 — Chặn đóng kết hợp đối với container 40HC, 40DC, 45ft
- **Vai trò:** `CUS`, `ADMIN`
- **Mức độ:** P1
- **Tiền điều kiện:** Mở form tạo lô `/shipments/new` hoặc chi tiết lô hàng FCL có container loại 40HC / 40DC / 45ft.
- **Các bước:**
  1. Thêm container loại 40HC hoặc 40DC hoặc 45ft.
  2. Quan sát ô checkbox "Đóng kết hợp (kẹp chuyến)".
  3. Rê chuột lên checkbox xem tooltip giải thích.
- **Kết quả mong đợi (Pass):**
  - Checkbox ở trạng thái vô hiệu hóa (`disabled = true`) và không được tích chọn (`checked = false`).
  - Rê chuột hiển thị tooltip: "Chỉ container 20 feet mới được đóng kết hợp (kẹp chuyến)".
- **Bằng chứng:** `qa/2026-09-08_phan3_dispatch-dialog.png`
- **Regression ID:** REG-CUS-COMB-04-20260908

### TC_CUS_COMB_05 — Hàng lẻ LCL tự động mang phân loại LCL
- **Vai trò:** `CUS`, `ADMIN`
- **Mức độ:** P0
- **Tiền điều kiện:** Mở `/shipments/new`.
- **Các bước:**
  1. Chọn hình thức vận chuyển là Hàng lẻ (LCL).
  2. Nhập thông tin kiện hàng, số khối CBM, trọng lượng kg.
  3. Bấm "Tạo lô hàng".
- **Kết quả mong đợi (Pass):**
  - Lô LCL được tạo thành công với `cargoMode = 'LCL'`.
  - Fulfillment được sinh ra tự động mang phân loại `dispatchClassification = 'LCL'`.
  - Form không hiển thị tùy chọn "Đóng kết hợp (kẹp chuyến)" của hàng nguyên container FCL.
- **Bằng chứng & Kiểm thử:**
  - Backend unit test: `shipment-fulfillment.service.test.ts`
- **Regression ID:** REG-CUS-COMB-05-20260908

## 1.20 — Font size đồng nhất giữa các dòng trong bảng "Chi tiết container" (báo cáo khách hàng 2026-09-08)

### TC-CUS-CREATE-041 — Cột "Biển số" đồng nhất font-size giữa dòng đã gán và dòng đang trống (regression bug 2026-09-08)

- **Mã bug:** BUG-2026-09-08-LEDGER-FONT
- **Vai trò:** `CUS`, `ADMIN`
- **Mức độ:** P1 (visual regression)
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:**
  1. Mở `/shipments`. Có ít nhất một lô FCL có **≥ 2 container** với các trạng thái khác nhau:
     - 1 container đã được gán biển số (`plateAssigned = true`).
     - 1 container chưa được gán biển số (`plateAssigned = false`).
- **Các bước:**
  1. Click nút "Chi tiết" của lô đó để mở drawer.
  2. Trong bảng "Chi tiết container", so sánh cột "Biển số" của 2 dòng liền kề.
  3. Đo `getComputedStyle(...)` của:
     - Ô "Biển số" của dòng đã gán (renderer `<strong>`).
     - Ô "Biển số" của dòng đang trống (renderer `<span class="csc-container-cell__display">` với placeholder "Nhập biển số").
- **Kết quả mong đợi (Pass):**
  - Cả hai ô cùng `font-size: 12px` và cùng `font-weight: 500` (hoặc một cặp giá trị duy nhất được dùng cho cả bảng).
  - Mắt thường nhìn 2 dòng liền kề thấy cỡ chữ bằng nhau; placeholder "Nhập biển số" chỉ khác ở **màu** (`--fg-3` thay vì `--ink`), không khác ở kích thước hoặc độ đậm.
  - Không ảnh hưởng đến bảng `csc-container-table` ở `/shipments/new` (font-size 13px vẫn giữ nguyên cho form tạo mới).
- **Kỳ vọng sai (Fail nếu):**
  - `font-size` ở dòng "Biển số đã gán" khác dòng "Biển số trống" (vd. 12px vs 13px).
  - `font-weight` chênh lệch rõ rệt giữa 2 renderer (`<strong>` 500 vs display span 400).
  - Cỡ chữ thay đổi ở `/shipments/new` (regression ngược sang form tạo).
- **Bằng chứng:**
  - `qa/2026-09-08_container-ledger-font_before.png` (screenshot bảng trước fix, thấy rõ chênh lệch cỡ chữ).
  - `qa/2026-09-08_container-ledger-font_after.png` (screenshot sau fix, 2 dòng cùng cỡ).
  - `qa/2026-09-08_container-ledger-font_ui-driver.log` (log script puppeteer đo `getComputedStyle`).
  - Output JSON của script `before-fix-ledger.mjs` chạy lại sau fix: 2 dòng có cùng `fontSize`/`fontWeight`.
- **Regression ID:** REG-LEDGER-FONT-20260908

## 1.21 — Ledger container: một cặp Lưu/Hủy, không cuộn ngang, payload tối thiểu (báo cáo khách hàng 2026-09-08)

### TC-CUS-CREATE-042 — Dòng đang sửa có đúng MỘT cặp Lưu/Hủy ngay tại ô Giờ hẹn đóng/trả

- **Mã bug:** BUG-2026-09-08-DUP-CONFIRM (cột "Thao tác" nhân đôi nút và đẩy bảng vào cuộn ngang)
- **Vai trò:** `CUS`
- **Mức độ:** P1
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** drawer lô FCL mở, bảng "Chi tiết container" ở chế độ chỉnh sửa.
- **Các bước:**
  1. Sửa "Giờ hẹn đóng/trả" của một dòng → quan sát vị trí cặp nút Lưu/Hủy xuất hiện.
  2. Đếm số nút Lưu + Hủy xuất hiện cho dòng đó.
  3. Kiểm tra header bảng: không còn cột "Thao tác dòng".
  4. Co hẹp drawer (~760px container width) → bảng vẫn hiển thị đủ 9 cột không cần cuộn ngang.
- **Kết quả mong đợi (Pass):**
  - Mỗi dòng đang dirty có đúng 1 nút Lưu + 1 nút Hủy, nằm trong ô Giờ hẹn đóng/trả (nơi vừa sửa).
  - Không có cột "Thao tác dòng"; các cột dùng % tổng 100% nên không sinh thanh cuộn ngang.
- **Kỳ vọng sai (Fail nếu):** cặp nút thứ hai xuất hiện ở cột khác; bảng tràn ngang tại drawer hẹp.
- **Bằng chứng:** `CusContainerLedger.test.tsx` — "renders exactly one Lưu/Hủy pair per dirty row",
  "has no separate Thao tác column"; CSS density contract test pin % cột + input 28px.

### TC-CUS-CREATE-043 — Lưu dòng container chỉ gửi các trường thực sự thay đổi

- **Mã bug:** BUG-2026-09-08-WRONG-409 (payload echo trường không đổi → 409 "Lô hàng đã bàn giao…")
- **Vai trò:** `CUS`
- **Mức độ:** P0
- **Các bước:**
  1. Mở drawer lô đã bàn giao Điều vận (có đủ nhà xe/biển số/tuyến).
  2. Chỉ sửa "Giờ hẹn đóng/trả" → Lưu.
  3. Bắt request `PATCH .../containers/:lineId` (devtools) → kiểm tra body.
- **Kết quả mong đợi (Pass):**
  - Body chỉ chứa `expectedShipmentVersion` + trường vừa đổi (vd `customerAppointmentAt`).
  - Lưu thành công (200), không còn 409 do echo trường governed không đổi.
- **Kỳ vọng sai (Fail nếu):** body chứa carrier/route/site tuy người dùng không sửa; response 409.
- **Bằng chứng:** `CusContainerLedger.test.tsx` — "sends only the changed field on save"
  (assert `Object.keys(payload)` đúng `['customerAppointmentAt','expectedShipmentVersion']`).

### TC-CUS-CREATE-044 — Sửa container sau bàn giao áp dụng trực tiếp (approval workflow parked)

- **Quyết định:** KH chưa chốt quy trình phê duyệt (2026-09-08) → bỏ luồng yêu cầu thay đổi
  trong app; mọi sửa hợp lệ lưu thẳng. Hạ tầng review (bảng + service) giữ nguyên để dùng lại.
  Ràng buộc giữ nguyên: dòng đã gắn chuyến thực tế bị chặn sửa ("Container đã gắn chuyến xe…").
- **Vai trò:** `CUS`, `DISPATCHER`
- **Mức độ:** P1
- **Các bước:**
  1. Lô đã bàn giao (READY_FOR_DISPATCH), dòng chưa có chuyến → sửa nhà xe/biển số/ngày → Lưu.
  2. Xác nhận không xuất hiện thông báo "phải đi qua yêu cầu thay đổi để phê duyệt".
  3. Dòng đã có chuyến thực (trip active) → thử sửa → bị chặn với lý do "Container đã gắn chuyến xe".
- **Kết quả mong đợi (Pass):** bước 1 lưu trực tiếp (200 + version bump); bước 3 chặn như cũ.
- **Kỳ vọng sai (Fail nếu):** xuất hiện yêu cầu phê duyệt cho container/plan; hoặc dòng có chuyến
  vẫn sửa được.
- **Bằng chứng:** backend `cus-shipment-workspace.test.ts` "post-handoff container edits apply
  directly"; `q22-source-authority.test.ts` "applies post-dispatch cargo changes directly without
  overwriting the linked trip" (không tạo shipmentChangeRequests).

### TC-CUS-CREATE-045 — Bảng chọn ngày giờ container (Popover) không bị che/cắt và hiển thị trọn vẹn

- **Mã bug:** BUG-2026-09-08-CALENDAR-CLIPPED (popover bị cuộn/cắt viền trên ở dòng cuối hoặc bảng ít dòng)
- **Vai trò:** `CUS`, `ADMIN`, `MANAGER`
- **Mức độ:** P0
- **Các bước:**
  1. Mở drawer chi tiết lô hàng có 1 hoặc 2 container (hoặc click dòng cuối cùng).
  2. Bấm vào nút chọn ngày giờ (cột "Giờ hẹn đóng/trả").
  3. Quan sát popover: phần tiêu đề, nút đóng, nút chọn nhanh ngày ("Hôm nay", "Ngày mai", "Ngày kia"), ô input Ngày, ô input Giờ, khung giờ phổ biến.
- **Kết quả mong đợi (Pass):**
  - Popover hiển thị trọn vẹn trong viewport, không bị che khuất bởi mép trên/dưới của bảng hoặc drawer.
  - Căn chỉnh tự động (fixed positioning) dựa trên vị trí nút bấm và không gian màn hình.
- **Kỳ vọng sai (Fail nếu):** Popover bị cắt cụt phần trên/dưới, chỉ hiện một nửa khung giờ hoặc tràn ra ngoài màn hình.
- **Bằng chứng:** `CusAppointmentPopover.test.tsx`, `qa/2026-09-08_cus_popover_row2_last_child.png`, `qa/2026-09-08_cus_popover_row1.png`.

### TC-CUS-CREATE-046 — Hợp nhất nút Lưu/Hủy tại Footer của Drawer và tự động đóng drawer sau khi Lưu

- **Mã bug:** BUG-2026-09-08-DRAWER-SAVE-CLOSE (yêu cầu bỏ chữ "Chưa có thay đổi", đóng drawer sau khi lưu và gom nút Lưu/Hủy lên cấp Drawer)
- **Vai trò:** `CUS`, `ADMIN`, `MANAGER`
- **Mức độ:** P1
- **Các bước:**
  1. Mở drawer chi tiết lô hàng, kiểm tra footer: không xuất hiện dòng chữ "Chưa có thay đổi".
  2. Sửa thông tin container (ngày giờ hẹn, cảng, biển số xe...) → footer hiện "Có thay đổi container chưa lưu" và kích hoạt nút [ Lưu ], [ Hủy ].
  3. Bấm nút [ Lưu ] tại footer.
- **Kết quả mong đợi (Pass):**
  - Toàn bộ thay đổi của các container được gửi lưu cùng lúc (batch save).
  - Sau khi lưu thành công, thông báo toast hiển thị và drawer tự động đóng lại.
  - Khi mở lại drawer, dữ liệu mới đã được lưu và footer sạch sẽ (không hiện chữ "Chưa có thay đổi").
- **Kỳ vọng sai (Fail nếu):** Drawer vẫn mở sau khi lưu; xuất hiện chữ "Chưa có thay đổi"; hoặc nút Lưu nằm phân mảnh bên trong từng cell.
- **Bằng chứng:** `CusDrawerFooter.test.tsx`, `ShipmentsPage.test.tsx`, `qa/2026-09-08_cus_drawer_ui-04_saved_success.png`, `qa/2026-09-08_cus_drawer_ui-driver.log`.

### TC-CUS-CREATE-047 — Bấm ra ngoài để đóng popover/dropdown hoạt động chuẩn xác kể cả bên trong Drawer

- **Mã bug:** BUG-2026-09-08-DISMISS-CLICK-OUTSIDE (Bấm ra ngoài để đóng không hoạt động trên popover ngày giờ hẹn / dropdown bên trong Drawer)
- **Vai trò:** `CUS`, `ADMIN`, `MANAGER`
- **Mức độ:** P0
- **Các bước:**
  1. Mở trang `/shipments`, bấm "Chi tiết" để mở drawer chi tiết lô hàng.
  2. Bấm nút chọn ngày giờ ("Giờ hẹn đóng/trả") trong bảng container để mở `CusAppointmentPopover`.
  3. Bấm ra ngoài popover (click vào vùng trống trong Drawer, thanh tiêu đề Drawer, hoặc vùng backdrop mờ bên trái Drawer).
  4. Quan sát: popover đóng lại ngay lập tức mà không kích hoạt thao tác ngoài ý muốn (không đóng nhầm drawer, không kích hoạt confirm hủy thay đổi).
  5. Thử nghiệm trên các dropdown khác (chọn cảng nâng/hạ, nhà xe, loại cont) trên cả desktop và mobile (viewport 390px).
- **Kết quả mong đợi (Pass):**
  - Popover/dropdown tự động đóng sạch sẽ khi click/tap ra ngoài (hỗ trợ cả `pointerdown` và `mousedown`).
  - Backdrop popover có z-index phù hợp (`z-index: 1040`) nằm trên Drawer (`z-index: 300`) nên hấp thụ tương tác dismiss một cách độc lập.
  - Phím Escape đóng popover/dropdown mà không làm đóng cả Drawer.
- **Kỳ vọng sai (Fail nếu):**
  - Bấm ra ngoài mà popover vẫn trơ trơ không đóng; hoặc click ra ngoài làm đóng nhầm cả Drawer / hiện dialog discard thay đổi.
- **Bằng chứng:** `CusAppointmentPopover.test.tsx`, `qa/2026-09-08_cus_dismiss_ui-*.png`, `qa/2026-09-08_cus_dismiss_ui-driver.log`.

---

### TC-CUS-CREATE-048 — Lô FCL nhiều cont có cont chưa chốt ngày: cảnh báo còn cont chưa chốt ngày, trạng thái giữ Chờ chốt lịch (không nhảy Sẵn sàng điều xe)

- **Mã bug:** BUG-2026-09-08-PARTIAL-DATE-STATUS (Lô FCL nhiều container mới chốt ngày cho 1 cont, cont còn lại chưa chốt ngày: hệ thống không được tự nhảy "Sẵn sàng điều xe", phải giữ "Chờ chốt lịch" và cảnh báo "Chưa chốt ngày")
- **Vai trò:** `CUS`, `DISPATCHER`, `ADMIN`, `MANAGER`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Tạo lô hàng FCL mới có 2 container, chưa nhập ngày đóng/trả cho container nào (lô ở trạng thái `PENDING_DATE` - "Chờ chốt lịch").
- **Các bước:**
  1. Đăng nhập CUS, mở `/shipments`. Quan sát lô hàng: trạng thái là "Chờ chốt lịch", cột Lịch trình hiển thị "Chưa chốt ngày".
  2. Bấm "Chi tiết" để mở drawer hoặc bảng container.
  3. Chỉ nhập ngày hẹn đóng/trả cho container thứ nhất (ví dụ ngày mai 09:00). Container thứ hai để trống ngày hẹn.
  4. Lưu thay đổi container.
  5. Quan sát trạng thái lô hàng trên danh sách `/shipments` và trong chi tiết lô:
     - Badge trạng thái của lô hàng: vẫn là **"Chờ chốt lịch"** (KHÔNG được tự chuyển thành "Sẵn sàng điều xe").
     - Cột Lịch trình: vẫn hiển thị chữ cảnh báo **"Chưa chốt ngày"** màu cam/cảnh báo, đi kèm dòng giờ hẹn của container thứ nhất đã nhập.
  6. Mở màn hình Kế hoạch tổng quát `/dispatch`: lô hàng chưa đủ ngày này không được coi là đã sẵn sàng toàn bộ; nếu hiển thị phải có dòng cảnh báo "Cảnh báo: Còn 1/2 cont chưa chốt ngày đóng trả".
  7. Quay lại CUS, bổ sung ngày hẹn cho container thứ hai và bấm Lưu.
  8. Quan sát lại: lúc này TẤT CẢ container đã có ngày hẹn, lô hàng mới chính thức chuyển trạng thái sang **"Sẵn sàng điều xe"** (READY_FOR_DISPATCH).
- **Kết quả mong đợi (Pass):**
  - Khi chưa đủ ngày cho tất cả container FCL, lô giữ vững trạng thái `PENDING_DATE` ("Chờ chốt lịch") và cảnh báo "Chưa chốt ngày".
  - Chỉ khi 100% container đã chốt ngày hẹn, lô mới chuyển sang "Sẵn sàng điều xe".
- **Kỳ vọng sai (Fail nếu):**
  - Mới nhập ngày cho 1 cont mà lô đã tự động chuyển sang "Sẵn sàng điều xe" và mất cảnh báo "Chưa chốt ngày" (hành vi lỗi khách hàng chụp ảnh báo).
- **Bằng chứng:** `shipment-routes.test.ts` (builder/display assertions: partial lot reads PENDING_DATE, fully-dated lot reads READY_FOR_DISPATCH), `cus-shipment-workspace.test.ts`, QA screenshot.

---

### TC-CUS-CREATE-049 — Popover "Giờ hẹn đóng/trả" (CUS): nhập Giờ trước Ngày, ô giờ 24h, hiển thị ngoài danh sách dạng "HH:MM d/m/yy"

- **Mã bug:** Regression staging 2026-09-08 (7-bug batch): popover sửa giờ hẹn đóng/trả phải ưu tiên nhập Giờ trước — Ngày sau, ô giờ theo định dạng 24h (không AM/PM), và hiển thị ngoài danh sách khớp định dạng "20:45 8/9/26".
- **Vai trò:** `CUS`
- **Mức độ:** P1
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Lô hàng FCL đã tạo; mở chi tiết lô ở giao diện CUS, thấy bảng container (CusContainerLedger).
- **Các bước:**
  1. Đăng nhập CUS, mở `/shipments`, bấm "Chi tiết" để mở bảng container.
  2. Bấm vào ô Lịch trình (giờ hẹn đóng/trả) của một container để mở popover `CusAppointmentPopover`.
  3. Quan sát thứ tự trường nhập: ô **Giờ** (HH:mm) phải đứng **trước** ô **Ngày** (dd/mm/yyyy).
  4. Kiểm tra ô Giờ theo định dạng 24h (00–23, không AM/PM; input được gắn `lang="en-GB"`).
  5. Nhập giờ 20:45 và ngày 8/9/2026, bấm Lưu.
  6. Quan sát hiển thị ngoài popover (bảng container / danh sách lô): ô lịch trình hiển thị **"20:45 8/9/26"** — giờ trước, ngày sau.
- **Kết quả mong đợi (Pass):**
  - Popover hiển thị Giờ trước Ngày, ô giờ 24h.
  - Hiển thị ngoài popover khớp "20:45 8/9/26" (không "8/9/26 20:45", không có AM/PM).
- **Kỳ vọng sai (Fail nếu):**
  - Popover hiện Ngày trước Giờ; hoặc ô giờ 12h AM/PM; hoặc hiển thị ngoài lệch định dạng "HH:MM d/m/yy".
- **Bằng chứng:** `CusAppointmentPopover.test.tsx` — it('renders giờ before ngày with 24h locale pinned to en-GB'). Liên quan: TC-CUS-CREATE-029/032 (nút Xác nhận + validate) trên cùng popover.

---

### TC-CUS-CREATE-050 — "Chỉnh sửa lịch trình" (nhân viên): nhập Giờ trước Ngày, giờ 24h — đồng bộ với popover CUS

- **Mã bug:** Cùng cụm regression staging 2026-09-08: editor "Chỉnh sửa lịch trình" phía nhân viên (`ShipmentContainerScheduleEditor.tsx`) phải đồng bộ quyết định giờ-first/24h như popover CUS (quyết định 2026-09-09).
- **Vai trò:** `DISPATCHER`, `CLERK`, `ADMIN`, `MANAGER`
- **Mức độ:** P1
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Lô FCL có container đã chốt lịch hẹn; mở chi tiết lô ở giao diện nhân viên (ShipmentContainerLedger).
- **Các bước:**
  1. Đăng nhập nhân viên (DISPATCHER/CLERK), mở chi tiết lô, bấm chỉnh sửa lịch trình của container để mở editor `ShipmentContainerScheduleEditor`.
  2. Quan sát thứ tự trường: **Giờ** trước **Ngày**; ô giờ 24h (00–23, không AM/PM).
  3. Nhập giờ 20:45 và ngày 8/9/2026, Lưu.
  4. Quan sát hiển thị ngoài editor (bảng container nhân viên): **"20:45 8/9/26"**.
- **Kết quả mong đợi (Pass):**
  - Editor giờ-first + 24h; hiển thị ngoài khớp "HH:MM d/m/yy", đồng bộ với popover CUS (TC-CUS-CREATE-049).
- **Kỳ vọng sai (Fail nếu):**
  - Editor vẫn Ngày-trước-Giờ hoặc 12h AM/PM; hiển thị ngoài lệch định dạng so với popover CUS.
- **Bằng chứng:** `ShipmentContainerScheduleEditor.test.tsx` (unit evidence — fix giờ-first đã ship 2026-09-09).

---

## 1.22 — Known behavior: sửa container hủy fulfillments chưa phát hành lệnh (API pin 2026-09-09)

> Phát hiện từ kiểm thử API staging 2026-09-09 (lô SHP-2609-00010). Quyết định của user (qua session prod-88): **document + pin bằng test, KHÔNG thêm guard chặn** — guard sẽ phá luồng sửa container của CUS sau khi phân bổ.

### TC-CUS-CREATE-051 — Sửa container khi lô đã phân bổ nhưng CHƯA phát hành lệnh → fulfillments cũ bị hủy (REPLACED), lô rời bảng chi tiết điều vận đến khi phân bổ lại

- **Mã:** API contract pin 2026-09-09
- **Vai trò:** `ADMIN` (API contract; UI tương đương qua luồng sửa container CUS)
- **Mức độ:** P2 (known behavior — không phải bug)
- **Tiền điều kiện:** Lô FCL ≥1 container đã "Phân bổ nhà xe" (fulfillments active), lô đang hiển thị trên Bảng chi tiết điều vận.
- **Các bước:**
  1. `PUT /api/shipments/:id/containers` (full reconcile: thêm/bớt/sửa container) khi lô chưa có chuyến (no trips).
  2. Quan sát response API và Bảng chi tiết điều vận.
  3. Chạy lại "Phân bổ nhà xe" (carrier allocation) cho lô.
- **Kết quả mong đợi (Pass):**
  - Bước 1: PUT thành công (200), không có lỗi.
  - Fulfillments chưa có chuyến bị hủy: `canceledAt` được set, `cancellationDisposition = "REPLACED"`, lý do đúng chuỗi "Container của lô hàng đã được cập nhật; cần gán lại nhà xe."
  - Lô biến mất khỏi Bảng chi tiết điều vận ngay sau bước 1 (rows loại fulfillments đã hủy).
  - Bước 3: phân bổ lại sinh fulfillments mới (id mới), lô trở lại bảng chi tiết; fulfillments cũ vẫn giữ trạng thái đã hủy.
  - Trường hợp ngược lại: nếu lô có chuyến "live" (trip ≠ CANCELED, chưa soft-delete) thì PUT bị chặn **409** "Không thể thay đổi container sau khi đã phát hành lệnh điều xe…" và fulfillments giữ nguyên.
- **Kỳ vọng sai (Fail nếu):**
  - Reconcile báo lỗi khi chưa có chuyến; hoặc hủy sai disposition/lý do; hoặc lô vẫn còn trên bảng chi tiết sau bước 1; hoặc 409 trong khi chưa có chuyến nào.
- **Bằng chứng:** `backend/src/tests/shipment-routes.test.ts` — describe **"PUT /:id/containers × fulfillments (reconcile guard contract)"**, 2 test: (1) "reconcile with untripped fulfillments cancels them (REPLACED) and drops the lot from the detail plan until re-allocation"; (2) "reconcile with a live trip is rejected 409 and leaves fulfillments untouched".

---

## 1.23 — Giờ hẹn ghi theo giờ Việt Nam bất kể múi giờ máy (quyết định KH 2026-09-09: "always use Vietnam Time")

> Trên browser múi giờ khác +07 (ví dụ Asia/Singapore +08), popover giờ hẹn từng ghi lệch qua parse browser-local (`new Date(naive).toISOString()`), cell hiển thị theo múi giờ máy, và prefill popover đọc giờ UTC nguyên văn. Serialize qua `localDateTimeToIso` → `+07:00` (đồng bộ `saveSchedule`); hiển thị/prefill pin `Asia/Ho_Chi_Minh`.

### TC-CUS-CREATE-052 — Giờ hẹn đóng/trả: payload "+07:00", hiển thị và prefill giờ VN trên browser bất kỳ

- **Mã bug:** Quyết định KH 2026-09-09 — trên browser +08, popover ghi giờ hẹn bị lệch −1h (parse browser-local), cell hiển thị sai giờ VN, prefill popover hiện giờ UTC nguyên văn. Wire format "+07:00" vốn là contract schema (zod `datetime({offset:true})`).
- **Vai trò:** `CLERK`, `DISPATCHER`, `ADMIN`, `MANAGER`
- **Mức độ:** P1
- **Thiết bị:** Desktop, browser đặt múi giờ KHÔNG phải +07 (ví dụ Asia/Singapore +08)
- **Tiền điều kiện:** Lô có container đang có giờ hẹn (instant UTC); CUS ledger chi tiết lô đang mở.
- **Các bước:**
  1. Đặt múi giờ browser về +08 (ví dụ Asia/Singapore).
  2. Mở popover "Giờ hẹn đóng/trả" trên dòng container có giờ hẹn đã lưu: quan sát prefill.
  3. Đặt **09:00** ngày 11/9/2026, đóng popover, bấm **Lưu**.
  4. Quan sát Network payload của request lưu container.
  5. Sau khi lưu xong, quan sát cell "Giờ hẹn đóng/trả" (và aria-label của trigger).
- **Kết quả mong đợi (Pass):**
  - Bước 2: prefill là giờ VN từ instant (ví dụ instant `06:30Z` → **13:30**, không phải 14:30 hay 06:30).
  - Bước 4: payload gửi **`customerAppointmentAt: "2026-09-11T09:00:00+07:00"`** (offset VN tường minh), không phải UTC theo múi giờ máy.
  - Bước 5: cell hiển thị **"09:00 11/9/26"** (giờ VN), reload vẫn đúng trên browser +08.
- **Kỳ vọng sai (Fail nếu):** Payload là `new Date(naive).toISOString()` theo múi giờ máy (ví dụ `…T01:30:00.000Z` cho 09:30 ở +08); prefill hiện giờ UTC hoặc giờ máy; hiển thị lệch giờ trên browser non-VN.
- **Bằng chứng:** Vitest `CusContainerLedger.test.tsx` (payload assertion `+07:00`), `CusAppointmentPopover.test.tsx` (prefill instant → giờ VN), `src/lib/format.test.ts` (`formatDateTimeShort` pin `Asia/Ho_Chi_Minh`); liên quan RCA TC-CUS-CREATE-039.