# M09 — Ứng dụng trường (forwarder / giao nhận trên điện thoại)

> **Phân hệ 9** — 5 nhóm (9.1–9.5). Nguồn PRD: `docs/prd/Module9.docx`.
> **Tiêu chí toàn phân hệ:** `M09-HT-01` … `M09-HT-10` (xem `00-cross-cutting.md`).
>
> **Đây là ứng dụng di động cho nhân viên giao nhận (`Role.FORWARDER` / `giaonhan`) làm việc tại
> cảng/bãi.** Mọi ca kiểm thử mặc định chạy trên viewport **Mobile (iPhone SE 375×667)** trong DevTools
> để bắt lỗi nút che, bảng vỡ, form tràn — trừ khi ca đó nêu rõ dùng Desktop.
>
> **Màn hình chính (forwarder portal):**
> - `/my-forwarder-trips` — Chuyến đi (danh sách chuyến của forwarder)
> - `/my-forwarder-trips/:id` — Chi tiết chuyến + ghi khoản chi
> - `/my-advances` — Tạm ứng / khoản chi hộ
> - `/my-settlements` — Phiếu thanh toán (danh sách)
> - `/my-settlements/new` — Tạo phiếu thanh toán
> - `/my-settlements/:id` — Chi tiết / in (forwarder)
> - `/settlements/:id` — In (`officeStaffOnly`: `admin`/`manager`/`ketoan`)
>
> **Vai trò thử chính:** `giaonhan` (forwarder). Vai trò phụ đối chiếu: `ketoan`, `giamdoc`, `admin`.

---

## 9.1 — Thực hiện tạm ứng và khoản chi hộ trên điện thoại

**Quy tắc (PRD M09-9.1):** Yêu cầu tạm ứng và khoản chi hộ thực tế phải liên kết để hệ thống tính số
còn thiếu / số cần bù. Mỗi yêu cầu cần: người đề nghị, nhiệm vụ (chuyến), lô, số tiền, mục đích, ngày
cần, tài khoản nhận. Forwarder theo dõi trạng thái: đã đề nghị → đã nhận → đã chi → cần thanh toán. Không
tạo yêu cầu mới khi quá hạn theo chính sách (trừ ngoại lệ được duyệt).

### TC-M09-01-01 — Luồng nghiệp vụ thông thường (đề nghị → nhận → chi → đối chiếu)

- **Mã PRD:** M09-01-01
- **Vai trò:** `giaonhan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** có chuyến/lô ACTIVE phân cho forwarder này; có tài khoản nhận khai báo sẵn.
- **Các bước:**
  1. Mở `/my-advances` → bấm "Đề nghị tạm ứng".
  2. Nhập: người đề nghị (mặc định forwarder đang login), nhiệm vụ = chuyến C-1001, lô = LÔ-A, số tiền 3.000.000đ, mục đích "Chi hộ bốc xếp cảng", ngày cần 28/07/2026, tài khoản nhận.
  3. Lưu → kiểm tra trạng thái hiển thị "Chờ".
  4. (Đổi vai `ketoan`) duyệt + đánh dấu đã nhận 3.000.000đ.
  5. (Về `giaonhan`) ghi khoản chi hộ 2.500.000đ liên kết yêu cầu trên → mở lại yêu cầu.
- **Kết quả mong đợi (Pass):**
  - Trạng thái cập nhật: Chờ → Đã nhận → Đã chi → Cần thanh toán.
  - Yêu cầu hiển thị: đã nhận 3.000.000đ, đã chi 2.500.000đ, còn dư 500.000đ (hoặc "cần bù" nếu chi > nhận).
  - Số tiền hiển thị VNĐ, dấu phân cách đúng, không có số lẻ.
- **Phụ thuộc:** Q12, Q13
- **Bằng chứng:** ảnh màn hình `/my-advances` (danh sách) + ảnh chi tiết yêu cầu sau khi chi.

### TC-M09-01-02 — Thiếu hoặc sai dữ liệu bắt buộc

- **Mã PRD:** M09-01-02
- **Vai trò:** `giaonhan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** mở form "Đề nghị tạm ứng" rỗng.
- **Các bước:**
  1. Bỏ trống lần lượt: nhiệm vụ, lô, số tiền, mục đích, ngày cần, tài khoản nhận → bấm Lưu.
  2. Nhập số tiền chữ "ba triệu" hoặc số âm → bấm Lưu.
  3. Chọn ngày cần trong quá khứ → bấm Lưu.
- **Kết quả mong đợi (Pass):**
  - Mỗi trường thiếu → thông báo lỗi tiếng Việt ngay dưới trường, không tạo bản ghi.
  - Số tiền sai định dạng → chặn, không lưu.
  - Ngày cần quá khứ → cảnh báo, yêu cầu chọn lại.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh form đang báo lỗi từng trường.

### TC-M09-01-03 — Ngoại lệ: nhiều tạm ứng cho một lô + hoàn trả số dư

- **Mã PRD:** M09-01-03
- **Vai trò:** `giaonhan`, `ketoan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** lô LÔ-B đã có 1 tạm ứng 3.000.000đ, đã chi hết 3.000.000đ.
- **Các bước:**
  1. `giaonhan` tạo thêm tạm ứng thứ 2 cho cùng LÔ-B, lý do "Cần bù chi hộ phát sinh".
  2. Sau khi chi xong, tổng chi < tổng nhận → tạo phiếu hoàn trả số dư.
  3. Kiểm tra danh sách `/my-advances` nhóm theo lô.
- **Kết quả mong đợi (Pass):**
  - Hệ thống cho phép nhiều tạm ứng cho 1 lô, gom đúng tổng nhận / tổng chi / số dư.
  - Hoàn trả được ghi riêng, không xóa khoản chi đã có.
  - Nhật ký giữ lịch sử: ai tạo, ai duyệt, lúc nào.
- **Phụ thuộc:** Q12
- **Bằng chứng:** ảnh danh sách tạm ứng nhóm theo lô + ảnh phiếu hoàn trả.

### TC-M09-01-04 — Kiểm soát quyền thao tác (maker-checker + URL trực tiếp)

- **Mã PRD:** M09-01-04
- **Vai trò thử:** `giaonhan` (tạo), `ketoan` (duyệt), `laixe`/`customer`
- **Thiết bị:** Mobile (iPhone SE 375×667) và Desktop
- **Tiền điều kiện:** `giaonhan` A tạo tạm ứng T-200.
- **Các bước:**
  1. `giaonhan` A thử tự duyệt tạm ứng do mình tạo → kiểm tra hệ thống chặn (maker-checker).
  2. `laixe` mở trực tiếp `/my-advances` → kiểm tra chuyển hướng.
  3. `customer` mở trực tiếp `/my-advances` → kiểm tra chuyển hướng.
  4. `ketoan` mở `/my-advances` → kiểm tra chỉ xem/không thao tác như forwarder (hoặc bị chặn theo cấu hình).
- **Kết quả mong đợi (Pass):**
  - Người tạo không tự duyệt được yêu cầu của chính mình.
  - `laixe`, `customer` không truy cập được `/my-advances` (chuyển hướng về home của vai trò đó).
  - Quyền xem/sửa phân biệt rõ giữa `giaonhan` và `ketoan`.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh màn hình chuyển hướng cho `laixe`/`customer` + ảnh nút duyệt mờ/vắng cho self-approve.

### TC-M09-01-05 — Gửi lại/đồng thời + biên: ngoài giờ, quá hạn, ngoại lệ được duyệt

- **Mã PRD:** M09-01-05
- **Vai trò:** `giaonhan`, `ketoan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** có chính sách "không tạo yêu cầu mới khi quá hạn X ngày" (theo cấu hình).
- **Các bước:**
  1. Mạng chập: bấm Lưu 2 lần nhanh / mất mạng giữa chừng → kiểm tra không tạo bản ghi trùng (HT-04).
  2. Tạo yêu cầu ngoài giờ (23:00) → kiểm tra vẫn lưu, timestamp đúng giờ VN (HT-06).
  3. Tạo yêu cầu khi đã quá hạn theo chính sách → hệ thống chặn, yêu cầu tick "Ngoại lệ được duyệt" + lý do.
  4. `ketoan` phê duyệt ngoại lệ → yêu cầu chuyển trạng thái hợp lệ.
- **Kết quả mong đợi (Pass):**
  - Double-submit không sinh tạm ứng trùng.
  - Yêu cầu ngoài giờ lưu đúng thời điểm.
  - Yêu cầu quá hạn bị chặn mặc định, chỉ tạo được khi có duyệt ngoại lệ + lý do bắt buộc.
- **Phụ thuộc:** Q14
- **Bằng chứng:** ảnh cảnh báo quá hạn + ảnh form ngoại lệ có lý do + ảnh kết quả sau double-submit.

---

## 9.2 — Chọn lô và ghi khoản chi ở trạng thái chờ

**Quy tắc (PRD M09-9.2):** Chỉ được chọn lô đang active và trong phạm vi quyền của forwarder; khoản chi
mới luôn ở trạng thái "Chờ kế toán duyệt". Bắt buộc: mã lô, công-te-nơ, hạng mục, số tiền, ngày, hình
thức chi, ghi chú. Chọn sai lô → chỉ sửa trước khi duyệt + giữ lịch sử. **Phụ thuộc: Q12, Q13, Q14.**

### TC-M09-02-01 — Luồng ghi khoản chi thông thường (trạng thái Chờ)

- **Mã PRD:** M09-02-01
- **Vai trò:** `giaonhan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** có lô ACTIVE LÔ-C (2 công-te-nơ) trong danh sách chuyến của forwarder này.
- **Các bước:**
  1. Mở `/my-forwarder-trips` → chọn chuyến → vào `/my-forwarder-trips/:id`.
  2. Bấm "Ghi khoản chi" → chọn lô LÔ-C, công-te-nơ CONT-1, hạng mục "Vé bãi", số tiền 500.000đ, ngày 26/07/2026, hình thức chi "Tiền mặt", ghi chú.
  3. Lưu → kiểm tra trạng thái.
- **Kết quả mong đợi (Pass):**
  - Dropdown lô chỉ liệt kê lô ACTIVE trong quyền của forwarder (không có lô DONE/đã hủy).
  - Khoản mới lưu với trạng thái "Chờ" — chưa ảnh hưởng tổng đã chi cho đến khi `ketoan` duyệt.
  - Trường bắt buộc đều có; số tiền VNĐ đúng định dạng.
- **Phụ thuộc:** Q12
- **Bằng chứng:** ảnh danh sách lô trong dropdown + ảnh khoản chi trạng thái "Chờ".

### TC-M09-02-02 — Thiếu hoặc sai dữ liệu + lô ngoài phạm vi

- **Mã PRD:** M09-02-02
- **Vai trò:** `giaonhan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. Bỏ trống hạng mục / số tiền / ngày → bấm Lưu.
  2. Nhập số tiền 0 hoặc âm.
  3. Thử chỉnh URL `/my-forwarder-trips/<id-lô-không-phải-của-mình>` để ghi chi cho lô khác.
- **Kết quả mong đợi (Pass):**
  - Trường thiếu → lỗi tiếng Việt, không lưu.
  - Số tiền không hợp lệ → chặn.
  - Lô không thuộc quyền forwarder → chuyển hướng hoặc báo "không có quyền", không ghi được chi.
- **Phụ thuộc:** Q12
- **Bằng chứng:** ảnh lỗi từng trường + ảnh từ chối truy cập lô ngoài phạm vi.

### TC-M09-02-03 — Ngoại lệ: chọn sai lô, sửa trước duyệt, chi chung nhiều cont

- **Mã PRD:** M09-02-03
- **Vai trò:** `giaonhan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** lô LÔ-D có 3 công-te-nơ; forwarder đã ghi 1 khoản sai lô.
- **Các bước:**
  1. Mở khoản chi trạng thái "Chờ" → sửa mã lô từ LÔ-D sang LÔ-E, sửa hạng mục.
  2. Tạo 1 khoản "Chi chung" (common cost) cho cả 3 công-te-nơ của LÔ-D → kiểm tra phân bổ.
  3. Kiểm tra lịch sử chỉnh sửa khoản đã sửa ở bước 1.
- **Kết quả mong đợi (Pass):**
  - Sửa được trước duyệt, lưu lý do + người sửa + thời điểm trong nhật ký.
  - Chi chung cho phép gắn nhiều cont hoặc để trống cont → phân bổ đúng theo quy tắc cấu hình.
  - Lịch sử chỉnh sửa xem được (giá cũ → giá mới, trường nào đổi).
- **Phụ thuộc:** Q13
- **Bằng chứng:** ảnh lịch sử chỉnh sửa + ảnh form chi chung nhiều cont.

### TC-M09-02-04 — Kiểm soát quyền: 2 khoản cùng loại hợp lệ + không sửa khoản của người khác

- **Mã PRD:** M09-02-04
- **Vai trò:** `giaonhan` A, `giaonhan` B, `ketoan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** `giaonhan` A đã ghi khoản chi K-300 trạng thái "Chờ".
- **Các bước:**
  1. `giaonhan` A ghi 2 khoản cùng hạng mục "Vé bãi" cùng ngày cho 2 cont khác nhau → kiểm tra hệ thống cho phép (2 khoản cùng loại hợp lệ).
  2. `giaonhan` B mở chi tiết K-300 → thử sửa/xóa.
  3. `ketoan` mở khoản K-300 → duyệt.
  4. `giaonhan` A thử sửa K-300 sau khi đã duyệt.
- **Kết quả mong đợi (Pass):**
  - Cho phép 2 khoản cùng loại cho 2 cont khác nhau (không coi là trùng).
  - `giaonhan` B không sửa/xóa được khoản của A.
  - Sau khi `ketoan` duyệt, `giaonhan` A không sửa được nữa (chỉ xem).
- **Phụ thuộc:** Q14
- **Bằng chứng:** ảnh 2 khoản cùng loại + ảnh từ chối sửa chéo + ảnh khoản đã duyệt không còn nút Sửa.

### TC-M09-02-05 — Gửi lại/đồng thời + biên: nhiều người submit cùng lúc, chi chung một phần hoàn trả

- **Mã PRD:** M09-02-05
- **Vai trò:** `giaonhan` A, `giaonhan` B, `ketoan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. A và B cùng lúc (2 thiết bị) ghi khoản chi cho cùng lô LÔ-F → kiểm tra không mất dữ liệu, không trùng ID.
  2. Mạng chập khi A bấm Lưu 2 lần → kiểm tra không tạo khoản trùng (HT-04).
  3. `ketoan` chuyển 1 khoản sang "Chuyển tiếp" (transferred) và 1 khoản "Từ chối" → kiểm tra tổng cập nhật ngay + lịch sử.
  4. Tạo khoản hoàn trả một phần (partial refund) liên kết khoản đã chi.
- **Kết quả mong đợi (Pass):**
  - Concurrent submit: mỗi khoản có ID riêng, không ghi đè.
  - Double-submit an toàn.
  - Tổng theo trạng thái (Chờ / Đã duyệt / Chuyển tiếp / Từ chối) cập nhật ngay khớp chi tiết.
  - Hoàn trả một phần giữ nguyên khoản gốc + sinh dòng hoàn trả riêng.
- **Phụ thuộc:** Q12, Q13, Q14
- **Bằng chứng:** ảnh danh sách khoản sau concurrent submit + ảnh tổng theo trạng thái + ảnh dòng hoàn trả.

---

## 9.3 — Gợi ý đơn giá nâng hạ theo cảng

**Quy tắc (PRD M09-9.3):** Hệ thống gợi ý đúng đơn giá nâng/hạ theo cảng; người dùng có thể sửa giá
thực tế nhưng phải nêu lý do. Hiển thị: giá gợi ý, giá nhập, chênh lệch, căn cứ bảng giá. Không có bảng
giá → nhập tay + đánh dấu cho kế toán. Cùng logic M02-2.4 và M04-4.6.

### TC-M09-03-01 — Luồng gợi ý đơn giá nâng hạ thông thường

- **Mã PRD:** M09-03-01
- **Vai trò:** `giaonhan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** bảng giá nâng/hạ cảng CÁNG-X có hiệu lực tại 26/07/2026 (ví dụ 1.200.000đ/lần).
- **Các bước:**
  1. Mở `/my-forwarder-trips/:id` → phần "Nâng hạ".
  2. Chọn cảng CÁNG-X, loại cont 20' → kiểm tra giá gợi ý.
  3. Lưu khoản chi nâng hạ với giá gợi ý.
- **Kết quả mong đợi (Pass):**
  - Hiển thị giá gợi ý 1.200.000đ, nguồn "Bảng giá CÁNG-X (hiệu lực 26/07)".
  - Nếu không sửa giá → không yêu cầu lý do, lưu thẳng.
  - Số tiền VNĐ đúng định dạng.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh phần Nâng hạ với giá gợi ý + căn cứ bảng giá.

### TC-M09-03-02 — Thiếu hoặc sai dữ liệu + sửa giá không có lý do

- **Mã PRD:** M09-03-02
- **Vai trò:** `giaonhan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. Sửa giá gợi ý 1.200.000đ thành 1.350.000đ → bấm Lưu ngay (không nhập lý do).
  2. Bỏ trống cảng / loại cont.
  3. Nhập giá âm hoặc 0.
- **Kết quả mong đợi (Pass):**
  - Sửa giá mà không có lý do → chặn, yêu cầu "Lý do sửa giá" bắt buộc.
  - Cảng/loại cont thiếu → lỗi tiếng Việt.
  - Giá không hợp lệ → chặn.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh form báo lỗi "Lý do sửa giá" bắt buộc.

### TC-M09-03-03 — Ngoại lệ: không có bảng giá → nhập tay + đánh dấu kế toán

- **Mã PRD:** M09-03-03
- **Vai trò:** `giaonhan`, `ketoan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** cảng CÁNG-Y chưa có bảng giá nâng/hạ.
- **Các bước:**
  1. Chọn cảng CÁNG-Y → kiểm tra hệ thống báo "Chưa có bảng giá, nhập tay".
  2. `giaonhan` nhập giá tay 900.000đ + lý do.
  3. Lưu → kiểm tra cờ "Giá nhập tay" hiển thị với `ketoan`.
- **Kết quả mong đợi (Pass):**
  - Không có bảng giá → cho nhập tay, không chặn nghiệp vụ.
  - Khoản có cờ "Giá nhập tay / cần kiểm tra" để `ketoan` đối soát.
  - Lý do nhập tay bắt buộc và lưu vào nhật ký.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh cảnh báo "Chưa có bảng giá" + ảnh khoản có cờ "Giá nhập tay".

### TC-M09-03-04 — Kiểm soát quyền: hiển thị chênh lệch + giữ giá gốc

- **Mã PRD:** M09-03-04
- **Vai trò:** `giaonhan`, `ketoan`
- **Thiết bị:** Mobile (iPhone SE 375×667) và Desktop
- **Các bước:**
  1. `giaonhan` sửa giá nâng từ 1.200.000đ → 1.350.000đ, nhập lý do "Phát sinh ca 3".
  2. Kiểm tra màn hình hiển thị: giá gợi ý, giá nhập, chênh lệch +150.000đ.
  3. `ketoan` mở chi tiết → kiểm tra thấy cả giá gốc + giá nhập + lý do.
  4. `laixe` thử mở trang nâng hạ → kiểm tra chuyển hướng.
- **Kết quả mong đợi (Pass):**
  - Chênh lệch tính đúng dấu và trị số.
  - Giá gốc không bị mất khi sửa (đối soát được).
  - `laixe` không truy cập được.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh chênh lệch + ảnh `ketoan` thấy giá gốc/lý do.

### TC-M09-03-05 — Gửi lại/đồng thời + biên: giá đổi trong ngày, cont đặc biệt, nhiều cảng cùng lô

- **Mã PRD:** M09-03-05
- **Vai trò:** `giaonhan`, `ketoan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. Bảng giá CÁNG-X đổi lúc 14:00 cùng ngày → ghi nâng hạ lúc 10:00 và 16:00 → kiểm tra mỗi khoản dùng đúng mức giá theo thời điểm.
  2. Ghi nâng hạ cho cont đặc biệt (reefer/40HC) → kiểm tra chọn đúng mức giá theo loại.
  3. Một lô đi qua 2 cảng (CÁNG-X, CÁNG-Z) → ghi nâng hạ riêng từng cảng.
  4. Mạng chập khi lưu → kiểm tra không tạo trùng.
- **Kết quả mong đợi (Pass):**
  - Mỗi khoản dùng giá có hiệu lực tại thời điểm ghi, không lấy nhầm giá mới nhất.
  - Cont đặc biệt áp đúng mức riêng (nếu cấu hình).
  - Nhiều cảng trong 1 lô: ghi độc lập, tổng cộng đúng.
  - Double-submit an toàn.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh 2 khoản cùng ngày khác mức giá + ảnh cont đặc biệt + ảnh 2 cảng.

---

## 9.4 — Gom khoản chi của nhiều nhân viên theo lô

**Quy tắc (PRD M09-9.4):** Tổng hợp theo lô nhưng giữ từng dòng và quyền của từng người; một người không
sửa được khoản của người khác. Tổng theo hạng mục và trạng thái phải khớp chi tiết dòng. Khoản chuyển
tiếp/từ chối cập nhật tổng ngay + giữ lịch sử. Cùng góc nhìn M04-4.3 nhưng từ phía forwarder.

### TC-M09-04-01 — Luồng gom khoản chi nhiều người theo lô

- **Mã PRD:** M09-04-01
- **Vai trò:** `giaonhan` A, `giaonhan` B, `ketoan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** lô LÔ-G do A và B cùng phụ trách; mỗi người đã ghi ≥2 khoản chi.
- **Các bước:**
  1. Mở `/my-forwarder-trips/:id` (lô LÔ-G) → xem phần "Tổng hợp khoản chi".
  2. Kiểm tra bảng liệt kê từng dòng + người tạo + trạng thái.
  3. Kiểm tra tổng theo hạng mục và theo trạng thái.
- **Kết quả mong đợi (Pass):**
  - Liệt kê đủ dòng của cả A và B, mỗi dòng có tên người tạo.
  - Tổng theo hạng mục = tổng các dòng cùng hạng mục.
  - Tổng theo trạng thái (Chờ/Đã duyệt/Chuyển tiếp/Từ chối) = tổng các dòng cùng trạng thái.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh bảng tổng hợp + ảnh 2 sub-total (hạng mục, trạng thái).

### TC-M09-04-02 — Thiếu hoặc sai dữ liệu + dòng mâu thuẫn tổng

- **Mã PRD:** M09-04-02
- **Vai trò:** `giaonhan`, `ketoan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. Giả lập 1 dòng bị thiếu trạng thái (do lỗi dữ liệu) → kiểm tra hiển thị + cảnh báo.
  2. Kiểm tra màn hình có cơ chế báo "Tổng không khớp chi tiết" nếu có sai số.
  3. Lọc theo người tạo / hạng mục / trạng thái → kiểm tra tổng lọc đúng.
- **Kết quả mong đợi (Pass):**
  - Dòng thiếu trạng thái được đánh dấu, không làm sai tổng.
  - Có cảnh báo nếu tổng khác chi tiết.
  - Bộ lọc tính lại tổng đúng theo phạm vi lọc.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh cảnh báo mâu thuẫn + ảnh tổng sau lọc.

### TC-M09-04-03 — Ngoại lệ: chi chung nhiều người + hoàn trả một phần

- **Mã PRD:** M09-04-03
- **Vai trò:** `giaonhan` A, `giaonhan` B, `ketoan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. A tạo "Chi chung" 1.000.000đ cho LÔ-G (phân bổ cho cả A và B).
  2. B tạo khoản chi riêng 600.000đ.
  3. `ketoan` duyệt cả 2 → kiểm tra tổng lô.
  4. Tạo hoàn trả 200.000đ cho khoản của A → kiểm tra tổng giảm đúng.
- **Kết quả mong đợi (Pass):**
  - Chi chung hiện đúng cho cả 2 người, không nhân đôi tổng.
  - Tổng lô = chi chung + chi riêng − hoàn trả.
  - Hoàn trả giữ nguyên dòng gốc + thêm dòng hoàn trả (âm hoặc trạng thái hoàn trả).
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh tổng lô trước/sau hoàn trả.

### TC-M09-04-04 — Kiểm soát quyền: chỉ người tạo mới sửa; chuyển tiếp/từ chối cập nhật tổng

- **Mã PRD:** M09-04-04
- **Vai trò:** `giaonhan` A, `giaonhan` B, `ketoan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. A thử sửa dòng do B tạo → kiểm tra chặn.
  2. B thử xóa dòng do A tạo → kiểm tra chặn.
  3. `ketoan` chuyển tiếp 1 dòng + từ chối 1 dòng của A → kiểm tra tổng trạng thái cập nhật ngay.
  4. `ketoan` mở lịch sử thay đổi của 1 dòng đã chuyển tiếp.
- **Kết quả mong đợi (Pass):**
  - Không người nào sửa/xóa dòng của người khác.
  - Chuyển tiếp/Từ chối làm tổng trạng thái thay đổi ngay, không cần reload.
  - Lịch sử dòng lưu đủ: ai duyệt, hành động, thời điểm, lý do (nếu có).
- **Phụ thuộc:** Q14
- **Bằng chứng:** ảnh từ chối sửa chéo + ảnh lịch sử dòng sau chuyển tiếp.

### TC-M09-04-05 — Gửi lại/đồng thời + biên: nhiều người submit cùng lúc, đối chiếu chéo

- **Mã PRD:** M09-04-05
- **Vai trò:** `giaonhan` A, `giaonhan` B, `ketoan`
- **Thiết bị:** Mobile (iPhone SE 375×667) và Desktop
- **Các bước:**
  1. A và B cùng lúc ghi khoản cho LÔ-G → kiểm tra tổng cập nhật đúng cả 2 dòng, không mất dòng.
  2. Mở cùng lúc màn hình forwarder (mobile) và màn hình `ketoan` (desktop `/advances?view=settlements`) → kiểm tra số liệu khớp.
  3. Đối chiếu tổng lô ở forwarder với tổng lô ở phía `ketoan`.
- **Kết quả mong đợi (Pass):**
  - Concurrent submit: tổng đúng, không trùng/không mất dòng.
  - Tổng lô ở forwarder = tổng lô ở phía `ketoan` (HT-10 đối chiếu liên phân hệ).
  - Mọi chênh lệch truy ngược được qua nhật ký.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh tổng lô 2 phía khớp nhau + ảnh nhật ký.

---

## 9.5 — Tải ảnh chứng từ tại cảng

**Quy tắc (PRD M09-9.5):** Ảnh phải liên kết đúng khoản chi; cho phép nhiều trang (multi-page); kiểm
tra loại tệp và dung lượng. Xem trước ảnh, trạng thái tải, thời gian chụp; kế toán mở được bản gốc. Tải
lỗi không được đánh dấu "đã có chứng từ"; cho thử lại không tạo chứng từ/khoản chi trùng.

### TC-M09-05-01 — Luồng tải ảnh chứng từ thông thường

- **Mã PRD:** M09-05-01
- **Vai trò:** `giaonhan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Tiền điều kiện:** có khoản chi K-400 trạng thái "Chờ".
- **Các bước:**
  1. Mở K-400 → bấm "Tải ảnh chứng từ".
  2. Chọn 1 ảnh JPG < 5MB (hoặc chụp từ camera).
  3. Đợi tải xong → kiểm tra trạng thái + xem trước.
- **Kết quả mong đợi (Pass):**
  - Ảnh xem trước được, hiển thị trạng thái "Đã tải" + thời gian chụp/tải (giờ VN).
  - Ảnh liên kết đúng K-400.
  - Cờ "Đã có chứng từ" của K-400 bật thành true.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh xem trước chứng từ + ảnh trạng thái "Đã có chứng từ" trên K-400.

### TC-M09-05-02 — Thiếu hoặc sai dữ liệu: sai loại tệp, quá kích thước

- **Mã PRD:** M09-05-02
- **Vai trò:** `giaonhan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. Tải tệp `.exe` / `.zip` / `.heic` (nếu không được hỗ trợ) → kiểm tra chặn.
  2. Tải ảnh > giới hạn dung lượng (ví dụ 10MB) → kiểm tra chặn + thông báo tiếng Việt.
  3. Tải ảnh không liên kết khoản chi (chọn "không" / bỏ trống) → kiểm tra yêu cầu bắt buộc chọn khoản.
- **Kết quả mong đợi (Pass):**
  - Sai loại tệp → từ chối, không tải lên.
  - Quá dung lượng → từ chối kèm hướng dẫn.
  - Không có khoản liên kết → không cho tải rời.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh cảnh báo loại tệp + ảnh cảnh báo dung lượng.

### TC-M09-05-03 — Ngoại lệ: hóa đơn nhiều trang, ảnh xoay

- **Mã PRD:** M09-05-03
- **Vai trò:** `giaonhan`, `ketoan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. Tải hóa đơn 3 trang (3 ảnh JPG) cho cùng K-400 → kiểm tra multi-page.
  2. Tải 1 ảnh chụp xoay 90° → kiểm tra xoay lại được trong xem trước hoặc cảnh báo.
  3. Tải lại 1 ảnh đã có (trùng tên/hash) → kiểm tra không tạo chứng từ trùng.
- **Kết quả mong đợi (Pass):**
  - Multi-page: hiển thị đủ 3 trang, kế toán xem đủ.
  - Ảnh xoay: có nút xoay xem trước hoặc hệ thống tự định hướng lại.
  - Ảnh trùng (cùng hash) → cảnh báo, không tạo bản ghi trùng.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh xem trước 3 trang + ảnh nút xoay + ảnh cảnh báo ảnh trùng.

### TC-M09-05-04 — Kiểm soát quyền: kế toán mở bản gốc, forwarder chỉ xem của mình

- **Mã PRD:** M09-05-04
- **Vai trò:** `giaonhan` A, `giaonhan` B, `ketoan`
- **Thiết bị:** Mobile (iPhone SE 375×667) và Desktop
- **Các bước:**
  1. `ketoan` mở chứng từ của K-400 (từ `/advances?view=settlements`) → tải bản gốc, kiểm tra chất lượng ảnh.
  2. `giaonhan` B thử mở K-400 của A để xem/xóa ảnh → kiểm tra chặn.
  3. `giaonhan` A xóa 1 ảnh của chính mình trước khi `ketoan` duyệt → kiểm tra lịch sử.
- **Kết quả mong đợi (Pass):**
  - `ketoan` mở/zoom được bản gốc để kiểm tra.
  - `giaonhan` B không truy cập được ảnh của A.
  - Xóa ảnh trước duyệt: lưu lịch sử, cập nhật cờ "Đã có chứng từ" nếu hết ảnh.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh `ketoan` mở bản gốc + ảnh từ chối truy cập chéo + ảnh lịch sử xóa.

### TC-M09-05-05 — Gửi lại/đồng thời + biên: mạng yếu, tải lỗi, thử lại không trùng

- **Mã PRD:** M09-05-05
- **Vai trò:** `giaonhan`
- **Thiết bị:** Mobile (iPhone SE 375×667)
- **Các bước:**
  1. Giả lập mạng yếu (DevTools throttling Slow 3G) → tải 1 ảnh → kiểm tra có tiến trình + không treo.
  2. Cắt mạng giữa chừng → ảnh lỗi → kiểm tra cờ "Đã có chứng từ" KHÔNG bật + có nút "Thử lại".
  3. Bấm "Thử lại" nhiều lần → kiểm tra không sinh chứng từ trùng cho K-400.
  4. Tải lại ảnh khác sau khi lỗi → kiểm tra lưu thành công, không trùng ID.
- **Kết quả mong đợi (Pass):**
  - Mạng yếu: hiển thị tiến trình, không block UI, không che nút.
  - Tải lỗi: cờ "Đã có chứng từ" = false, có thông báo lỗi rõ ràng + nút thử lại (HT-08).
  - Thử lại không tạo chứng từ trùng, không tạo khoản chi trùng.
  - Sau khi thành công, cờ cập nhật đúng.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh tiến trình mạng yếu + ảnh trạng thái lỗi (chưa có chứng từ) + ảnh sau thử lại thành công.

---

## Bảng nghiệm thu M09

| Ngày thử | Mã TC        | Người thử | Kết quả | Ghi chú | Bằng chứng |
| -------- | ------------ | --------- | ------- | ------- | ---------- |
| __/__/__ | TC-M09-01-01 |           |         |         |            |
| __/__/__ | TC-M09-01-02 |           |         |         |            |
| __/__/__ | TC-M09-01-03 |           |         |         |            |
| __/__/__ | TC-M09-01-04 |           |         |         |            |
| __/__/__ | TC-M09-01-05 |           |         |         |            |
| __/__/__ | TC-M09-02-01 |           |         |         |            |
| __/__/__ | TC-M09-02-02 |           |         |         |            |
| __/__/__ | TC-M09-02-03 |           |         |         |            |
| __/__/__ | TC-M09-02-04 |           |         |         |            |
| __/__/__ | TC-M09-02-05 |           |         |         |            |
| __/__/__ | TC-M09-03-01 |           |         |         |            |
| __/__/__ | TC-M09-03-02 |           |         |         |            |
| __/__/__ | TC-M09-03-03 |           |         |         |            |
| __/__/__ | TC-M09-03-04 |           |         |         |            |
| __/__/__ | TC-M09-03-05 |           |         |         |            |
| __/__/__ | TC-M09-04-01 |           |         |         |            |
| __/__/__ | TC-M09-04-02 |           |         |         |            |
| __/__/__ | TC-M09-04-03 |           |         |         |            |
| __/__/__ | TC-M09-04-04 |           |         |         |            |
| __/__/__ | TC-M09-04-05 |           |         |         |            |
| __/__/__ | TC-M09-05-01 |           |         |         |            |
| __/__/__ | TC-M09-05-02 |           |         |         |            |
| __/__/__ | TC-M09-05-03 |           |         |         |            |
| __/__/__ | TC-M09-05-04 |           |         |         |            |
| __/__/__ | TC-M09-05-05 |           |         |         |            |

### Tiêu chí toàn phân hệ M09-HT-01 … M09-HT-10

Chạy TC-HT-01 … TC-HT-10 từ `00-cross-cutting.md` trên màn hình của M09. Vì M09 là ứng dụng di động,
**bắt buộc chạy HT-07 (responsive) trên viewport iPhone SE 375×667** — kiểm tra nút không bị che, bảng
không vỡ, form không tràn, chụp ảnh màn hình.

| Mã HT     | Kết quả | Bằng chứng |
| --------- | ------- | ---------- |
| M09-HT-01 |         |            |
| M09-HT-02 |         |            |
| M09-HT-03 |         |            |
| M09-HT-04 |         |            |
| M09-HT-05 |         |            |
| M09-HT-06 |         |            |
| M09-HT-07 |         |            |
| M09-HT-08 |         |            |
| M09-HT-09 |         |            |
| M09-HT-10 |         |            |
