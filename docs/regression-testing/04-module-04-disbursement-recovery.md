# M04 — Quy trình chi hộ — thu hộ khép kín

> **Phân hệ 4** — 7 nhóm chức năng (4.1–4.7). Nguồn PRD: `docs/prd/Module4.docx`.
> **Tiêu chí nghiệm thu toàn phân hệ:** `M04-HT-01` … `M04-HT-10` (xem `00-cross-cutting.md`).
>
> **Màn hình chính:** `/shipments/:id` (chi tiết lô, nhập chi phí), `/expenses` (danh sách khoản chi),
> `/expenses/new` (tạo khoản chi), `/expenses/:id/edit` (sửa khoản chi), `/customers/:id/billing/new`
> (sinh giấy báo nợ), `/advances?view=settlements` (duyệt hoàn ứng; legacy `/admin/advance-settlements`
> vẫn chuyển hướng đến đây). Vai trò thử chính: `admin`,
> `ketoan` (duyệt), `giaonhan` (nhập chi phí hiện trường), `clerk` (khởi tạo lô). Xem thêm đề xuất
> nghiệp vụ Q12, Q13, Q14, Q21, Q22 trong `00-cross-cutting.md`.

---

## 4.1 — CUS hoặc nhân viên chứng từ khởi tạo lô hàng

**Quy tắc nghiệp vụ (PRD M04-4.1):** Lô phải có **mã duy nhất** và đủ dữ liệu tối thiểu trước khi nhân
viên hiện trường ghi chi phí. Bắt buộc: khách hàng, vận đơn, công-te-nơ, tờ khai, ngày giao, địa điểm.
Cho phép lưu nháp khi thiếu, nhưng **không cho chuyển bước** nghiệp vụ tiếp theo.

### TC-M04-01-01 — Luồng nghiệp vụ thông thường (tạo lô đủ dữ liệu tối thiểu)

- **Mã PRD:** M04-01-01
- **Vai trò:** `clerk`
- **Tiền điều kiện:** đã có khách hàng A, danh mục cảng/địa điểm, mã lô chưa trùng.
- **Các bước:**
  1. Mở `/shipments/new` (form khởi tạo lô).
  2. Nhập: khách A, vận đơn `BL-2026-0001`, công-te-nơ `MSCU1234567`, tờ khai `TC-55912`, ngày giao
     05/08/2026, địa điểm nhận "Cảng Hải Phòng", địa điểm giao "Kho Long Biên".
  3. Bấm "Lưu & phát hành lô".
- **Kết quả mong đợi (Pass):**
  - Lô sinh mã duy nhất (ví dụ `SHP-2026-0007`), hiển thị trên `/shipments/:id`.
  - Trạng thái lô = "Sẵn sàng ghi chi phí", nút "Nhập chi phí" mở.
  - Lịch sử lô ghi: người tạo `clerk`, thời điểm.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh trang `/shipments/:id` sau lưu + ảnh mục lịch sử.

### TC-M04-01-02 — Thiếu hoặc sai dữ liệu (thiếu trường bắt buộc, trùng mã lô)

- **Mã PRD:** M04-01-02
- **Vai trò:** `clerk`
- **Các bước:**
  1. Mở `/shipments/new`. Bỏ trống lần lượt: khách hàng, số vận đơn, công-te-nơ, tờ khai, ngày giao,
     địa điểm.
  2. Bấm "Lưu & phát hành lô".
  3. Nhập lại đầy đủ nhưng dùng mã lô đã tồn tại.
- **Kết quả mong đợi (Pass):**
  - Mỗi trường bắt buộc thiếu → cảnh báo tiếng Việt, chỉ rõ tên trường (ví dụ "Vận đơn là bắt buộc").
  - Không tạo lô mới ở bước 2.
  - Mã trùng → cảnh báo "Mã lô đã tồn tại", không ghi đè lô cũ.
  - Cho phép bấm "Lưu nháp" khi thiếu dữ liệu; lô nháp không xuất hiện trong danh sách ghi chi phí của
    `giaonhan`.

### TC-M04-01-03 — Trường hợp ngoại lệ (lô nháp không được dùng để ghi chi phí / chuyển bước)

- **Mã PRD:** M04-01-03
- **Vai trò:** `clerk`, `giaonhan`
- **Tiền điều kiện:** có 1 lô đang ở trạng thái "Nháp" (thiếu ngày giao).
- **Các bước:**
  1. `clerk` mở `/shipments/:id` của lô nháp → kiểm tra nút "Nhập chi phí".
  2. `giaonhan` mở danh sách lô cần ghi chi phí → kiểm tra lô nháp có xuất hiện.
  3. `clerk` bổ sung đủ trường → bấm "Phát hành lô".
- **Kết quả mong đợi (Pass):**
  - Lô nháp: nút "Nhập chi phí" vô hiệu, có tooltip "Cần phát hành lô trước".
  - Lô nháp không nằm trong danh sách ghi chi phí của `giaonhan`.
  - Sau khi phát hành → nút "Nhập chi phí" mở, lô xuất hiện với `giaonhan`.

### TC-M04-01-04 — Kiểm soát quyền thao tác

- **Mã PRD:** M04-01-04
- **Vai trò thử:** `giaonhan`, `ketoan`, `laixe`, `customer`
- **Các bước:**
  1. `giaonhan` mở `/shipments/new` → thử tạo lô.
  2. `ketoan` mở `/shipments/new` → thử tạo lô.
  3. `laixe` và `customer` mở trực tiếp URL `/shipments/new`.
- **Kết quả mong đợi (Pass):**
  - `giaonhan`/`ketoan`: tùy cấu hình — hoặc bị từ chối, hoặc chỉ tạo nháp không được phát hành; nhật ký
    ghi nhận thao tác.
  - `laixe`, `customer`: bị redirect, không thấy form tạo lô.
  - Không để lộ dữ liệu khách hàng khác trong response body.

### TC-M04-01-05 — Gửi lại/đồng thời + biên: trùng mã khi 2 người cùng tạo; đổi khách/container sau phát hành

- **Mã PRD:** M04-01-05
- **Vai trò:** 2 tài khoản `clerk` (C1, C2)
- **Các bước:**
  1. C1 và C2 cùng bấm "Lưu & phát hành" với cùng mã lô thủ công gần như cùng lúc.
  2. C1 phát hành lô SHP-001 với khách A → sau đó `clerk` đổi khách thành B.
  3. C1 phát hành lô có 2 công-te-nơ; xóa 1 cont rồi thêm cont khác.
- **Kết quả mong đợi (Pass):**
  - Trùng mã đồng thời: 1 người thắng, 1 nhận "Mã lô đã tồn tại" (TC-HT-04 / Q23).
  - Đổi khách/container sau phát hành → bắt buộc tạo phiên bản mới + thông báo cho điều vận/kế toán
    (Q17/Q18), lưu giá trị trước/sau.
  - Mọi lần thử xung đột được ghi nhật ký.

---

## 4.2 — Nhân viên hiện trường ghi chi phí ở trạng thái chờ

**Quy tắc nghiệp vụ (PRD M04-4.2):** Khoản chi mới **luôn ở trạng thái "Chờ"**; người nhập chỉ được
sửa khoản của mình khi chưa gửi duyệt. Bắt buộc: mã lô, công-te-nơ, hạng mục, số tiền, hình thức chi,
ngày, ảnh chứng từ. Thiếu chứng từ bắt buộc hoặc số tiền không hợp lệ → **không gửi duyệt** được.

### TC-M04-02-01 — Luồng nghiệp vụ thông thường (ghi khoản chi chờ)

- **Mã PRD:** M04-02-01
- **Vai trò:** `giaonhan`
- **Tiền điều kiện:** lô `SHP-001` đã phát hành, có công-te-nơ `MSCU1234567`.
- **Các bước:**
  1. Mở `/shipments/SHP-001` → bấm "Nhập chi phí" (hoặc mở `/expenses/new?shipment=SHP-001`).
  2. Nhập: hạng mục "Bốc xếp", công-te-nơ `MSCU1234567`, số tiền 500.000đ, hình thức chi "Tiền mặt",
     ngày 05/08/2026, ảnh chứng từ (biên nhận bốc xếp có geotag).
  3. Bấm "Lưu" → sau đó "Gửi duyệt".
- **Kết quả mong đợi (Pass):**
  - Khoản lưu ở trạng thái "Chờ", xuất hiện trên `/expenses` với mã định danh (ví dụ `EXP-2026-0123`).
  - Số tiền chỉ tính 1 lần vào "Tạm tính" của lô, chưa vào báo cáo đã chốt.
  - Lịch sử: ai tạo, khi nào, trạng thái "Chờ".
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh `/expenses` + ảnh chi tiết `EXP-2026-0123`.

### TC-M04-02-02 — Thiếu hoặc sai dữ liệu (thiếu ảnh, số tiền ≤ 0)

- **Mã PRD:** M04-02-02
- **Vai trò:** `giaonhan`
- **Các bước:**
  1. Mở `/expenses/new`. Nhập đủ trường nhưng **không đính kèm ảnh chứng từ**.
  2. Bấm "Gửi duyệt".
  3. Sửa lại: thêm ảnh, nhưng số tiền = 0đ, sau đó -100.000đ → bấm "Gửi duyệt".
- **Kết quả mong đợi (Pass):**
  - Thiếu ảnh → cảnh báo "Ảnh chứng từ là bắt buộc", **không gửi duyệt** được (chỉ lưu nháp).
  - Số tiền ≤ 0 → cảnh báo "Số tiền phải lớn hơn 0", không gửi duyệt.
  - Không để khoản không hợp lệ rơi vào hàng đợi duyệt của `ketoan`.

### TC-M04-02-03 — Trường hợp ngoại lệ (sửa khoản đã gửi duyệt, sửa khoản của người khác)

- **Mã PRD:** M04-02-03
- **Vai trò:** `giaonhan` (G1 tạo, G2 người khác)
- **Tiền điều kiện:** G1 đã gửi duyệt khoản `EXP-2026-0123`, G2 có khoản `EXP-2026-0124` ở trạng thái "Chờ".
- **Các bước:**
  1. G1 mở `/expenses/EXP-2026-0123/edit` → thử sửa số tiền.
  2. G1 mở `/expenses/EXP-2026-0124/edit` (khoản của G2) → thử sửa số tiền.
- **Kết quả mong đợi (Pass):**
  - G1 sửa khoản đã gửi duyệt của mình → trường tiền read-only hoặc nút sửa vô hiệu, có gợi ý "Thu hồi
    để sửa" (chỉ khi chưa được `ketoan` duyệt).
  - G1 sửa khoản của G2 → bị từ chối "Bạn chỉ sửa được khoản do bạn tạo".
  - Mọi lần thử ghi nhật ký.

### TC-M04-02-04 — Kiểm soát quyền thao tác

- **Mã PRD:** M04-02-04
- **Vai trò thử:** `laixe`, `customer`, `clerk`
- **Các bước:**
  1. `laixe` mở `/expenses/new`.
  2. `customer` mở `/expenses/new`.
  3. `clerk` mở `/expenses/new` → thử tạo khoản chi.
- **Kết quả mong đợi (Pass):**
  - `laixe`, `customer`: không vào được `/expenses/new` (redirect/403).
  - `clerk`: không có quyền ghi chi phí (chỉ khởi tạo hồ sơ lô); nếu cố tạo → bị từ chối.
  - Nhật ký ghi nhận các lần thử thất bại.

### TC-M04-02-05 — Gửi lại/đồng thời + biên: gửi duyệt 2 lần; 2 người cùng sửa khoản chờ; 1 chứng từ nhiều dòng

- **Mã PRD:** M04-02-05
- **Vai trò:** `giaonhan`
- **Các bước:**
  1. Mở `/expenses/new` ở 2 tab, bấm "Gửi duyệt" 2 lần gần như cùng lúc (mạng Slow 3G).
  2. G1 và G2 mở cùng `/expenses/EXP-2026-0125/edit` (khoản do G1 tạo, G1 mời G2 đã được chuyển nhượng
     quyền phụ) → cùng bấm lưu với số tiền khác nhau.
  3. Tạo 1 biên nhận chi trả cho 3 cont → nhập 3 khoản riêng, cùng link tới 1 ảnh chứng từ cha.
- **Kết quả mong đợi (Pass):**
  - Gửi duyệt 2 lần: chỉ 1 dòng vào hàng đợi, mã giao dịch trùng → trả kết quả cũ (TC-HT-04).
  - 2 người cùng lưu: người sau nhận 409 "phiên bản cũ, hãy tải lại" (Q23), không ghi đè.
  - 1 ảnh nhiều dòng: mỗi dòng giữ link riêng, không bị gộp hay mất vết.

---

## 4.3 — Gom chi phí của nhiều nhân viên về đúng một lô

**Quy tắc nghiệp vụ (PRD M04-4.3):** Tổng hợp theo lô nhưng **giữ từng dòng, từng người chi, từng chứng
from**; không gộp làm mất vết. Chi tiết lô hiển thị tổng theo hạng mục/công-te-nơ/người chi/trạng thái.
Nhập sai lô → **chuyển có kiểm soát kèm lịch sử** (không xóa im lặng).

### TC-M04-03-01 — Luồng nghiệp vụ thông thường (gom nhiều khoản về 1 lô)

- **Mã PRD:** M04-03-01
- **Vai trò:** `giaonhan` (G1, G2), `ketoan` (xem)
- **Tiền điều kiện:** lô `SHP-001` có 2 cont `MSCU1111111` và `MSCU2222222`.
- **Các bước:**
  1. G1 nhập 2 khoản cho cont 1: "Bốc xếp" 500.000đ, "Vé bãi" 300.000đ.
  2. G2 nhập 2 khoản cho cont 2: "Bốc xếp" 500.000đ, "Nâng hạ" 1.200.000đ.
  3. `ketoan` mở `/shipments/SHP-001` → xem bảng tổng hợp chi phí.
- **Kết quả mong đợi (Pass):**
  - Tổng theo hạng mục: Bốc xếp 1.000.000, Vé bãi 300.000, Nâng hạ 1.200.000.
  - Tổng theo cont: cont 1 = 800.000, cont 2 = 1.700.000.
  - Tổng theo người chi: G1 = 800.000, G2 = 1.700.000.
  - Tổng theo trạng thái: 4 khoản "Chờ" = 2.500.000đ.
  - Mỗi dòng vẫn xem được riêng, có link tới ảnh chứng từ.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh bảng tổng hợp chi phí trên `/shipments/SHP-001`.

### TC-M04-03-02 — Thiếu hoặc sai dữ liệu (khoản mồ côi không thuộc lô nào)

- **Mã PRD:** M04-03-02
- **Vai trò:** `giaonhan`
- **Các bước:**
  1. Mở `/expenses/new`. Bỏ trống trường "Lô" (hoặc nhập mã không tồn tại).
  2. Bấm "Lưu".
- **Kết quả mong đợi (Pass):**
  - Cảnh báo "Lô là bắt buộc" (hoặc "Mã lô không tồn tại"), không cho lưu.
  - Không tạo khoản mồ côi làm sai tổng lô khác.

### TC-M04-03-03 — Trường hợp ngoại lệ (chuyển khoản nhập sai lô có kiểm soát)

- **Mã PRD:** M04-03-03
- **Vai trò:** `giaonhan`, `ketoan`
- **Tiền điều kiện:** G1 đã nhập khoản `EXP-2026-0130` 500.000đ nhầm vào lô `SHP-001` (đúng ra là `SHP-002`).
- **Các bước:**
  1. G1 mở `/expenses/EXP-2026-0130/edit` → bấm "Chuyển sang lô khác" → chọn `SHP-002` → nhập lý do.
  2. Mở `/shipments/SHP-001` và `/shipments/SHP-002` → kiểm tra lại tổng.
  3. `ketoan` mở lịch sử khoản `EXP-2026-0130`.
- **Kết quả mong đợi (Pass):**
  - Khoản chuyển sang `SHP-002`, tổng 2 lô tính lại đúng.
  - Lịch sử khoản lưu: lô cũ `SHP-001` → lô mới `SHP-002`, người chuyển, lý do, thời điểm.
  - Không có bản ghi "biến mất" khỏi cả 2 lô (giữ vết đầy đủ).

### TC-M04-03-04 — Kiểm soát quyền thao tác

- **Mã PRD:** M04-03-04
- **Vai trò thử:** `laixe`, `customer`, `clerk`
- **Các bước:**
  1. `laixe` mở `/shipments/SHP-001` → kiểm tra thấy bảng tổng hợp chi phí không.
  2. `customer` mở lô tương ứng từ Bill/Book trên `/portal/shipments` → kiểm tra thấy tổng chi phí đã duyệt; URL dùng id kỹ thuật nhưng UI không hiển thị mã nội bộ `SHP-*`.
  3. `clerk` mở `/shipments/SHP-001` → thử sửa một dòng chi phí.
- **Kết quả mong đợi (Pass):**
  - `laixe`: không thấy bảng chi phí (hoặc không vào được trang).
  - `customer`: chỉ thấy **tổng các khoản đã duyệt** (không thấy chi tiết người chi, ảnh nội bộ).
  - `clerk`: xem được nhưng không sửa được dòng chi phí.

### TC-M04-03-05 — Gửi lại/đồng thời + biên: 2 người cùng chuyển khoản; cộng dồn sau khi chuyển

- **Mã PRD:** M04-03-05
- **Vai trò:** `giaonhan`, `ketoan`
- **Các bước:**
  1. G1 và G2 cùng bấm "Chuyển lô" cho cùng khoản `EXP-2026-0130` (G1 → SHP-002, G2 → SHP-003) gần cùng
     lúc.
  2. Sau khi chuyển xong, G1 thêm 1 khoản mới vào `SHP-001` → kiểm tra tổng.
- **Kết quả mong đợi (Pass):**
  - 2 lệnh chuyển đồng thời: 1 thắng (theo timestamp), 1 nhận "khoản đã được chuyển bởi người khác"
    (Q23).
  - Tổng `SHP-001` = tổng cũ − 500.000 + khoản mới; không trùng lặp hay mất khoản.

---

## 4.4 — Kế toán đối chiếu chứng từ và duyệt khoản chi

**Quy tắc nghiệp vụ (PRD M04-4.4):** Duyệt/từ chối **theo dòng hoặc theo đợt**. Dòng đã duyệt → **khóa
không sửa trực tiếp**. Kế toán được sửa số tiền nhưng **phải nêu lý do**. Dòng bị từ chối → được sửa và
gửi lại kèm lịch sử.

### TC-M04-04-01 — Luồng nghiệp vụ thông thường (duyệt từng dòng và duyệt theo đợt)

- **Mã PRD:** M04-04-01
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** lô `SHP-001` có 4 khoản đang "Chờ" từ nhóm 4.3.
- **Các bước:**
  1. Mở `/expenses` → lọc theo lô `SHP-001`, trạng thái "Chờ".
  2. Mở `EXP-2026-0123` → đối chiếu ảnh chứng từ → bấm "Duyệt".
  3. Quay lại danh sách, chọn 3 khoản còn lại → bấm "Duyệt theo đợt" → nhập ghi chú chung.
- **Kết quả mong đợi (Pass):**
  - Sau bước 2: `EXP-2026-0123` → "Đã duyệt", số tiền khóa (read-only), lịch sử ghi người duyệt + thời điểm.
  - Sau bước 3: 3 khoản → "Đã duyệt" cùng lúc, cùng ghi chú; tổng chi phí đã duyệt của lô cập nhật.
  - Tổng đã duyệt lô = 2.500.000đ vào "Tạm tính đã duyệt" (vẫn chưa vào kỳ đã chốt).
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh `/expenses` sau duyệt + ảnh lịch sử 1 dòng.

### TC-M04-04-02 — Thiếu hoặc sai dữ liệu (từ chối thiếu lý do)

- **Mã PRD:** M04-04-02
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Mở `EXP-2026-0123` → bấm "Từ chối" mà không nhập lý do.
  2. Bấm "Từ chối" với lý do < 5 ký tự (nếu có quy tắc tối thiểu).
- **Kết quả mong đợi (Pass):**
  - Bước 1: cảnh báo "Lý do từ chối là bắt buộc", không từ chối.
  - Bước 2: cảnh báo độ dài lý do (nếu áp dụng).
  - Khoản vẫn ở "Chờ", không rơi vào trạng thái không rõ ràng.

### TC-M04-04-03 — Trường hợp ngoại lệ (kế toán sửa tiền khi duyệt, dòng bị từ chối được sửa+gửi lại)

- **Mã PRD:** M04-04-03
- **Vai trò:** `ketoan`, `giaonhan`
- **Các bước:**
  1. `ketoan` mở `EXP-2026-0124` → thấy số tiền khai 500.000 nhưng chứng từ chỉ 450.000.
  2. Bấm "Sửa trước khi duyệt" → đổi thành 450.000 → hệ thống yêu cầu "Lý do sửa tiền".
  3. Nhập lý do "Sai theo biên nhận" → bấm "Duyệt".
  4. `ketoan` từ chối `EXP-2026-0125` với lý do "Ảnh mờ" → `giaonhan` sửa ảnh, đổi số tiền, gửi lại.
- **Kết quả mong đợi (Pass):**
  - `EXP-2026-0124`: duyệt với 450.000, lịch sử lưu "tiền 500.000 → 450.000, lý do, người sửa".
  - `EXP-2026-0125`: trạng thái "Từ chối" → sau khi G sửa+gửi lại → "Chờ" với phiên bản mới, xem được
    cả bản bị từ chối và bản gửi lại.
  - Lịch sử từng dòng đầy đủ: ai, khi nào, giá trị trước/sau.

### TC-M04-04-04 — Kiểm soát quyền thao tác (maker-checker, không tự duyệt)

- **Mã PRD:** M04-04-04
- **Vai trò thử:** `giaonhan` (tự duyệt khoản mình tạo), `clerk`, `laixe`
- **Các bước:**
  1. `giaonhan` tạo khoản `EXP-2026-0140` → mở lại khoản đó → thử bấm "Duyệt".
  2. `clerk` mở `/expenses` → tìm nút "Duyệt".
  3. `laixe` mở `/expenses` → tìm nút "Duyệt".
- **Kết quả mong đợi (Pass):**
  - `giaonhan` tự duyệt khoản mình tạo → **bị từ chối** (maker-checker, Q15), có thông báo rõ.
  - `clerk`, `laixe`: không thấy nút "Duyệt", không vào được workflow duyệt.
  - Mọi lần thử ghi nhật ký.

### TC-M04-04-05 — Gửi lại/đồng thời + biên: 2 người cùng duyệt 1 dòng; duyệt đợt có dòng lỗi

- **Mã PRD:** M04-04-05
- **Vai trò:** 2 tài khoản `ketoan` (K1, K2)
- **Các bước:**
  1. K1, K2 cùng bấm "Duyệt" `EXP-2026-0123` gần như cùng lúc.
  2. K1 chọn "Duyệt đợt" 3 dòng, trong đó 1 dòng `EXP-2026-0126` thiếu ảnh (bị lỗi dữ liệu) → bấm duyệt.
- **Kết quả mong đợi (Pass):**
  - Bước 1: 1 người thắng, 1 nhận "khoản đã được duyệt bởi người khác" (Q23); chỉ 1 bút toán duyệt.
  - Bước 2: 2 dòng hợp lệ được duyệt; dòng `EXP-2026-0126` bị bỏ qua + cảnh báo rõ "dòng lỗi, không duyệt
    được", giao dịch đợt vẫn thành công một phần với nhật ký rõ ràng.

---

## 4.5 — Sinh giấy báo nợ và chốt vào kỳ phù hợp

**Quy tắc nghiệp vụ (PRD M04-4.5):** Chỉ các khoản **đã duyệt** mới vào kỳ đúng; không đưa lại khoản đã
nằm trên giấy báo nợ khác. Khoản duyệt muộn sau khi kỳ đã phát hành → chuyển sang kỳ tiếp theo hoặc tạo
điều chỉnh theo quyết định khóa. Phụ thuộc Q21 (khóa kỳ), Q22 (nguồn chân lý).

### TC-M04-05-01 — Luồng nghiệp vụ thông thường (sinh giấy báo nợ từ khoản đã duyệt)

- **Mã PRD:** M04-05-01
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** khách A có các khoản chi hộ đã duyệt tháng 08/2026 tổng 10.000.000đ.
- **Các bước:**
  1. Mở `/customers/CUST-A/billing/new`.
  2. Chọn kỳ "Tháng 08/2026", loại "Chi hộ". Bấm "Gợi ý khoản".
  3. Kiểm tra danh sách khoản được đề xuất.
  4. Bấm "Lập giấy báo nợ" → xem trước PDF.
- **Kết quả mong đợi (Pass):**
  - Chỉ các khoản **đã duyệt** trong kỳ xuất hiện; khoản "Chờ"/"Từ chối" không có.
  - Tổng giấy báo nợ = 10.000.000đ, phân tách theo hạng mục.
  - PDF có đủ: khách, kỳ, danh sách khoản, tổng, hạn thanh toán (đã điều chỉnh cuối tuần/lễ — Q19).
- **Phụ thuộc:** Q21, Q22.
- **Bằng chứng:** ảnh form lập + ảnh PDF xem trước.

### TC-M04-05-02 — Thiếu hoặc sai dữ liệu (trùng khoản đã có trên giấy báo nợ khác)

- **Mã PRD:** M04-05-02
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** khoản `EXP-2026-0200` đã nằm trên giấy báo nợ `DN-A-08-001`.
- **Các bước:**
  1. Mở `/customers/CUST-A/billing/new`, kỳ 08/2026 → bấm "Gợi ý khoản".
  2. Tìm `EXP-2026-0200` trong danh sách đề xuất.
  3. Thử thêm tay `EXP-2026-0200` vào giấy báo nợ mới.
- **Kết quả mong đợi (Pass):**
  - `EXP-2026-0200` **không** có trong danh sách đề xuất (đã được dùng).
  - Thêm tay → cảnh báo "Khoản đã thuộc giấy báo nợ DN-A-08-001", không cho thêm.

### TC-M04-05-03 — Trường hợp ngoại lệ (khoản duyệt muộn sau khi kỳ đã phát hành)

- **Mã PRD:** M04-05-03
- **Vai trò:** `ketoan`, `giamdoc`
- **Tiền điều kiện:** kỳ giấy báo nợ tháng 08 của khách A **đã phát hành**; sau đó `EXP-2026-0210` (1.500.000đ)
  mới được duyệt cho kỳ 08.
- **Các bước:**
  1. `ketoan` mở `/customers/CUST-A/billing/new` kỳ 08 → bấm "Gợi ý khoản".
  2. Chọn quyết định: "Chuyển sang kỳ 09" HOẶC "Tạo điều chỉnh kỳ 08".
  3. Nếu chọn "Tạo điều chỉnh kỳ 08" → hệ thống yêu cầu phê duyệt mở khóa (Q21).
  4. `giamdoc` phê duyệt (nếu áp dụng) → kiểm tra kỳ 08 không bị ghi đè.
- **Kết quả mong đợi (Pass):**
  - Kỳ 08 đã phát hành: **không sửa trực tiếp**.
  - "Chuyển sang kỳ 09" → `EXP-2026-0210` vào danh sách đề xuất kỳ 09, có link tới kỳ gốc 08.
  - "Tạo điều chỉnh kỳ 08" → tạo dòng điều chỉnh liên kết kỳ gốc, lưu người duyệt, lý do; kỳ 08 gốc
    không đổi (Q22).

### TC-M04-05-04 — Kiểm soát quyền thao tác

- **Mã PRD:** M04-05-04
- **Vai trò thử:** `giaonhan`, `clerk`, `customer`
- **Các bước:**
  1. `giaonhan` mở `/customers/CUST-A/billing/new`.
  2. `clerk` mở `/customers/CUST-A/billing/new`.
  3. `customer` (chủ CUST-A) mở `/portal/customers/CUST-A/billing/new`.
- **Kết quả mong đợi (Pass):**
  - `giaonhan`, `clerk`: không vào được trang lập giấy báo nợ (redirect/403).
  - `customer`: chỉ xem giấy báo nợ đã phát hành của mình, không có quyền lập mới.
  - Nhật ký ghi nhận các lần thử.

### TC-M04-05-05 — Gửi lại/đồng thời + biên: lập 2 giấy báo nợ cùng khách/cùng kỳ; khách theo tuần

- **Mã PRD:** M04-05-05
- **Vai trò:** `ketoan` (K1, K2)
- **Các bước:**
  1. K1, K2 cùng bấm "Lập giấy báo nợ" cho CUST-A, kỳ 08 (cùng khoản đề xuất) gần như cùng lúc.
  2. Khách B có hợp đồng thanh toán theo tuần → lập giấy báo nợ → kiểm tra chu kỳ khóa.
  3. Khách C không có khoản chi hộ trong kỳ → bấm "Gợi ý khoản".
- **Kết quả mong đợi (Pass):**
  - Bước 1: 1 người thắng, 1 nhận "khoản đã được đưa vào giấy báo nợ khác" (Q23); không trùng lặp.
  - Bước 2: khách B khóa theo **tuần** (Q21), kỳ đề xuất đúng theo chu kỳ hợp đồng.
  - Bước 3: danh sách rỗng + thông báo "Không có khoản đã duyệt trong kỳ", không lập giấy báo nợ rỗng.

---

## 4.6 — Phân loại khoản chi hộ có hóa đơn

**Quy tắc nghiệp vụ (PRD M04-4.6):** Hạng mục yêu cầu hóa đơn → phải có đủ thông tin **trước khi duyệt**;
không đoán thuế khi thiếu bằng chứng. Bắt buộc: hạng mục, số hóa đơn, ngày hóa đơn, đơn vị phát hành,
tiền trước thuế, thuế, ảnh. Điều chỉnh/thay thế/đa dòng phải liên kết rõ tránh đếm trùng.

### TC-M04-06-01 — Luồng nghiệp vụ thông thường (khoản có hóa đơn đủ thông tin)

- **Mã PRD:** M04-06-01
- **Vai trò:** `giaonhan`, `ketoan`
- **Tiền điều kiện:** hạng mục "Nâng hạ" được cấu hình là "Có hóa đơn".
- **Các bước:**
  1. `giaonhan` mở `/expenses/new` → chọn hạng mục "Nâng hạ" → hệ thống bật nhóm trường "Thông tin hóa đơn".
  2. Nhập: số hóa đơn `HD-001234`, ngày 05/08/2026, đơn vị phát hành "Cảng Hải Phòng", tiền trước thuế
     1.000.000đ, thuế VAT 8% = 80.000đ, ảnh hóa đơn.
  3. Lưu + gửi duyệt → `ketoan` mở để duyệt.
- **Kết quả mong đợi (Pass):**
  - Tổng tiền = tiền trước thuế + thuế = 1.080.000đ, hệ thống tự tính và hiển thị công thức.
  - Thuế suất chọn từ danh mục (không tự nhập tay trừ trường hợp đặc biệt có lý do).
  - Khoản lưu "Chờ", `ketoan` thấy đủ thông tin để đối chiếu và duyệt.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh form + ảnh chi tiết khoản.

### TC-M04-06-02 — Thiếu hoặc sai dữ liệu (thiếu trường hóa đơn, sai số tiền trước thuế + thuế)

- **Mã PRD:** M04-06-02
- **Vai trò:** `giaonhan`
- **Các bước:**
  1. Chọn hạng mục "Nâng hạ" → bỏ trống "Số hóa đơn" và "Đơn vị phát hành" → bấm "Gửi duyệt".
  2. Nhập tiền trước thuế 1.000.000, thuế 50.000 (không khớp 8%) → bấm "Gửi duyệt".
- **Kết quả mong đợi (Pass):**
  - Bước 1: cảnh báo "Số hóa đơn là bắt buộc", "Đơn vị phát hành là bắt buộc"; không gửi duyệt.
  - Bước 2: cảnh báo "Thuế không khớp tỷ lệ VAT (8% × 1.000.000 = 80.000)"; yêu cầu xác nhận lý do
    ngoại lệ hoặc sửa lại.

### TC-M04-06-03 — Trường hợp ngoại lệ (thay thế hóa đơn, điều chỉnh, đa dòng — tránh đếm trùng)

- **Mã PRD:** M04-06-03
- **Vai trò:** `giaonhan`, `ketoan`
- **Các bước:**
  1. `ketoan` yêu cầu thay thế: hóa đơn sai số → `giaonhan` tải hóa đơn mới cùng số → bấm "Thay thế
     hóa đơn" trên `EXP-2026-0301`, nhập lý do.
  2. Hóa đơn điều chỉnh (số âm -100.000đ) cho hóa đơn gốc `HD-001234` → `giaonhan` tạo khoản mới link
     tới gốc.
  3. 1 hóa đơn 3 dòng cho 3 cont → nhập 3 khoản riêng, cùng số hóa đơn.
- **Kết quả mong đợi (Pass):**
  - Thay thế: lịch sử lưu cả 2 phiên bản ảnh, lý do; không mất bản gốc.
  - Điều chỉnh âm: link tới hóa đơn gốc, tổng kỳ giảm đúng mà không "xóa im lặng".
  - Đa dòng: 3 khoản cùng số hóa đơn được cảnh báo "cùng số hóa đơn" nhưng cho phép khi mỗi dòng link
    tới 1 cont khác; không đếm trùng vào tổng lô.

### TC-M04-06-04 — Kiểm soát quyền thao tác

- **Mã PRD:** M04-06-04
- **Vai trò thử:** `laixe`, `customer`
- **Các bước:**
  1. `laixe` mở `/expenses/new` với hạng mục "Nâng hạ".
  2. `customer` mở `/portal/expenses/new` (nếu có route).
- **Kết quả mong đợi (Pass):**
  - Cả 2 không vào được form nhập chi hộ; route bị từ chối.
  - Không để lộ thông tin hóa đơn nội bộ cho khách.

### TC-M04-06-05 — Gửi lại/đồng thời + biên: cùng số hóa đơn 2 lô; thuế suất ngoại lệ 0%/5%/10%

- **Mã PRD:** M04-06-05
- **Vai trò:** `giaonhan`
- **Các bước:**
  1. Tạo 2 khoản dùng cùng số hóa đơn `HD-001234` cho 2 lô khác nhau → hệ thống cảnh báo nhưng cho phép
    kèm lý do.
  2. Tạo khoản hạng mục "Nâng hạ" với thuế suất 0% (hàng miễn thuế), 5%, 10% → kiểm tra chấp nhận có lý do.
- **Kết quả mong đợi (Pass):**
  - Cùng số hóa đơn 2 lô: cảnh báo rõ, yêu cầu lý do "chia hóa đơn"; không chặn cứng nếu đúng nghiệp vụ.
  - Thuế suất khác 8%: cho phép chọn từ danh mục với lý do; hệ thống không "đoán" thuế khi thiếu.

---

## 4.7 — Phân loại khoản chi hộ không có hóa đơn

**Quy tắc nghiệp vụ (PRD M04-4.7):** Chỉ áp dụng cho **hạng mục được phép** (đề xuất Q12: bốc xếp/lao
động thời vụ, vé bãi/đò/phí nhỏ, xử lý khẩn cấp, vật tư nhỏ). Bắt buộc: lý do + căn cứ thay thế theo chính
sách nội bộ. Ngưỡng (Q13): 1.000.000đ/khoản, 5.000.000đ/người/ngày, chống chia nhỏ (cộng gộp). Duyệt
(Q14): thiếu bằng chứng → **trả về** (không duyệt); vượt ngưỡng phân cấp (Trưởng phòng ≤5M; Giám đốc
>5M hoặc >10M/ngày). Phụ thuộc Q12, Q13, Q14.

### TC-M04-07-01 — Luồng nghiệp vụ thông thường (khoản chi hộ không hóa đơn, đủ căn cứ)

- **Mã PRD:** M04-07-01
- **Vai trò:** `giaonhan`
- **Tiền điều kiện:** hạng mục "Bốc xếp" được cấu hình "Không hóa đơn", thuộc danh sách Q12.
- **Các bước:**
  1. Mở `/expenses/new` → chọn hạng mục "Bốc xếp" → hệ thống bật nhóm "Căn cứ thay thế" (không yêu cầu
     hóa đơn).
  2. Nhập: số tiền 500.000đ, ngày 05/08/2026, người nhận "Anh A (bốc vác)", lý do "Bốc xếp cont MSCU…",
     đính kèm ảnh hiện trường có geotag + biên nhận tay.
  3. Lưu + gửi duyệt.
- **Kết quả mong đợi (Pass):**
  - Khoản lưu "Chờ" với đầy đủ: số tiền, ngày, người nhận, lô, lý do, ≥1 bằng chứng.
  - Hạng mục ngoài danh sách (ví dụ "Hối lộ") **không có** trong dropdown (Q12).
  - Không yêu cầu số hóa đơn (vì là khoản không hóa đơn).
- **Phụ thuộc:** Q12, Q13, Q14.
- **Bằng chứng:** ảnh form + ảnh chi tiết khoản.

### TC-M04-07-02 — Thiếu hoặc sai dữ liệu (thiếu ảnh/geotag, hạng mục ngoài danh sách)

- **Mã PRD:** M04-07-02
- **Vai trò:** `giaonhan`
- **Các bước:**
  1. Chọn "Bốc xếp", nhập đủ số tiền/lý do nhưng **không đính kèm ảnh/geotag** → bấm "Gửi duyệt".
  2. Thử chọn hạng mục "Hối lộ" trong dropdown.
- **Kết quả mong đợi (Pass):**
  - Thiếu ảnh/geotag → cảnh báo "Bằng chứng hiện trường là bắt buộc"; **không gửi duyệt** được.
  - "Hối lộ" không có trong dropdown (Q12), không cho nhập tay.

### TC-M04-07-03 — Trường hợp ngoại lệ (thiếu căn cứ → trả về không duyệt; ngưỡng Q13 chống chia nhỏ)

- **Mã PRD:** M04-07-03
- **Vai trò:** `giaonhan`, `ketoan`
- **Tiền điều kiện:** không có.
- **Các bước:**
  1. `ketoan` duyệt khoản `EXP-2026-0401` nhưng thấy ảnh geotag lệch vị trí lô → bấm "Trả về bổ sung".
  2. `giaonhan` tạo 2 khoản "Vé bãi" cùng người, cùng ngày: 600.000 + 500.000 = 1.100.000đ → kiểm tra
     cảnh báo ngưỡng 1.000.000/khoản và 5.000.000/người/ngày (Q13).
  3. `giaonhan` cố "chia nhỏ" 1 khoản 4.500.000 thành 5 khoản × 900.000 cùng người/ngày → kiểm tra cảnh
     báo chống chia nhỏ (cộng gộp).
- **Kết quả mong đợi (Pass):**
  - Bước 1: khoản → "Trả về" (không duyệt), `giaonhan` nhận thông báo bổ sung; không vào "Đã duyệt".
  - Bước 2: cảnh báo "Tổng 1.100.000 vượt ngưỡng 1.000.000/khoản" nếu áp dụng theo quy tắc; cảnh báo tổng
    ngày khi > 5.000.000.
  - Bước 3: hệ thống cộng gộp cùng người/ngày/hạng → cảnh báo "Tổng ngày 4.500.000, có dấu hiệu chia
    nhỏ", yêu cầu phê duyệt cấp cao hơn.

### TC-M04-07-04 — Kiểm soát quyền thao tác (phân cấp duyệt Q14, maker-checker)

- **Mã PRD:** M04-07-04
- **Vai trò thử:** `giaonhan` (tự duyệt), `ketoan` (vượt thẩm quyền), `giamdoc`
- **Các bước:**
  1. `giaonhan` tạo khoản 4.000.000đ đủ ảnh → thử tự duyệt.
  2. `ketoan` (Trưởng phòng Tài chính/Kế toán) duyệt khoản 4.000.000đ (≤5M, trong thẩm quyền).
  3. Tạo khoản 6.000.000đ → `ketoan` thử duyệt.
  4. Tạo khoản đưa tổng ngày của 1 người lên 11.000.000đ → `ketoan` thử duyệt → cần `giamdoc`.
- **Kết quả mong đợi (Pass):**
  - Bước 1: `giaonhan` không tự duyệt được (maker-checker, Q14/Q15).
  - Bước 2: `ketoan` duyệt ≤5M thành công.
  - Bước 3: `ketoan` duyệt >5M → **bị từ chối**, yêu cầu `giamdoc`.
  - Bước 4: `ketoan` duyệt khi tổng ngày >10M → bị từ chối, chỉ `giamdoc` duyệt được; mọi lần thử ghi
    nhật ký.

### TC-M04-07-05 — Gửi lại/đồng thời + biên: duyệt đồng thời khoản >5M; biên đúng ngưỡng; gửi lại khoản bị trả về

- **Mã PRD:** M04-07-05
- **Vai trò:** `giamdoc`, `giaonhan`
- **Các bước:**
  1. 2 tab `giamdoc` cùng bấm "Duyệt" khoản 6.000.000đ gần như cùng lúc.
  2. Tạo khoản đúng 5.000.000đ → `ketoan` duyệt (biên ≤5M).
  3. Tạo khoản 5.000.001đ → kiểm tra thẩm quyền (vừa >5M).
  4. `giaonhan` sửa khoản `EXP-2026-0401` bị trả về (bổ sung ảnh geotag đúng) → gửi lại → `ketoan` duyệt.
- **Kết quả mong đợi (Pass):**
  - Bước 1: 1 `giamdoc` thắng, 1 nhận "khoản đã được duyệt" (Q23); chỉ 1 bút toán.
  - Bước 2: `ketoan` duyệt 5.000.000đ thành công (đúng ngưỡng ≤5M).
  - Bước 3: 5.000.001đ → vượt 5M → cần `giamdoc` (kiểm tra biên chính xác).
  - Bước 4: khoản gửi lại → "Chờ" phiên bản mới, lịch sử giữ bản bị trả về; sau khi `ketoan` duyệt →
    "Đã duyệt" với vết đầy đủ.

---

## Bảng nghiệm thu M04

| Ngày thử | Mã TC        | Người thử | Kết quả | Ghi chú | Bằng chứng |
| -------- | ------------ | --------- | ------- | ------- | ---------- |
| __/__/__ | TC-M04-01-01 |           |         |         |            |
| __/__/__ | TC-M04-01-02 |           |         |         |            |
| __/__/__ | TC-M04-01-03 |           |         |         |            |
| __/__/__ | TC-M04-01-04 |           |         |         |            |
| __/__/__ | TC-M04-01-05 |           |         |         |            |
| __/__/__ | TC-M04-02-01 |           |         |         |            |
| __/__/__ | TC-M04-02-02 |           |         |         |            |
| __/__/__ | TC-M04-02-03 |           |         |         |            |
| __/__/__ | TC-M04-02-04 |           |         |         |            |
| __/__/__ | TC-M04-02-05 |           |         |         |            |
| __/__/__ | TC-M04-03-01 |           |         |         |            |
| __/__/__ | TC-M04-03-02 |           |         |         |            |
| __/__/__ | TC-M04-03-03 |           |         |         |            |
| __/__/__ | TC-M04-03-04 |           |         |         |            |
| __/__/__ | TC-M04-03-05 |           |         |         |            |
| __/__/__ | TC-M04-04-01 |           |         |         |            |
| __/__/__ | TC-M04-04-02 |           |         |         |            |
| __/__/__ | TC-M04-04-03 |           |         |         |            |
| __/__/__ | TC-M04-04-04 |           |         |         |            |
| __/__/__ | TC-M04-04-05 |           |         |         |            |
| __/__/__ | TC-M04-05-01 |           |         |         |            |
| __/__/__ | TC-M04-05-02 |           |         |         |            |
| __/__/__ | TC-M04-05-03 |           |         |         |            |
| __/__/__ | TC-M04-05-04 |           |         |         |            |
| __/__/__ | TC-M04-05-05 |           |         |         |            |
| __/__/__ | TC-M04-06-01 |           |         |         |            |
| __/__/__ | TC-M04-06-02 |           |         |         |            |
| __/__/__ | TC-M04-06-03 |           |         |         |            |
| __/__/__ | TC-M04-06-04 |           |         |         |            |
| __/__/__ | TC-M04-06-05 |           |         |         |            |
| __/__/__ | TC-M04-07-01 |           |         |         |            |
| __/__/__ | TC-M04-07-02 |           |         |         |            |
| __/__/__ | TC-M04-07-03 |           |         |         |            |
| __/__/__ | TC-M04-07-04 |           |         |         |            |
| __/__/__ | TC-M04-07-05 |           |         |         |            |

### Tiêu chí toàn phân hệ M04-HT-01 … M04-HT-10

Chạy các TC-HT-01 … TC-HT-10 từ `00-cross-cutting.md` áp dụng trên các màn hình của M04
(`/shipments/:id`, `/expenses`, `/expenses/new`, `/expenses/:id/edit`, `/customers/:id/billing/new`,
`/advances?view=settlements`).

| Mã HT     | Kết quả | Bằng chứng |
| --------- | ------- | ---------- |
| M04-HT-01 |         |            |
| M04-HT-02 |         |            |
| M04-HT-03 |         |            |
| M04-HT-04 |         |            |
| M04-HT-05 |         |            |
| M04-HT-06 |         |            |
| M04-HT-07 |         |            |
| M04-HT-08 |         |            |
| M04-HT-09 |         |            |
| M04-HT-10 |         |            |
