# Card 261022095235a/b — tờ khai inline + sync (CUS-05) · sửa/thêm cont hết lỗi

Ngày: 2026-10-22 · Nguồn: Zalo QLVT 20:03 (2 card) + ruling 09:50 (22/10)
Worktree: `fix-cus-tokhai-cont` (off main 839d0577)

## Bối cảnh bề mặt

| Màn | Route | Trước thay đổi | Sau thay đổi |
|---|---|---|---|
| Tổng quan (drawer) | `/shipments` → drawer | Ledger "Chi tiết container" KHÔNG có cột tờ khai; thêm/xóa cont có | + Cột "Số tờ khai" click-to-edit + Copy; 409-remove có recovery |
| Chi tiết lô (bảng) | `/shipments-detail` | Tờ khai inline + auto-copy ĐÃ có (FB-109 v2); editor số cont dead-end 400 khi gõ sai check digit | + ISO hint + one-tap fix (giống add-row) |
| Chi tiết lô (lô) | `/shipments/:id` | KHÔNG có thêm/xóa cont (TICKET-09 gỡ 17/10); tờ khai chỉ sửa qua section "Tờ khai hải quan" (lot entity) hoặc Sửa lô → nhóm chứng từ | Writer roles host CHÍNH ledger quản lý container của drawer (thêm/xóa/sửa dòng/tờ khai inline); reader/lock/terminal giữ section đọc |

## Root-cause card B (repro-first, evidence `qa/2026-10-22-cus-tokhai-cont/pre-fix-driver.log`)

1. **API đã xanh sau các card trước** (r19 FB-086, _75/_76): add/đổi/xóa cont trên
   lô có data bẩn (số sai format/check digit, placeholder trống số) đều
   200/201 — probe `node /tmp/tokhai-repro3.mjs` (output `/tmp/tokhai-repro3-out.txt`).
2. **Hạ tầng còn sập**: `/shipments/:id` không còn nút Thêm/Xóa container nào
   (TICKET-09 17/10 gỡ theo by-design; UI drive `hasAdd:false, hasRemove:false`)
   → khách sửa lô sai/thiếu cont từ "màn chi tiết lô" không có đường —
   ruling 22/10 09:50 đảo chiều, FB-112 mở lại.
3. **Dead-end UX đổi số cont**: workboard editor số cont không có pre-check
   ISO 6346 (add-row có từ card 191026100000) → khách gõ sai check digit chỉ
   nhận 400 trần, không có gợi ý sửa 1 chạm.

## Ca hồi quy

| ID | Màn | Kỳ vọng |
|---|---|---|
| TOKHAI-R1 | drawer `/shipments` + `/shipments/:id` ledger | Cột "Số tờ khai" hiện số per-cont; click → input; Enter lưu ngay qua container-line command |
| TOKHAI-R2 | lô 3 cont (2 trống) | Lưu tờ khai cont #1 → #2 #3 tự nhận cùng số (FB-109 auto-copy, cùng transaction); toast báo "tự copy sang N cont" khớp declarationSync |
| TOKHAI-R3 | cont #2 đã có số KHÁC | Sửa #1 KHÔNG ghi đè #2 (divergence cho phép — luật card 261013200312) |
| TOKHAI-R4 | nút Copy tờ khai | Chỉ hiện khi hàng có số + lô còn cont trống; 1 call `copy-declaration`; toast số dòng thật |
| TOKHAI-R5 | fieldAccess READ_ONLY (lock kế toán) | Cell đọc thuần "—"/số, không trigger, không Copy |
| TOKHAI-R6 | `/shipments/:id` writer (ADMIN/MANAGER/CUS/DISPATCHER), FCL, chưa lock | Ledger quản lý: nút "Thêm container" + "Xóa container" hiển thị và hoạt động (ruling 22/10) |
| TOKHAI-R7 | `/shipments/:id` ACCOUNTANT / lock / COMPLETED | Section đọc `Containers (N)` — không nút, không gọi workspace detail |
| TOKHAI-R8 | workboard `/shipments-detail` | Gõ số cont sai check digit trong editor → warning + "Đổi thành <số đúng>" 1 chạm; số hợp lệ → hết hint |
| TOKHAI-R9 | drawer remove cont bị 409 version | Tự reload detail (onDetailStale) + toast — thử lại được ngay (parity với add r19) |

## Phạm vi

Sửa: FE ledger chia sẻ (cột tờ khai + commit/copy), host detail page, ISO
hint workboard, remove 409 recovery, tests FE.
Không sửa: luật BE (auto-copy FB-109, add/remove guards, RBAC) — đã đúng,
chỉ pin lại bằng QA probe.

## Review độc lập (22/10, code-reviewer) — đã xử lý hết

- HIGH drawer sibling stale sau fan-out → commit/copy giờ fire `onDetailStale`
  (channel reload FB-086 r19) khi có sync; verify rung 3 drawer 6/6
  (`drawer-fanout-driver.log`: siblings fill in-place, divergence giữ, nút
  Copy biến mất khi hết ô trống).
- MEDIUM disable-blur đóng editor giữa commit → `readOnly` khi busy + guard
  `close()`; test jsdom mô phỏng in-flight blur + reject (editor giữ draft).
- MEDIUM LCL dead card @detail → gate `cargoMode !== 'LCL'` (test pin không
  fetch workspace detail).
- LOW `!line` throw → toast + return false; cell commit có try/finally;
  idempotency key clear đồng nhất cả 2 path (commit + copy); bỏ aria-hidden
  lệch convention ở add-row blank cell.

