# Kế hoạch Kiểm thử theo Vai trò & Luồng — SilverSea TTransport

> **Mục đích:** Tài liệu tổng quan cho bộ acceptance criteria được phân chia theo từng vai trò và từng
> luồng nghiệp vụ chính trong quy trình Order-to-Cash (O2C). Mỗi vai trò có một tệp riêng chứa
> toàn bộ các flow mà vai trò đó sở hữu hoặc tham gia.
>
> **Nguồn chân lý:** Mọi tiêu chí được dẫn xuất từ:
> - `docs/prd/O2C Flow.md` — Quy trình O2C end-to-end
> - `docs/prd/quytrinh-o2c-qa-test-plan.md` — 20 test cases O2C (TC-MO2C-00 → TC-MO2C-19)
> - `docs/regression-testing/*.md` — 17 tệp hồi quy ~470+ test cases
> - `docs/prd/Module1.docx` … `Module12.docx` — 12 phân hệ PRD
> - `docs/prd/business-logic-qa-proposals.md` — 23 quy tắc Q01–Q23
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
| 5 | ~~Chi phí phát sinh (Ops)~~ (flow retired; ops expense plan deleted 2026-09) | — | — | — |
| 6 | **Duyệt e-POD & Chốt O2C** | Kế toán (ACCOUNTANT) / CUS | — | `06-ketoan-chot-o2c.md` |
| 7 | **RBAC & Phân quyền** | Tất cả 8 vai trò | — | `07-rbac-phan-quyen.md` |
| 8 | **Cổng Khách hàng** | Khách hàng (CUSTOMER) | — | `08-customer-portal.md` |

---

## 3. Tài khoản kiểm thử

Mật khẩu chung: `Abc123`. URL local: `http://localhost:7174`

| Username | Vai trò | Ghi chú |
|----------|---------|---------|
| `admin` | ADMIN | Superuser, dùng khi cần quyền cao nhất |
| `giamdoc` | MANAGER | Quản lý: duyệt ngoại lệ, báo cáo |
| `ketoan` | ACCOUNTANT | Kế toán: ghi chi phí, duyệt e-POD, chốt O2C |
| `cus` | CLERK (CUS) | Chứng từ: tạo lô, kiểm tra POD |
| `dieuvan` | DISPATCHER | Điều vận: ghép chuyến, phân xe, phát lệnh |
| `giaonhan` | FORWARDER | Hiện trường: tạm ứng, khoản chi hộ |
| `laixe` | DRIVER | Lái xe: nhận lệnh, cập nhật tiến độ, e-POD |
| `thu`, `pho`, `quyet` | DRIVER | Lái xe dự phòng (multi-driver test) |
| `customer` | CUSTOMER | Cổng khách hàng: theo dõi lô, giấy báo nợ |

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
