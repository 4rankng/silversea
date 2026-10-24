# Case QA-2026-10-24-SIL191 — Toolbar chốt debit thiếu "Tách nhóm" khi chọn lô đã ghép

Ticket SIL-191 (board plan.tingting.vip; FB-093 verify-fail, card gốc
211026024348). Surface: Kế toán /accounting/chot-debit — selection strip
("Đã chọn N lô"). QA R42: chọn 2 lô đang ghép (R39B1-LCL01, R41B1-LCL01) →
toolbar không có "Tách nhóm", `document.querySelector(".tach-nhom-action")`
= null.

## Root cause

Nút "Tách nhóm" duy nhất của board nằm trong CỘT "Thông số container"
(per-row). Một lựa chọn ≥2 lô thao tác qua thanh công cụ không có đường tách
nào; workstation ẩn cột đó (hoặc dữ liệu `lcl.revGroupId` không render cell)
làm action hoàn toàn không với tới — đúng defect FB-093 đã tái phát.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| SIL191-R1 | Chọn ≥2 lô, trong đó có lô đang ghép (cùng 1 nhóm) | Strip hiện nút "Tách nhóm" (armed) ngay cạnh "Gửi yêu cầu điều chỉnh cước" |
| SIL191-R2 | Click nút strip → dialog chung → xác nhận | `unmergeLclGroup({ groupId, dimension: 'REV' })`; board refetch; toast [Hoàn tác] như per-row |
| SIL191-R3 | Chọn đúng 1 lô | Strip không thêm nút (per-row trong cột vẫn là đường chính) |
| SIL191-R4 | Chọn ≥2 lô CHƯA ghép | Không có nút strip (đúng điều kiện "đang ghép + multi-select") |
| SIL191-R5 | Lựa chọn thuộc ≥2 nhóm khác nhau | Nút aria-disabled + lý do "nhiều nhóm ghép"; click bị guard |
| SIL191-R6 | Nhóm có lô đã chốt (costLockedAt) | aria-disabled + lý do "đã chốt kế toán" |

## Rule (nguồn)

FB-093 + owner ruling 24/10: không toolbar undo, toast là undo; MỘT unmerge
path (`POST /shipments/lcl/unmerge-group`) — strip tái dùng component
`UnmergeRevGroupAction`, không tạo đường thứ hai.

## Verify

- Unit: `frontend/src/pages/accounting/AccountingDebitClosePage.tach-nhom.test.tsx`
  (khối SIL-191: armed/1-lô/chưa-ghép/2-nhóm/đã-chốt).
- Rung 3: screenshot trước (staging) / sau (local) 1440 + driver log trong
  `qa/` — xem comment ticket.
