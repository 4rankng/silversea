# SIL-489 — Gộp xe thu khách: Lô 1 không hiển thị 100% cước, tổng doanh thu mất 3.500.000₫

- **Ticket:** SIL-489 (board id 551, In Progress → QA)
- **Reported:** QA Glint 25/10 trên staging build `c8f68a26`
- **Severity:** P0 / money-board · **Type:** regression case (READ-side law)

## Bug

Sau khi gộp 2 lô LCL cùng khách bằng "Gộp xe thu khách" (lô không có chuyến
live — chưa phân bổ xe), cả HAI lô mất DOANH THU trên bảng quyết toán:

- Lô 1: DOANH THU trống (mất đúng 2.000.000₫ đã nhập tay cho Lô 1).
- Lô 2: chỉ còn tag ghép, không có số 0₫.
- Tổng Long Minh rơi 6.500.000₫ → 3.000.000₫, grand total 11.500.000₫ →
  8.000.000₫ — mất đúng 3.500.000₫ = 2.000.000 + 1.500.000 (cả hai lô biến
  khỏi tổng). Chi phí (CƯỚC TRẢ / CHI NỘI ĐỊA) không đổi.

### Root cause

`effectiveLclFreight` (backend/src/services/lcl-effective-freight.ts) áp
luật "group artifact citation đọc UNSET" (FB-145) lên KÊNH SNAPSHOT của cả
lô ĐANG Ở TRONG NHÓM (qualified). Merge ghi tiền của lô không-chuyến bằng
shipment-level snapshot mang note citation của chính luật ghép:

- Lô 1: `Ghép cước thu khách — Lô 1 giữ 100% cước thu nhóm (giá nhập tay, 5T)`
- Lô 2: `Ghép thu cước cùng Lô 1 — lô ghép giữ 0₫ cước thu (chưa phân bổ xe)`

Cả hai note đều match `REV_GROUP_NOTE_PREFIXES` → filter bỏ số tiền →
qualified lot đọc `null` (Chưa xác định) dù nhóm còn hoạt động và số tiền
đó CHÍNH LÀ giá live của nhóm (luật 100%/0₫ spec 23/10).

Phạm vi đúng của luật FB-145 rule 1 (theo header của chính module + các test
đã pin R39) là lô **UNGROUPED** — "the lot went back to 'từng xe riêng'".
Không phải lô đang grouped.

## Expected

Trong nhóm đang gộp (trip-less):

- Lô 1 DOANH THU = 2.000.000₫ (100% cước thu nhóm, giá nhập tay).
- Lô 2 DOANH THU = 0₫ kèm note "Ghép cước cùng Bill R42CUS-MRG-01" (D02 —
  zero tính toán là một giá trị, phải hiện kèm lý do).
- Tổng gồm đúng 100% của Lô 1 (Long Minh = 3.000.000₫ lô khác + 2.000.000₫
  + 0₫ = 5.000.000₫ — tổng nhóm sau gộp theo luật 100%/0₫; con số
  6.500.000₫ trong ticket bao gồm cả 1.500.000₫ của Lô 2 mà luật ghép đã
  cho về 0₫, nên mốc đúng sau fix là 5.000.000₫, không phải 6.500.000₫).

## Reproduction

1. Tạo 2 lô LCL cùng khách, nhập giá cước thu khách tay (2.000.000₫ và
   1.500.000₫), chưa phân bổ xe.
2. Chọn cả 2 → "Gộp xe thu khách" (loại xe + Cước thu Lô 1 = 2.000.000₫).
3. Reload /shipments-debit: trước fix cả 2 dòng DOANH THU trống, tổng mất
   3.500.000₫; sau fix Lô 1 = 2.000.000₫, Lô 2 = 0₫ + tag ghép.

## Regression coverage

- `backend/src/tests/unit/lcl-unmerge-revert-r39.test.ts` — 2 test mới pin
  luật đọc: grouped trip-less Lô 1 đọc đúng snapshot 100% citation của
  merge; grouped trip-less member đọc 0₫ + memberNote "Ghép cước cùng Bill X".
- Luật PURE một chỗ (`effectiveLclFreight`) — cả hai bảng tiền (debit
  summary + accounting close) tự lành theo.
