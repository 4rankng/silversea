# Regression spec — `SIL-904` Chi phí Ops: SỐ TỜ KHAI / SỐ HĐ / LOẠI PHÍ gãy giữa từ + đè cột bên cạnh; chuỗi SỐ HĐ dính đôi

**Ticket:** SIL-904 (QA fail build `7a0ac8ff` — Round 8 + Round 9, cùng triệu chứng)
**Owner (implement):** fix lane (omp worktree `fix-sil-904-cols-r2`)
**Owner (verify):** qa
**Status (this doc):** LANDED 2026-11-24 — verify on staging sau deploy
**Cycle:** 2026-11 wave

## QA repro (verbatim facts)

Role hoapt (Phạm Thị Hòa, Kế toán), `/advances?view=ops-expenses` → Tab Chi phí Ops, 24/11/2026,
staging `vantai.tingting.vip`, build `7a0ac8ff` (= `85d563dc`):

1. SỐ TỜ KHAI '309183503920' gãy giữa chữ hoặc đè lên SỐ HĐ — dòng 'Phí nâng vỏ' render
   '309183503920402' (chữ '36' bị đè), dòng 'Phí kết cấu hạ tầng' gãy '3091835039' + '20'.
2. LOẠI PHÍ wrap 3–4 dòng và chồng lên vùng SỐ HĐ ('Phí hạ container' đè 'TEST-QA-CR0101',
   'QAHĐ-861-B02'; 'Hải quan luồng xanh' 4 dòng 'Hải / quan / luồng / xanh').
3. DOM chứa 'INV-4C-001INV-4C-001' ở ô SỐ HĐ dòng 'Phí bốc xếp' (100.000₫, 21/11/2026, id 87).

## Root cause (đúng theo code)

1. **CSS (bug thật, đã sửa):** bảng dùng `.tt-table` = `table-layout: fixed; width: 100%`.
   Theo CSS 2.1 §17.5.2.1, track width trong fixed layout LẤY TỪ `width` của cell dòng đầu —
   `min-width` trên `th` **không** đổi track. Law round-9 (`85d563dc`) pin `white-space: nowrap`
   lên cell nhưng chỉ đặt `min-width: 120px/110px` ⇒ track giữ nguyên share 4.8% / 3.75%
   (≈53px / ≈43px tại canvas 1144px) ⇒ nội dung nowrap tràn ngang vẽ đè cột phải (đúng
   '309183503920402'). LOẠI PHÍ track ≈54px ⇒ 'Hải quan luồng xanh' mỗi từ một dòng.
2. **Chuỗi đôi (data artifact, KHÔNG phải bug writer):** điều tra 24/11 toàn bộ write path —
   `createOpsExpense`, `updateOpsExpense`, `updateAccountingExpense`,
   `upsertExpenseAccountingSource`, `runIdempotent`/replay, correction — TẤT CẢ SET cột
   `invoice_number` verbatim (không có phép concat nào; replay trả snapshot đã lưu, create chạy
   đúng 1 lần per key, payload-hash lệch → 409). FE: render cell chỉ 1 ternary
   (`row.invoiceNumber?.trim() || 'X'`); input inline-edit + form modal là controlled
   input replace-thuần ở mọi commit trong history (`git log -S` không có bản concat nào).
   Không seed/QA script nào tạo 'INV-4C-001'. Dev DB scan không có row tự-nối-đôi.
   ⇒ 'INV-4C-001INV-4C-001' là giá trị đã lưu trên staging row 87 từ một lần nhập cũ
   (double-paste là đường nhập duy nhất tạo đúng chuỗi tự-nối) — code hiện tại không tái tạo được.

## Fix

- `ops-accountant-tab.css`: 3 track nhận **px width thật** — SỐ TỜ KHAI 124px
  (12 số ≈93.4px + 24px chrome), SỐ HĐ 126px ('TEST-QA-CR0101' ≈98px), LOẠI PHÍ 120px
  (wrap ranh giới từ, không 'contai/ner'); bỏ 3 % share chết (4.8/3.75/4.75); giữ
  nowrap cell + `overflow-wrap: normal; word-break: normal` cho LOẠI PHÍ; board tràn
  ~220px tại canvas 1440 sidebar-open → scroll wrapper `overflow-x: auto` (giới hạn
  được ticket chấp nhận: "bảng cuộn ngang mượt khi cần").
- `OpsAccountantTab.styles.test.ts`: pin mới — 3 px width verbatim, cấm % share còn sống,
  nowrap/word-boundary law, scroll rule, và floor-to-token arithmetic
  (124−24 ≥ 12×7.78; 126−24 ≥ 97.5).
- Row 87 staging: sửa qua chính inline SỐ HĐ edit (SIL-882) — gate trùng số HĐ tự-loại-row
  nên lưu lại số đúng không 409. KHÔNG blind-update DB.

## Expected

- SỐ TỜ KHAI / SỐ HĐ: một dòng, không gãy giữa chữ, không đè cột bên cạnh.
- LOẠI PHÍ: chỉ wrap tại ranh giới từ, không tràn ra vùng cột khác.
- Không có chuỗi HĐ nhân đôi trong DOM sau khi row 87 được sửa số qua inline edit.
- Test: `OpsAccountantTab.styles.test.ts` pin px law (7 case file này đều xanh).
