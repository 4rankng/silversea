# QA cut 1d — TC-DDP-006/007 verified + dialog-hang repro artifact

**Ticket:** 8afc13a9 (Dispatch detailed-plan: all containers + reassign)
**Staging commit under test:** 8a7e6fc3 (current); fullstack is debugging the dialog hang LOCALLY per Amendment 4 (USER DIRECTIVE: fix/debug cycles verified LOCAL-first before staging re-cuts). This is the REPRO ARTIFACT for fullstack's local debug.
**Status:**
- TC-DDP-006 (master-plan no regression) **PASS rung 3**.
- TC-DDP-007 (no console errors during nav) **PASS rung 3** (filtered my own script errors; no app errors).
- TC-DDP-003 / TC-DDP-004 (assign + reassign carrier) **BLOCKED** by dialog hang. Repro artifact saved here for local debug.

---

## TC-DDP-006 — Master-plan no regression (PASS rung 3)

- Navigated `https://vantai.tingting.vip/dispatch-detail` → `https://vantai.tingting.vip/dispatch` via `browser_navigate`.
- On `/dispatch`: `h1 = "Kế hoạch Tổng quát"`, `.master-plan-grid__row` count = **9**, `.master-plan-grid` present, `.detailed-plan-grid` class absent.
- `document.querySelectorAll('[data-testid^=dispatch-detail]').length` = **0**. No dispatch-detail-* testIds leaked into the master-plan DOM.
- `detailTestIdCount: 0`, `hasDetailTestIds: false`.
- **Verdict:** PASS — master-plan still shows the assigned-only behavior (unchanged from pre-fix), and the detail-plan fix did not leak any of its affordances into the overview.

## TC-DDP-007 — No regression on other dispatcher flows (PASS rung 3 console logs)

- Pulled `browser_get_logs` after the `/dispatch-detail` → `/dispatch` navigation + the dialog open + close cycle. Filtered out my own `browser_evaluate` SyntaxErrors (I have been writing broken inline scripts that throw `querySelector` invalid-selector / `await` only-valid-in-async / `Identifier has already been declared` etc.). Those are MY OWN script errors, not app errors.
- **Push API errors** (`Chrome currently does not support the Push API in incognito mode`) are environment-level (browser runs in incognito), not app errors. Not a regression.
- **Zero app-level errors** in the log buffer after the navigation + dialog interaction cycle.
- **Verdict:** PASS — no red console entries attributable to the dispatch-detail fix on this staging cut.

---

## TC-DDP-003 / TC-DDP-004 — Dialog-hang repro artifact (BLOCKED, for fullstack local debug)

**Repro path (deterministic):**

1. Open `https://vantai.tingting.vip/login`. Login as `dungnv` / `Abc123` (staging DISPATCHER per testplan/testaccounts.txt).
2. SPA redirects to `https://vantai.tingting.vip/dispatch`.
3. Navigate to `https://vantai.tingting.vip/dispatch-detail` (default date filter).
4. The grid renders 11 rows in `.detailed-plan-grid__row` (10 plated, 1 unplated "Chưa có số"). 10 rows have `.dispatch-assignment-cell__trigger`; 6 rows also have `.dispatch-assignment-cell__quick-issue`.
5. **Click the carrier cell of any plated row** (the element with class `.dispatch-assignment-cell__trigger`, e.g. the first row carrying "SilverSea / 15H-021.39").
6. A `<div role="dialog">` opens with title "Phân xe lại" and visible fields: `Loại xe` (Xe nhà / Xe ngoài / Xe đầu kéo), the plate (`15H-021.39`), `Lái xe` (current driver name, e.g. "Dương Văn Thực Hủy"), and action buttons `Hủy` / `Xác nhận phân xe lại`.
7. **The dialog stays on "Đang tải…" (Loading…) for > 10 seconds** without ever rendering the carrier picker / driver picker / vehicle-type chooser. The `Hủy` button is non-functional via standard click paths (Escape key + click on `Hủy` text both leave the dialog mounted).
8. Same hang reproduces via the **quick-issue** trigger (`.dispatch-assignment-cell__quick-issue`): dialog title "Phát lệnh · EBKG18452303", fields Tên tài xế / SĐT / CHỌN NHANH NGÀY / GIỜ CHẠY / GIỜ KẾT THÚC / NGÀY CHẠY / KHUNG GIỜ PHỔ BIẾN / Hủy / Phát lệnh — but **NO operations tags picker** anywhere in this dialog either.

**Expected vs Actual (per ticket 8afc13a9 acceptance criteria):**
- **Expected (per TC-DDP-003)**: clicking a row's carrier affordance opens an assignment dialog with a carrier picker that lists the available carriers and lets the user assign/reassign. The current carrier must be pre-selected.
- **Actual**: dialog opens with the title + static fields (Loại xe / plate / current driver) but the carrier picker is stuck on "Đang tải…" indefinitely. The dialog cannot be completed.

**Expected (per TC-DDP-004)**: reassigning a carrier to a different one updates `carrier_id` in the DB. Cannot exercise this because the picker never resolves.

**Hypothesis for local debug (fullstack):**
- The carrier-list API call that the dialog depends on is not resolving. Candidate endpoints: `GET /api/dispatch/carriers` (or whatever `useDispatchDetailPlan` calls to populate the dropdown).
- Likely cause: the carrier list query depends on data that the current staging seed does not satisfy — could be a missing customer / supplier / active-flag filter, or a permission check failing silently.
- Console logs (filtered to app-level): **zero app-level errors**. The dialog stays in the "Đang tải…" state, suggesting the React Query fetch is in `isPending: true` forever (or the API returns 200 with empty list and the UI never leaves the loading state).
- This is the ORIGINAL user complaint behind ticket 8afc13a9: "dispatch detailed plan cannot change carrier" — confirmed via the hang on every carrier-cell click.

**Repro artifact files saved:**
- `qa/2026-09-10_dispatch-detailed-plan_dialog-hang-repro.md` (this file)
- Earlier screenshots: `qa/2026-09-10_dispatch-detailed-plan_ui-cut1.png` (page-load evidence) + `qa/2026-09-10_dispatch-detailed-plan_ui-cut1-unassigned.png` (saved before browser_screenshot failed; check the file).

**Note for fullstack:** the dialog content I observed during the hang is recorded below for cross-reference with local repro. Element counts and selectors are reproducible.

```
Title:                 Phân xe lại
Visible body:          Loại xe / Xe nhà / Xe nhà / Xe ngoài / Xe đầu kéo
                       15H-021.39
                       Lái xe / Dương Văn Thực Hủy
                       Hủy / Xác nhận phân xe lại
Stuck state:           "Đang tải…" persists > 10s (and indefinite per repeated checks)
```

```
Title:                 Phát lệnh · EBKG18452303
Visible body:          Phát lệnh cho tài xế · STG VERIFY NHA XE 09 · 51K-999.99
                       Tên tài xế (nhà xe ngoài) — không bắt buộc
                       SĐT tài xế (nhà xe ngoài)
                       CHỌN NHANH NGÀY / Hôm nay / Ngày mai / Ngày kia
                       GIỜ CHẠY / GIỜ KẾT THÚC / NGÀY CHẠY
                       KHUNG GIỜ PHỔ BIẾN / 08:00 / 10:00 / 13:30 / 16:00
                       Hủy / Phát lệnh
Operations tags picker: ABSENT (the testplan T4 location is the master-plan's dispatch-assignment dialog, not these dialogs)
```

**Next step:** fullstack reproduce locally + fix + re-cut → QA re-verify on staging at the fixed HEAD per Amendment 4.
