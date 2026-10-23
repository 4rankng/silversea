# HANDOFF — fix-quyettoan-redesign (Chi phí - Quyết toán CUS, owner screenshots 23/10)

- Owner/controller: this session (worktree `/Users/dev/.paseo/worktrees/
  1njkloyy/fix-quyettoan-redesign`, branch `fix-quyettoan-redesign` off main
  `322e8ebf`). Last updated: 2026-10-24 (sau review pass + QA after 27/27).
- Goal: redesign /shipments-debit theo owner spec v2 (thông báo 1819 23/10):
  bảng 11 cột fixed-layout, group theo KH sticky, totals foot sticky = Σ cột,
  3 trạng thái tiền (số | '0' | pill 'Chờ số liệu' — cấm 'Chưa xác định'),
  1 unified date range picker, checkbox luôn hiện + [Gộp hàng] action bar,
  row 52px 1 baseline, kebab ⋯ thay nút đen, mobile cards + totals strip.
  STATUS: DONE — code + QA + gates + independent review (H1/M1 fixed).
- Wire: shared zod + BE ship thêm `carrierCostTotal`/`opsCostTotal` (additive,
  optional — skew-safe; unit-pinned). FE interface widened.
- Ánh xạ spec→wire KHÔNG bịa: Tuyến→NHÀ MÁY (không POL/POD trên L1); MST/Mã
  KH, TMS viền vàng, '(PDF)'/'· N file', 'Khoản mục' select — bỏ/hoãn vì
  không có dữ liệu nguồn (bảng đầy đủ trong qa README). Mono→var(--font-data)
  (font-family contract cấm mono).
- Files owned: shared/src/schemas/shipment-debit-summary.ts; backend/src/
  services/shipment-debit-summary.service.ts + tests/unit/
  shipment-debit-summary-split.test.ts (NEW); frontend design-system/forms/
  UnifiedDateRangePicker.{tsx,css,test.tsx} (NEW); features/shipments/debit/
  {debitMoney.ts (NEW), DebitLotTable.tsx (NEW), ShipmentDebitRecords.tsx};
  features/shipments/ShipmentDebitRibbon.tsx; pages/ShipmentDebitPage.
  {tsx,css}; components/layout/Topbar.tsx (ẩn month chip trên route); 4 style
  contract tests + 6 page test files + Records test; docs (guidelines ruling
  2026-10-23 + 02-controls Use/scope); testplan/2026-10-24-…; qa/2026-10-24-…
  + qa/scripts/2026-10-24-quyettoan-redesign.mjs (Playwright, env-only ports).
  KHÔNG đụng features/dispatch/**.
- QA: `qa/2026-10-24-quyettoan-redesign/` — BEFORE (main ffdf9d92 :7175): rows
  127–182px, 'Chưa xác định' ×557/×92 (desktop/phone), month chip on route.
  AFTER (worktree :7195 → BE :3003): 27/27 PASS — rows 52px, right-align
  edge 0, totals sticky = Σ (receivable 5.000.000, known=95; cột 0-known đọc
  '—'), group collapse 158→83, picker preset apply → URL ?from&to + refetch,
  copy tờ khai toast, kebab expand L2, phone totals strip, DB identity
  158 lô unchanged (read-only run — không mutate).
- Gates: root lint 0 · BE tsc 0 · BE tests all pass · FE tsc -b 0 · tsgo -b 0
  · FULL FE 5550/5550 (xem qa README; rerun cuối sau review fixes) · make
  build 0. design:drift: baseline file stale (đỏ sẵn trên main — precedent
  lane dispatch); delta vs main: MỌI counter ≤ (hexFallback 67 < 68).
- Env QA còn sống (kill khi hết cần): main FE :7175 (vite, main checkout),
  worktree BE :3003, worktree FE :7195; trunk BE :3002 + DB :5441 của chủ.
- Non-goals: role-ui-sweep đầy đủ, 768 band đo riêng, staging smoke tự động
  post-deploy (deploy theo lệnh owner — xem commit message +qa README),
  L2 workspace redesign, TMS/khoản-mục wire fields.
- Next: commit main + push + deploy staging theo lệnh owner ("commit to main,
  push, deploy to staging prod").
