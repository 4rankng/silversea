# HANDOFF — fix-kho-search-race (TiepVu22Oct-3: gõ GLC đè pick bị ăn ký tự)

- Owner/controller: this session (worktree
  /Users/dev/.paseo/worktrees/1njkloyy/fix-kho-search-race, branch
  `fix-kho-search-race` off main 19140823).
- Last updated: 2026-10-23.
- Goal: search kho lấy hàng (danh mục chung) — khách báo gõ đủ "GLC" không
  ra, gõ "LC" lại thấy (TiepVu22Oct-3 / TiepVu22Oct-4.docx image4).
  STATUS: DONE — fix + unit tests (red-green) + Playwright UI driven
  (truoc/sau, delay 0/120/400ms, final green trên build cuối) + gates +
  independent review (code-reviewer DONE_WITH_CONCERNS → 2 findings fix
  trong changeset: dropoff-port sweep + commitEnterMatch session-end;
  1 finding từ chối có lý do — blur-resync sẽ wipe free-text FB-105);
  landing via trunk commit `fix(cus): search kho — chặn race stale-response,
  gõ full 'GLC' ra kết quả (TiepVu22Oct-3)` + push theo instruction của
  owner.
- Điều tra (repro-first, `qa/2026-10-23-search-glc-race/`): KHÔNG có
  server-side search theo keystroke (network log chỉ mount-time
  `?scope=shared` + `?customerId=1`); không có ngưỡng ≤2/≥3 ký tự. Lỗi còn
  sót trên main sau 261022213755b: gõ ĐÈ lên ô kho đã có pick — keystroke
  đầu làm onCustomValue clear id (value id → '') và sync effect trong
  `uui-searchable-field.tsx` chạy `setInputValue('')` ăn mất chữ vừa gõ
  ("GLC" → ô còn "LC"). Symptom "GLC → menu đóng" của khách trùng dạng
  pre-fix 261022213755b (ảnh chụp trước khi fix deploy); field trống đã
  xanh trên main — residual là path gõ đè, đã fix bằng typing-session law:
  khi typedCustomTextRef live, sync effect không đè inputValue; luật
  chosenKey (fromLiveTyping) giữ nguyên.
- Files: `frontend/src/features/shipments/create/uui-searchable-field.tsx`
  (+26/−8: typing-session guard + commitEnterMatch session-end),
  `frontend/src/features/shipments/create/ShipmentCreateContainerRow.tsx`
  (sweep: allowsCustomValue cho Cảng hạ, twin Cảng nâng), test mới
  `uui-searchable-field.typing-session.test.tsx` (8 tests, 2 fail trên code
  cũ — red-green proof), testplan case
  `testplan/cycles/2026-10/2026-10-23-tiepvu3-kho-search-stale-race.md`.
- Env verify: FE worktree :7176 (proxy chung BE :3002, đã tắt sau QA); trunk
  :3002/:7175 chạy từ main checkout. DB :5441 có kho GLC id 27166 (tạo cho
  repro, GIỮ LẠI để regression tái chạy).
- Gates: root lint 0 · FE `tsc -b` 0 · `make build` 0 · FE full vitest FINAL
  712 files / 5497 tests ALL PASS (2 run đầu: 2 fail thiếu dist ở worktree
  mới — xanh sau build; 1 flake KT-16 ShipmentFinanceForm dưới tải — xanh
  scoped 4/4, không import module bị đổi) · scoped searchable-field 23/23 ·
  create-feature 224/224.
- Non-goals: không đổi exact-match semantics của warehouseCustomText
  (owner ruling 261022213755b passthrough); không thêm server search;
  UuiSelectField/finance form không thuộc changeset.
