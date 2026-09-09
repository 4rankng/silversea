# PRD — TTransport / Silver Sea

Tài liệu đặc tả nghiệp vụ đang có hiệu lực. Mỗi tệp ghi rõ nguồn (`.docx` yêu cầu
từ khách hàng) ở đầu trang.

| Tài liệu | Phạm vi | Nguồn |
|----------|---------|-------|
| [`QuyTrinhO2C.md`](QuyTrinhO2C.md) | Quy trình end-to-end: Chứng từ → Điều vận → Lái xe → Chốt hồ sơ | tổng hợp |
| [`MasterDataNhaMay.md`](MasterDataNhaMay.md) | Quan hệ Khách hàng – Nhà máy – Tuyến – Vị trí; cascading + auto-fill; **lệnh chạy ngoài + lưu trữ hỗn hợp** | `2026.9.6_Logic_nghiep_vu.docx` Phần 1 |
| [`LoHangKepKetHop.md`](LoHangKepKetHop.md) | Lô hàng Kẹp & Kết hợp: định nghĩa, mô hình dữ liệu, thuật toán chống nhân đôi chi phí | `2026.9.6_Logic_nghiep_vu.docx` Phần 2 |
| [`OpsVanHanh.md`](OpsVanHanh.md) | 3 màn hình nhân viên hiện trường: kế hoạch làm hàng, theo dõi phương tiện, ví tạm ứng | `2026.9.6_Man_hinh_ops.docx` |
| [`ManHinhLaiXe.md`](ManHinhLaiXe.md) | App Lái xe: cấu trúc thẻ 2 lớp, luồng nhận lệnh, e-POD bắt buộc | `2026.8.27_Man_hinh_lai_xe.docx` |
| [`CuocPhiPhuPhiDau.md`](CuocPhiPhuPhiDau.md) | **Bảng cước phí — thiết kế logic:** công thức, tham số, bảng cước thành phẩm, quy tắc làm tròn | `18.7 - BG Long Minh T7.xlsx` |
| [`CuocPhiThietKeDB.md`](CuocPhiThietKeDB.md) | **Bảng cước phí — thiết kế DB schema:** 5 bảng mới + thuật toán `resolveFreightRate()` + snapshot *(APPROVED DIRECTION — 10/09)* | dẫn xuất từ `CuocPhiPhuPhiDau.md` |
| [`PhuongAnTinhCuocTuDong.md`](PhuongAnTinhCuocTuDong.md) | **Phương án tính cước tự động:** 5 mục docx KH ↔ engine/schema; mapping 4 nhóm tham số A-D, 3-step engine, debit-note override, fuel-price entry | `Phương án tính cước tự động.docx` (KH gửi 09/09) |
| [`CauHoiKhachHang_CuocPhi_2026-09-08.md`](CauHoiKhachHang_CuocPhi_2026-09-08.md) | **5 câu hỏi nghiệp vụ cần khách hàng Long Minh trả lời** trước khi triển khai | — |

`archive/` chứa 12 tệp `Module*.docx` gốc — giữ để tra cứu, **không** phải nguồn chân lý hiện hành.

> **Trạng thái tài liệu (2026-09-10):** tất cả PRD trong bảng trên là **đặc tả đang
> có hiệu lực**. [`CuocPhiThietKeDB.md`](CuocPhiThietKeDB.md) đã chuyển từ `ĐỀ XUẤT`
> sang **APPROVED DIRECTION** sau khi wave spec (`run-1788968588650-mctezn`) khóa 3
> quyết định KH (Câu 1=B, 2=A, 4=A) và anchor = Ngày vận chuyển (đóng item 2b).
> [`PhuongAnTinhCuocTuDong.md`](PhuongAnTinhCuocTuDong.md) là tài liệu mới cho wave
> auto-pricing, neo 5 mục docx KH ↔ engine/schema hiện có. Còn **4 open items** theo
> dõi trong ticket `e3873fbc` — xem chi tiết tại [`PhuongAnTinhCuocTuDong.md`](PhuongAnTinhCuocTuDong.md)
> §4 và [`CuocPhiThietKeDB.md`](CuocPhiThietKeDB.md) §6.2 (Còn mở).

---

## Thay đổi có hiệu lực gần nhất

**2026-09-10 — Wave auto-pricing (`run-1788968588650-mctezn`): tài liệu mới + flip status.**
PRD mới [`PhuongAnTinhCuocTuDong.md`](PhuongAnTinhCuocTuDong.md) neo 5 mục của docx
`Phương án tính cước tự động.docx` (KH gửi 09/09) vào engine/schema hiện có:
(1) công thức cước cốt lõi,
(2) 4 nhóm tham số A-D (lag, threshold pct/abs, activation trigger, transport-date anchor),
(3) 3-step engine + snapshot no-retro,
(4) debit-note override + reason rule,
(5) fuel-price entry + RBAC.
[`CuocPhiThietKeDB.md`](CuocPhiThietKeDB.md) chuyển từ `ĐỀ XUẤT` → **APPROVED
DIRECTION** sau khi KH chốt Câu 1=B / 2=A / 4=A và docx §2D đóng item 2b
(anchor = Ngày vận chuyển). Testplan
[`flows/12-cuocphi-phuphi-dau.md`](../../testplan/flows/12-cuocphi-phuphi-dau.md)
mở rộng với `TC-CUOC-009..025` (lock-at-create, supersede, threshold pct/abs/XOR,
ratchet, MANUAL fallback 15T, override reason, config RBAC) — tất cả **BLOCKED —
pending T1**, Phase-2 evidence. Matrix coverage mới ở §5 của
[`2026-09-09-docx-trilogy.md`](../../testplan/matrix/2026-09-09-docx-trilogy.md). Còn
4 open items (Câu 5, lag ASKEY/SUNRISE+SJ, giá gốc 15T ×3 tuyến, threshold X/Z) — track
ticket `e3873fbc`. Wiring/config/UI/tests thuộc ticket T1 (`cf5f4e29`), T2 (`a7f6740f`),
T3 (`06b1a41f`), T4 (`28002a59`), T6 (`2b5b9b5d`).

**2026-09-09 — Đối chiếu trọn bộ 3 docx (trilogy reconciliation).** Toàn bộ yêu cầu
của `Man_hinh_lai_xe` / `Logic_nghiep_vu` / `Man_hinh_ops` đã được đối chiếu code,
đóng gap, và neo test: ma trận 55 dòng
[`testplan/matrix/2026-09-09-docx-trilogy.md`](../../testplan/matrix/2026-09-09-docx-trilogy.md).
Gap đã đóng: nhãn `Giờ đóng / trả:` + CTA ≥48px trên thẻ app lái xe (`7a098f28`),
tag `[KẸP]/[KẾT HỢP]` trên chi tiết lô CUS (`90a17e65`), micro-ledger gom cùng mã lô
nhiều người chi trên tab kế toán (`cda12f57`), **duyệt 2 đường cho khoản thiếu ảnh**
(ảnh hợp lệ HOẶC kiểm chứng giấy tận tay `inPersonCheck=true` + ghi chú bắt buộc, ghi
audit log — `723c7fd2`). Deviation đã ghi nhận: đẩy lệnh cho lái xe = poll 15s (không
FCM push); in hoá đơn = modal + `@media print` (không có route in riêng); PDF = browser
print-to-PDF (server-side PDF hoãn). **Chờ quyết định USER:** nhãn `Chạy ngoài` trên
danh sách lô (PRD-only, hoãn) và snapshot chữ ký nhà máy tại lúc phát lệnh (open design,
cần migration) — xem [`MasterDataNhaMay.md`](MasterDataNhaMay.md) §2 và §4.

**2026-09-08 — Cước cơ bản + phụ phí dầu (KH Long Minh).** Nguồn chân lý là file
`18.7 - BG Long Minh T7.xlsx`. Công thức: `cước = giá gốc × (1 + % chia sẻ) + (giá dầu
kỳ − giá dầu mốc) × lít định mức khứ hồi`. **Làm tròn đến từng đồng.**
⚠️ **Hai xung đột chặn với code hiện tại** (chi tiết
[`CuocPhiThietKeDB.md`](CuocPhiThietKeDB.md) §1):
(1) `computeFuelSurcharge()` đang nhân `% chia sẻ` vào **phụ phí dầu**, trong khi Excel
nhân vào **giá cước gốc** và thu phụ phí 100 %;
(2) `customers.fuel_surcharge_share_pct` lưu **1 giá trị/khách hàng**, nhưng riêng Long
Minh đã có **3 mức theo tuyến** (2 % / 2,5 % / 4 %) ⇒ schema hiện tại **không biểu diễn
được hợp đồng thật**. Thiết kế bảng đề xuất đã tái tạo đúng **48/48 mức cước** của file
gốc, sai số 0 đồng.

**2026-09-07 — Chốt: đơn vị thẻ app lái xe = 1 CONTAINER.** Quyết định sản phẩm: **docx
là chuẩn**. Thẻ Lớp 1 = 1 container / thẻ (không phải 1 chuyến / thẻ), tab con
`Lệnh mới` / `Đã nhận` / `Lịch sử`, không badge trạng thái trên thẻ. Migration board
theo mô hình container-card **đã land** (09-07, hoàn tất gap 09-09) — thẻ ghép Kẹp/
Kết hợp dính liền + khóa nối tiếp KẾT HỢP. Chi tiết: [`ManHinhLaiXe.md`](ManHinhLaiXe.md) §2.1.

**2026-09-07 — Lệnh chạy ngoài (ad-hoc orders).** Bổ sung phần còn thiếu của
`Logic_nghiep_vu.docx` Phần 1: **lưu trữ hỗn hợp** (chọn danh mục ⇒ lưu ID; gõ text tự
do ⇒ ID `null` + `Raw_*`), **guardrail không tự thêm vào danh mục gốc**, checkbox
`Lệnh chạy ngoài (Tối ưu xe rỗng)` bypass validation cước phí, và **Combobox
(Creatable Select)** cho 5 trường master data. Ràng buộc cascading/khoá read-only nay
chỉ áp dụng cho **luồng chuẩn**. Chi tiết: [`MasterDataNhaMay.md`](MasterDataNhaMay.md) §2.1 và §4.

**2026-09-06 — Định nghĩa lại Kẹp / Kết hợp.** Hai khái niệm đã **hoán đổi bản chất
thời gian** so với PRD trước đó (Kẹp = đồng thời, Kết hợp = nối tiếp). Chi tiết và
danh sách acceptance criteria bị ảnh hưởng: [`LoHangKepKetHop.md`](LoHangKepKetHop.md).

---

## Bản đồ sang test plan

| PRD | Test plan tương ứng |
|-----|---------------------|
| `MasterDataNhaMay.md` §1–§3 (luồng chuẩn) | `testplan/flows/01-cus-create-shipment.md` §1.10 (`TC-CUS-CREATE-021`…`-024`) |
| `MasterDataNhaMay.md` §2.1, §4 (lệnh chạy ngoài) | `testplan/flows/09-kep-kethop-ghep-chuyen.md` §9.5 (`TC-ADHOC-001`…`-004`), `testplan/roles/01-cus.md` `CUS-SHIP-10`…`-16` |
| `LoHangKepKetHop.md` | `testplan/flows/09-kep-kethop-ghep-chuyen.md`, `testplan/roles/02-dieuvan.md` |
| `OpsVanHanh.md` | `testplan/flows/05-ops-quy-chi-phi.md`, `testplan/roles/06-vanhanh.md` Flow 7–9 |
| `ManHinhLaiXe.md` §1–§3 (điều hướng, thẻ 2 lớp) | `testplan/flows/03-laixe-nhan-lenh.md` §3.7 (`TC-LX-NHANLENH-014`…`-020`) |
| `ManHinhLaiXe.md` §4 (e-POD) | `testplan/flows/04-laixe-tien-do-epod.md` §4.5 (`TC-LX-TIENDO-018`…`-022`) |
| `ManHinhLaiXe.md` (tổng thể) | `testplan/roles/03-laixe.md` |
| `CuocPhiPhuPhiDau.md` §1–§2 (công thức), §10 (làm tròn) | `testplan/flows/01-cus-create-shipment.md` §1.1 — **đã sửa công thức phụ phí dầu 2026-09-08** |
| `CuocPhiThietKeDB.md` | *chưa có test plan* — cần bổ sung khi triển khai |
| Toàn bộ 3 docx (ma trận đối chiếu) | `testplan/matrix/2026-09-09-docx-trilogy.md` |
