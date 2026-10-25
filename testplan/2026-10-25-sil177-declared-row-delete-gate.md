# SIL-177 — Nút xóa dòng mang tờ khai bị chặn ở FE (không còn warn-and-allow)

- **Case ID:** SIL-177-REG-1
- **Ticket:** plan.tingting.vip SIL-177 (id 210) — QA Glint fail 24/10 trên build f3be253b: lot 220 dòng 2 (MSKU1234570, tờ khai R42ATK184) → dialog cảnh báo → confirm → **vẫn xóa được** (API 2→1)
- **Surface:** `/shipments/:id` → "Chi tiết container" (`CusContainerLedger` + `CusContainerLedgerRow`) — cùng ledger ở drawer Tổng quan `/shipments`
- **Role:** mọi role thấy nút (ADMIN/MANAGER/CUS/DISPATCHER — `canRemoveContainer`)

## Reproduction

1. Mở lô FCL có dòng container đang mang số tờ khai.
2. Nhìn nút "Xóa container" trên dòng đó.

## Observed (trước fix — build f3be253b)

- Nút enabled; click mở dialog: `Xóa container <số>? Cont đang mang tờ khai <số> — xóa sẽ gỡ tờ khai khỏi dòng này.`
- Confirm ⇒ FE **tự gỡ tờ khai** (container-line command `declarationNumber: ''`) rồi DELETE với version fresh ⇒ **bypass đúng guard 409** BE đã chặn từ cf47ad30 (card 211026094500). Số tờ khai biến mất khỏi dòng mà operator không hề yêu cầu gỡ — đúng sự cố mà guard sinh ra để ngăn.

## Root cause

`removeContainer()` chạy nhánh "recovery" tự clear `declarationNumber` trước khi xóa (di sản SIL-472 — sửa "nút xóa chết" bằng cách cho phép xóa, thay vì chặn đúng luật). QA verdict 24/10 + owner: FE không được warn-and-allow qua guard; **gỡ tờ khai là bước tường minh riêng** của operator qua inline editor.

## Expected

- Dòng mang tờ khai: nút "Xóa container" **disabled** kèm tooltip đúng message guard: `Cont có tờ khai <số> — gỡ tờ khai trước khi xóa`. Click không mở dialog, không gọi API nào (không clear, không delete).
- Dòng không tờ khai: giữ nguyên confirm dialog `Xóa container <số>?` → DELETE trực tiếp với version detail → toast + refetch (hành vi CUS-10 giữ nguyên).
- Confirm text không còn nhánh "xóa sẽ gỡ tờ khai" (dòng declared không bao giờ tới dialog).

## Regression coverage

`frontend/src/features/shipments/cus/CusContainerLedger.test.tsx` — describe "SIL-177 — nút xóa dòng mang tờ khai bị chặn ở FE, không auto-gỡ":

1. Dòng mang tờ khai: nút disabled + `title` nêu đúng số tờ khai; click ⇒ không dialog, **0 API call**. **Đỏ trên code trước fix** (nút enabled, dialog hiện, clear + delete chạy).
2. Dòng không tờ khai: confirm ⇒ DELETE trực tiếp version detail, không có call gỡ nào trên wire (no-regression pin).
3. Confirm của cont thường chỉ nêu số cont — không còn text "gỡ tờ khai" (khẳng định removeConfirmMessage đã bỏ nhánh declared).

## Supersede

Ghi đè flow "gỡ rồi xóa" của `2026-10-24-sil472-declared-container-delete.md` (SIL-472-REG-1) — behavior đó chính là bypass QA đã bắt. Guard 409 BE (cf47ad30) tiếp tục là ranh giới cuối cho mọi role.
