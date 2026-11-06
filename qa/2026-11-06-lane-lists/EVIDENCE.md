# Wave-13 lane evidence — qa/2026-11-06-lane-lists/

Branch `fix/sil-lists` (base 3efeffb9; salvage WIP 256358e1 + final commit). Local stack: dev DB :5441, backend :3002 (main checkout), FE driven from THIS worktree's vite on :7199 (my branch code) with the shared :3002 API.

## Gates (all green)

| Gate | Command | Result |
|---|---|---|
| BE typecheck | `cd backend && npx tsc --noEmit` | exit 0 |
| BE tests (unit-only) | `cd backend && TZ=UTC pnpm test` | 342/342 pass, 0 fail |
| BE scoped | `TZ=UTC npx tsx --test src/tests/unit/sil434-lot-day-filter.test.ts src/tests/unit/cus-container-day-triage.test.ts src/tests/unit/shipment-transport-date-condition.test.ts` | 13/13 |
| FE typecheck | `cd frontend && npx tsc -b` | exit 0 (after 2 toast-signature fixes) |
| FE scoped sweep | `npx vitest run "src/features/shipments/create" "src/features/shipments/cus" "src/features/shipments/debit" <12 page/data files>` | 93 files / 762 tests pass |
| Root lint | `pnpm lint` | 0 errors (6 pre-existing warnings) |
| Build | `make build` | vite build ✓ 19.68s |

## SIL-434 — API repro on real DB rows (rung 2)

`sil434-api-probe.log` (fixture rows SIL434-LOT/SIL434-FCL, cleaned after):
- Filter 10/11..10/11: the LCL lot (EDD 10/11, stored closingAt 06/11) is HIDDEN (was the leak); FCL control (appointment 10/11) shown; 35 unrelated rows unaffected.
- Filter 06/11..06/11: the lot SHOWN (its printed LỊCH TRÌNH day).
VERDICT PASS — filter agrees with the printed day.

## SIL-472 — UI DRIVEN (rung 3)

Drive: admin → /shipments/380/edit → Xóa container 1 (BBHU2001012, tờ khai TK-631-LONGTEST-VALUE) → confirm → Lưu thay đổi.
- Observed: ERROR TOAST in viewport (`toast toast--error :: "Cont có tờ khai TK-631-LONGTEST-VALUE — gỡ tờ khai trước khi xóa dòng container."`) + top banner `.csc-submit-error[role=alert]` with the same verbatim message; NO navigation; DOM: both surfaces captured (screenshot).
- DB after: `SELECT count(*) FROM shipment_containers WHERE shipment_id = 380` → 2 (refusal honored — nothing silently deleted).
- Precondition fixture (operational_sites W13-NM-UI for the form's required Nhà máy field) deleted after the drive.

## SIL-180 — UI DRIVEN (rung 3)

Drive: admin → /shipments/new → row 1 weight "10000" (ghost editor commit) → "Thêm container".
- Observed: row 2 weight trigger renders **"10.000"** (copied); Loại cont stays "Chọn loại"; Số cont empty (screenshot captured inline).
- Component pin: `ShipmentCreateWorkspace.weight-copy.sil180.test.tsx` (3 cases incl. adjacent-row law + empty-source).

## SIL-335 — UI + DB DRIVEN (rung 3)

Drive (admin, /shipments/new): typed "W13 SIL335 CARRIER" into the Hãng tàu combobox (free text) + LOG COM + Xuất khẩu + booking SIL335-BK-002 → Lưu nháp → landed /shipments/779150.
- DB: `shipments` id 779150 `shipping_line_name = 'W13 SIL335 CARRIER'` ✓
- DB: `suppliers` id 204 `W13 SIL335 CARRIER / ACTIVE / {SHIPPING_LINE}` ✓ (master catalog)
- Suggestions: reopening /shipments/new → carrier dropdown now OFFERS "W13 SIL335 CARRIER" (22 options) ✓
- Note: the first drive attempt persisted the supplier while the lot save itself was validation-blocked — persist-before-save is the designed order (best-effort, non-blocking).

## SIL-452 — UI DRIVEN (rung 3)

Drive: ketoan → /shipments-debit → ⋯ row menu (BULK-EXP-0034) → entries: Mở chi tiết / Xem lô hàng / **Khai chi phí** → click → shared drawer "Thêm khoản chi" opens at lot scope: context **"BULK-EXP-0034 · Chung lô"** (screenshot captured: drawer + board).

## SIL-453 — UI DRIVEN (rung 3)

Drive: ketoan → /shipments/779150 → action cluster renders Quay lại + **Khai chi phí** (Sửa/Tạo mới/Xóa correctly absent for ACCOUNTANT) → click → drawer "Thêm khoản chi · **SHP-2611-00337** · Chung lô" (screenshot captured; business key, not internal id).

## SIL-455 — UI DRIVEN (rung 3)

Drive: ketoan → /settlements/1 (PT-2610-0001).
- `[data-field-id="settlement-creator-confirm-fact"]` → "Xác nhận hoàn ứng (người lập): Phạm Thị Hòa · 15:12:05 26/10/2026" (the as-create stamp — was absent at QA time)
- `[data-field-id="settlement-confirm-fact"]` → "Đã duyệt (KT): Phạm Thị Hòa · 18:10:41 26/10/2026" (KT-duyệt law unchanged)
(screenshot captured; both lines also in the page snapshot text)

## SIL-197 — UI DRIVEN (rung 3, discoverability only)

/admin (config hub /config): card "Cài đặt ứng dụng" description now reads "Chính sách báo cáo theo tháng (tạo phiên bản, ngày hiệu lực), hồ sơ tài chính xe, bật/tắt tính năng và nhà cung cấp AI." (snapshot text + hub render). Cmd-K palette shares the registry entry.
NOTE: the page itself (ADMIN-only /config/app-settings, "Chính sách báo cáo" tab) never moved — provenance `git log -S 'app-settings'` shows no removal commit. Role-gate question flagged in Concerns.

## SIL-434 UI note

NOT UI-driven: the leak lives in the BE read service; backend :3002 runs the main checkout (no worktree BE restart permitted on shared ports). Coverage = API repro on real rows (above, rung 2) + BE unit pins. The FE surface (filter inputs → GET params) was already pinned by ShipmentContainersPage.test.tsx.

## Test-data notes

Left in dev DB (evidence for QA re-verify): suppliers id 204 'W13 SIL335 CARRIER'; shipments 779149/779150 (SIL335-BK-001/002 markers, cargo FCL LOG COM area). Removed: SIL434 fixtures, W13-NM-UI site. Browser tab closed; worktree vite server stopped after the drives.
