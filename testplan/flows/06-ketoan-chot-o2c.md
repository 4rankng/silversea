> **⚠ RETIRED FLOW (2026-09-06).** The PENDING_EXPENSE_APPROVAL pre-condition this flow is built on no longer exists: the stage was retired 2026-09-05 (efc94827) and removed from the status vocabulary 2026-09-06 (7dd66d05). Direct close now gates on IN_TRANSIT. The AR/AP snapshot + reconciliation concepts below remain valid reference for the deferred accounting suite ("kế toán = từ từ"); the gated close path itself is not reachable. Do not write new tests against this flow as-is.

# Luồng 6: Duyệt e-POD, Chốt O2C & Xuất Debit Note — Kế toán (Accountant)

> **Vai trò sở hữu:** Kế toán (ACCOUNTANT) / CUS
> **Tài khoản demo:** `ketoan` (password: `Abc123`), `cus` cho phần CUS
> **Route chính:** `/shipments/:id` (e-POD review, close), `/debt` (AR), `/payables` (AP), `/finance` (P&L)
> **PRD nguồn:** Module 05, 06, 11, O2C Bước 4, TC-MO2C-10 → TC-MO2C-15
>
> **Tổng quan luồng:** Kế toán/CUS duyệt e-POD (2 slot bắt buộc), xác nhận POD giấy, rồi chốt
> trực tiếp lô hàng → COMPLETED. Hệ thống sinh snapshot AR/AP/P&L, xuất Debit Note. Chặn đóng
> khi thiếu điều kiện (e-POD chưa ACCEPTED, POD giấy chưa thu hồi, chi phí chưa đủ scope).

---

## 6.1 — Chặn đóng khi thiếu điều kiện (Negative Tests)

### TC-KT-CHOTO2C-001 — Chặn COMPLETED khi e-POD chưa ACCEPTED

- **Mã PRD:** TC-MO2C-10
- **Vai trò:** `ketoan` hoặc `cus`
- **Mức độ:** P0
- **Tiền điều kiện:** Shipment PENDING_EXPENSE_APPROVAL, e-POD SUBMITTED (chưa ACCEPTED)
- **Các bước:**
  1. Mở `/shipments/:id`. Ghi trạng thái/version.
  2. Thử bấm "Hoàn thành" trực tiếp khi e-POD chưa ACCEPTED.
- **Kết quả mong đợi (Pass):**
  - Hệ thống **chặn**: nêu đúng điều kiện thiếu (e-POD chưa duyệt).
  - Shipment vẫn PENDING_EXPENSE_APPROVAL.
  - Không phát sinh snapshot/ledger/Debit Note.
- **Kỳ vọng sai (Fail nếu):**
  - Chuyển COMPLETED khi e-POD chưa ACCEPTED.
  - Sinh AR/AP/P&L khi chưa đủ điều kiện.
- **Bằng chứng:** ảnh thông báo chặn + trạng thái trước/sau + AR không có dữ liệu mới

---

### TC-KT-CHOTO2C-002 — Chặn COMPLETED khi chưa xác nhận POD giấy

- **Mã PRD:** TC-MO2C-10, O2C Bước 4
- **Vai trò:** `ketoan`
- **Mức độ:** P0
- **Các bước:**
  1. e-POD đã ACCEPTED. Nhưng chưa tích "Đã thu hồi chứng từ gốc (POD mộc đỏ)".
  2. Thử bấm "Hoàn thành".
- **Kết quả mong đợi (Pass):**
  - Chặn: "Chưa xác nhận thu hồi POD giấy".
  - Không chuyển COMPLETED.
- **Bằng chứng:** ảnh thông báo chặn

---

### TC-KT-CHOTO2C-003 — Chặn COMPLETED khi chi phí chưa đủ scope

- **Mã PRD:** TC-MO2C-10
- **Vai trò:** `ketoan`
- **Mức độ:** P0
- **Tiền điều kiện:** e-POD ACCEPTED, POD giấy đã xác nhận, nhưng 1 scope chi phí chưa hoàn tất
- **Các bước:**
  1. Thử bấm "Hoàn thành".
- **Kết quả mong đợi (Pass):**
  - Chặn: "Còn scope chi phí chưa hoàn tất".
  - Shipment vẫn PENDING_EXPENSE_APPROVAL.
- **Bằng chứng:** ảnh thông báo chặn + ảnh danh sách scope chưa xong

---

## 6.2 — Duyệt e-POD

### TC-KT-CHOTO2C-004 — Kế toán duyệt e-POD thành công

- **Mã PRD:** TC-MO2C-11
- **Vai trò:** `ketoan`
- **Mức độ:** P0
- **Tiền điều kiện:** e-POD SUBMITTED, 2 file bắt buộc đã tải
- **Các bước:**
  1. Mở `/shipments/:id` → e-POD & điều kiện hoàn thành.
  2. Tải và đối chiếu từng file (phiếu bãi + biên bản giao nhận).
  3. Bấm "Duyệt e-POD".
  4. Xác nhận hộp thoại "Đã thu hồi chứng từ gốc (POD mộc đỏ)".
  5. Ghi reviewer, thời gian, submission version, status → ACCEPTED.
- **Kết quả mong đợi (Pass):**
  - e-POD chuyển ACCEPTED.
  - Reviewer, timestamp, version được ghi nhận.
  - POD giấy xác nhận riêng biệt nhưng bắt buộc.
  - Chỉ **current submission** đủ hồ sơ mới được ACCEPTED.
- **Kỳ vọng sai (Fail nếu):**
  - Accountant bị 403 (PRD cấp quyền cho Accountant).
  - Không cần xác nhận POD giấy.
  - Duyệt thiếu file.
  - Reviewer/timestamp không lưu.
- **Bằng chứng:** ảnh file review + ảnh hộp thoại POD giấy + status ACCEPTED + reviewer/timestamp

---

### TC-KT-CHOTO2C-005 — Xử lý lại cùng version ở tab khác → bị từ chối

- **Mã PRD:** TC-MO2C-11
- **Vai trò:** `ketoan`
- **Mức độ:** P1
- **Các bước:**
  1. e-POD đã ACCEPTED ở tab 1.
  2. Mở cùng e-POD ở tab 2. Thử duyệt lại.
- **Kết quả mong đợi (Pass):**
  - Bị từ chối: "e-POD đã được duyệt" hoặc stale version conflict.
  - Không tạo bản ghi mới.
- **Bằng chứng:** ảnh thông báo từ chối

---

### TC-KT-CHOTO2C-006 — Từ chối e-POD có lý do → Driver phải tạo phiên bản mới

- **Mã PRD:** TC-MO2C-11
- **Vai trò:** `ketoan`
- **Mức độ:** P0
- **Các bước:**
  1. e-POD SUBMITTED. Bấm "Từ chối".
  2. Nhập lý do từ chối.
  3. Kiểm tra: Driver thấy e-POD bị từ chối, phải tạo phiên bản mới.
- **Kết quả mong đợi (Pass):**
  - Từ chối giữ lịch sử (lý do, reviewer, timestamp).
  - Driver phải nộp lại e-POD phiên bản mới.
  - Phiên bản cũ không bị thay thế/xóa.
- **Bằng chứng:** ảnh từ chối + lý do + ảnh cổng lái xe thấy bị từ chối

---

## 6.3 — Chốt O2C trực tiếp (Kế toán hoặc CUS)

### TC-KT-CHOTO2C-007 — Kế toán chốt trực tiếp — COMPLETED

- **Mã PRD:** TC-MO2C-12
- **Vai trò:** `ketoan`
- **Mức độ:** P0
- **Tiền điều kiện:** e-POD ACCEPTED, POD giấy đã xác nhận, mọi scope hoàn tất, ảnh container+seal có
- **Các bước:**
  1. Xác nhận lại: trip IN_TRANSIT, shipment PENDING_EXPENSE_APPROVAL, e-POD ACCEPTED, POD giấy OK, scope đủ.
  2. Chọn VAT.
  3. Bấm "Hoàn thành".
  4. Refresh mọi màn liên quan.
- **Kết quả mong đợi (Pass):**
  - Trip và shipment chuyển COMPLETED **đúng một lần**.
  - Snapshot/ledger/posting tài chính chỉ sinh **một lần**.
  - Ghi người thao tác (ketoan), thời điểm, VAT.
  - Không cần chuỗi phê duyệt 3 người hay `/governance-actions` — Kế toán/CUS chốt trực tiếp.
- **Kỳ vọng sai (Fail nếu):**
  - Bắt buộc chuỗi phê duyệt (Manager → Admin → Kế toán).
  - Thiếu ảnh/scope/POD vẫn hoàn thành.
  - Double posting.
  - Trip hoặc shipment sai trạng thái.
- **Bằng chứng:** ảnh điều kiện close + actor/thời điểm/VAT + trạng thái COMPLETED + snapshot ID

---

### TC-KT-CHOTO2C-008 — CUS cũng có thể chốt trực tiếp

- **Mã PRD:** TC-MO2C-12
- **Vai trò:** `cus`
- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `cus`. Mở lô đủ điều kiện.
  2. Chọn VAT. Bấm "Hoàn thành".
- **Kết quả mong đợi (Pass):**
  - CUS chốt trực tiếp được khi mọi gate đúng (tương tự Kế toán).
  - Không cần phê duyệt bổ sung.
- **Bằng chứng:** ảnh CUS đóng + trạng thái COMPLETED

---

## 6.4 — Snapshot AR / AP / P&L

### TC-KT-CHOTO2C-009 — Snapshot AR chính xác tại thời điểm close

- **Mã PRD:** TC-MO2C-14
- **Vai trò:** `ketoan`
- **Mức độ:** P0
- **Các bước:**
  1. Ghi doanh thu, VAT, tổng AR tại thời điểm close.
  2. Mở `/debt`, lọc theo khách/kỳ.
  3. Đối chiếu: AR sau VAT = doanh thu trước VAT + VAT.
- **Kết quả mong đợi (Pass):**
  - Snapshot AR sinh đúng **một lần** tại COMPLETED.
  - Số liệu khớp phép tính: `AR = doanh thu + VAT`.
  - Source ID truy ngược được.
  - Xe nhà/Xe ngoài tách đúng.
- **Kỳ vọng sai (Fail nếu):**
  - Thiếu/trùng snapshot.
  - Lệch số/VAT.
  - Không truy ngược nguồn.
- **Bằng chứng:** ảnh `/debt` + source IDs + worksheet đối chiếu

---

### TC-KT-CHOTO2C-010 — Snapshot AP đúng NCC

- **Mã PRD:** TC-MO2C-14
- **Vai trò:** `ketoan`
- **Mức độ:** P0
- **Các bước:**
  1. Mở `/payables`, lọc theo kỳ.
  2. Kiểm tra: Xe ngoài có AP NCC/chủ xe phù hợp.
  3. Kiểm tra: Xe nhà không bị ghi như xe ngoài.
- **Kết quả mong đợi (Pass):**
  - AP đúng NCC cho xe ngoài.
  - Xe nhà/Xe ngoài phân loại đúng.
  - Tổng AP khớp nguồn.
- **Bằng chứng:** ảnh `/payables` + phân loại xe

---

### TC-KT-CHOTO2C-011 — P&L = Doanh thu − Chi phí

- **Mã PRD:** TC-MO2C-14, M11
- **Vai trò:** `ketoan`, `giamdoc`
- **Mức độ:** P0
- **Các bước:**
  1. Mở `/finance`, lọc theo kỳ.
  2. Đối chiếu: lợi nhuận = doanh thu trước VAT − tổng chi phí.
  3. Cộng 2 nhóm (Xe nhà + Xe ngoài) và so với tổng kỳ.
- **Kết quả mong đợi (Pass):**
  - P&L khớp phép tính.
  - Tổng nhóm = tổng kỳ.
  - Xe nhà/Xe ngoài tách đúng.
- **Bằng chứng:** ảnh `/finance` + worksheet

---

## 6.5 — Xuất Debit Note

### TC-KT-CHOTO2C-012 — Tạo và xuất Debit Note

- **Mã PRD:** TC-MO2C-13
- **Vai trò:** `ketoan`
- **Mức độ:** P0
- **Các bước:**
  1. Mở `/debt`. Chọn khách hàng và chu kỳ chứa trip đã COMPLETED.
  2. Tạo preview/draft Debit Note.
  3. Xác nhận chỉ trip đủ điều kiện (COMPLETED + e-POD ACCEPTED) được chọn.
  4. Lưu Debit Note. Ghi `billingDocumentId`.
  5. Export XLSX.
  6. Mở workbook: tìm Booking/BL, trip ID, doanh thu, VAT, tổng sau VAT.
  7. Đối chiếu với snapshot close.
- **Kết quả mong đợi (Pass):**
  - Chỉ trip COMPLETED có e-POD ACCEPTED được bill.
  - Không claim trùng.
  - XLSX mở được, chứa đúng run ID/trip/số tiền/VAT/tổng.
  - Số liệu khớp snapshot close.
- **Kỳ vọng sai (Fail nếu):**
  - Trip chưa đủ điều kiện xuất hiện.
  - Trip bị trùng.
  - Export lỗi/trống.
  - Sai Booking/BL/trip/số tiền/VAT.
- **Bằng chứng:** ảnh builder + billingDocumentId + file XLSX + worksheet đối chiếu

---

## 6.6 — Điều chỉnh sau hoàn thành

### TC-KT-CHOTO2C-013 — Chặn sửa trực tiếp dữ liệu đã duyệt

- **Mã PRD:** TC-MO2C-15, Q18
- **Vai trò:** `ketoan`
- **Mức độ:** P0
- **Tiền điều kiện:** Trip COMPLETED, đã có snapshot
- **Các bước:**
  1. Chọn chi phí đã duyệt. Thử sửa trực tiếp.
  2. Thử sửa giá trị trong snapshot AR/AP.
- **Kết quả mong đợi (Pass):**
  - Không cho sửa trực tiếp.
  - Chỉ có nút "Tạo điều chỉnh" / "Tạo yêu cầu điều chỉnh".
  - Snapshot cũ giữ nguyên.
- **Bằng chứng:** ảnh "Không thể sửa trực tiếp" + nút điều chỉnh

---

### TC-KT-CHOTO2C-014 — Tạo yêu cầu điều chỉnh qua workflow

- **Mã PRD:** TC-MO2C-15, Q18
- **Vai trò:** `ketoan` (maker) + `giamdoc` (approver)
- **Mức độ:** P0
- **Các bước:**
  1. `ketoan` tạo yêu cầu điều chỉnh chi phí, bắt buộc nhập lý do.
  2. Nếu thay đổi tiền: dùng checker/approver khác maker → `giamdoc` duyệt.
  3. Sau phê duyệt: mở lại expense, AR/AP, audit.
- **Kết quả mong đợi (Pass):**
  - Điều chỉnh lưu before/after, lý do, actor/version, approval.
  - Snapshot cũ giữ nguyên, có cờ cần đối soát.
  - Giá trị điều chỉnh liên kết với snapshot cũ.
  - Actor độc lập khi thay đổi tiền.
- **Kỳ vọng sai (Fail nếu):**
  - Cho ghi đè trực tiếp.
  - Mất lịch sử.
  - Không có cờ reconciliation.
  - Snapshot cũ bị đổi âm thầm.
- **Bằng chứng:** ảnh yêu cầu điều chỉnh + audit before/after + cờ reconciliation

---

## 6.7 — Đối chiếu 5 điểm

### TC-KT-CHOTO2C-015 — Worksheet đối chiếu 5 điểm (FCL + LCL)

- **Mã PRD:** TC-MO2C-19
- **Vai trò:** `ketoan` / QA
- **Mức độ:** P0
- **Các bước:**
  1. Tạo worksheet cho lô FCL và LCL.
  2. Đối chiếu 5 điểm: Shipment → Trip → Expenses → Debit Note → AR.
  3. Kiểm tra: doanh thu, chi phí, VAT, AR, AP, lợi nhuận, source IDs.
  4. Công thức: `AR sau VAT = doanh thu trước VAT + VAT`; `lợi nhuận = doanh thu − tổng chi phí`.
- **Kết quả mong đợi (Pass):**
  - 5 điểm khớp và truy vết hai chiều.
  - AP/P&L khớp nguồn.
  - Mọi số có source ID.
- **Bằng chứng:** worksheet 5 điểm + source IDs

---

## Bảng nghiệm thu — Luồng Chốt O2C (Kế toán)

| Ngày thử | Mã TC | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|-----------|---------|---------|------------|
| __/__/__ | TC-KT-CHOTO2C-001 | | | Chặn e-POD chưa ACCEPTED | |
| __/__/__ | TC-KT-CHOTO2C-002 | | | Chặn POD giấy chưa thu hồi | |
| __/__/__ | TC-KT-CHOTO2C-003 | | | Chặn scope chưa đủ | |
| __/__/__ | TC-KT-CHOTO2C-004 | | | Duyệt e-POD | |
| __/__/__ | TC-KT-CHOTO2C-005 | | | Stale version | |
| __/__/__ | TC-KT-CHOTO2C-006 | | | Từ chối e-POD | |
| __/__/__ | TC-KT-CHOTO2C-007 | | | KT chốt trực tiếp | |
| __/__/__ | TC-KT-CHOTO2C-008 | | | CUS chốt trực tiếp | |
| __/__/__ | TC-KT-CHOTO2C-009 | | | Snapshot AR | |
| __/__/__ | TC-KT-CHOTO2C-010 | | | Snapshot AP | |
| __/__/__ | TC-KT-CHOTO2C-011 | | | P&L | |
| __/__/__ | TC-KT-CHOTO2C-012 | | | Debit Note | |
| __/__/__ | TC-KT-CHOTO2C-013 | | | Chặn sửa trực tiếp | |
| __/__/__ | TC-KT-CHOTO2C-014 | | | Điều chỉnh workflow | |
| __/__/__ | TC-KT-CHOTO2C-015 | | | Đối chiếu 5 điểm | |
