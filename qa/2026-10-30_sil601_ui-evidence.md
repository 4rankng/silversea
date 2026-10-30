# SIL-601 (id 702) — UI/evidence coverage (rung table per AGENTS.md §9)

- Môi trường: local — worktree `fix-sil-702`, backend `http://localhost:3012`
  (PORT=3012), frontend `http://localhost:7187` (vite, VITE_API_PROXY_TARGET
  → :3012). DB/Redis dùng chung ss-prod-db :5441 / ss-prod-redis :6391.
  Cổng 7175/3002 do lane song song `fix-sil-683-r2` giữ — KHÔNG đụng.
- Tài khoản: `admin` (truy vấn + CUS workboard + debit), `giaonhan`
  (Role.OPS — /ops/orders). Mật khẩu theo testplan/testaccounts.txt.
- Fixture: lô LCL id 777 `SHP-2610-00235` (customer LONG Minh id 1, tuyến 6,
  không package → ô đếm), 1 chuyến id 504 với `container_count=2` (case
  "nhiều cont" của luật cũ). DB xác nhận:
  `777 LCL - - SHP-2610-00235` · `1 trips, sum(container_count)=2`.
  Lô fixture cũ `Q2-LCL-IMP` (LCL có sẵn) xuất hiện trên /ops/orders như
  minh chứng thêm. Các lô fixture 774/775/777 còn lại trong dev DB (đánh dấu
  `SIL601-TRIP-*`), không ảnh hưởng dữ liệu thật.
- Driver: `qa/drivers/2026-10-30-sil601-lcl-cont-count-drive.mjs`
  (puppeteer, token inject trước navigation) — log đầy đủ:
  `qa/2026-10-30_sil601_ui-driver.log`.

## Bảng coverage (mỗi claim một rung)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Ô "Tổng quan hàng hóa" CUS hiện "1 cont" cho lô LCL (không còn "—"/0) | UI DRIVEN (3) | `qa/2026-10-30_sil601_ui-cus-workboard-1440.png` + `…-390.png`; DOM row assert trong `…_ui-driver.log` ("Nhập lẻ · 1 cont · 30/10/2026 …"); cell derive từ `operational.totalContainers` (B4) | Filter combo mở rộng, các role ngoài admin |
| Ô Container /ops/orders hiện "1 cont" cho lô LCL (không còn "Chưa có cont") | UI DRIVEN (3) | `qa/2026-10-30_sil601_ui-ops-orders-1440.png`; DOM assert dòng `Q2-LCL-IMP … 1 cont …` trong driver log; API `ops-orders containerCount = 1` (lot 777) | — |
| Phone meta debit "Bill · ngày · n cont" = 1 cho lô LCL có Σ=2 (SIL-478 bị SIL-601 supersede cho LCL) | DB/API VERIFIED (2) + unit pin | DB contrast `sum(container_count)=2` vs API `debit-summary containerCount = 1` (row present) trong driver log; FE render pin `ShipmentDebitRecords.test.tsx` ("BL-LCL · 06/10/2026 · 1 cont") | Row render trên phone face 390px không bắt được (515-lot list + custom combobox lọc khách — chưa drive được filter); UI DRIVEN không đạt cho claim này |
| Mọi per-lot cont count backend = 1 cho LCL (detail-reads pricing input, workspace totals, forwarder, billing draft qty, ops count, readiness advisory, settlement cargoMode) | CODE-READ (1) + source pins | `backend/src/tests/unit/lcl-lot-cont-count-law.test.ts` (8 site pins) + `shipment-debit-summary-row-meta.test.ts` | E2E từng endpoint (unit-only ruling 2026-10-19 — DB paths không chạy trong BE test tree) |
| FCL giữ nguyên số cont thật (regression guard) | Unit + full gates | `shared/src/constants/lcl-lot-cont.test.ts` (FCL passthrough incl. null); full suites xanh (qa/2026-10-30_sil601_*.log) | — |
| Laws khác không vỡ (FB-091, 20260916_5, 615, 686-688, 689-691) | Unit + full gates | toàn bộ test pin hiện hành xanh (fe-test-final, be-test) | — |
| Settlement KPI/plan-row = 1 cho lô LCL (per-lot dedup — review M1) | Unit | `admin-advance-settlement-summary.test.ts` (gồm case 2 chuyến/1 lô = 1) | UI /admin/advance-settlements chưa drive (fixture cần expense links) |

## Review độc lập

`Sil601Review` (code-reviewer): **Approve** — không có HIGH. M1 (dedup theo
trip thay vì theo lô) đã fix (per-lot key qua `shipmentId`); M2 (mixed/legacy
trip-grain rows) giữ nguyên theo luật "LCL = 1" + ghi nhận là giới hạn diễn
giải trong testplan (cần owner nếu đổi trip-grain semantics); L1 bổ sung 2
behavioral tests (ShipmentDebitRecords meta + settlement cases); L2 bổ sung
`cargoMode` lên ops wire (render đã skew-safe).

## Gates (final tree)

| Gate | Command | Log | Exit |
|---|---|---|---|
| Root lint | `pnpm lint` | `qa/2026-10-30_sil601_lint.log` | 0 |
| Backend typecheck | `cd backend && npx tsc --noEmit` | `qa/2026-10-30_sil601_be-tsc.log` | 0 |
| Frontend typecheck | `cd frontend && npx tsc -b` | `qa/2026-10-30_sil601_fe-tsc.log` | 0 |
| Shared tests | `cd shared && pnpm test` | `qa/2026-10-30_sil601_shared-test.log` | 0 (309) |
| Backend tests | `cd backend && pnpm test` | `qa/2026-10-30_sil601_be-test.log` | 0 (906) |
| Frontend tests | `cd frontend && pnpm test` | `qa/2026-10-30_sil601_fe-test-final.log` | 0 |
| Build | `make build` | `qa/2026-10-30_sil601_build.log` | 0 |
