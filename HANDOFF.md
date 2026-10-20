# FB-113 standing verdict + fix — 2026-10-20 (card 171026122140)

Controller: agent, worktree /Users/dev/.paseo/worktrees/1njkloyy/fix-fb113-investigate, branch fix-fb113-investigate (off main bf3a0ff9).

**Status**: DONE — verdict + fix committed on branch, pushed.

- Verdict: surface mismatch lần 3. Ledger /shipments-detail PASS 11/11 trên staging bf3a0ff9 (3 lot shapes, bảng+card mode, UI==API); /shipments/:id (CÙNG tên nav 'Chi tiết lô hàng', tới được qua drawer 'Chi tiết lô hàng') FAIL đúng chữ QA — header thiếu Số tờ khai + thứ tự sai (UI DRIVEN staging, lô 176 DNKM13337/102250318903).
- Fix: ShipmentDetailPage header card trình bày nhóm chứng từ Bill/Booking (merged billBookingReference) → Số tờ khai (declarations entity = cùng nguồn section Tờ khai hải quan) → Xuất/Nhập → Hãng tàu. Không đụng BE contract; portal là non-goal (audience khác).
- Gates: FE tsgo 0; vitest scoped 44/44; eslint đổi file 0; root lint 0. Evidence qa/2026-10-20-fb113-standing/ (before-staging fail + after-local pass + ledger phase-1), chi tiết testplan/2026-10-20-fb113-standing.md.

**Not covered**: staging re-drive sau deploy (QA R26); role khác ngoài CUS trên detail header; viewport ≤760 của detail (không đổi CSS).

Stack note: vite :7178 chạy từ worktree này (background) cho after-drive; :7175 (r25 worktree) + :7176 (SSD main) + backend :3002 (SSD main, tsx) là của task khác — KHÔNG đụng. Local DB ss-prod-db :5441 có sẵn, chỉ đọc.
