# flows/12 pricing UI regression — RUN-SUMMARY

- **Date:** 2026-09-10 (03:0x–03:3xZ)
- **Executor:** frontend lane (PM reassignment — QA non-executing after 3 wakes)
- **Target:** local dev — UI at http://localhost:7180 (this repo's tree; :7174 is a foreign silversea-prod checkout), API :3001 on current `main` (restarted 09:53, includes `428d705b`, `e12454cf`, `1b77b722`)
- **Accounts:** admin / Abc123 (financial + config surfaces), laixe / Abc123 (driver app)
- **Method:** embedded-browser UI drives + in-tab authenticated fetch (API-driven) against the live engine; claim ladder per check below.

## Claim ladder

| # | Check (PM's flows/12 list) | Result | Claim level |
|---|---|---|---|
| a | Preview AUTO anchor: LongMinh(1525)×NEWEB(1196)×CONT20, transportDate 2026-09-12 → total 4,791,480 + formula trace | **PASS** | API-driven (in-tab fetch, live engine) — engine math + trace ids verified live; card rendering verified by component tests (23/23) |
| b | MANUAL hint on terms-less route (r-11) | **PASS** | API-driven: 200 + `source: MANUAL`, hint "Không tìm thấy điều khoản cước cho khách hàng #1525, tuyến #11 — cần nhập tay giá cước" |
| c | 15T AUTO on 3 routes (D4/D5 demo seed) | **PASS** | API-driven: NEWEB 3,570,000 / ASKEY 3,536,000 / SUNRISE+SJ 3,587,500 — exact anchors |
| d | Override 404-as-null + PUT reason-iff-diff | **PASS** | API-driven (GET 404 / PUT diff-no-reason 400 / PUT with reason 200, row 34: system 4,791,480 → final 5,000,000) **+ UI-DRIVEN**: section "Giá cước — điều chỉnh báo nợ" on /shipments/132085 renders system read-only 4.791.480 ₫, pre-filled final 5,000,000 + reason; save button live |
| e | Driver /my-trips [data-adhoc-label] | **PASS — UI-DRIVEN** | Full dispatch pipeline executed to make it reachable: canonical create → container intake (TEST1234560, ISO-6346-validated) → carrier allocation (OWN) → handoff ACCEPT → CUS line update → issue dispatch (trip 51972, OWN truck 15H-055.79 + driver laixe) → /my-trips card renders "Chạy ngoài" (rgb(164,93,28), transparent bg, next to ĐƠN tag). See checks.md §e for the ad-hoc dispatch finding |
| f | CUS workboard row label | **PARTIAL** | Data-layer PASS (workboard rows carry `raw.isAdHoc`, incl. hybrid lot 132084); render span/CSS identical to the 3 UI-verified surfaces; **row-level UI screenshot = GAP** — the workboard's default window/sort + search submit did not surface the test lots on page 1 (today-default is design; QA fixtures flooding page 1). A human/QA glance closes this in one look |

## Regression anchors re-verified from cycle 2 (no regressions)

- Fuel-period CRUD (UI, admin): list `{items,total}` renders newest-first; POST 201; dup → 409 "effective_from đã tồn tại"; PUT 200; DELETE 200 (test rows cleaned).
- Rate-terms (UI): create 201; XOR radio disables the sibling input; **explicit-null threshold clearing persisted** (3% → "Không áp dụng" → "—" after reload); dup → 409 "Cấu hình đã tồn tại"; T9 defaults live (threshold radio = "Không áp dụng", lag 0).
- Engine bypass: ad-hoc lot 132084 correctly produced **zero snapshots** (engine bypass by design, docx §2-D) even through appointment edits.

## Not covered / gaps

1. (f) row-level UI screenshot (see PARTIAL above).
2. TC-CUOC-011–014 live threshold-ratchet browser run (needs a two-period <threshold scenario; covered at unit level by QA's TC-CUOC-007/008).
3. RBAC matrix (403s) — covered by backend automated suites (config 6/6, shipments RBAC) and QA phase-2; not re-driven in the browser this run.
4. Driver-app label e2e required a hybrid lot (isAdHoc + catalog customer) — see checks.md §e finding: pure-catalog-less ad-hoc lots cannot be dispatched (`trips.customer_id` NOT NULL) until the schema relaxes.