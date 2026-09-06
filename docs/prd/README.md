# PRD — TTransport / Silver Sea

Tài liệu đặc tả nghiệp vụ đang có hiệu lực. Mỗi tệp ghi rõ nguồn (`.docx` yêu cầu
từ khách hàng) ở đầu trang.

| Tài liệu | Phạm vi | Nguồn |
|----------|---------|-------|
| [`QuyTrinhO2C.md`](QuyTrinhO2C.md) | Quy trình end-to-end: Chứng từ → Điều vận → Lái xe → Chốt hồ sơ | tổng hợp |
| [`MasterDataNhaMay.md`](MasterDataNhaMay.md) | Quan hệ Khách hàng – Nhà máy – Tuyến – Vị trí; cascading dropdown + auto-fill | `2026.9.6_Logic_nghiep_vu.docx` Phần 1 |
| [`LoHangKepKetHop.md`](LoHangKepKetHop.md) | Lô hàng Kẹp & Kết hợp: định nghĩa, mô hình dữ liệu, thuật toán chống nhân đôi chi phí | `2026.9.6_Logic_nghiep_vu.docx` Phần 2 |
| [`OpsVanHanh.md`](OpsVanHanh.md) | 3 màn hình nhân viên hiện trường: kế hoạch làm hàng, theo dõi phương tiện, ví tạm ứng | `2026.9.6_Man_hinh_ops.docx` |
| [`ManHinhLaiXe.md`](ManHinhLaiXe.md) | App Lái xe: cấu trúc thẻ 2 lớp, luồng nhận lệnh, e-POD bắt buộc | `2026.8.27_Man_hinh_lai_xe.docx` |

`archive/` chứa 12 tệp `Module*.docx` gốc — giữ để tra cứu, **không** phải nguồn chân lý hiện hành.

---

## Thay đổi có hiệu lực gần nhất

**2026-09-06 — Định nghĩa lại Kẹp / Kết hợp.** Hai khái niệm đã **hoán đổi bản chất
thời gian** so với PRD trước đó (Kẹp = đồng thời, Kết hợp = nối tiếp). Chi tiết và
danh sách acceptance criteria bị ảnh hưởng: [`LoHangKepKetHop.md`](LoHangKepKetHop.md).

---

## Bản đồ sang test plan

| PRD | Test plan tương ứng |
|-----|---------------------|
| `MasterDataNhaMay.md` | `testplan/flows/01-cus-create-shipment.md` §1.10 |
| `LoHangKepKetHop.md` | `testplan/flows/09-kep-kethop-ghep-chuyen.md`, `testplan/roles/02-dieuvan.md` |
| `OpsVanHanh.md` | `testplan/flows/05-ops-quy-chi-phi.md`, `testplan/roles/06-vanhanh.md` |
| `ManHinhLaiXe.md` | `testplan/roles/03-laixe.md`, `testplan/flows/03-laixe-nhan-lenh.md`, `testplan/flows/04-laixe-tien-do-epod.md` |
