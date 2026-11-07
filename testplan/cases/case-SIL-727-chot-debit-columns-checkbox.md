# SIL-727 (id 847) — Chốt debit: khôi phục cột thành phần + checkbox đầu dòng

- Ticket: SIL-727 (board SIL, id 847, tạo 07/11/2026, HIGH). Lane K1.
- Surface: `/accounting/chot-debit` — bảng "Kế hoạch điều động tổng hợp"
  (`AccountingDebitClosePage*`), vai Kế toán.

## Bug (kết quả thực tế trước fix)

1. Bảng mở đúng 6 cột (dot Chi phí · Ngày · lô · Tổng thu · Tổng 1 · Đối
   soát) — 8 cột thành phần PHẢI THU/PHẢI TRẢ bị ẩn bởi luật column-visibility
   (KT4 essential default + `autoHideWhenEmpty` phản ứng với wire null).
2. Đầu dòng lô (R3M-KR1, R3M-KR2) là chấm đỏ "Thiếu chi phí" — không có affordance
   chọn dòng; kế toán không biết click dòng để chọn → selection rỗng →
   [Chọn Debit] / [Xuất Debit Note] disabled, [Ghép cước thu khách] báo
   "Chọn ít nhất 2 lô…".
3. [Xác nhận đối soát] disabled khi không có dòng PENDING trong bộ lọc (luật
   riêng, không do selection — giữ nguyên).

## Ranh giới (tránh đụng chạm lane H2)

- Nhãn 'Tổng 1' / 'Thiếu tổng 1', track cột NGÀY, `.debit-missing`,
  `.debit-col--money`, sticky offsets — SIL-701/H2 sở hữu (commit 249889cb).
  Ticket này KHÔNG đổi CSS kích thước track.

## Case pin (expected sau thay đổi)

1. Desktop board mở với đủ 10 cột tiền: PHẢI THU (Cước thu tự động · Lạch
   Huyện · Phụ ps · Phát sinh (cus) · Tổng thu) + PHẢI TRẢ (Cước trả ĐV ·
   Lạch Huyện ĐV · Phát sinh ĐV · Tổng 1 · Phí RU); 8 cột thành phần
   `essential: true` — picker khóa (disabled + checked), stored choice cũ
   không thể giấu (sanitize FB-093 lan 3).
2. Dòng chọn được (adjustment NONE|CONFIRMED) → ô đầu dòng là CHECKBOX
   (`LclSelectCheckbox`, role=checkbox, aria-checked, label "Chọn lô <bill>");
   click checkbox toggle đúng selection state (không double-toggle qua row
   click); tick ✓ trên ô Ngày vẫn phản ánh.
3. Dòng KHÔNG chọn được (PENDING) vẫn giữ dot "Thiếu chi phí" khi thiếu tiền.
4. Chọn 1 dòng → [Chọn Debit (N dòng)] + [Xuất Debit Note] bật; chọn ≥2 lô lẻ
   chưa ghép → [Ghép cước thu khách] bật. Row-click selection vẫn hoạt động.
5. Popup Chọn Debit hiện Lần/Tháng/VAT (0/5/8/10%) — pin sẵn ở
   `AccountingDebitClosePage.rounds.test.tsx` (vatRate) — không đổi code.
6. Phone records không render ô đầu dòng (dot lẫn checkbox) — luật cũ giữ.

## Regression evidence

- (điền sau khi chạy) FE scoped tests + tsc, qa/2026-11-07-lane-k1/.
- Catalog provenance: house primitive `LclSelectCheckbox` (card 181026145000 —
  Untitled UI Checkbox render vô hình với stylesheet app → reuse house control,
  không invent layout).
