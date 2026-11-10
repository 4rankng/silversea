# qa/2026-11-09-r8a-694-728-734 — Lane r8a: SIL-694 / SIL-728 / SIL-734

Branch: `fix/r8a-694-728-734` (base 6d7a3886 = origin/main)
Environment: local stack — backend :3003 (tsx dev, worktree r8a-fix), frontend :7176 (vite,
proxy → :3003), DB `ss-prod-db` localhost:5441/silversea (local mirror), Redis :6391.
Account: hoapt (ACCOUNTANT, NV009) / Abc123. Browser: Paseo Chromium tab.
NOTE: staging (vantai.tingting.vip) dùng CHỈ để tái hiện/pin dữ liệu fail trước fix
(login hoapt 200 ACCOUNTANT; report rows NHH −420.000₫/VĐC −4.300.000₫ với
outstandingSigned = 0; settlements PT-2611-0004 +5.000.000₫, PT-2611-0005 +50.000₫).
Fix KHÔNG có trên staging build c4cea6b6 — mọi evidence chạy dưới đây là LOCAL.

## Gates (§5)

| Gate | Command | Result |
| --- | --- | --- |
| Root lint | `pnpm lint` | **0 errors** (6 warnings pre-existing trên base, không thuộc file lane sửa — bg_8 sau fix: "✖ 6 problems (0 errors, 6 warnings)"). Fix 1 error do lane gây ra: prop `canReview` unused → commit 8fcaa082 |
| Backend typecheck | `cd backend && npx tsc --noEmit` | EXIT=0 (2 lần chạy: sau 694 + sau 734) |
| Backend tests | `cd backend && pnpm test` | pass 342 / fail 0 (bg_3) |
| Frontend typecheck | `cd frontend && npx tsc -b` | EXIT=0 (bg_4 + chạy lại sau commit cuối: FINAL_FE_TSC_EXIT=0) |
| Frontend tests | `cd frontend && pnpm test` | full suite BẤT ỔN ĐỊNH trên máy này: 2 lần chạy 55 rồi 81 file fail, toàn bộ mẫu kiểm tra là `Test timed out in 5000ms` (không một assertion fail); file heavy nhất chạy riêng với `--testTimeout=20000` → **17/17 PASS** (bg_15) ⇒ timeout do tải máy (containers + lanes song song), KHÔNG phải hồi quy từ diff. Các suite chạm đúng vùng sửa pass ổn định: OpsReconciliationReportPage 12/12, trip-detail POD 7/7 (bg_11 chạy lại trên code cuối). |
| Build | `make build` | EXIT=0 (bg_7) |

## SIL-694 — POD gốc (UI DRIVEN, trừ screenshot)

Drive thật hoapt → http://localhost:7176/trips/754 (trip IN_TRANSIT, OWN, ref
BK-S638F-DROP-1793680800573):

1. Nút "Hoàn thành" (TripHeader) → modal "Hoàn thành chuyến" mở.
2. DOM assert TRƯỚC mark (browser snapshot): `status` =
   "Chưa thu hồi POD gốc (chứng từ mộc đỏ) — Kế toán/CUS đánh dấu đã thu hồi
   trước khi hoàn thành chuyến." + nút "Đánh dấu đã thu hồi POD gốc".
3. Click nút → POST /api/trips/754/pod-recovered {expectedVersion:4} → 200.
4. DOM assert SAU mark: status = "POD gốc: đã thu hồi · 20:10:15 9/11/2026",
   nút mark biến mất.
5. API GET /trips/754 → {"status":"IN_TRANSIT","podRecoveredAt":"2026-11-09T13:10:15.419Z",
   "podRecoveredBy":9,"version":5} (cột mới từ GET fix).
6. DB: `SELECT id,status,pod_recovered_at,pod_recovered_by,version FROM trips WHERE id=754`
   → `754 | IN_TRANSIT | 2026-11-09 13:10:15.419+00 | 9 | 5` (ss-prod-db psql).
7. Nhập lý do + submit close → banner lỗi rõ ràng: **"Chưa có e-POD hợp lệ.
   Không thể chốt tài chính chuyến đi."** — cổng POD đã THÔNG, close đi tới cổng
   kế tiếp (trip 754 thiếu e-POD — bằng chứng lái xe, ngoài scope ticket). Trên
   dữ liệu đủ evidence (QA trip 492), chuỗi mark → close 200 đã được lane F1
   chứng minh bằng API (comment 4286).

Limitation: browser_screenshot của Paseo host lỗi cố định "tab has not painted
yet" (visibilityState=visible, readyState=complete — tool failure, không phải
app) → KHÔNG có PNG; evidence = DOM snapshot text + evaluate reads + API + DB.

## SIL-728 — nút Lập phiếu hoàn ứng (UI DRIVEN, trừ screenshot)

Trước fix (staging, API probe 09/11): cả 2 dòng QA outstandingSigned=0 → nút
old-condition không render — đúng fail QA 4783.

Sau fix (local drive hoapt → /accounting/hoan-ung):
1. DOM assert: 2 dòng ÂM đều có nút "Lập phiếu hoàn ứng" —
   Nguyễn Văn Giao −15.950.000₫ (os +16.050.000₫) và q23-forwarder −500.000₫
   (os 0). Cả hai thuộc nhánh MỚI (report âm + ví không âm) mở dialog settlement.
2. Click dòng 1 → dialog "Lập phiếu hoàn ứng cho nhân viên" mở, radio
   "Nguyễn Văn Giao — Còn tạm ứng 16.050.000 ₫" CHECKED (prefill đúng staff
   qua initialForwarderId), 3 section render đầy đủ.
3. Đóng bằng Hủy (không ghi phiếu — tránh đụng dữ liệu mirror lớn hơn cần thiết).

Netting BE: report local trả advanced đã trừ consumption phiếu legacy
(ops-reconciliation-report.service — pin unit netting.test.ts).

## SIL-734 — re-price chiều COST (DB VERIFIED, probe thật)

`cd backend && DATABASE_URL=...:5441/silversea npx tsx ../qa/scripts/2026-11-09-r8a-sil734-cost-reprice-probe.ts`
→ **PROBE GREEN 12/12** (exit 0): D1 merge giá bảng/stamp 0₫, D2 tách cả nhóm
member về đúng 2.400.000₫ (matched SUPPLIER) + planned mirror, D3 lane miss
clear về null honest (trip + planned), D4 tách 1 lô leaver re-price hit.
Regression: probe K1 2026-11-07 (REV + xóa lô chính) → **GREEN 10/10**.
Evidence log: cost-reprice-probe.log + k1-survivor-probe.log (cùng thư mục này).
