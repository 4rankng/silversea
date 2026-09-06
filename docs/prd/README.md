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

`archive/` chứa 12 tệp `Module*.docx` gốc — giữ để tra cứu, **không** phải nguồn chân lý hiện hành.

---

## Thay đổi có hiệu lực gần nhất

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
| `MasterDataNhaMay.md` §2.1, §4 (lệnh chạy ngoài) | `testplan/flows/01-cus-create-shipment.md` §1.11 (`TC-CUS-CREATE-026`…`-037`), `testplan/roles/01-cus.md` `CUS-SHIP-09`…`-15` |
| `LoHangKepKetHop.md` | `testplan/flows/09-kep-kethop-ghep-chuyen.md`, `testplan/roles/02-dieuvan.md` |
| `OpsVanHanh.md` | `testplan/flows/05-ops-quy-chi-phi.md`, `testplan/roles/06-vanhanh.md` Flow 7–9 |
| `ManHinhLaiXe.md` §1–§3 (điều hướng, thẻ 2 lớp) | `testplan/flows/03-laixe-nhan-lenh.md` §3.7 (`TC-LX-NHANLENH-014`…`-020`) |
| `ManHinhLaiXe.md` §4 (e-POD) | `testplan/flows/04-laixe-tien-do-epod.md` §4.5 (`TC-LX-TIENDO-018`…`-022`) |
| `ManHinhLaiXe.md` (tổng thể) | `testplan/roles/03-laixe.md` |
