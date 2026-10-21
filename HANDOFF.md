# R29F — FB-093 re-verify trên staging-built FE (nút "Tách nhóm" Kế toán) — 2026-10-21

Controller: agent, worktree feat-r29f-fb093-stgverify (off main ebd032fb), branch feat-r29f-fb093-stgverify.

**Status**: DONE — verdict **PASS 5/5 (UI DRIVEN)** trên staging-built FE. Fix
`essentialWhenHasData` (merge ebd032fb) đã được verify đúng lỗ hổng cần đóng
(lần trước mới chỉ local FE :7191 → staging API). Card 211026092400 đã
QA_TESTED từ lane trước; lane này là confirmatory — 0 src change.

## Verdict tóm tắt

- **Surface chính PASS**: ketoan profile sạch (storedChoice=null) →
  `/accounting/chot-debit` → cột "Thông số container" TỰ HIỂN + nút "Tách nhóm"
  enabled trên từng dòng nhóm R29F (aria-label nêu Số Bill). KT4 giữ nguyên
  (cột tiền breakdown vẫn ẩn).
- **Flow PASS**: click "Tách nhóm" dòng R29F-02 → dialog → unmerge **200**
  (`dissolved:true`) → board hết nút/note R29F; DB cả 2 lô revGroup=null,
  note=null; cước về đúng trạng thái trước ghép (lô chính null như trước, lô
  member 0₫ computed-zero D02).
- **Regression mini PASS**: `[]` → đủ cột; `['phanXe']` → phanXe ẩn đúng
  choice, container VẪN hiện; `['container']` → ẩn đúng (choice thắng
  essentialWhenHasData). 2 luật không va chạm.

## Bắt buộc đọc nếu dùng lại evidence này

- **Build drift**: task pin ebd032fb, resume pin 85ea2cef, build thực tế tại
  drive time **806acf89** (merge REQ-07 — chỉ driver-display FE, không đụng
  accounting). Drift được ghi nhận + chứng minh fix live bằng chunk bytes
  (`AccountingDebitClosePage-DJu42oE9.js` chứa `essentialWhenHasData`) trong
  `qa/2026-10-21-r29f-fb093-stgverify/00-build-and-fix-proof.txt`. Scripts
  abort khi health lệch `QA_EXPECT_BUILD`.
- **Note-literal trap**: board DOM render "(Ghép cùng Bill X)" (label
  `ghépCùngRef`) KHÁC chuỗi API "Ghép cước cùng Bill X" — assert từng surface
  theo literal của nó (run 1 fail 1/5 chỉ vì nhiễu này, evidence giữ dưới
  prefix `run1-note-literal-*`).

## Artifacts + scripts

- Evidence: `qa/2026-10-21-r29f-fb093-stgverify/` (README verdict + coverage
  table §9, PNG từng bước, DOM fragments, db-*.json, net.log, ui-driver.log).
- Drivers: `testplan/qa/scripts/2026-10-21-r29f-fb093-setup-merge.mjs` (UI tạo
  2 lô LCL R29F + UI ghép) và `testplan/qa/scripts/2026-10-21-r29f-fb093-tach-verify.mjs`
  (surface + tách nhóm + regression). Idempotent: tái dùng lô R29F nếu còn.
- Data test để lại: shipment 972/973 (SHP-2610-00572/573, booking R29F-01/02,
  YUANFANG) — cuối task cả 2 ungrouped, lock OPEN. Merge→unmerge ×2 chu kỳ
  (tiepvv merge, ketoan unmerge).

## Residual (ngoài scope, đã ghi nhận từ R29)

Kênh debit-summary hiển thị `freightAuto=0` KHÔNG kèm reason cho lô member
không-trip sau tách — snapshot `freight_rate_snapshots` giữ đúng reason D02
"Tách khỏi nhóm ghép — chờ định giá lại" nhưng read channel không surface.
Không phải defect "thiếu nút"; cần card riêng nếu muốn surface.

## Next steps (không blocking)

- Card riêng (nếu khách muốn): surface reason D02 trên debit-summary cho member
  sau tách.
- Khi staging recut tiếp và cần re-verify pin: `QA_EXPECT_BUILD=<hash> node
  testplan/qa/scripts/2026-10-21-r29f-fb093-*.mjs`.
