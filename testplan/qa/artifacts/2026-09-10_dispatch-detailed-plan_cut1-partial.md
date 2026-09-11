# QA cut 1 — Partial findings (DISPATCHER scope)

**Ticket:** 8afc13a9 (Dispatch detailed-plan: all containers + reassign) + 365943ea (driver mobile UI)
**Staging commit under test:** 8a7e6fc3
**Cut 1 scope per PM:** DISPATCHER-account cases only
  - T1 TC-DDP-001..006
  - T4 TC-REPLACE-TAGS-001 (dispatch picker)
**HELD until cut 1b (13b68a2b):** T3 TC-DRV-MOBILE-001..007, T4 TC-REPLACE-TAGS-002 (driver mobile part)
**Status:** PARTIAL — rung 3 (UI DRIVEN) completed for the surface I could reach; rung 2 (DB/API) NOT completed because no staging DB connection is registered with this QA agent (db_list returns empty).

## Auth + setup
- Logged in to `https://vantai.tingting.vip` as `dungnv` / `Abc123` (staging DISPATCHER per `testplan/testaccounts.txt`).
- Login form: `input#username-input` + `input#password-input` + `button.login-submit`. SPA-redirect after submit landed on `/dispatch`.
- Subsequent SPA navigation to `/dispatch-detail` worked.
- Browser session was lost once when I did a hard `browser_navigate` to `/dispatch` after the dispatch-detail inspection; re-logged in cleanly.

## T1 TC-DDP-001 — Display parity
- **Rung 3 (UI):** at `/dispatch-detail` on staging, the `.detailed-plan-grid__row` count was **11**. 10 of those carry the `detailed-plan-grid__row--plated` modifier; 1 is unplated (the row with `dispatch-assignment-cell__carrier="HÀ AN"` and `dispatch-assignment-cell__plate="CUS sẽ bổ sung"`).
- **Rung 2 (DB):** NOT RUN — `db_list` returned 0 connections. Cannot compute N = total containers for the selected day to confirm display parity. Filed as known gap.
- **Verdict:** INCONCLUSIVE on display parity; rung-3 evidence captured (`qa/2026-09-10_dispatch-detailed-plan_ui-cut1.png`).

## T1 TC-DDP-002 — Unassigned containers visible
- **Observed:** no row in the current view carries `carrier_id IS NULL`. All 11 carriers are populated (`SilverSea, HÀ AN, STG VERIFY NHA XE 09, VÂN LAN ×3, ĐĂNG QUÂN, BIỂN XANH ×2, DUYÊN HẢI ×2`). 0 matches for `Chưa phân` text in the page body.
- **Possible explanations:** (a) the visible date range (07/09 → 11/09/2026) has no unassigned containers in the seed; (b) the fix only renders rows that have a carrier even if `carrier_id IS NULL`. Cannot distinguish without changing the date filter to a known-unassigned day or running a DB query.
- **Verdict:** NEEDS RE-RUN with a date that the seed has unassigned containers for, OR with a DB query to confirm. Cannot PASS based on a single default-view observation.

## T1 TC-DDP-003 / TC-DDP-004 — Assign / Reassign carrier
- **Observed:** every row carries a `.dispatch-assignment-cell__carrier` element with a clickable `.dispatch-assignment-cell__trigger`. The picker control is present and reachable in DOM.
- **Rung 3 (UI):** not exercised in this cut — would need a known-unassigned target row to assert the assign flow, AND the DB side to confirm `shipment_carrier_history` audit rows.
- **Verdict:** PENDING — cannot fully verify without DB-backed target.

## T1 TC-DDP-005 — Role gating
- **Rung 3 (UI as CUS):** not exercised in this cut. CUS would need a separate login + page navigation; doing this in the same eval risks the react-query refocus closing the DISPATCHER dialogs (per PM's standing rule). Defer to a follow-up eval after DISPATCHER scope is closed.
- **Verdict:** PENDING — needs CUS eval.

## T1 TC-DDP-006 — Master-plan no regression
- **Rung 3 (UI):** session was lost during the master-plan navigate-then-login cycle, so I do not have a master-plan row-count number to compare. No leak of `dispatch-detail-*` testIds in any visible DOM during this cut. Cannot PASS based on absence of evidence.
- **Verdict:** NEEDS RE-RUN in next eval.

## T1 TC-DDP-007 — Other dispatcher flows
- **Rung 3 (UI):** no console errors observed during the dispatch-detail navigation (`browser_get_logs` not pulled this cut).
- **Verdict:** NEEDS explicit log capture + 14-tag list verification in next eval.

## T4 TC-REPLACE-TAGS-001 — Dispatch picker order
- **Rung 3 (UI):** NOT EXERCISED. The dispatch assignment dialog is reached by clicking `.dispatch-assignment-cell__trigger` on a row. To exercise this without losing the master-plan count, the click must happen in a separate eval after T1 is closed.
- **Verdict:** PENDING — needs separate eval; risk: react-query refocus will close the picker if I navigate away.

## What I COULD verify cleanly
- Staging URL `https://vantai.tingting.vip` is reachable and serves the SPA.
- `dungnv` / `Abc123` is a valid DISPATCHER credential at this commit.
- `/dispatch-detail` route renders the `Kế hoạch Chi tiết Xe` page with a working grid (`.detailed-plan-grid__row` count + carrier cells).
- The `.detailed-plan-grid__container-block` + `.detailed-plan-grid__row--plated` classes are present (matches the CSS contract).

## Gaps that need a separate eval + DB access
1. TC-DDP-001 full parity (UI count vs DB count) — needs DB read access.
2. TC-DDP-002 unassigned-state copy on a known-unassigned day — needs date picker or seed audit.
3. TC-DDP-003/004 assign/reassign actions + audit history — needs DB write/read.
4. TC-DDP-005 role gating (CUS view) — needs second login + DB call.
5. TC-DDP-006 master-plan row count comparison — needs clean master-plan nav.
6. TC-DDP-007 console log capture + tag picker — needs a focused eval.
7. TC-REPLACE-TAGS-001 dispatch picker click — needs the assignment dialog to open without refocus loss.

## Recommendations
- **PM**: add a staging DB connection to this agent (or a read-only role account) so rung-2 evidence can be produced in-cycle.
- **PM**: stage a known-unassigned day (or annotate the seed) so TC-DDP-002 has a non-default trigger.
- **Cut 1 verdict**: cannot set `qaPassed: true` for T1 yet. Mark this cycle's evidence as PARTIAL and continue in a second eval that drives the actions end-to-end with DB read-back.

## Artifacts saved this cycle
- `qa/2026-09-10_dispatch-detailed-plan_ui-cut1.png` — staging `/dispatch-detail` after login as `dungnv`, showing the 11-row grid with all carriers assigned.
- `qa/2026-09-10_dispatch-detailed-plan_cut1-partial.md` — this report.

## Honest rung label
This cycle's T1 work is **rung 3** for the page-load evidence I captured, but **rung 1 (CODE-READ ONLY)** for the parity/assign/role-gate checks because I could not exercise the mutations and could not query the DB. Treat every PASS claim as conditional until a second eval with DB access + click-through.
