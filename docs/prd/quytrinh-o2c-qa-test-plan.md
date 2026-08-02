# KẾ HOẠCH KIỂM THỬ THỦ CÔNG — QUY TRÌNH ĐƠN HÀNG ĐẾN THU TIỀN (ORDER-TO-CASH)

> **Dành cho QA thủ công.** Tài liệu này hướng dẫn kiểm thử trọn vòng luồng
> **Đơn hàng đến Thu tiền** trên website TingTing (phiên bản Silversea): từ
> Thiết lập nền tảng → Tạo lô hàng → Điều xe → Vận hành & chi phí hiện trường →
> Đối chiếu & Hoàn thành → Bàn giao công nợ.
>
> **Đối tượng:** Nhân viên QA (con người), thao tác trực tiếp trên website.
>
> **Nguồn sự thật:** [`O2C dev-rev1.md`](./O2C%20dev-rev1.md) và
> [`O2C Flow.md`](./O2C%20Flow.md). Phần mềm, test tự động và tài liệu QA phải
> tuân thủ PRD. Hành vi khác PRD là lỗi, trừ khi PRD ghi rõ một quyết định thay đổi
> đã được phê duyệt.

---

## Mục lục

- [§0 Quy tắc nguồn sự thật](#0-quy-tắc-nguồn-sự-thật)
- [§1 Thông tin môi trường & tài khoản](#1-thông-tin-môi-trường--tài-khoản)
- [§2 Chuẩn bị dữ liệu (Bước 0)](#2-chuẩn-bị-dữ-liệu-bước-0)
- [§3 Luồng kiểm thử chính (Bước 1 → 4)](#3-luồng-kiểm-thử-chính)
  - [Test 1 — Tạo lô hàng + tự áp giá cước (CUS)](#test-1--tạo-lô-hàng--tự-áp-giá-cước-cus)
  - [Test 2 — Điều xe (Dispatch)](#test-2--điều-xe-dispatch)
  - [Test 3 — Ops chi hộ + tự áp giá nâng/hạ](#test-3--ops-chi-hộ--tự-áp-giá-nâng-hạ)
  - [Test 4 — Lái xe nhận lệnh, cập nhật chi phí, hoàn thành chuyến](#test-4--lái-xe-nhận-lệnh-cập-nhật-chi-phí-hoàn-thành-chuyến)
  - [Test 5 — Thu hồi POD (cổng chặn bắt buộc)](#test-5--thu-hồi-pod-cổng-chặn-bắt-buộc)
  - [Test 6 — Kế toán duyệt chi phí + hoàn thành lô](#test-6--kế-toán-duyệt-chi-phí--hoàn-thành-lô)
  - [Test 7 — Bàn giao công nợ AR/AP + chụp số liệu](#test-7--bàn-giao-công-nợ-arap--chụp-số-liệu)
- [§4 Phân quyền — test chéo vai trò](#4-phân-quyền--test-chéo-vai-trò)
- [§5 Trường hợp biên & ngoại lệ](#5-trường-hợp-biên--ngoại-lệ)
- [§6 Đối chiếu liên phân hệ (End-to-End)](#6-đối-chiếu-liên-phân-hệ-end-to-end)
- [§7 Bảng nghiệm thu](#7-bảng-nghiệm-thu)
- [§8 Cách ghi lỗi](#8-cách-ghi-lỗi)

---

## 0. Quy tắc nguồn sự thật

1. Kiểm thử theo PRD, không kiểm thử theo giới hạn hiện tại của phần mềm.
2. Không sửa kết quả mong đợi để hợp thức hóa hành vi đang chạy.
3. Mọi sai lệch phải được ghi lỗi và truy vết về yêu cầu PRD tương ứng.
4. Chỉ hai điều chỉnh sau là hợp lệ vì đã được phê duyệt trong PRD:
   - Bỏ trạng thái `Đã khóa`; `Hoàn thành` là trạng thái kết thúc và chi phí vẫn
     được chỉnh sửa theo cơ chế có dấu vết/đối soát.
   - Hoàn thành áp dụng maker/checker theo quyết định Q15: Kế toán/CUS tạo yêu
     cầu, người có quyền độc lập phê duyệt.

Các hành vi bắt buộc, không phải ngoại lệ:

- Lô hàng có đủ năm trạng thái `Mới tạo → Đã điều xe → Đang chạy → Chờ duyệt phí → Hoàn thành`.
- Kẹp hàng tự động chỉ ghi nhận một lần định mức phí đường bộ khép kín.
- Duyệt phí chi hộ tự động sinh bút toán cấn trừ tạm ứng của Ops/Lái xe.
- Giá cước dự kiến, phụ phí xăng dầu và giá nâng/hạ được hệ thống tự áp theo dữ liệu nền.

---

## 1. Thông tin môi trường & tài khoản

### 1.1. Môi trường

| Môi trường | Địa chỉ | Ghi chú |
| ---------- | --- | ------- |
| **Staging (chính)** | https://vantai.tingting.vip/ | Dùng để kiểm thử. Mọi mật khẩu `Abc123`. |
| Nội bộ | http://localhost:7174 | Chỉ dùng khi đội kỹ thuật đã bật sẵn trên máy của bạn. |

### 1.2. Tài khoản (mật khẩu đều là `Abc123`)

| Tên đăng nhập | Vai trò | Dùng test mảng |
| ------------- | ------- | -------------- |
| `admin` | Quản trị hệ thống | Mọi thao tác (quyền cao nhất); thêm/sửa/xóa; phê duyệt các yêu cầu |
| `giamdoc` | Giám đốc | Báo cáo, P&L, phê duyệt các yêu cầu, dữ liệu nhạy cảm |
| `ketoan` | Kế toán | Thu hồi POD, duyệt chi phí, hoàn thành lô, công nợ AR/AP |
| `cus` | Nhân viên chứng từ (CUS) | Tạo lô hàng |
| `dieuvan` | Điều vận | Lập kế hoạch, gán xe và phát hành lệnh điều xe |
| `giaonhan` | Ops / Hiện trường | Chi hộ, cập nhật phí nâng/hạ |
| `laixe` (`thu`, `pho`, `quyet`) | Lái xe | Nhận lệnh, cập nhật chi phí, hoàn thành chuyến |

> 📝 Dùng đúng tài khoản cho đúng vai trò. `cus` = nhân viên chứng từ (tạo lô);
> `dieuvan` = điều vận; `giaonhan` = Ops/hiện trường (chi hộ).

---

## 2. Chuẩn bị dữ liệu (Bước 0)

> **Mục tiêu:** đảm bảo dữ liệu nền (danh mục) đã có trước khi test luồng. Chạy
> 1 lần / đợt test. Nếu môi trường đã có sẵn, có thể bỏ qua.

Thực hiện bằng tài khoản `admin` hoặc `ketoan`. Mở các màn danh mục và kiểm tra
các mục đã có dữ liệu:

- [ ] **Khách hàng** (Danh mục → Khách hàng): ≥1 khách, đã cài
      **% chia sẻ phụ phí xăng dầu**.
- [ ] **Tuyến đường** (Danh mục → Tuyến đường): ≥1 tuyến.
- [ ] **Bảng giá cước** (Danh mục → Bảng giá cước): giá theo **Khách × Tuyến**
      còn hiệu lực. (Test tự áp giá cần mục này.)
- [ ] **Định mức nhiên liệu** (Danh mục → Định mức nhiên liệu) + **Cấu hình giá
      dầu** (Danh mục → Giá dầu): đã có `Giá dầu gốc` + `Giá dầu hiện tại`.
- [ ] **Xe** (Danh mục → Xe): ≥1 xe dán nhãn **`Xe nhà`**, ≥1 xe dán nhãn
      **`Xe ngoài`**. Biển số dạng text có dấu tách (vd `15C-123.45`).
- [ ] **Tài xế** (Nhân sự → Tài xế): ≥1 lái xe.
- [ ] **Nhà cung cấp** (Danh mục → Nhà cung cấp): có NCC dầu + NCC cước xe ngoài.
- [ ] **Bảng giá Nâng/Hạ** (Danh mục → Bảng giá Nâng/Hạ): giá theo
      `Cảng + cỡ Cont (20'/40') + Hàng/Rỗng`.

> Nếu thiếu bất kỳ mục nào → tạo bằng giao diện, hoặc báo đội hỗ trợ tạo dữ liệu
> mẫu trước khi test.

---

## 3. Luồng kiểm thử chính

Đây là **luồng chính** — chạy tuần tự tạo 1 lô đi hết vòng đời. Mỗi test cho
**kết quả mong đợi quan sát được trên màn hình** (số liệu, màu trạng thái,
thông báo).

Sơ đồ luồng PRD bắt buộc:

```
CUS tạo lô ──▶ Điều vận điều xe ──▶ Lái xe nhận lệnh ──▶ Ops/Lái xe thực hiện
 (Mới tạo)       (Đã điều xe)          (Đang chạy)                       │
                                                            ▼
                                      Nộp chi phí ──▶ Chờ duyệt phí
                                                            │
                                                            ▼
                                      Kế toán thu hồi POD + duyệt chi phí
                                      (tự động cấn trừ tạm ứng)
                                                            │
                                                            ▼
                                      Maker/checker Hoàn thành → AR + AP snapshot
```

---

### Test 1 — Tạo lô hàng + tự áp giá cước (CUS)

**Vai trò:** `cus` (nhân viên chứng từ).
**Màn hình:** Danh sách lô hàng → bấm **"Tạo lô hàng"**.

**Tiền điều kiện:** Bảng giá cho "Khách × Tuyến" đã có (xem §2).

**Các bước:**
1. Đăng nhập `cus`. Mở Danh sách lô hàng, bấm **"Tạo lô hàng"**.
2. Nhập: Số Bill/Booking, chọn **Khách hàng**, **Tuyến đường**, **Nhà máy**.
3. Chọn **loại hàng FCL**: nhập số Cont (vd `2 × 40HC`), KG, CBM.
4. Quan sát trường **Đơn giá cước dự kiến**.
5. Bấm **Lưu**.

**Kết quả mong đợi (Pass):**
- ✅ Trường "Đơn giá cước dự kiến" **tự điền** từ Bảng giá — **không gõ tay** được.
- ✅ Lô tạo thành công, mở chi tiết lô thấy đầy đủ thông tin.
- ✅ Có trường **phụ phí xăng dầu** tự tính. Tính tay để đối chiếu:
  `Phụ phí = (Giá dầu hiện tại − Giá dầu gốc) × Số lít định mức × % chia sẻ KH`.
- ✅ Lô/chuyến ở trạng thái **`Mới tạo`**.

**❌ Báo lỗi nếu:** giá cước bắt gõ tay / để trống; phụ phí sai công thức; lưu lỗi.

**Bằng chứng:** ảnh form (giá tự điền) + ảnh chi tiết sau khi lưu + ảnh tính tay phụ phí.

---

### Test 2 — Điều xe (Dispatch)

**Vai trò:** tài khoản **Điều vận**. `admin`/`giamdoc` có thể dùng để hỗ trợ hoặc
phê duyệt, nhưng không thay thế quyền thao tác hằng ngày của Điều vận.
**Màn hình:** Điều xe / Bảng kế hoạch điều phối (menu **Phân xe**).

**Tiền điều kiện:** có lô ở trạng thái `Mới tạo` (từ Test 1).

**Các bước:**
1. Đăng nhập tài khoản Điều vận. Mở màn **Điều xe** (Bảng kế hoạch điều phối).
2. Chọn lô cần điều xe.
3. Gán: **Xe** (chọn xe `Xe nhà` hoặc `Xe ngoài`), **Tài xế**, **Rơ-moóc**,
   thời gian dự kiến.
4. Bấm **phát hành lệnh điều xe**.

**Kết quả mong đợi (Pass):**
- ✅ Lệnh phát hành thành công (thông báo trên màn).
- ✅ Lô chuyển chính xác sang trạng thái **`Đã điều xe`**.
- ✅ Lệnh xuất hiện trên ứng dụng của tài xế được gán (màn **Chuyến đi của tôi**).
- ✅ Nhãn **`Xe nhà`** hoặc **`Xe ngoài`** hiển thị ở chi tiết (dùng để tách P&L).

**❌ Báo lỗi nếu:** điều xe được bằng tài khoản không có quyền; xe đang bận mà
  vẫn gán được (phải có cảnh báo — 1 xe không chạy 2 chuyến cùng lúc); lệnh
  không tới tài xế.

**Bằng chứng:** ảnh màn Điều xe sau phát hành + ảnh chi tiết lô (trạng thái + nhãn xe).

> **Kẹp hàng là tự động:** ghép hai lệnh chạy hai chiều phải tự động áp đúng một
> định mức phí đường bộ khép kín. Nếu hệ thống yêu cầu người dùng tự giảm bằng
> tay hoặc ghi nhận hai lần, ghi lỗi P1.

---

### Test 3 — Ops chi hộ + tự áp giá nâng/hạ

**Vai trò:** `giaonhan` (Ops / Hiện trường).
**Màn hình:** **Chuyến đi của tôi (Ops)**, mở chi tiết chuyến → tạo chi hộ.

**Tiền điều kiện:** lô đã `Đã điều xe`; lái xe xác nhận lệnh để chuyển sang
`Đang chạy`. Đã có Bảng giá Nâng/Hạ.

**Các bước:**
1. Đăng nhập `giaonhan`. Mở **Chuyến đi của tôi**, chọn chuyến.
2. Tạo khoản **chi hộ**: chọn mã lô, chọn **Tên Cảng** + **Loại Cont**
   (vd `40HC / Hàng`).
3. Quan sát trường số tiền nâng/hạ.
4. Đính kèm ảnh biên lai/hóa đơn. Lưu.

**Kết quả mong đợi (Pass):**
- ✅ Số tiền nâng/hạ **tự điền** từ Bảng giá (Cảng + Loại Cont) — Ops **không gõ tay**.
- ✅ Chi phí lưu về đúng lô, trạng thái **`Chờ duyệt`**.
- ✅ Ảnh biên lai đính kèm thành công, xem lại được.
- ✅ Mọi khoản chi (từ nhiều Ops/Lái xe) **gom về cùng 1 mã lô**.
- ✅ Khi Ops/Lái xe hoàn tất và gửi các khoản chi, lô chuyển sang
  **`Chờ duyệt phí`**; không nhảy thẳng đến `Hoàn thành`.

**❌ Báo lỗi nếu:** tiền nâng hạ gõ tay được; chi phí lưu sai lô; ảnh không lưu.

**Bằng chứng:** ảnh form chi hộ (tiền tự điền) + ảnh chi tiết lô có chi phí `Chờ duyệt`.

---

### Test 4 — Lái xe nhận lệnh, cập nhật chi phí, hoàn thành chuyến

**Vai trò:** `laixe` (Lái xe).
**Màn hình:** **Chuyến đi của tôi**, chi tiết chuyến.

**Tiền điều kiện:** lệnh đã điều xe hiển thị trên **Chuyến đi của tôi**.

**Các bước:**
1. Đăng nhập `laixe`. Mở **Chuyến đi của tôi**, xem lệnh mới (giờ cut-off, đóng/trả).
2. Bấm **"Xác nhận nhận lệnh"** (nhận lệnh gốc từ Ops).
3. Cập nhật chi phí thực tế: tiền đường, tiền nâng hạ từng container.
4. Tải lên ảnh cột bơm/hóa đơn dầu (nếu đổ nhiên liệu).
5. Chụp ảnh số Cont/Seal chì, bấm **"Hoàn thành chuyến"** (hoàn thành phía lái xe).

**Kết quả mong đợi (Pass):**
- ✅ Bấm xác nhận → ghi lại giờ nhận lệnh (giờ Việt Nam).
- ✅ Chi phí cập nhật thành công, hiển thị ở chi tiết.
- ✅ Ảnh nhiên liệu tải lên được; dữ liệu (số lít/đơn giá) bóc tách hiển thị để xác nhận.
- ✅ Bấm hoàn thành → chuyến **vẫn chưa** sang `Hoàn thành` ở cấp lô (cần Kế toán
  thu hồi POD + duyệt — xem Test 5, 6).
- ✅ Lô hiển thị **`Chờ duyệt phí`** sau khi dữ liệu vận hành đã được gửi đầy đủ.

**❌ Báo lỗi nếu:** không thấy lệnh; giờ nhận lệnh sai; ảnh không lưu; nút hoàn thành lỗi.

**Bằng chứng:** ảnh chi tiết chuyến của lái xe + ảnh chi phí + ảnh giờ nhận lệnh.

---

### Test 5 — Thu hồi POD (cổng chặn bắt buộc)

**Vai trò:** `ketoan` (Kế toán) hoặc `cus` (nhân viên chứng từ).
**Màn hình:** chi tiết chuyến / chi tiết lô.

**Tiền điều kiện:** Lái xe đã bấm hoàn thành chuyến (Test 4); **chưa** xác nhận
thu hồi POD.

**Các bước:**
1. Đăng nhập `ketoan`. Mở chi tiết chuyến.
2. Thử bấm **"Hoàn thành"** (hoặc yêu cầu hoàn thành) **mà chưa** xác nhận thu hồi POD.
3. Đánh dấu **"Đã thu hồi chứng từ gốc (POD)"**.
4. Bấm hoàn thành lại.

**Kết quả mong đợi (Pass):**
- ✅ Lần 1: hệ thống **chặn**, báo lỗi tiếng Việt dạng
  *"Chưa thu hồi POD gốc (chứng từ mộc đỏ)…"*. Chuyến **không** sang `Hoàn thành`.
- ✅ Lần 2 (sau khi xác nhận POD): cho phép tạo yêu cầu hoàn thành.

**❌ Báo lỗi nếu:** hoàn thành được khi chưa thu hồi POD (đây là **lỗi nghiêm trọng P0**).

**Bằng chứng:** ảnh lần 1 (bị chặn + thông báo lỗi) + ảnh sau khi đánh dấu POD.

---

### Test 6 — Kế toán duyệt chi phí + hoàn thành lô

**Vai trò:** `ketoan` (Kế toán); cần `admin`/`giamdoc` phê duyệt yêu cầu.
**Màn hình:** chi tiết chuyến; mục **Yêu cầu phê duyệt**.

**Tiền điều kiện:** POD đã thu hồi (Test 5); có chi phí `Chờ duyệt` (Test 3, 4).

**Các bước:**
1. Đăng nhập `ketoan`. Mở chi tiết chuyến, xem danh sách chi phí **`Chờ duyệt`**.
2. **Phân loại** chi hộ: nhóm **CÓ hóa đơn** (nâng hạ, lưu kho) vs **KHÔNG hóa đơn**.
3. Áp mức **VAT** đúng (0/5/8/10%) theo nhóm.
4. **Duyệt** từng khoản chi phí (đi qua luồng phê duyệt).
5. Kiểm tra bút toán **cấn trừ tạm ứng tự động** của đúng Ops/Lái xe ngay sau
   khi khoản phí được duyệt. Không tạo Phiếu quyết toán thủ công để thay thế bước này.
6. Tạo **yêu cầu hoàn thành** lô.
7. Đăng nhập bằng tài khoản phê duyệt độc lập → mục **Yêu cầu phê duyệt** →
   **phê duyệt** yêu cầu.

**Kết quả mong đợi (Pass):**
- ✅ Hai nhóm chi hộ (CÓ/KHÔNG hóa đơn) tách bạch.
- ✅ VAT áp đúng nhóm.
- ✅ Duyệt chi phí → trạng thái chuyển `Chờ duyệt → Đã duyệt`.
- ✅ Duyệt chi phí → hệ thống tự sinh một giao dịch cấn trừ vào dư nợ tạm ứng
  của đúng người phát sinh; không sinh trùng khi duyệt/gửi lại cùng yêu cầu.
- ✅ Yêu cầu hoàn thành tạo thành công (hệ thống báo đã ghi nhận yêu cầu).
- ✅ Sau khi được phê duyệt → chuyến **sang `Hoàn thành`**.

**❌ Báo lỗi nếu:** VAT sai; không tự cấn trừ; cấn trừ sai người/sai số tiền;
maker tự phê duyệt yêu cầu của mình; hoặc hoàn thành bỏ qua cổng POD.

**Bằng chứng:** ảnh phân loại chi hộ + ảnh bút toán cấn trừ tự động + ảnh danh
sách yêu cầu phê duyệt + ảnh lô `Hoàn thành`.

---

### Test 7 — Bàn giao công nợ AR/AP + chụp số liệu

**Vai trò:** `ketoan`, `admin`.
**Màn hình:** **Công nợ phải thu khách (AR)**, **Chi phí phải trả NCC (AP)**,
**Báo cáo P&L**.

**Tiền điều kiện:** có lô đã `Hoàn thành` (Test 6), cả 2 loại `Xe nhà` và `Xe ngoài`.

**Các bước:**
1. Mở **Công nợ phải thu khách (AR)** → kiểm tra bản ghi cho lô vừa hoàn thành.
2. Mở **Chi phí phải trả NCC (AP)** → kiểm tra bản ghi (NCC/chủ xe ngoài).
3. So sánh **tổng sau VAT** trên lô vs số tiền AR.
4. Mở **Báo cáo P&L** → kiểm tra P&L **tách `Xe nhà` / `Xe ngoài`**.
5. **Sửa 1 chi phí** sau khi Hoàn thành → kiểm tra số liệu cũ có bị đánh dấu
   "đã thay đổi" không.

**Kết quả mong đợi (Pass):**
- ✅ Khi lô `Hoàn thành` → hệ thống **tự tạo** bản ghi AR + AP (không cần làm tay).
- ✅ Lô `Xe ngoài` sinh thêm AP cho NCC/chủ xe; lô `Xe nhà` ghi lương tài xế + nhiên liệu.
- ✅ Tổng sau VAT trên lô **khớp** số tiền AR.
- ✅ P&L tách riêng doanh thu/giá vốn `Xe nhà` vs `Xe ngoài`.
- ✅ Chi phí **vẫn sửa được** sau Hoàn thành (không bị khóa). Sửa → số liệu AR/AP
  bị **đánh dấu "đã thay đổi"** để Kế toán đối soát lại (không ghi đè số cũ).

**❌ Báo lỗi nếu:** không tự sinh AR/AP; tổng lệch; không tách P&L; sửa sau hoàn thành bị khóa cứng.

**Bằng chứng:** ảnh màn AR + AP có bản ghi + ảnh P&L tách 2 nhóm + ảnh dấu "đã thay đổi".

---

## 4. Phân quyền — test chéo vai trò

Chạy các kiểm tra sau để xác nhận **người không có quyền không xem được / không
làm được**.

> **Cách thử chung:** với mỗi vai trò, đăng nhập → vừa dùng menu bình thường
> (xem nút chức năng có hiện không), vừa thử **gõ trực tiếp địa chỉ trang** vào
> thanh địa chỉ của trình duyệt.

| # | Hành động | Vai trò thử | Kết quả mong đợi |
|---|-----------|-------------|------------------|
| RB-1 | Vào màn **Điều xe** | Điều vận: được phép; `laixe`, `giaonhan`: thử truy cập | Điều vận thao tác được; Lái xe/Ops bị chuyển hướng hoặc hiện thông báo không có quyền |
| RB-2 | Vào màn **Công nợ AR**, **AP**, **P&L** | `laixe`, `giaonhan`, `cus` | Bị chuyển hướng / hiện thông báo không có quyền |
| RB-3 | Bấm **"Hoàn thành"** lô | `laixe`, `giaonhan` | Bị chặn / nút bị ẩn |
| RB-4 | Đánh dấu **thu hồi POD** | `laixe` | Bị chặn (chỉ Kế toán / Nhân viên chứng từ được làm) |
| RB-5 | Xem **lợi nhuận / giá vốn / lương lái xe** ở chi tiết chuyến | `giaonhan` (Ops), Điều vận | **Không thấy** (ẩn hoàn toàn) |
| RB-6 | Thêm/sửa/xóa danh mục (Khách hàng, Bảng giá, Xe) | `giaonhan`, `cus` | `cus` chỉ thêm mới được; không sửa/xóa (nút ẩn; vào trang sửa bị chặn). `giaonhan` không có quyền. |

**❌ Báo lỗi (P0) nếu:** vai trò không có quyền vẫn thấy dữ liệu nhạy cảm (lợi
nhuận, giá vốn, lương) hoặc vẫn thao tác được (điều xe, hoàn thành, sửa danh mục).

---

## 5. Trường hợp biên & ngoại lệ

| # | Tên test | Vai trò | Kết quả mong đợi |
|---|----------|---------|------------------|
| EG-1 | Hoàn thành khi **chưa thu hồi POD** | `ketoan` | Bị chặn; không đổi trạng thái (Test 5) |
| EG-2 | **Bấm 2 lần** "Hoàn thành" (mạng chậm) | `ketoan` | Chỉ tạo 1 yêu cầu / 1 bộ số liệu; lần 2 báo "đã có" |
| EG-3 | Điều xe cho **xe đang bận** (đã gán chuyến đang chạy) | Điều vận | Cảnh báo / chặn (không gán trùng) |
| EG-3A | Kẹp hai lệnh chạy hai chiều | Điều vận | Hệ thống tự chỉ tính một định mức phí đường khép kín; không cần sửa tay |
| EG-3B | Duyệt lại cùng một khoản phí chi hộ | `ketoan` | Chỉ có một bút toán cấn trừ tạm ứng; thao tác lặp là idempotent |
| EG-4 | Sửa chi phí **sau Hoàn thành** | `ketoan` | Sửa được; số liệu AR/AP đánh dấu "đã thay đổi" (Test 7) |
| EG-5 | Mất kết nối khi Ops/Lái xe đẩy chi phí | `giaonhan`, `laixe` | Thông báo tiếng Việt; dữ liệu không mất; online lại gửi thành công |
| EG-6 | Hủy chuyến **đã Hoàn thành** | `admin` | Cần phê duyệt; **hoàn tác** công nợ AR/AP đã ghi |
| EG-7 | Chuyến **chưa hoàn thành** vào cuối kỳ | `admin` | Đánh dấu "đang thực hiện", **không** tính vào số chính thức kỳ |
| EG-8 | Phụ phí xăng dầu khi **đổi giá dầu** trước chốt | `ketoan` → `cus` | Tự tính lại phụ phí |

---

## 6. Đối chiếu liên phân hệ (End-to-End)

Chọn **1 lô đã đi đủ 4 bước** và đối chiếu số liệu chảy đúng xuyên suốt.

**Các bước:**
1. Chọn 1 lô `Hoàn thành`.
2. Thu thập số liệu tại 5 điểm:
   - Chi tiết lô
   - Chi tiết chuyến
   - Danh sách chi phí
   - Giấy báo nợ / Debit Note
   - Công nợ AR sau khi chụp số liệu
3. So sánh: **Tổng doanh thu**, **Tổng chi phí**, **Lợi nhuận** qua 5 điểm.

**Kết quả mong đợi (Pass):**
- ✅ Tổng **khớp** qua 5 điểm (lô → chuyến → chi phí → debit note → AR).
- ✅ **Truy ngược** được từ AR về chứng từ gốc.
- ✅ P&L tách `Xe nhà`/`Xe ngoài` khớp tổng kỳ.

**Bằng chứng:** bảng so sánh 5 cột + ảnh từng màn.

---

## 7. Bảng nghiệm thu

Điền kết quả sau mỗi ca. Copy thêm dòng nếu cần.

| Ngày thử | Mã test | Người thử | Kết quả (Pass/Fail/Blocked) | Lỗi ghi chú | Bằng chứng |
| -------- | ------- | --------- | --------------------------- | ----------- | ---------- |
| __/__/__ | Test 1 — Tạo lô + tự áp giá | | | | |
| __/__/__ | Test 2 — Điều xe | | | | |
| __/__/__ | Test 3 — Ops chi hộ + giá nâng hạ | | | | |
| __/__/__ | Test 4 — Lái xe nhận lệnh + chi phí | | | | |
| __/__/__ | Test 5 — Cổng POD | | | | |
| __/__/__ | Test 6 — Duyệt chi phí + hoàn thành | | | | |
| __/__/__ | Test 7 — Chụp số liệu AR/AP + P&L | | | | |
| __/__/__ | RB-1 … RB-6 (phân quyền) | | | | |
| __/__/__ | EG-1 … EG-8 (biên/ngoại lệ) | | | | |
| __/__/__ | §6 Đối chiếu E2E | | | | |

---

## 8. Cách ghi lỗi

1. **Không sửa test case cho khớp.** Ghi nhận lỗi thật.
2. **Tái hiện được:** ghi rõ môi trường (staging/nội bộ), trình duyệt, thời điểm,
   tài khoản dùng.
3. **Đính kèm bằng chứng:** ảnh màn hình + ảnh thông báo lỗi hiện trên màn.
4. **Đối chiếu PRD trước khi báo:** trích đúng bước/yêu cầu PRD. Nếu phần mềm
   khác PRD, ghi lỗi; không tạo ngoại lệ theo hành vi hiện tại.
5. **Phân loại ưu tiên:**
   - **P0** (chặn nghiệp vụ, hỏng sổ sách/công nợ): ví dụ hoàn thành được khi
     chưa POD; dữ liệu nhạy cảm lộ cho vai trò không có quyền; số liệu AR/AP lệch/sai.
   - **P1** (luồng chính hỏng): không điều xe / không duyệt chi phí / không hoàn thành.
   - **P2** (biên, trải nghiệm): thông báo tiếng Việt sai, ảnh không xem lại, định dạng số.
