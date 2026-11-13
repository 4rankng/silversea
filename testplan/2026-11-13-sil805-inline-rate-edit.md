# SIL-805 — Bảng Kiểm soát lô hàng: inline-edit 8 ô giá/chi phí + Lợi nhuận cập nhật ngay sau Lưu

Ngày: 2026-11-13 · SIL-805 (id 933) · P0 · lane u1 (`fix/u1-805-chot`)

## Báo cáo lỗi (hiện trạng trước fix)

UAT KH 12/11 trên `/accounting/chot-debit` (cả tab FCL + LCL): các ô tiền của
bảng chỉ ĐỌC — kế toán không sửa được đơn giá/chi phí ngay trên dòng (chỉ ô
"Chi phí ngoài" nhập được từ SIL-771); sau khi lưu một thay đổi, ô Lợi nhuận
chỉ đổi sau khi tải lại trang.

## Trường hợp hồi quy (case ID: SIL805-R1..R4)

| # | Trường hợp | Kết quả mong đợi |
|---|---|---|
| R1 | Lô CHƯA khóa chi phí (costLockedAt null): 8 ô giá/chi phí (cước thu, Lạch Huyện, phụ PS, phát sinh CUS, cước trả ĐV, Lạch Huyện ĐV, phát sinh ĐV, phí RU) | Mỗi ô là ô nhập trên dòng (placeholder = giá trị hiệu lực định nhóm chữ số); gõ số mới + blur/Enter → lưu đúng (lô, ô, số nguyên VND); gõ lại đúng giá trị đang áp dụng → KHÔNG gửi |
| R2 | Lô ĐÃ khóa chi phí (costLockedAt set) | 8 ô render text định dạng, không còn ô nhập nào; server cũng chặn 409 (assert cost + accounting lock) |
| R3 | Lưu một ô giá/chi phí | Lợi nhuận (= Tổng thu − Tổng trả − Chi phí ngoài, server tính lại từ các ô ghi đè) cập nhật NGAY sau lưu (board refetch), không cần tải lại trang; ô ghi đè là KNOWN cả khi = 0 (card 20261002_293) |
| R4 | Mỗi lần lưu | Ghi audit_logs `DEBIT_RATE_OVERRIDE_SET` (before/after + changedFields, entityType 'shipment'); lưu lại đúng giá trị máy đang giữ = no-op, không audit noise |

## Bằng chứng sau fix (local dev, 13/11/2026)

- BE unit `backend/src/tests/unit/debit-board-rate-overrides.test.ts` — 7/7 ✔
  (merge, known-zero, RU display-only, chuỗi override → tổng → lợi nhuận).
- FE `frontend/src/pages/accounting/AccountingDebitClosePage.sil805.test.tsx`
  — 7/7 ✔ (8 ô nhập, lưu đúng lô+ô, unchanged không gửi, khóa → text,
  lợi nhuận refetch ngay sau lưu + nền đỏ khi âm, tab LCL cùng luật).
- UI drive rung-3 (`qa/scripts/2026-11-13-sil805-rate-edit-ui-drive.mjs`,
  ketoan, lot BL-SIL765-2KHO / shipment 779508, cả hai kênh THU+TRA):
  `qa/2026-11-13_sil805_ui-1-board.png` · `-2-cuoc-thu-saved.png` ·
  `-3-profit-refreshed.png` · `qa/2026-11-13_sil805_ui-driver.log` —
  Lợi nhuận 600.000 ₫ (1.000.000 − 400.000 − 0) hiện NGAY sau lần lưu thứ 2,
  `shipment_debit_rate_overrides` ghi (779508, 1000000, 400000) + 2 dòng
  audit_logs; giá trị test đã revert, audit giữ nguyên vết.
- Không phá phần đã PASS: sil771/sil772/sil773/... toàn bộ 32 file / 280 test
  trang accounting vẫn xanh.
