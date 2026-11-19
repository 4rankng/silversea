# Regression spec — `SIL-861` Khai chi phí: chặn trùng Số hóa đơn TRƯỚC khi lưu

**Ticket:** SIL-861 (Validation chống nhập trùng trong Popup Khai báo chi phí — Ops)
**Owner (implement):** frontend
**Owner (verify):** qa
**Status (this doc):** LANDED 2026-11-19 (worktree wt-sil855861) — verify on staging
**Cycle:** 2026-11 wave

## Goal

Popup 'Khai chi phí' (/ops/orders), tab PHÍ CÓ HÓA ĐƠN: 2 dòng cùng Số HĐ trên cùng lô phải
bị chặn NGAY khi nhập (lỗi inline dưới từng dòng + dòng tổng footer `Trùng số hóa đơn "…" —
không lưu dòng trùng.` + Lưu disabled) — hết partial save kiểu 'Đã lưu 3 dòng. 1 dòng chưa
lưu: …'. Nhiều dòng cùng LOẠI PHÍ vẫn được phép; Số HĐ bỏ trống vẫn Tùy chọn (SIL-834).

## Out of scope

- Không đổi API (409 OPS_EXPENSE_INVOICE_DUPLICATE vẫn là rào cản cuối cho số HĐ đã tồn tại
  trên lô từ phiên trước — warn/hard theo luật hiện có).
- Không đổi tab PHÍ KHÔNG HÓA ĐƠN (chặn trùng loại phí + bắt buộc cont giữ nguyên).

## Acceptance criteria

### TC-861-001 — Chặn trùng trước lưu

- **Given** hoangnh mở Khai chi phí, tab PHÍ CÓ HÓA ĐƠN, 2 dòng 'Phí hạ container'.
- **When** nhập cùng Số HĐ 'QAHĐ-001' ở cả 2 dòng.
- **Then** mỗi dòng hiện 'Trùng số hóa đơn trên lô này — không lưu dòng trùng.', footer
  hiện 'Trùng số hóa đơn "QAHĐ-001" — không lưu dòng trùng.', Lưu disabled; submit không gọi API.
- **Assert:** vitest G6 (OpsExpenseFormModal.containers.test.tsx); DOM thật khi QA drive.
- **Evidence:** `qa/2026-11-19_sil861_gates.log`.

### TC-861-002 — Số HĐ khác nhau thì lưu được nguyên 2 dòng

- **When** đổi một dòng sang 'QAHĐ-002'.
- **Then** lỗi mất, Lưu bật; Lưu gọi createExpense 2 lần với invoiceNumber 'QAHĐ-001'/'QAHĐ-002' — không còn partial save.
- **Evidence:** vitest G6; staging UI khi QA drive.

### TC-861-003 — Số HĐ trống không bị coi là trùng

- **Given** 2 dòng cùng loại phí, Số HĐ để trống.
- **Then** Lưu bật, không lỗi 'Trùng số hóa đơn' (Số HĐ Tùy chọn, SIL-834 giữ nguyên).
- **Evidence:** vitest G7.

## What is NOT covered (be honest)

- Chưa drive UI thật ở lane này (rung 1: vitest 26/26 + tsc) — staging drive là việc của QA.
- Trùng Số HĐ với dòng ĐÃ LƯU trên lô (khác phiên nhập) vẫn đi qua 409 write-path — chưa pin E2E riêng (luật cũ giữ nguyên).
- Mobile width 390 chưa sweep riêng (popup dùng layout hiện có, không đổi CSS).
