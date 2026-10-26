# Regression case — SIL-491 (board id 553): xóa lô chính đã gộp — lô còn lại không thừa hưởng 100% cước nhóm

- **Ngày**: 2026-10-26
- **Ticket**: SIL-491 (board plan.tingting.vip internal id 553) — báo trên staging build `c8f68a26`, 2 lô LCL Long Minh
  (R42CUS-MRG-01 2.000.000₫ làm lô chính + R42CUS-MRG-02 1.500.000₫) gộp qua "Gộp xe thu khách", xóa lô chính qua drawer
  Tổng quan "Xóa lô".
- **Surface**: bảng tiền đọc CƯỚC VẬN TẢI (AUTO) — shared owner duy nhất
  `backend/src/services/lcl-effective-freight.ts` (`effectiveLclFreight`), tiêu thụ bởi 2 board
  (`shipment-debit-summary.service.ts` — DOANH THU/receivable, và `accounting-debit-close.service.ts`).

## Chuỗi sự kiện cảm sinh defect

1. **FB-095** (`cebe7697`, 21/10): xóa/tách Lô 1 → promote lô kế tiếp, 100% cước nhóm theo crown — writer ghi snapshot
   crown cho survivor với note `Đón cước chính khi tách nhóm (từ Bill X) — 100% cước thu` (INSERT-only, amount = cước
   chuyển thật, khác 0).
2. **FB-145** (`9f174360`, 23/10): luật đọc UNSET — rule 1: lot UNGROUPED có snapshot mới nhất là "group citation" →
   "Chưa xác định". `REV_GROUP_NOTE_PREFIXES` gộp luôn prefix `Đón cước chính` → **crown transfer BỊ MASK**.
3. Delete lô chính 2 lô → survivor dissolve (`revGroupId = null`) + nhận snapshot crown 2.000.000₫ → đọc:
   ungrouped + citation → **UNSET** → DOANH THU trống (ticket: "neither 2.000.000₫ nor 1.500.000₫").

FB-145 rule 1 tự khai scope: "merge member-zero tail, hoặc citation chờ-định-giá-lại" — đều là **cited 0₫** (D02: computed
zero là giá trị, board in UNSET). Crown transfer KHÔNG phải artifact chết: tiền nhóm thật sự theo crown (luật FB-095
"nhóm không bao giờ rơi về 0₫"). Rule 1 over-match → defect.

## SIL491-R1 — xóa lô chính (nhóm 2 lô, chưa phân xe): survivor in 100% cước nhóm

**Repro**: gộp 2 lô LCL cùng KH (2.000.000₫ + 1.500.000₫) → xóa lô chính → mở bảng Quyết toán (debit summary) đọc row
survivor.

- **Trước fix (defect)**: CƯỚC VẬN TẢI (AUTO) + DOANH THU của survivor TRỐNG ("Chưa xác định").
- **Sau fix (expected)**: survivor in **2.000.000₫** (cước nhóm theo crown), `receivableTotal` phản ánh theo; nhóm đã
  dissolve nên không còn strip NHÓM GHÉP (phần này đã đúng từ FB-095).

## SIL491-R2 — nhóm ≥ 3 lô, xóa Lô 1: Lô 2 promote GIỮ nhóm, vẫn in cước crown

Survivor mới là Lô 1 của nhóm còn_live (qualified path, fallback qua snapshot channel) → crown 2.000.000₫ phải in, không
bị fallback-null ăn mất.

## Edge pins (D02 + FB-145 giữ nguyên)

1. Member-zero tail (`Ghép cước cùng Bill X`, 0₫) sau tách → UNSET (pin cũ giữ).
2. Citation chờ-định-giá-lại (0₫) → UNSET (pin cũ giữ).
3. Crown KHÔNG có gì chuyển (`Đón cước chính … — chưa có cước thu để chuyển`, 0₫) → UNSET (vẫn chờ định giá).
4. Restore tail trước-ghép (`Tách nhóm — trở về cước thu trước ghép`) — không phải citation, giữ tiền (pin cũ giữ).
5. Marker cước riêng 21/10 (`Tách nhóm — cước thu theo đơn giá khách × tuyến (lô độc lập)`, khác 0) → in tiền (sibling
   cùng class được sửa theo).

## Luật fix (shared owner `lcl-effective-freight.ts`)

Citation nhóm trên snapshot channel chỉ là "artifact chết" khi **số tiền nó cite là 0** (D02). Citation mang tiền khác 0
là tiền sống (crown transfer FB-095 / cước riêng được re-cite) — board phải in, không UNSET. Bất biến cho writer: tiền
mất thì cite 0₫ kèm lý do — không writer nào đặt tiền khác 0 sau citation "đã mất".

## Evidence

- Unit: `backend/src/tests/unit/lcl-unmerge-revert-r39.test.ts` — thêm 4 case SIL-491, giữ nguyên toàn bộ pin FB-145 cũ.
- Gates: scoped backend vitest + backend typecheck + full backend vitest — `qa/2026-10-26-sil488-sil491-ghep/`.
