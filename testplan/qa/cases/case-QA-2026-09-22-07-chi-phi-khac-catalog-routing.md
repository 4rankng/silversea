# Case QA-2026-09-22-07 — Per-customer "Chi phí khác" catalog + column routing (card _64, ruling 9)

- **Case ID:** QA-2026-09-22-07
- **Reported:** 2026-09-22, card `20260922_64` + operator ruling 9 (both PM rounds, teammsg 2246 /
  memory `baogia-wave-rulings-2026-09-22`).
- **Surface:** the per-customer "Chi phí khác" fee catalog on the quotation (card _66 model, section
  "II. Chi phí khác") + the routing rules that carry incurred fees into the right bảng quyết toán/bảng kê
  surfaces: dedicated columns vs the other-costs column + bảng kê note.
- **Status:** case PREPARED — feature not yet implemented (_66 building; _63's Lạch Huyện column landing is
  in the queue). Asserts card acceptance + rulings; runnable once _66/_64 land (Lạch Huyện routing rung waits
  on _63's landing).
- **Engine-gate anchors:** TC-BG-55…TC-BG-60 in the 2026-09-22 Báo giá & Chi phí requirements.

## Scope fence

- **In:** catalog storage per customer (all sample rows + sub-classifications, verbatim); routing rules
  (Hải quan giám sát and Nâng/Hạ Lạch Huyện → dedicated columns; every other fee → other-costs column + fee
  name into the bảng kê note); TẠM amounts = editable per-customer defaults (ruling 9a: **never hardcoded**);
  Kiểm hóa pending-empty + manual per lot (9b); Mở tờ khai-Hàng đặc thù manual per lot (9c); per-customer edit
  isolation; the add-fee-row capability (the customer's "...." open row).
- **Out:** _63's per-lift amount engine for Lạch Huyện (that case asserts 1×/2×; this case asserts only that
  the fee ROUTES to the dedicated Lạch Huyện column); _66 model internals; the customer's upcoming amount
  adjustments (ruling 9: future changes are data edits, never code changes — asserted by the no-hardcode pin).

## Mutation surface (HARD RULE)

Writes: (a) ONE amount edit on ONE named catalog row (Soi chiếu · Thủ tục soi, 500.000 → 600.000 → revert)
on the LONG MINH fixture quotation; (b) ONE added fee row on the same quotation (added → verified → removed);
(c) fixture-lot fee entries needed to trigger routing, one fee per named lot, reverted after evidence. No
batch edits, no row-action sweeps. LOG COM's quotation is the isolation witness — read-only.

## Preconditions

- Staging with two seeded quotations: LONG MINH and LOG COM, both carrying the catalog from the customer's
  table (below); _63's Lạch Huyện landed (column exists).
- Backend gate has TC-BG-55…60 green before the staging rung starts.

## Fixtures (named — the customer's own table, verbatim)

| STT | Nội dung | Phân loại | Số tiền (TẠM default) |
|---|---|---|---|
| 1 | Phí mở tờ khai | Hàng thông thường 500.000 · Hàng đặc thù **(trống — nhập tay theo lô)** | 500.000 |
| 2 | Hải quan giám sát | Luồng xanh/vàng 150.000 · Luồng đỏ 250.000 | 150.000 |
| 3 | Nâng/Hạ Lạch Huyện | — | 500.000 |
| 4 | Lưu ca xe | — | 1.000.000 |
| 5 | Soi chiếu | Thủ tục soi 500.000 · Kéo cont đi soi 1.200.000 | 500.000 |
| 6 | Kiểm hóa | — | **(trống — chờ khách, nhập tay theo lô)** |
| 7 | Kẹp chì hải quan | — | 100.000 |
| 8 | "…" (dòng mở — thêm dòng phí mới) | — | — |

## Steps and expected values

1. **Catalog completeness (verbatim).** Read the LONG MINH quotation's "Chi phí khác" section: all rows and
   sub-classifications present exactly as the table above (TC-BG-55) — labels verbatim, TẠM defaults in the
   Số tiền cells, rows 1-đặc-thù and 6 empty by ruling.
2. **TẠM = editable default, not a constant.** Edit ONE row: Soi chiếu · Thủ tục soi 500.000 → **600.000**;
   save; re-read LONG MINH → 600.000. Backend-gate transcript additionally shows the catalog is **data**:
   the amounts live in tables, no 500.000/1.200.000 literals wired into code (ruling 9a — the pin that makes
   "khách báo số mới thì chỉ là sửa dữ liệu" true).
3. **Per-customer isolation.** Re-read LOG COM's Soi chiếu · Thủ tục soi → **still 500.000** (card criterion
   5; TC-BG-57-class isolation branch). One customer's edit never leaks to another.
4. **Dedicated column — Hải quan giám sát.** On fixture lot A, enter a Hải quan giám sát fee (150.000;
   luồng xanh/vàng): it renders in the **dedicated Hải quan giám sát column** of the lot's settlement/bảng kê
   surface — and NOT in the Chi phí khác column, NOT in a note line (card criterion 2; TC-BG-56).
5. **Dedicated column — Lạch Huyện (pairs with _63).** On fixture lot B, record a Nâng/Hạ Lạch Huyện lift:
   it renders in the **Lạch Huyện column** (the _63-owned column; this case asserts routing, not the 1×/2×
   amount math) (card criterion 3).
6. **Other fees → other-costs column + bảng kê note.** On fixture lot C, enter Lưu ca xe (1.000.000), Soi
   chiếu (500.000) and Kẹp chì hải quan (100.000): all three amounts land in the **Chi phí khác column**, and
   the three fee NAMES appear in the **ghi chú of the real bảng kê** opened for that lot — proven on a real
   bảng kê, not a preview (card criterion 4).
7. **Empty cells stay empty; manual per lot.** Kiểm hóa and Mở tờ khai-Hàng đặc thù hold no default amount in
   the catalog; a fixture lot with either fee requires the manual per-lot amount entry and auto-fills nothing
   (ruling 9b/9c; TC-BG-60).
8. **Add-row capability.** Add ONE new row (e.g. "Phí dỡ hàng ngoài giờ", 300.000) to LONG MINH's catalog;
   re-read present; a later lot using it routes per rules 4–6 (non-dedicated → other-costs + note). Then
   remove the row; catalog returns to the step-1 baseline.
9. **Positive controls / revert.** Soi chiếu · Thủ tục soi back to **500.000**; re-read LONG MINH (baseline)
   and LOG COM (unchanged throughout). Fixture-lot fee entries removed after their evidence.

## Pass/Fail

- PASS = catalog verbatim-complete; one-customer edits isolated; Hải quan giám sát and Lạch Huyện route to
  their dedicated columns; the other fees land in Chi phí khác WITH fee names in the real bảng kê note;
  empty rows stay empty with manual per-lot entry; add-row works and reverts; no amount literal exists in code.
- FAIL = any amount hardcoded; a dedicated-column fee landing in Chi phí khác or a note; a note-fee landing
  in a dedicated column; missing note names on the real bảng kê; cross-customer leak; Kiểm hóa/đặc-thù
  auto-filled with a default; revert drift.

## Rungs

- Storage, isolation, no-hardcode (steps 1–3, 7–9 values): backend gate transcript (TC-BG-55…60) + API/DB
  read of both fixture quotations' catalog tables.
- Routing + real-bảng-kê proof (steps 4–6): staging mouse-through — the catalog section, the three lots'
  fee surfaces, and the REAL bảng kê showing the fee names in its note; full-page screenshots 1280–2560,
  empty + filled states, per the QA evidence hard gate. (Lạch Huyện rung executes after _63's landing —
  currently queued.)
