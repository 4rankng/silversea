# QA 2026-10-23 — TiepVu22Oct-3: search kho GLC, stale-state race (typing session)

Scope: combobox "Kho lấy hàng (CFS/Cảng)" (danh mục chung, shared catalog) trên
/shipments/new — `USearchableField` (searchable + allowsCustomValue +
onCustomValue passthrough).

## Root cause (repro-first, evidence trong thư mục này)

- KHÔNG có server-side search theo keystroke — network log (`*-driver.log`
  `net operational-sites`) chỉ có GET mount-time `?scope=shared` +
  `?customerId=1`. Filter 100% client-side (`matchesComboboxSearch`).
  Không tồn tại ngưỡng ≤2/≥3 ký tự đổi query path: "LC" không trùng label
  "GLC" (không phát sinh id-roundtrip); "GLC" trùng đúng label →
  onCustomValue resolve id → form value đổi giữa chừng.
- Lỗi còn sót sau fix 261022213755b (4fadceb5): gõ ĐÈ lên ô đã có pick —
  keystroke đầu làm passthrough clear id (value: id → ''), sync effect trong
  `uui-searchable-field.tsx` chạy `setInputValue('')` và ĂN chữ vừa gõ:
  gõ "GLC" → ô còn "LC" (probe `truoc-d0/40/120/400` đều thấy). Đây là
  "state cũ ghi đè input mới" — cùng họ race stale-response, trên form-value
  roundtrip.
- Symptom "gõ GLC → menu đóng" của KH (ảnh docx TiepVu22Oct-4 image4) trùng
  dạng pre-fix 261022213755b (log 2026-10-22-tiepvu2 truoc:
  `expanded=false, glcOptions=0`); field trống (scenario A) trên main hiện
  ĐÃ xanh ở mọi delay — phần còn sót là path gõ đè (scenario C), đã fix.

## Fix

`frontend/src/features/shipments/create/uui-searchable-field.tsx` — typing
session owns the visible text: khi `typedCustomTextRef` đang live
(allowsCustomValue, non-empty), sync effect KHÔNG đè `inputValue`; luật
chosenKey (fromLiveTyping) giữ nguyên như 261022213755b.

## Bằng chứng

| File | Nội dung |
|---|---|
| `qa-search-glc-truoc-driver.log` + `truoc-d0/d40/d400` | TRƯỚC fix: C-typed-GLC value="LC" — chữ G bị ăn (mọi delay 0–400ms) |
| `qa-search-glc-sau-d0/d120/d400-driver.log` | SAU fix: C-typed-G/GL/GLC = "G"/"GL"/"GLC", visible=[GLC], exp=true |
| `qa-search-glc-sau-final-green.log` | Final build: diacritics "Bãi"→[GLC], "Đà Nẵng"→[BB Đà Nẵng]; retype-over-pick + bare-Enter commit + click-pick commit "GLC"; 390px contract — exit 0 (2 run trước fail ở bước setup click customer do vite cold-start jitter — probe `qa-debug-customer-click.mjs` xác nhận input click-through, no overlay; run lại GREEN) |
| `qa-truoc-*.png` / `qa-sau-d*-*.png` | Screenshots từng bước (A fresh GLC, B control LC, C retype-over-pick) |
| `qa-sau-final-*.png` | Green: diacritics, enter-commit, picked-glc-over-retype, 390 |
| `api-shared-scope-identity.txt` / `db-glc-row.txt` | API + DB identity kho GLC (id 27166, shortName GLC — read-only change: dữ liệu không đổi) |
| `gate-*.log` | tsc -b 0 · lint 0 · make build 0 · full FE vitest 5497/5497 (final); 2 run đầu ghi lại fail-and-repair: thiếu dist ở worktree mới + 1 flake KT-16 dưới tải (xanh scoped 4/4, không import module bị đổi) |
| `../scripts/2026-10-23-search-glc-race/*.mjs` | Driver (chạy từ frontend/ của một checkout có node_modules) |

## Independent review (code-reviewer, DONE_WITH_CONCERNS → resolved)

1. Dropoff-port (`ShipmentCreateContainerRow.tsx`) thiếu `allowsCustomValue={isAdHoc}` — cùng
   defect class, twin của Cảng nâng → ĐÃ sweep trong changeset này.
2. `commitEnterMatch` không end typing session → ĐÃ fix (clear typedCustomTextRef trên
   commit path; return ambiguous giữ session cho free text).
3. Plate fields có transform uppercase/slice hiển thị raw text trong session — accepted
   tradeoff (cách cũ chính là race bị fix); blur-resync đề xuất bị TỪ CHỐI vì sẽ wipe
   free-text FB-105 trên blur. Follow-up nếu owner muốn.

DB local: kho GLC id 27166 (customer 1 LONG MINH, code GLC, name "Bãi GLC",
shortName "GLC") — tạo cho repro, GIỮ LẠI cho regression chạy lại được.

