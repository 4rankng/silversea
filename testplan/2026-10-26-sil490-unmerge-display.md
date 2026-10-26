# SIL-490 — Hủy ghép không hiển thị lại cước thu: tiền bị nổi lên "Chưa xác định"

- **Ticket:** SIL-490 (board id 552, In Progress → QA)
- **Reported:** QA Glint 25/10 trên staging build `c8f68a26`
- **Severity:** P0 / money-board · **Type:** regression case (READ-side law)

## Bug

Hủy ghép (row-level, expander "Hủy ghép" trên Lô chính) xong: nhóm tan đúng,
controls mở lại, nhưng CẢ HAI lô DOANH THU trống, tổng giữ nguyên mức thấp
(Long Minh 3.000.000₫ / grand 8.000.000₫). Toast hứa "Bill R42CUS-MRG-02
thành Lô chính và nhận 100% cước thu nhóm" nhưng không con số nào hiện.

### Luật áp dụng (đÃ CHỐT — không đổi behavior write)

Row-level "Hủy ghép" trên Lô chính = luật FB-095 **promote** (PRD
`docs/prd/LoHangKepKetHop.md` edge case 5: "Hủy ghép/Xóa Lô 1 → tự chuyển
quyền Lô chính + 100% tiền cước sang Lô 2"; copy confirm FE đọc đúng vậy;
FE test đã pin toast promote). Luật **restore về pre-merge** là của
"Tách nhóm" CẢ NHÓM (`unmergeLclGroup`) — path đó đã hoạt động đúng, không
đổi. Ticket này KHÔNG đảo luật promote thành restore.

### Root cause

`effectiveLclFreight` (unqualified path — lô đã rời nhóm) vứt MỌI snapshot
mang note citation. Nhưng promote ghi tiền THẬT được chuyển cho Lô 2 bằng
snapshot note citation:

- Lô 2: `Đón cước chính khi tách nhóm (từ Bill R42CUS-MRG-01) — 100% cước
  thu` (2.000.000₫ — tiền thật, phải đọc) → bị đọc UNSET.
- Lô 1: `Tách nhóm — chuyển 100% cước cho Bill R42CUS-MRG-02` (0₫ — money
  đã rời lô, đúng luật phải đọc "Chưa xác định" chờ định giá lại).

Tương tự marker tiền riêng `Tách nhóm — cước thu theo đơn giá khách × tuyến
(lô độc lập)` (REV_LOT_OWN_CUOC_REASON, non-zero) cũng bị UNSET oan.

## Expected

Sau Hủy ghép (promote law):

- Lô 2 (được nhận 100%): DOANH THU = 2.000.000₫ — toast khớp bảng.
- Lô 1: "Chưa xác định" (0₫ citation = tiền đã chuyển đi, chờ CUS chọn lại
  giá per-lot §4.1 — đúng luật R39 đã pin), loại xe lô rời bị gỡ theo luật
  leaver (FB-095/QA C-1).
- Tổng Long Minh = 3.000.000₫ + 2.000.000₫ = 5.000.000₫.

Còn muốn cả hai lô về đúng giá trước gộp (2.000.000₫/1.500.000₫) → dùng
"Tách nhóm" CẢ NHÓM (strip) — path restore đã đúng.

## Root cause fix

Cited **ZERO** mới là artifact mơ hồ (member-zero tail, "chờ định giá lại",
tiền đã chuyển đi) → UNSET. Cited **NON-ZERO** là tiền thật service vừa
chuyển/giữ cho lô → đọc amount.

## Regression coverage

- `backend/src/tests/unit/lcl-unmerge-revert-r39.test.ts` — 3 case: promote
  citation non-zero đọc amount; own-cuoc marker non-zero đọc amount;
  moved-out zero vẫn UNSET (giữ luật R39).
- Các test R39 cũ (member-zero tail 0₫ → UNSET; awaiting-reprice → UNSET)
  giữ nguyên pass.
