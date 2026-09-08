# Kế hoạch Kiểm thử theo Vai trò & Luồng — SilverSea TTransport

> **Mục đích:** Tài liệu tổng quan cho bộ acceptance criteria được phân chia theo từng vai trò và từng
> luồng nghiệp vụ chính trong quy trình Order-to-Cash (O2C). Mỗi vai trò có một tệp riêng chứa
> toàn bộ các flow mà vai trò đó sở hữu hoặc tham gia.
>
> **Nguồn chân lý (cập nhật 2026-09-07):** Mọi tiêu chí được dẫn xuất từ các PRD đang có
> hiệu lực trong [`docs/prd/`](../../docs/prd/README.md):
>
> | PRD | Phạm vi | Luồng tương ứng |
> |-----|---------|-----------------|
> | [`QuyTrinhO2C.md`](../../docs/prd/QuyTrinhO2C.md) | Quy trình O2C end-to-end | 1, 2, 3, 4, 6 |
> | [`MasterDataNhaMay.md`](../../docs/prd/MasterDataNhaMay.md) | Khách hàng–Nhà máy–Tuyến–Vị trí; lệnh chạy ngoài | 1 (§1.10, §1.11) |
> | [`LoHangKepKetHop.md`](../../docs/prd/LoHangKepKetHop.md) | Lô hàng Kẹp & Kết hợp | 9 |
> | [`OpsVanHanh.md`](../../docs/prd/OpsVanHanh.md) | 3 màn hình Ops hiện trường | 5 |
> | [`ManHinhLaiXe.md`](../../docs/prd/ManHinhLaiXe.md) | App Lái xe: thẻ 2 lớp, e-POD | 3, 4 |
>
> ⚠️ Các nguồn cũ từng được trích ở đây — `docs/prd/O2C Flow.md`,
> `docs/prd/quytrinh-o2c-qa-test-plan.md`, `docs/regression-testing/*.md`,
> `docs/prd/business-logic-qa-proposals.md` — **không còn tồn tại trong repo**.
> 12 tệp `Module*.docx` đã chuyển vào `docs/prd/archive/`, chỉ để tra cứu lịch sử,
> **không** phải nguồn chân lý hiện hành.
>
> **Quy ước:** Tất cả test case viết bằng tiếng Việt. Thuật ngữ kỹ thuật giữ nguyên tiếng Anh khi cần.
> Mỗi test case có mã định danh, vai trò, tiền điều kiện, các bước, kết quả mong đợi và cột bằng chứng.

---

## 1. Vòng đời Lô hàng (O2C State Machine)

```
Mới tạo (NEW) → Đã phân xe (DISPATCHED) → Đang chạy (IN_TRANSIT) → Hoàn thành (COMPLETED)
                                                                                                                    ↗
                                                                                            Đã hủy (CANCELED) ←──── (ngoại lệ)
```

---

## 2. Ma trận Vai trò × Luồng

| # | Luồng | Vai trò chính | Vai trò tham gia | Tệp |
|---|-------|--------------|------------------|-----|
| 1 | **Tạo lô hàng** | CUS (CLERK) | Admin, Manager | `01-cus-create-shipment.md` |
| 2 | **Điều xe / Phân bổ chuyến** | Điều vận (DISPATCHER) | CUS (bàn giao) | `02-dieuvan-dispatch.md` |
| 3 | **Nhận lệnh & Kích hoạt chuyến** | Lái xe (DRIVER) | Điều vận (phát lệnh) | `03-laixe-nhan-lenh.md` |
| 4 | **Cập nhật tiến độ & e-POD** | Lái xe (DRIVER) | — | `04-laixe-tien-do-epod.md` |
| 5 | **Kế hoạch làm hàng, Theo dõi xe & Quỹ tạm ứng (Ops)** | Ops / Hiện trường (OPS) | Kế toán (duyệt), Điều vận (gán chuyến) | `05-ops-quy-chi-phi.md` |
| 6 | **Duyệt e-POD & Chốt O2C** | Kế toán (ACCOUNTANT) / CUS | — | `06-ketoan-chot-o2c.md` |
| 7 | **RBAC & Phân quyền** | Tất cả 8 vai trò | — | `07-rbac-phan-quyen.md` |
| 8 | **Cổng Khách hàng** | Khách hàng (CUSTOMER) | — | `08-customer-portal.md` |
| 9 | **Ghép chuyến Kẹp & Kết hợp** | Điều vận (DISPATCHER) | Lái xe, Kế toán | `09-kep-kethop-ghep-chuyen.md` |
| 10 | **E2E & Edge Cases** | CUS, Điều vận, Admin | Tất cả | `10-e2e-regression.md` |
| 11 | **Kiểm thử Bổ sung & Cập nhật v2.0 (QA Matrix v2.0)** | CUS, Điều vận, Admin, Manager | Tất cả | `11-qa-matrix-v2-enhancements.md` |

> **Lịch sử slot Luồng 5.** Slot này từng là "Chi phí phát sinh (Ops)" gắn trạng thái
> `PENDING_EXPENSE_APPROVAL` + tự cấn trừ tạm ứng; toàn bộ cơ chế đó **đã dừng và xoá**
> ngày 2026-09-05 (commit `58a330af`) và **không được dựng lại**. Tệp hiện tại là đặc tả
> Ops **mới** ngày 2026-09-06 (3 màn `/ops/*`). Một tệp trùng lặp `05-ops-vi.md` đã được
> gộp vào `05-ops-quy-chi-phi.md` và xoá ngày 2026-09-07.


---

## 3. Tài khoản kiểm thử

Testplan này **chỉ nêu vai trò** — không ghi cứng username nào. Mỗi test
case gọi vai trò cần dùng (`CUS`, `DISPATCHER`, `ACCOUNTANT`, `MANAGER`,
`ADMIN`, `DRIVER`, `OPS`, `CUSTOMER`) và runner sẽ tra `testaccounts.txt`
để chọn đúng username theo môi trường:

- **local** (`http://localhost:7174`): prod-mirror named users **+** demo
  seed accounts (`CUS`, `DISPATCHER`, `ACCOUNTANT`, `MANAGER`, `DRIVER`,
  `OPS`, `CUSTOMER-SAMSUNG`, `CUSTOMER-CANON`) — bật sau khi `make seed`.
- **staging** (`https://vantai.tingting.vip`): chỉ có prod-mirror named
  users (vd `thanhdc` cho CUS, `dungnv` cho DISPATCHER, `bqhuong` cho
  DRIVER). **Không** có `MANAGER` / `CUSTOMER` vì prod không có role đó.

Mật khẩu chung mọi môi trường: `Abc123`. Chi tiết mapping xem
`../testaccounts.txt` (đã verify 2026-09-06: 62 users trên staging reset
về `Abc123`).

Khi viết test case mới: dùng role code in hoa (`CUS`, `DISPATCHER`, …)
chứ không ghi username. Runner / tester tự map sang account thật theo
môi trường đang chạy.

---

## 4. Mức độ ưu tiên

| Mức | Ý nghĩa | Khi nào phải thử |
|-----|---------|-----------------|
| **P0** | Chặn nghiệp vụ — sai sẽ hỏng sổ sách, công nợ | Mỗi release |
| **P1** | Luồng nghiệp vụ chính | Mỗi release |
| **P2** | Trường hợp biên, ngoại lệ, UX | Mỗi release cho phân hệ thay đổi |
| **Smoke** | Đăng nhập, điều hướng, xem báo cáo | Trước mỗi đợt regression |

---

## 5. Quy tắc PASS / FAIL / BLOCKED

| Trạng thái | Ý nghĩa |
|-----------|---------|
| **PASS** | Kết quả khớp PRD, bằng chứng đầy đủ |
| **FAIL** | Lệch PRD, thiếu control, sai dữ liệu/trạng thái/quyền, bằng chứng không đạt |
| **BLOCKED** | Không thể chạy do hạ tầng, tài khoản, master data, hoặc prerequisite chưa sẵn sàng |

**Quy tắc toàn đợt:** Một đợt chạy chỉ PASS khi **mọi case bắt buộc đều PASS**. Không dùng SKIP thay cho BLOCKED.

---

## 6. Môi trường & Thiết bị

| Thiết lập | Giá trị |
|-----------|---------|
| Desktop | 1440 × 900 |
| Mobile | 390 × 844 (hoặc iPhone SE 375 × 667 cho driver/ops) |
| Trình duyệt | Incognito / logout sạch giữa các vai trò |
| Múi giờ | `Asia/Ho_Chi_Minh` |
| Frontend local | `http://localhost:7174` |
| Backend API | `http://localhost:3001/api` |
| Health check | `http://localhost:3001/api/health` |

---

## 7. Cấu trúc mỗi test case

```markdown
### TC-<Vai trò>-<Luồng>-<STT>

- **Mã PRD:** (nếu có)
- **Vai trò:** <tài khoản demo>
- **Mức độ:** P0 / P1 / P2 / Smoke
- **Thiết bị:** Desktop / Mobile
- **Tiền điều kiện:** dữ liệu cần có sẵn
- **Các bước:**
  1. …
  2. …
- **Kết quả mong đợi (Pass):**
  - …
- **Kỳ vọng sai (Fail nếu):**
  - …
- **Bằng chứng:** ảnh / tệp xuất / mã chứng từ
```

---

## 8. Bảng nghiệm thu tổng hợp

| Ngày thử | Mã TC | Vai trò | Luồng | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|---------|-------|-----------|---------|---------|------------|
| __/__/__ | — | — | — | — | — | — | — |
