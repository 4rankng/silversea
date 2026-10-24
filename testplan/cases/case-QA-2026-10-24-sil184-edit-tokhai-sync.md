# Case QA-2026-10-24-SIL184 — Sửa tờ khai inline tự đồng bộ cả lô (CUS-05)

Ticket SIL-184 (board plan.tingting.vip, card gốc 261022095235a). Surface:
Chi tiết lô (/shipments/:id ledger + drawer + /shipments-detail) — sửa số tờ
khai inline tại chỗ. QA R42: sửa MSKU1234565 (Q1-DECL-177 → Q1-DECL-184),
reload → MSKU1234570 vẫn Q1-DECL-177 — không sync.

## Root cause

Fan-out của `updateCusShipmentContainerLine` chỉ fill sibling TRỐNG
(predicate FB-109 `IS NULL OR btrim=''`). Lô mà các cont đã cùng mang số cũ
(lô copy theo luật CUS-05) → sửa 1 cont không kéo các bản copy theo → lô
phân kỳ ngay sau 1 lần sửa.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| SIL184-R1 | Lô 2 cont cùng số X → sửa cont A thành Y, reload | Cont B nhận Y (đồng bộ theo lô); response `declarationSync.updatedContainerIds` chứa id của B |
| SIL184-R2 | Lô còn cont TRỐNG → lưu số mới | Fill trống như cũ (FB-109 không hồi quy) |
| SIL184-R3 | Cont B đang có số Z KHÁC X và Y (divergence chủ đích) | B KHÔNG bị đụng (card 261013200312) |
| SIL184-R4 | Xóa số (clear) trên cont A | Chỉ áp cho A — không fan-out |
| SIL184-R5 | Toast | "Đã lưu tờ khai — tự đồng bộ sang N cont khác của lô." (không còn nói "còn trống") |

## Rule (nguồn)

CUS-05 ruling 22/10 (cards 221026095229/221026095329): "nhập 1 cont sync mọi
cont cùng lô"; TOKHAI-R3 bảo vệ divergence.

## Verify

- Unit: `backend/src/tests/unit/cus-container-line-tokhai-edit-sync.test.ts`
  (predicate empty-HOẶC-số-cũ, bảo vệ divergence, clear local).
- Probe (rung 2): `qa/scripts/2026-10-24-sil184-edit-sync-probe.mjs` — lô 2
  cont, sửa tờ khai 1 cont, đọc lại 2 dòng sau reload API.
