# case-2026-10-29-sil576 — /penalties: focus trả về ROW bảng sau khi đóng drawer (residual QA fail 29/10)

- Ticket: SIL-576 (board id 654), lane `fix-sil-a11y2`.
- Repro (QA Glint fail 29/10, build df6047f3): mở drawer từ dòng bảng xếp
  hạng "Lương Văn Long" (click chuột) → Escape đóng → Enter ngay sau đó KHÔNG
  mở lại drawer — "chưa rõ do focus không trả về dòng hay do dòng không kích
  hoạt bằng Enter".
- Root cause: dòng bảng xếp hạng là `<tr onClick>` THUẦN CHUỘT — restoreFocusTo
  đã trả focus về dòng (bằng chứng gián tiếp: Tab cuộn qua vùng bảng) nhưng
  dòng KHÔNG có bàn phím activation → Enter không reopen. (Nút 'Lập biên bản'
  có trigger button nên đạt.)
- Expected: focus trả về ROW sau khi đóng (không body, không chỉ button); row
  kích hoạt được bằng Enter/Space → reopen đúng drawer của driver đó. Phone
  card cùng contract.
- Fix: `<tr>` thêm tabIndex=0 + aria-label "Lập biên bản cho {tên}" +
  onKeyDown Enter/Space (guard event.target === currentTarget để inner control
  giữ key riêng); `.penalty-m-card` (phone) thành role=button + cùng keydown;
  focus ring :focus-visible cho cả hai (WCAG 2.4.7).
- Pin: `PenaltyTable.test.tsx` case mới (Enter/Space mở drawer với ROW làm
  opener, phím khác không mở, phone card Enter).
- Evidence: `qa/2026-10-29_sil576_ui-driver.log` (6/6 PASS — đúng chuỗi QA:
  click row → Escape → focus trên row "Lập biên bản cho Lương Văn Long" →
  Enter REOPEN) + `2026-10-29_sil576_ui-penalties-row-reopen-1280.png`;
  `qa/2026-10-29_sil576_tsc.log`, `qa/2026-10-29_sil576_vitest.log`.
