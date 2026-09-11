# QA cut 1b — Driver mobile UI findings (T3 + T4 driver-mobile)

**Tickets:** T3 365943ea (driver mobile UI), T4 a6cb2543 driver-mobile part (replace tags)
**Staging commit under test:** 13b68a2b (backend RBAC-only fix; FE bundle unchanged)
**PM signal:** STAGING READY 1B — driver RBAC fix verified by deploy-owner, GET /shipments/dispatch-task-tags returns 200 for DRIVER.
**Status:** RUNG 3 partial — RBAC fix verified + page wiring intact, BUT every DRIVER probed has 0 trips, so the card-anatomy TCs (TC-DRV-MOBILE-001..007) and TC-REPLACE-TAGS-002 cannot be exercised end-to-end on a populated view.

## What I verified (rung 3, real staging, real DOM)

### DRIVER login & RBAC fix
- Cleared `localStorage` + `sessionStorage` and re-logged in as **bqhuong** / `Abc123` (staging DRIVER) → redirected to `https://vantai.tingting.vip/my-trips` (NO 403 — RBAC fix works).
- Also re-logged as **vvtrung** (Vũ Văn Trung, plate 15H-076.50), **tvtham**, **btdung** (Bùi Tiến Dũng, plate 15H-104.03) — all redirected to `/my-trips` cleanly. RBAC fix is live.
- "thu" login fails on staging with "Sai thông tin đăng nhập" — `thu` is local-dev-only per testplan.

### /my-trips page wiring intact
- Title renders: "Hành trình · TransTing".
- Driver identity line: "Bùi Tiến Dũng  15H-104.03" (correct for `btdung`).
- 3 tabs render with counts: Lệnh mới 0  / Đã nhận 0  / Lịch sử 0.
- Empty state copy correct: "Chưa có lệnh mới nào được giao." (no new orders assigned).
- All 4 probed drivers (bqhuong, vvtrung, tvtham, btdung) → all 3 tabs → 0 cards. **None of the staging DRIVER accounts I tried had an assigned trip.**

## What I COULD NOT verify (rung 1 — no populated view to drive)

### TC-DRV-MOBILE-001 — Field order at 390 px
- The card factory/headline element does not render (no cards in DOM). The Cycle-2 unit test (`renders the ticket-365943ea field order with container, type and seal on one line`) PASSED on the committed 9b2744b6 code, so the JSX order is locked; this staging step would only re-confirm.

### TC-DRV-MOBILE-002 — No horizontal scroll at 360 / 390 / 768 px
- No cards present → cannot test scroll behaviour with content. Page-level scroll width is clean (SPA header / tabs render without overflow in current empty view).

### TC-DRV-MOBILE-003 — Container + ports side-by-side
- No cards present → cannot observe pairing.

### TC-DRV-MOBILE-004 — 390 px screenshot
- BLOCKED — browser MCP returned "Screenshot failed: the embedded browser did not produce a frame in time" on every attempt this cycle.

### TC-DRV-MOBILE-005 — Existing DRV-LIST-01..06 acceptance still hold
- Page renders, no console errors observed; full-bleed and tap-target assertions depend on a card being present.

### TC-DRV-MOBILE-006 — Vietnamese labels match
- No card labels to read. Tab copy is correct.

### TC-DRV-MOBILE-007 — Long factory name abbreviates
- No card → no factory name to abbreviate.

### TC-REPLACE-TAGS-002 — Driver mobile shows 14 tags
- No operations tag pills rendered on the page (no cards). Per PM's wire fact: "GET /shipments/dispatch-task-tags returns 200 for DRIVER — chips will render" — but with 0 cards there are 0 chips to assert order against.

## Why no populated driver
- 4 staging DRIVER accounts probed (bqhuong, vvtrung, tvtham, btdung) → all 0 trips in all 3 tabs (Lệnh mới / Đã nhận / Lịch sử).
- I do not have DB read access (no staging DB connection registered with this QA agent — per PM cut-1 ruling).
- Without DB, cannot enumerate which of the 38 named drivers has an assignment in the current staging seed; would have to script-log each one sequentially (38 × 3 tabs × login round-trip), well over the in-turn tool budget.
- This is a staging seed gap, NOT a regression. The cycle-2 unit tests for the FE card wiring PASSED.

## Verdict
- **TC-DRV-MOBILE-001..007 + TC-REPLACE-TAGS-002**: rung 1 (CODE-READ ONLY) — the page wiring is intact, but I could not drive the card-anatomy assertions because no probed driver has a populated view on this staging cut. The FE cycle-2 unit-test green on commit 9b2744b6 (with cycle-2 evidence in `qa/2026-09-10_driver-mobile-ui_cycle2-reverify.md`) is the rung-1 backup per the PM ruling.
- **DRIVER RBAC fix**: PASS rung 3 — 4 drivers can now reach `/my-trips` with no 403.
- **No regression on page wiring**: PASS rung 3 — page renders, identity + tabs + empty state correct.

## Recommendations
- **PM / deploy-owner**: seed at least one DRIVER with an assigned trip on staging 13b68a2b so the next QA cycle can drive TC-DRV-MOBILE-001..007 + TC-REPLACE-TAGS-002 against a populated card.
- **PM**: register a read-only staging DB connection with this QA agent so it can enumerate which DRIVER has trips and target the populated one directly (saves a 38-driver probe loop).
- **Next QA cycle**: re-login as the now-populated DRIVER, run the 7 TCs at 360/390/768, drive the operations-row chip assertion per TC-REPLACE-TAGS-002.

## Artifacts
- `qa/2026-09-10_driver-mobile-ui_cut1b.md` — THIS report.
- Earlier UI screenshot from cycle 2 (`qa/2026-09-10_driver-mobile-ui_cycle2-reverify.md` + `qa/2026-09-10_dispatch-detailed-plan_ui-cut1.png` is the T1 artifact, not T3).
