# Phase-2 QA run — docx trilogy (2026-09-09, lane 4)

**Scope:** flows/09 Kẹp/Kết hợp + 5 case mới (TC-ADHOC-001..004, TC-GHEP-012), driver-board
48px/"Giờ đóng / trả:" checks, 90a17e65 pair tags, OPS wallet optimistic + two-path approval,
full suites + lint + typecheck trên integrated tree (local dev only, no staging/prod).

## Gates

| Gate | Kết quả |
|------|---------|
| Backend suite | **1858/1858 PASS** (exit 0, 229s) — `backend-suite.log` |
| Frontend suite | **exit 0** (vitest, 60.9s) — `frontend-suite.log` |
| Frontend lint | **0 errors** (111 warnings = baseline chấp nhận từ 09-05) — `frontend-lint.log` |
| Frontend typecheck | **0 errors** — `frontend-typecheck.log` |
| Targeted re-run sau lint-fix | 9 files / 85 tests PASS |

## Browser results (UI-DRIVEN, agent-browser, local)

| Case | Kết quả | Evidence |
|------|---------|----------|
| TC-ADHOC-001 | **PASS** — checkbox là element đầu tiên (DOM idx 0/31), mặc định không tích, toggle không mất dữ liệu | `adhoc001_*.png` |
| TC-ADHOC-002 | **PASS** — L1 catalog (customer_id=3/raw NULL), L2 free-text (92561: raw KH+raw ports, XOR per-container), L3 mixed (raw KH + dropoff_port_id=5); **guardrail: customers/sites/routes/ports = 165/30/53/41 không đổi** | `adhoc002_dbrows_ALL.txt`, `*_counts_*.txt` |
| TC-ADHOC-003 | **PASS** — NM disabled tới khi chọn KH; chỉ xổ nhà máy KH A; chọn NM ⇒ tuyến autofill + disabled | `adhoc003_*.png` |
| TC-ADHOC-004 | **FAIL vs PRD list-leg** — list render "—" thay tên + không nhãn "Chạy ngoài"; detail render raw KH + ghi chú ad-hoc. Khớp adjudication lane 2: PRD-only, DEFERRED chờ user duyệt | `adhoc004_*.png` |
| TC-GHEP-001 (API) | **PASS** — pair #571 KEP/ACTIVE trips 27025+27026; các error string âm bản xác nhận: "Chỉ có thể ghép 2 chiều cho chuyến xe nội bộ", "Thiếu thông tin tải trọng xe", "…không khớp dữ liệu chuyến hiện tại" | `ghep001_pair-create-response.json` |
| TC-GHEP-012 | **NOT-RUN UI** (hạn chế dữ liệu mirror: không có cặp ghép gắn shipment; 2 trips nội bộ đều orphan). Unit/component PASS: `pair-ket-hop-gating.test.ts` + FE tag-render test (90a17e65). UI leg của driver-board cũng NOT-RUN (board rỗng — trips orphan không có fulfillment link) | `ghep009_*.png`, `ghep009_journey-board-api.json` |
| OPS expense → wallet | **PASS** — toast "Đã lưu khoản chi — chờ kế toán duyệt"; DB id=82 PENDING/paid_by=3; SỐ DƯ −150.000; nhãn đỏ "Nợ chứng từ" | `ops-*.png`, `ops-expense-dbrow.txt` |
| OPS two-path approve | **PASS** — dialog "Duyệt không ảnh biên lai" bắt buộc ghi chú kiểm chứng; APPROVED (approved_by=9); audit ×2 (39589/39590) | `ops-ketoan-*.png`, `ops-expense82-audit.txt` |

## Lint fixes (6 mechanical, trong lane files, không đụng logic)

`IssueOrderFields.tsx` (xoá getNextDay), `useDispatchDetailPlan.test.tsx` (xoá fixture chết),
`CusDetailContent.tsx` (`_onExternalTripCompleted`), `use-cus-detail.ts` ×2 + `use-cus-quick-edit.ts`
(bỏ binding `response` không dùng). Sau fix: lint 0 errors + targeted re-run 85/85 PASS.

## Not covered / deviations

- TC-GHEP-012 + driver-board pair cards UI: **hạn chế dữ liệu** (không có cặp shipment-linked trên
  1 xe nội bộ trong mirror) — unit/component PASS; cần dữ liệu ghép gắn fulfillment để chạy UI leg.
- MLX-7 push notification: **documented deviation — polling 15s** (theo lead/lane 1).
- Nhãn "Chạy ngoài" list (F5): DEFERRED chờ user duyệt (PRD adjudication `0b7ad7e2`).
- Snapshot phát lệnh (F6): OPEN DESIGN chờ user duyệt — không migration.
- MDN-7 inactive-factory filter: không định vị được evidence — chờ lane 2 evidence-only.
- Server-side PDF (đề nghị thanh toán): deferred (đã biết từ trước).
- TC-GHEP-008/-011: service-level only (đã ghi trong flows/09).

## Data touches (local DB, logged)

`trucks.id=21 tow_capacity_tons=25`; `trips 27025/27026: vehicle_capacity_kg, planned window,
canonical, departure_date 2026-09-09, truck/driver → bqhuong(39/33)`; pair #571; 3 lô TEST-ADHOC-L1/L2/L3
(92562/92561/92563); ops_expense id=82 (PENDING→APPROVED). Không đụng staging/prod.
