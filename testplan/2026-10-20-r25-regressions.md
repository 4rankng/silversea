# R25 regressions — FB-011 "{" search warning + FB-036 driver phone + FB-045 dialog clip (20/10/2026)

Cards: 201026135800 · 201026135900 · 201026140000.
Branch `fix-r25-regressions` (off `main` = `16f0e51a`). Browser evidence under
`qa/2026-10-20-r25-regressions/` (before/after per card, local dev + staging).

## Investigation verdict (pre-implementation)

Staging repro on build `ab0a9138` (= `16f0e51a` + A.1 container-copy; pin
approved by controller — does not touch these surfaces) confirms all three
reported symptoms. A local A/B (identical probes against `8bfa2ac7` at
:7176/:3003 and `16f0e51a` at :7175/:3002, same DB —
`qa/2026-10-20-r25-regressions/compare-builds-driver.log`) shows the two
builds behave IDENTICALLY on all three surfaces:

- FB-011: q="{" → HTTP 200 total 0, silent empty state on both builds.
- FB-036: 0/14 cells with phone on both builds (code never rendered phone).
- FB-045: GIỜ HẸN ĐÓNG/TRẢ header sheared at 1024 on both builds (130px equal
  slice < label width; fine at ≥1280).

So no commit in `8bfa2ac7..16f0e51a` changed these surfaces (range diff
touches only accounting/clerk/phoi-phieu/NameCell). The R24 PASS verdicts were
width/data/QA-expectation dependent, not protected by any code. These are
unguarded behaviors the R25 round exposed; the fixes below implement the
card-stated expected behavior and pin it with tests so the R26 round cannot
re-report them.

## Case TC-201026135800 — FB-011: tìm "{" ở /dispatch không có cảnh báo

- Repro (dieuvan): `/dispatch`, gõ `{` vào "Tìm theo B/L, Booking, khách
  hàng…". Before: danh sách rỗng lặng lẽ (empty state "Không có lô hàng nào
  cần phân xe"), không có cảnh báo nào (`stg-before-driver.log` /
  `before-fb011-dispatch-search-brace.png`).
- Expected: từ khóa không chứa chữ/số nào (chỉ ký tự đặc biệt) hiện cảnh báo
  qua slot `search.error` của FilterBar (role="alert", hợp đồng card
  20261002_283 — filter bar giữ chiều cao khi có lỗi). Danh sách vẫn rỗng
  (server trả 0 — hành vi đúng), nhưng dispatcher biết tại sao.
- Root cause: master-plan search chưa từng validate từ khóa; mọi field tìm
  kiếm (bill/booking/tên/container/tờ khai) đều chữ-số, một query toàn ký tự
  đặc biệt không thể match — im lặng là sai về UX.
- Fix: `masterPlanSearchError()` (pure, export từ MasterPlanFilters.tsx) —
  trimmed q non-empty và không có `\p{L}|\p{N}` nào → cảnh báo. Unit test pin.

## Case TC-201026135900 — FB-036: /dispatch-detail thiếu SĐT lái xe

- Repro (dieuvan): `/dispatch-detail`, khối THÔNG TIN ĐIỀU PHỐI (cell
  Điều phối) hiển thị "SilverSea · 15H-061.14 · Bùi Quang Hường" — không có
  SĐT (0/14 cells có phone, `stg-before-driver.log`).
- Expected: SĐT lái xe hiện kèm tên/biển số trong cell Điều phối: trip OWN →
  drivers.phone của tài xế chuyến; planned OWN (chưa phát lệnh) → phone của
  tài xế gắn xe theo biển số; EXTERNAL → trips.external_driver_phone.
- Fix: backend row đọc `dispatch.assignedDriverPhone` (trip hydrate +
  planned-plate hydrate qua batch truck-driver assignment); write path
  (plate patch + atomic plan save) echo cùng field để cell không mất SĐT sau
  lưu; FE type + cell render token SĐT (data-font, muted) cạnh tên tài xế.
- Sweep: `getActiveAssignment`/`getActiveAssignmentsByTruckIds` trả thêm
  `driverPhone` (additive); consumers hiện tại không đổi hành vi.

## Case TC-201026140000 — FB-045: dialog "Chi tiết container" clip cột GIỜ HẸN ĐÓNG/TRẢ

- Repro (dieuvan): `/dispatch` → "Chi tiết container" drawer. At ≤1024px:
  header "GIỜ HẸN ĐÓNG/TRẢ" bị cắt ngang (th scrollWidth > clientWidth —
  shear giữa chữ vì global th nowrap + cột auto 118px < label ~125px); giá trị
  "08:00 20/10/2026" wrap 2 dòng (`stg-fb045-w1024`).
- Expected (FB-063/R17 law, card 181026021137): header LUÔN 1 dòng, cột đủ
  rộng không cắt chữ, giá trị datetime 1 dòng.
- Fix: cột giờ hẹn có width riêng 150px (`__appointment-column`), thead th
  pin `white-space: nowrap` tường minh (không nhờ global), min-width table
  giữ 900px (còn lại 7 cột auto ≥101px ≥ mọi label còn lại). Styles test pin.

## Gates

`pnpm lint` · `cd backend && npx tsc --noEmit` · `cd backend && pnpm test` ·
`cd frontend && npx tsgo -b` · scoped vitest (master-plan, detailed-plan,
drawer styles) · `make build`. Logs → `qa/2026-10-20-r25-regressions/gates.log`.

## Verdicts (2026-10-20, end of run)

All three symptoms reproduced on staging `ab0a9138` (before evidence) and on
local HEAD before the fix; all three fixed and UI DRIVEN on local dev after
the fix. Staging re-drive needs a deploy ≥ this commit (not in scope per
controller instruction — code + tests + push is the deliverable).

| Case | Verdict | Evidence |
|---|---|---|
| TC-201026135800 FB-011 | **FIXED — UI DRIVEN** | Before (staging + local): `stg-before-driver.log` / `before-fb011-dispatch-search-brace.png` — `{` silent empty, 0 alerts. After: `after-driver.log` `fb011-after-brace` — typing `{` shows `role="alert"` "Từ khóa chỉ có ký tự đặc biệt — thêm chữ hoặc số…" with `aria-invalid=true`; typing `B` clears it (`fb011-after-brace-cleared`). Unit: MasterPlanFilters.test.tsx 3 new pins (validator class + alert slot + clear-on-letter). |
| TC-201026135900 FB-036 | **FIXED — UI DRIVEN + wire/DB verified** | Before (staging): `stg-fb036-cells` — 0/14 cells with SĐT. After wire: `fb036-wire-db-proof` — 5/50 rows carry `dispatch.assignedDriverPhone` on BOTH branches (planned plate→roster 3, live trip 2). DB: drivers roster rows `Đinh Thanh Thịnh|0973768118`, `Võ Đức Đỗ|0939254881`, `Phạm Văn Hùng|0900000003` match the wire exactly. After UI: `after-driver.log` `fb036-after-cells` — 8 cells render "plate · name · phone" in the Điều phối block. Unit: DispatchPlanEditorCell.test.tsx 2 new pins (render beside plate/name + clean omit when null). |
| TC-201026140000 FB-045 | **FIXED — UI DRIVEN** | Before (staging + local): header `GIỜ HẸN ĐÓNG/TRẢ` sheared at 1024 (`stg-fb045-w1024` — `sheared:true`, value 2 lines). After: `after-driver.log` `fb045-after-w{1440,1280,1024}` — `verdict:true` at all three widths: 9/9 headers 1 line 0 shear, appointment column exactly 150px, "08:00 24/09/2037" 1 line. Styles pin: DispatchContainerDetailDrawer.styles.test.ts (150px floor + explicit nowrap law + table minimum). |

## Verification coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| FB-011 `{` cảnh báo on /dispatch | UI DRIVEN | `qa/2026-10-20-r25-regressions/{after-fb011-dispatch-search-brace.png,after-fb011-dispatch-search-braceB.png,after-driver.log}` + unit pins | staging re-drive (needs deploy ≥ this commit); role MANAGER viewport 768/390 (alert slot is the shared FilterBar band, pinned by its own tests); /dispatch-detail's own search (not in card scope) |
| FB-036 SĐT lái xe in Điều phối block | UI DRIVEN | `after-fb036-dispatch-detail.png`, `after-driver.log` `fb036-after-cells`, `fb036-wire-db-proof` (wire 200, planned+trip branches), DB roster match | staging re-drive; EXTERNAL-trip phone cell (no external-phone rows in local page 1 — branch covered by wire shape + unit type); ACCOUNTANT role (route allows, phone not redacted by design — roster contact, not site PII); mobile 390 card tier of the grid |
| FB-045 dialog column no-clip | UI DRIVEN | `after-fb045-container-detail-w{1440,1280,1024}.png`, `after-driver.log` `fb045-after-w*` (verdict true ×3) | staging re-drive; widths 761–1023 (container card layout takes over ≤760 — different mode, unaffected); CUS role drawer entry (same component) |
| R24↔R25 code-delta audit (no dispatch-surface commit in range) | DB/API VERIFIED | `compare-builds-driver.log` — identical behavior on 8bfa2ac7 vs 16f0e51a against the same DB for all three cards | staging DATA at R24 time (unknowable — build replaced); R24 QA's exact window width for FB-045 |
