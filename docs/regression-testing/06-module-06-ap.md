# M06 — Quản lý công nợ phải trả (AP)

> **Phân hệ 6** — 4 nhóm (6.1–6.4). Nguồn PRD: `docs/prd/Module6.docx`.
> **Tiêu chí toàn phân hệ:** `M06-HT-01` … `M06-HT-10` (xem `00-cross-cutting.md`).
>
> **Màn hình chính:** `/payables` (danh sách công nợ phải trả), `/payables/:id` (chi tiết nhà cung cấp
> AP), `/suppliers`, `/suppliers/:id`, `/config/suppliers`. Vai trò thử: `ketoan` (ghi nhận & thanh
> toán), `giamdoc` (xem), `admin` (quản lý danh mục).
>
> **Phụ thuộc câu hỏi logic nghiệp vụ (Q):** nhóm 6.1 phụ thuộc **Q06** (hóa đơn nhiều xe); nhóm 6.2 phụ
> thuộc **Q07** (một nhà cung cấp nhiều nhóm dịch vụ) và **Q08** (khách hàng ⇄ nhà cung cấp); nhóm 6.4 phụ
> thuộc nặng **Q08** (đối trừ không tự động, có biên bản + phê duyệt, ≤ min(AR, AP)). Khi Silver Sea ký
> duyệt giá trị khác, cập nhật cột *Phụ thuộc* và kỳ vọng tương ứng.

---

## 6.1 — Theo dõi công nợ nhiên liệu

**Quy tắc (PRD M06-6.1):** Đối chiếu hóa đơn với nhiên liệu đã ghi nhận theo xe và kỳ; chỉ ghi công nợ
**một lần** cho mỗi hóa đơn. Hiển thị số đã trả, còn phải trả, hạn thanh toán và chênh lệch với dữ liệu
nhiên liệu. Hóa đơn điều chỉnh hoặc chênh lệch số lit phải được **giải trình trước khi duyệt**.

### TC-M06-01-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M06-01-01
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** có nhà cung cấp nhiên liệu "Petrolimex", xe X đã ghi nhận 100 lit trong kỳ 07/2026.
- **Các bước:**
  1. Mở `/payables` → bấm "Tạo công nợ nhiên liệu".
  2. Chọn nhà cung cấp Petrolimex, kỳ 07/2026, hóa đơn số HD-001, xe X, 100 lit, đơn giá 22.000đ/lit, tổng 2.200.000đ, VAT 8%, hạn thanh toán 15/08.
  3. Lưu.
- **Kết quả mong đợi (Pass):**
  - Công nợ được ghi nhận **một lần** cho HD-001; không tạo bút toán trùng.
  - `/payables/:id` hiển thị: tổng 2.376.000đ (đã VAT), còn phải trả 2.376.000đ, đã trả 0, hạn 15/08.
  - Chênh lệch với dữ liệu nhiên liệu xe X kỳ 07 = 0 lit (đối soát khớp).
- **Phụ thuộc:** Q06
- **Bằng chứng:** ảnh `/payables` mới + ảnh chi tiết hóa đơn kèm mục "Đối soát nhiên liệu".

### TC-M06-01-02 — Thiếu hoặc sai dữ liệu

- **Mã PRD:** M06-01-02
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Mở form tạo công nợ nhiên liệu.
  2. Bỏ trống "số hóa đơn" hoặc nhập số lit âm (-5) → bấm Lưu.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo tiếng Việt chỉ rõ trường thiếu/giá trị không hợp lệ.
  - Không lưu bản ghi, trạng thái form giữ nguyên dữ liệu đã nhập.

### TC-M06-01-03 — Trường hợp ngoại lệ (chênh lệch số lit / hóa đơn điều chỉnh phải giải trình)

- **Mã PRD:** M06-01-03
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** xe X đã ghi nhận 100 lit kỳ 07.
- **Các bước:**
  1. Tạo hóa đơn nhiên liệu cho xe X với 95 lit (thực tế hóa đơn thiếu 5 lit so với nhật ký đổ).
  2. Bấm Lưu → hệ thống chặn, yêu cầu "Lý do chênh lệch".
  3. Nhập lý do (ví dụ "hóa đơn điều chỉnh lần sau") → duyệt.
- **Kết quả mong đợi (Pass):**
  - Hệ thống hiển thị chênh lệch -5 lit và yêu cầu lý do **trước khi cho duyệt**.
  - Lý do lưu cùng công nợ; dấu vết nhật ký có đủ người duyệt, thời điểm, lý do.

### TC-M06-01-04 — Kiểm soát quyền thao tác

- **Mã PRD:** M06-01-04
- **Vai trò thử:** `giamdoc`, `laixe`, `customer`
- **Các bước:**
  1. Đăng nhập `giamdoc` → chỉ có nút "Xem", không có "Tạo/Sửa/Thanh toán".
  2. Đăng nhập `laixe` → truy cập trực tiếp `/payables` → redirect "Không có quyền".
  3. Đăng nhập `customer` → truy cập `/payables/:id` → 403.
- **Kết quả mong đợi (Pass):**
  - `giamdoc` xem được nhưng không thao tác ghi nhận/thanh toán.
  - `laixe`/`customer` bị chặn ở cả URL và API (kiểm tra DevTools 403).
  - Nhật ký ghi rõ thao tác thất bại.

### TC-M06-01-05 — Gửi lại/đồng thời + biên: 1 hóa đơn nhiều xe; thanh toán một phần; hóa đơn đến sau kỳ

- **Mã PRD:** M06-01-05
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** xe A 60 lit, xe B 40 lit kỳ 07; kỳ 07 đang mở.
- **Các bước:**
  1. DevTools Network = "Slow 3G". Tạo hóa đơn HD-002 cho 2 xe (100 lit, 2.000.000đ) → bấm Lưu **2 lần liên tiếp**.
  2. Kiểm tra phân bổ theo lit thực tế: xe A 1.200.000đ, xe B 800.000đ (không chia đều).
  3. Thanh toán một phần 1.000.000đ cho HD-002 → còn nợ 1.000.000đ.
  4. Nhập hóa đơn HD-003 kỳ 07 sau khi đã tạm chốt → giữ "chưa phân bổ", yêu cầu giải trình.
- **Kết quả mong đợi (Pass):**
  - Chỉ tạo **1 công nợ** cho HD-002 dù bấm Lưu 2 lần (cùng id giao dịch).
  - Phân bổ đúng theo số lit, không chia đều.
  - Hóa đơn đến sau kỳ không bị âm thầm bỏ qua, có trạng thái rõ ràng + dấu vết.
- **Phụ thuộc:** Q06

---

## 6.2 — Mở rộng công nợ cho hãng tàu, nhà xe, cảng, kho và dịch vụ

**Quy tắc (PRD M06-6.2):** Mỗi khoản phải trả liên kết **đúng nhà cung cấp và chứng từ nguồn**; danh mục
nhà cung cấp không bị trùng. Sổ công nợ hiển thị phát sinh theo **loại dịch vụ**, chứng từ và trạng thái.
Nhà cung cấp chưa có hồ sơ phải được tạo và kiểm tra trước; khoản không có hóa đơn cần **căn cứ thay thế**.

### TC-M06-02-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M06-02-01
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** nhà cung cấp "Cảng Hải Phòng" đã có hồ sơ; nhóm dịch vụ "Cảng".
- **Các bước:**
  1. Mở `/payables` → "Tạo công nợ dịch vụ".
  2. Chọn nhà cung cấp "Cảng Hải Phòng", nhóm dịch vụ "Cảng", hóa đơn cảng, lô L-100, số tiền 3.000.000đ, VAT 8%, hạn 20/08.
  3. Lưu → mở `/suppliers` và `/payables`.
- **Kết quả mong đợi (Pass):**
  - Công nợ liên kết đúng nhà cung cấp, lô L-100 và chứng từ hóa đơn cảng.
  - Sổ công nợ hiển thị dòng phát sinh theo loại dịch vụ "Cảng", có trạng thái "Chưa thanh toán".
  - Báo cáo theo loại dịch vụ + theo NCC đều tăng 3.240.000đ (đã VAT).
- **Phụ thuộc:** Q07
- **Bằng chứng:** ảnh `/payables` + ảnh báo cáo theo loại dịch vụ.

### TC-M06-02-02 — Thiếu hoặc sai dữ liệu

- **Mã PRD:** M06-02-02
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Form tạo công nợ dịch vụ, bỏ trống "nhà cung cấp" hoặc chọn nhà cung cấp không tồn tại → Lưu.
  2. Thử tạo nhà cung cấp trùng mã số thuế với NCC đã có.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo tiếng Việt chỉ rõ "phải chọn nhà cung cấp" hoặc "nhà cung cấp không tồn tại".
  - Khi tạo mới, hệ thống phát hiện trùng mã số thuế và chặn, không tạo bản ghi trùng.

### TC-M06-02-03 — Trường hợp ngoại lệ (NCC chưa có hồ sơ + khoản không có hóa đơn)

- **Mã PRD:** M06-02-03
- **Vai trò:** `ketoan` (lập), `admin` (duyệt danh mục)
- **Các bước:**
  1. Tạo công nợ cho NCC chưa có hồ sơ "Nhà xe Trường Thnh" → hệ thống yêu cầu tạo và kiểm tra hồ sơ trước.
  2. `admin` tạo hồ sơ `/config/suppliers` mới → xác minh mã số thuế không trùng → lưu.
  3. Quay lại tạo công nợ "Vận tải thuê ngoài" không có hóa đơn → bắt buộc đính kèm căn cứ thay thế (phiếu thu/ảnh hiện trường có geotag/xác nhận ký).
- **Kết quả mong đợi (Pass):**
  - Không cho ghi nhận công nợ khi NCC chưa có hồ sơ đã kiểm tra.
  - Khoản không hóa đơn chỉ lưu khi đủ căn cứ thay thế + lý do; nếu thiếu → trả về "cần bổ sung".
- **Phụ thuộc:** Q07

### TC-M06-02-04 — Kiểm soát quyền thao tác

- **Mã PRD:** M06-02-04
- **Vai trò thử:** `giamdoc`, `laixe`, `customer`
- **Các bước:**
  1. `giamdoc` mở `/payables` và `/suppliers` → chỉ xem, không có nút Tạo/Sửa/Xóa.
  2. `laixe` thử truy cập `/config/suppliers` → redirect "Không có quyền".
  3. `customer` thử tạo công nợ dịch vụ → API trả 403.
- **Kết quả mong đợi (Pass):**
  - `giamdoc` chỉ xem được.
  - `admin` mới được quản lý `/config/suppliers` (tạo/sửa/đổi nhóm chính).
  - Nhật ký ghi rõ thao tác thất bại của người không có quyền.

### TC-M06-02-05 — Gửi lại/đồng thời + biên: NCC cũng là khách hàng; 1 hóa đơn nhiều lô; đổi tên NCC

- **Mã PRD:** M06-02-05
- **Vai trò:** `ketoan`, `admin`
- **Các bước:**
  1. DevTools "Slow 3G". Tạo công nợ dịch vụ → bấm Lưu 2 lần → chỉ 1 bản ghi.
  2. Đối tác D vừa là khách hàng vừa là NCC (cùng mã số thuế): tạo công nợ AP cho D → sổ AP tách riêng khỏi AR, không gộp số dư.
  3. Tạo 1 hóa đơn nhiều lô (L-100, L-101) cho NCC "Cảng Hải Phòng" → mỗi dòng gắn đúng lô, tổng cộng khớp hóa đơn.
  4. `admin` đổi tên NCC "Petrolimex" → "Petrolimex HN" → kiểm tra các hóa đơn cũ vẫn giữ liên kết và dấu vết.
- **Kết quả mong đợi (Pass):**
  - Không tạo bản ghi/bút toán trùng khi gửi 2 lần.
  - AP/AR của đối tác kép được tách bạch rõ ràng theo vai trò.
  - Đổi tên NCC không làm mất liên kết các giao dịch cũ; có nhật ký đổi tên.
- **Phụ thuộc:** Q07, Q08

---

## 6.3 — Theo dõi hóa đơn, ngày đến hạn và thanh toán nhà cung cấp

**Quy tắc (PRD M06-6.3):** Thanh toán **giảm đúng công nợ**; cho phép trả một phần; **không ghi nhận
hai lần** cùng chứng từ chi. Hiển thị **tuổi nợ phải trả**, lịch sử chi và số còn phải trả theo hóa đơn.
Thanh toán trước hóa đơn hoặc trả thừa phải được ghi thành **khoản tạm ứng hoặc chưa phân bổ**.

### TC-M06-03-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M06-03-01
- **Vai trò:** `ketoan` (ghi nhận), người có thẩm quyền (duyệt chi)
- **Tiền điều kiện:** có hóa đơn nhà cung cấp HD-200, ngày nhận 01/08, ngày đến hạn 20/08, số tiền 5.000.000đ.
- **Các bước:**
  1. Mở `/payables/:id` cho HD-200.
  2. Bấm "Ghi nhận thanh toán": số tiền 5.000.000đ, chứng từ chi UNC-900, ngày chi 18/08.
  3. Người có thẩm quyền duyệt.
  4. Kiểm tra lại trang chi tiết và danh sách `/payables`.
- **Kết quả mong đợi (Pass):**
  - Công nợ HD-200 giảm đúng 5.000.000đ; còn phải trả = 0; trạng thái "Đã thanh toán".
  - Tuổi nợ hiển thị đúng (17 ngày từ nhận đến chi).
  - Lịch sử chi có 1 dòng UNC-900; chứng từ chỉ ghi một lần.
- **Bằng chứng:** ảnh `/payables/:id` sau thanh toán + ảnh lịch sử chi.

### TC-M06-03-02 — Thiếu hoặc sai dữ liệu

- **Mã PRD:** M06-03-02
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Form ghi nhận thanh toán: bỏ trống "chứng từ chi" hoặc nhập số tiền âm → Lưu.
  2. Nhập số tiền lớn hơn nhiều lần mức còn nợ mà không chọn "tạm ứng" → kiểm tra cảnh báo.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo tiếng Việt chỉ rõ trường bắt buộc/giá trị không hợp lệ.
  - Không ghi nhận bản ghi sai, dữ liệu đã nhập vẫn ở form.

### TC-M06-03-03 — Trường hợp ngoại lệ (trả trước / trả thừa → tạm ứng hoặc chưa phân bổ)

- **Mã PRD:** M06-03-03
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** HD-201 còn nợ 3.000.000đ.
- **Các bước:**
  1. Thanh toán 5.000.000đ cho HD-201 (vượt 2.000.000đ) → hệ thống tách 3.000.000đ giảm nợ và 2.000.000đ ghi "tạm ứng/chưa phân bổ" cho NCC.
  2. Tạo thanh toán trước khi có hóa đơn (chưa có công nợ) → hệ thống ghi "tạm ứng", đợi hóa đơn về để đối trừ.
- **Kết quả mong đợi (Pass):**
  - Công nợ HD-201 giảm đúng 3.000.000đ; 2.000.000đ còn lại ở trạng thái "chưa phân bổ" của NCC, không âm.
  - Thanh toán trước → ghi nhận là tạm ứng; dấu vết chứng từ rõ ràng.

### TC-M06-03-04 — Kiểm soát quyền thao tác

- **Mã PRD:** M06-03-04
- **Vai trò thử:** `giamdoc`, `customer`, `laixe`
- **Các bước:**
  1. `giamdoc` mở `/payables/:id` → chỉ xem lịch sử chi, không có nút "Ghi nhận thanh toán".
  2. `customer` thử truy cập `/payables/:id` → redirect "Không có quyền" + API 403.
  3. `ketoan` lập thanh toán cho chính khoản mình đã lập hóa đơn → kiểm tra maker/checker (Q15): không tự duyệt.
- **Kết quả mong đợi (Pass):**
  - `giamdoc` chỉ xem; `customer`/`laixe` bị chặn URL + API.
  - `ketoan` không được tự duyệt khoản mình lập (maker-checker tách bạch).
  - Nhật ký ghi rõ thao tác thất bại.

### TC-M06-03-05 — Gửi lại/đồng thời + biên: đúng hạn; ngày nghỉ; 1 khoản chi nhiều hóa đơn

- **Mã PRD:** M06-03-05
- **Vai trò:** `ketoan`, người có thẩm quyền
- **Các bước:**
  1. DevTools "Slow 3G". Ghi nhận thanh toán chứng từ UNC-901 → bấm Lưu 2 lần liên tiếp → kiểm tra chỉ có 1 dòng chi.
  2. Thử ghi nhận lại **cùng chứng từ UNC-901** cho hóa đơn khác → hệ thống chặn trùng chứng từ chi.
  3. Hóa đơn đến hạn đúng ngày nghỉ (Chủ nhật 02/08/2026) → kiểm tra hiển thị ngày gốc 02/08 + ngày điều chỉnh 03/08/2026 (Thứ 2).
  4. 1 khoản chi UNC-902 = 8.000.000đ trả cho 2 hóa đơn HD-A (3tr) + HD-B (5tr) → phân bổ đúng từng hóa đơn.
- **Kết quả mong đợi (Pass):**
  - Không tạo chứng từ chi trùng khi gửi 2 lần hoặc dùng lại số chứng từ.
  - Hạn rơi cuối tuần hiển thị cả ngày gốc và ngày điều chỉnh; tính quá hạn theo ngày điều chỉnh.
  - 1 khoản chi nhiều hóa đơn: từng hóa đơn giảm đúng số tiền phân bổ; tổng khớp chứng từ.
- **Phụ thuộc:** Q19

---

## 6.4 — Đối trừ công nợ song phương

**Quy tắc (PRD M06-6.4):** Số đối trừ **không vượt số nhỏ hơn** giữa AR và AP; chỉ ghi sổ **sau khi phê
duyệt**. Tạo **hai bút toán liên kết** giảm đúng AR và AP, giữ nguyên dấu vết trước đối trừ. Yêu cầu bị từ
chối không làm đổi số dư; hủy sau phê duyệt phải dùng **bút toán hoàn tác**.

### TC-M06-04-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M06-04-01
- **Vai trò:** `ketoan` (lập), `giamdoc` (phê duyệt)
- **Tiền điều kiện:** đối tác D có AR 10.000.000đ và AP 7.000.000đ (cùng mã số thuế).
- **Các bước:**
  1. Mở `/payables/:id` của D → "Tạo yêu cầu đối trừ".
  2. Chọn số đối trừ 7.000.000đ (= min(AR, AP)), đính kèm biên bản đối trừ, ngày 05/08.
  3. `ketoan` lưu → trạng thái "Chờ duyệt".
  4. `giamdoc` phê duyệt.
- **Kết quả mong đợi (Pass):**
  - Sau duyệt: 2 bút toán liên kết được tạo — AR giảm 7.000.000đ, AP giảm 7.000.000đ.
  - Số dư mới: AR = 3.000.000đ, AP = 0.
  - Dấu vết trước đối trừ (10tr / 7tr) được lưu và xem được từ chi tiết.
  - Số đối trừ = 7.000.000đ ≤ min(10.000.000, 7.000.000) — thỏa mãn quy tắc.
- **Phụ thuộc:** Q08
- **Bằng chứng:** ảnh chi tiết 2 bút toán liên kết + ảnh biên bản đối trừ.

### TC-M06-04-02 — Thiếu hoặc sai dữ liệu

- **Mã PRD:** M06-04-02
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Form tạo yêu cầu đối trừ: bỏ trống "biên bản đối trừ" hoặc nhập số đối trừ = 0 → Lưu.
  2. Nhập số đối trừ 8.000.000đ (> AP 7.000.000đ).
- **Kết quả mong đợi (Pass):**
  - Trường thiếu → cảnh báo tiếng Việt chỉ rõ "phải có biên bản đối trừ".
  - Số đối trừ > min(AR, AP) → chặn với thông báo "số đối trừ vượt số nhỏ hơn giữa phải thu và phải trả".
  - Không tạo yêu cầu ở trạng thái không hợp lệ.

### TC-M06-04-03 — Trường hợp ngoại lệ (yêu cầu bị từ chối / hủy sau duyệt)

- **Mã PRD:** M06-04-03
- **Vai trò:** `ketoan`, `giamdoc`
- **Các bước:**
  1. `ketoan` tạo yêu cầu đối trừ 5.000.000đ → trạng thái "Chờ duyệt".
  2. `giamdoc` từ chối (có lý do) → kiểm tra số dư AR/AP **không đổi**.
  3. Tạo yêu cầu khác 4.000.000đ → `giamdoc` phê duyệt → AR/AP giảm đúng.
  4. Hủy yêu cầu **sau khi đã duyệt** → hệ thống tạo **bút toán hoàn tác**, AR/AP phục hồi về trước đối trừ.
- **Kết quả mong đợi (Pass):**
  - Yêu cầu bị từ chối: số dư không thay đổi, nhật ký có lý do từ chối.
  - Hủy sau duyệt: tạo bút toán hoàn tác liên kết, dấu vết trước đối trừ và trước hoàn tác đều còn.
- **Phụ thuộc:** Q08

### TC-M06-04-04 — Kiểm soát quyền thao tác

- **Mã PRD:** M06-04-04
- **Vai trò thử:** `ketoan`, `admin`, `giamdoc`
- **Các bước:**
  1. `ketoan` lập yêu cầu đối trừ → không được tự phê duyệt yêu cầu của mình (maker-checker).
  2. `admin` thử phê duyệt đối trừ → kiểm tra xem `admin` có quyền phê duyệt hay chỉ `giamdoc`.
  3. `ketoan` thử hủy yêu cầu đã duyệt → bị từ chối (chỉ người phê duyệt mới hủy được).
- **Kết quả mong đợi (Pass):**
  - Người tạo không tự duyệt (Q15); chỉ `giamdoc` (hoặc người được ủy quyền) phê duyệt.
  - Hủy sau duyệt yêu cầu đúng thẩm quyền; nhật ký phân biệt thao tác thất bại.
- **Phụ thuộc:** Q08, Q15

### TC-M06-04-05 — Gửi lại/đồng thời + biên: số dư đổi trong lúc chờ duyệt; đối trừ một phần; 2 yêu cầu đồng thời

- **Mã PRD:** M06-04-05
- **Vai trò:** `ketoan`, `giamdoc`
- **Tiền điều kiện:** D có AR 10.000.000đ, AP 7.000.000đ; 1 yêu cầu đối trừ 5.000.000đ đang chờ duyệt.
- **Các bước:**
  1. DevTools "Slow 3G". Tạo yêu cầu đối trừ → bấm Lưu 2 lần liên tiếp → chỉ 1 yêu cầu được tạo.
  2. Trong lúc yêu cầu 5.000.000đ chờ duyệt, tạo phát sinh mới làm AP giảm còn 6.000.000đ → thử phê duyệt yêu cầu 5tr (vẫn ≤ min(AR, AP)).
  3. Thử phê duyệt đồng thời 2 yêu cầu đối trừ (3tr + 5tr) trên cùng đối tác → hệ thống chỉ cho 1 thắng, yêu cầu kia bị từ chối nếu vượt min(AR, AP) tại thời điểm duyệt.
  4. Đối trừ một phần: duyệt 3.000.000đ của yêu cầu 5.000.000đ → AP giảm 3.000.000đ, còn lại 2.000.000đ giữ "chưa đối trừ".
- **Kết quả mong đợi (Pass):**
  - Không tạo yêu cầu/bút toán trùng khi gửi 2 lần.
  - Số đối trừ được kiểm tra lại **tại thời điểm duyệt** so với min(AR, AP); nếu vượt → chặn.
  - 2 yêu cầu đồng thời: first-approve-wins, yêu cầu sau bị từ chối nếu vượt số dư còn lại.
  - Đối trừ một phần: chỉ phần được duyệt mới ghi sổ; phần còn lại giữ trạng thái rõ ràng.
- **Phụ thuộc:** Q08, Q23

---

## Bảng nghiệm thu M06

| Ngày thử | Mã TC        | Người thử | Kết quả | Ghi chú | Bằng chứng |
| -------- | ------------ | --------- | ------- | ------- | ---------- |
| __/__/__ | TC-M06-01-01 |           |         |         |            |
| __/__/__ | TC-M06-01-02 |           |         |         |            |
| __/__/__ | TC-M06-01-03 |           |         |         |            |
| __/__/__ | TC-M06-01-04 |           |         |         |            |
| __/__/__ | TC-M06-01-05 |           |         |         |            |
| __/__/__ | TC-M06-02-01 |           |         |         |            |
| __/__/__ | TC-M06-02-02 |           |         |         |            |
| __/__/__ | TC-M06-02-03 |           |         |         |            |
| __/__/__ | TC-M06-02-04 |           |         |         |            |
| __/__/__ | TC-M06-02-05 |           |         |         |            |
| __/__/__ | TC-M06-03-01 |           |         |         |            |
| __/__/__ | TC-M06-03-02 |           |         |         |            |
| __/__/__ | TC-M06-03-03 |           |         |         |            |
| __/__/__ | TC-M06-03-04 |           |         |         |            |
| __/__/__ | TC-M06-03-05 |           |         |         |            |
| __/__/__ | TC-M06-04-01 |           |         |         |            |
| __/__/__ | TC-M06-04-02 |           |         |         |            |
| __/__/__ | TC-M06-04-03 |           |         |         |            |
| __/__/__ | TC-M06-04-04 |           |         |         |            |
| __/__/__ | TC-M06-04-05 |           |         |         |            |

### Tiêu chí toàn phân hệ M06-HT-01 … M06-HT-10

Chạy TC-HT-01 … TC-HT-10 từ `00-cross-cutting.md` trên màn hình của M06 (`/payables`, `/payables/:id`,
`/suppliers`, `/config/suppliers`). Lưu ý thử trọng tâm:

- **HT-01 (Ngôn ngữ):** nhãn, cảnh báo trên form AP và đối trừ song phương.
- **HT-02 (Phân quyền URL):** `giamdoc` chỉ xem; `ketoan` không vào `/config/suppliers` (chỉ `admin`); `customer`/`laixe` chặn `/payables`.
- **HT-03 (Nhật ký):** mọi phê duyệt đối trừ, hủy sau duyệt, đổi tên NCC đều có dấu vết.
- **HT-04 (Double-submit):** áp cho "Tạo công nợ" và "Ghi nhận thanh toán" (đã bao gồm trong TC-…-05).
- **HT-05 (Tiền tệ):** tổng AP > 1 tỷ VNĐ, định dạng không số lẻ, khớp tệp xuất.
- **HT-06 (Ngày giờ):** hạn điều chỉnh cuối tuần hiển thị cả ngày gốc và ngày làm việc tiếp theo.
- **HT-07 (Responsive):** `/payables` bảng dài có thanh cuộn ngang trên mobile.
- **HT-08 (Khôi phục lỗi):** form tạo công nợ giữ dữ liệu khi mất mạng.
- **HT-09 (Tìm & xuất):** xuất Excel `/payables` kỳ, đủ cột, tổng = tổng màn.
- **HT-10 (Đối chiếu liên phân hệ):** tổng AP kỳ khớp báo cáo chi tiết `/finance`; đối trừ song phương khớp giữa AR và AP.

| Mã HT      | Kết quả | Bằng chứng |
| ---------  | ------- | ---------- |
| M06-HT-01  |         |            |
| M06-HT-02  |         |            |
| M06-HT-03  |         |            |
| M06-HT-04  |         |            |
| M06-HT-05  |         |            |
| M06-HT-06  |         |            |
| M06-HT-07  |         |            |
| M06-HT-08  |         |            |
| M06-HT-09  |         |            |
| M06-HT-10  |         |            |
