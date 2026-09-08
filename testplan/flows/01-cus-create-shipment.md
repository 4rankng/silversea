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

### TC-CUS-CREATE-037 — Dropdown "Hãng tàu" treo/hiển thị sai danh sách khi mở (bug 2026-09-08)

- **Mã PRD:** Bug report 2026-09-08 — mở dropdown "Hãng tàu" trên /shipments/new bị treo, danh sách hiển thị nhầm là danh sách Khách hàng
- **Vai trò:** `cus`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Đã đăng nhập `cus`, đang ở /shipments/new
- **Các bước:**
  1. Bấm vào ô "Hãng tàu" (không gõ gì).
  2. Quan sát dropdown xổ ra: danh sách option phải là CÁC HÃNG TÀU (EVER, SJJ, ONE...), KHÔNG phải danh sách khách hàng.
  3. Gõ 1-2 ký tự (ví dụ "ev") → danh sách phải lọc còn các hãng tàu khớp, không treo trang.
  4. Backspace xóa text → input cập nhật bình thường, không snap về giá trị cũ, không treo.
  5. Chọn một hãng tàu → giá trị áp dụng đúng vào trường.
- **Kết quả mong đợi (Pass):** dropdown mở < 300ms, đúng danh sách hãng tàu, lọc theo gõ phím, không treo trang, chọn được.
- **Bằng chứng:** screenshot dropdown + log console.

---

### TC-CUS-CREATE-038 — Dropdown Cảng nâng / Tuyến đường che mất nút "+ Thêm" khi trigger ở giữa/cuối màn hình (regression bug 2026-09-08)

- **Mã PRD:** Bug report 2026-09-08 — "Phần thêm mới tuyến đường, cảng nâng hạ đang bị lỗi hiển thị, nếu màn hình hiển thị ở đầu trang thì không sao nhưng nếu hiển thị ở giữa hoặc cuối trang, menu thay vì xổ lên sẽ xổ xuống và che mất phần +Thêm để click". Class `.csc-route-picker` (container row "Cảng nâng"/"Cảng hạ"/"Tuyến đường") + class `.csc-customer-picker` (Khách hàng) + class `.csc-shipping-line-picker` (Hãng tàu) đều xếp `SearchableField` rồi đến nút `+ Thêm` bên dưới; khi popover xổ xuống (default `placement="bottom"`) nó đè lên nút `+ Thêm` ngay phía dưới và người dùng không click được nút inline-create.
- **Vai trò:** `cus`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Đăng nhập `cus`, mở `/shipments/new`; có ít nhất 1 khách hàng có cảng/tuyến trong catalog để dropdown hiển thị danh sách > 1 option.
- **Các bước:**
  1. Đăng nhập `cus`, mở `/shipments/new`. Chọn khách hàng (vd LONG MINH), hình thức **Hàng nguyên container (FCL)**, nhập Số Booking / Số Bill.
  2. Cuộn trang sao cho dòng **Cảng nâng** nằm ở khoảng giữa màn hình (rect.top trong khoảng 300-600 / viewport.height=900) — vẫn còn chỗ trống phía dưới.
  3. Click vào ô "Cảng nâng" → quan sát hướng mở của popover.
  4. Quan sát nút **"+ Thêm"** ngay bên dưới ô Cảng nâng.
  5. Tương tự với ô **Cảng hạ** và **Tuyến đường** trong cùng dòng container.
  6. (Optional) Trượt xuống sao cho trigger nằm sát đáy viewport → popover **phải xổ lên trên** (data-placement="top") và nút +Thêm vẫn click được.
- **Kết quả mong đợi (Pass):**
  - Nút **+Thêm** phải luôn click được khi dropdown đang mở (không bị popover đè/nuốt).
  - Ở trigger giữa/cuối màn hình: popover **phải xổ lên trên** (data-placement="top" hoặc tương đương) để không che nút `+Thêm` bên dưới.
  - Ở trigger đầu trang (≤ ~1/3 viewport trên): popover vẫn được phép xổ xuống — đây là hướng mở mặc định, nút +Thêm không bị che vì nằm ngoài vùng popover hoặc popover đã được đặt sao cho +Thêm vẫn lộ ra.
  - Không có regression ở các picker khác dùng cùng `.csc-utility-button--dashed` (Hãng tàu, Thêm nhà máy, Thêm ngày giao, Thêm kho).
- **Kỳ vọng sai (Fail nếu):**
  - Dropdown xổ xuống và nút `+Thêm` bị che → người dùng không click inline-create được mà phải đóng dropdown trước.
  - data-placement luôn là `"bottom"` dù trigger ở cuối viewport.
- **Bằng chứng:** `qa/<YYYY-MM-DD>_cus-create-popover-flip_before.png` (dropdown xổ xuống che +Thêm, trigger ở giữa trang) + `qa/<YYYY-MM-DD>_cus-create-popover-flip_after.png` (popover xổ lên / +Thêm click được) + measurement log (rect của popover vs trigger vs +Thêm button).

---

## 1.2 — (đang mở)

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
- **Vai trò:** `cus` (longminh-side account, vd `thanhdc`)
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

- **Vai trò:** `cus`
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
- **Vai trò:** `cus`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Lô đã tồn tại với BL `BL-DUP-001` (Hàng Nhập), Tờ khai `TK-DUP-001`, do tài
  khoản `cus` khác (hoặc cùng `cus`) tạo trước đó. Lô cũ chưa xóa.
- **Các bước:**
  1. Đăng nhập `cus`, mở `/shipments/new`.
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

- **Vai trò:** `cus`
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

- **Vai trò:** `cus`
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

- **Vai trò:** `cus`
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

- **Vai trò:** `cus`
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

- **Vai trò:** `cus`
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

- **Vai trò:** `cus`
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

- **Vai trò:** `cus`
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

- **Vai trò:** `cus`
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

- **Vai trò:** `cus`
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

- **Vai trò:** `cus`
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
- **Vai trò:** `cus`, `admin`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:**
  1. Đăng nhập `cus`, mở `/shipments-detail` (Danh sách container).
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
- **Vai trò:** `cus`
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
- **Vai trò:** `admin`, `cus`, `giamdoc`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:**
  1. Có lô hàng đã tạo với ít nhất 1 container có nhà máy được gán.
  2. Trang "Tổng quan lô hàng" (`/shipments`) hiển thị đúng tên nhà máy (ví dụ: ASKEY-1, ASKEY-2).
- **Các bước:**
  1. Đăng nhập `admin`.
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
