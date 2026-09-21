# Current Development Handoff

## Active delivery — QA of the two Kanban TODO specs (Ops screens + freight auto-pricing), 20 September 2026

Controller: agent session, 2026-09-20 ~22:30 (+08). Branch `prod`, HEAD `b1d23b63`.
Working tree carries **only** this QA's new files (untracked): `testplan/2026-09-20-ops-pricing-docx-qa.md`,
`qa/2026-09-20_ops-pricing-docx-qa/` (+ `qa/scripts/local-ops-pricing-docx-20260920.mjs`,
`qa/scripts/local-pin-aria-20260920.mjs`), `scripts/kanban-cards-20260920-ops-pricing.py`.
**No application code was changed** — this was a verification + ticketing pass.

**Scope:** QA `2026.9.6_Man_hinh_ops.docx` and `Phương án tính cước tự động.docx` (Kanban-PROD/TODO)
against local dev (`http://localhost:7175`, API `:3002` — this checkout's Makefile ports, NOT the
`:7174/:3001` in AGENTS.md), accounts from `testplan/testaccounts.txt` (password `Abc123`).

**Business flow exercised end-to-end (UI DRIVEN):** CUS creates FCL lot (`shipment 298`
`SHP-2609-00020`, Bill `QATEST-IMP-20260920`, LONG MINH, NEWEB, cont `QATU1234569` 20'DC) →
dispatcher allocates carrier, assigns vehicle, issues order (`trip 195` `TRP-202609-0001`, truck
`15E-016.26`, driver `Phạm Văn Hùng`) → driver accepts (`ORDER_RECEIVED`) → OPS sees the live trip on
`/ops/fleet-tracking` and declares an incidental expense (250.000đ "Ship Lạch Huyện") → accountant
debit workspace.

**QA fixture mutations made on the local DB (no cleanup needed per user):** added trailer
`RM-15E-016.26` (20FT) + attached to `trucks id=6`; closed stale seed trips on truck 6;
`user_shipment_links` for user 7 → lots 37/96/256/298; `truck_ops_assignments` truck 6 → user 7;
created OPS user `qaops2` (id 54); created `fuel_price_periods id=5` (28.000 @ 2026-09-19);
override `debit_note_overrides id=1` on snapshot 5.

**Defects found (all ticketed in Kanban-PROD/TODO as `20260920_52…58`):**
- 52 / TC-OPS-BUG-01 — OPS expense save 403: `user_shipment_links` has no runtime writer from
  dispatch/truck assignment; the button is offered on every row. (UI DRIVEN)
- 53 / TC-CUOC-BUG-01 — FCL lots never lock freight: `shipments.route_id` stays null for FCL
  (route lives on the container) and `lockShipmentFreightRate` bails on null route. (DB/API VERIFIED)
- 54 / TC-CUOC-BUG-02 — L1 "CƯỚC VẬN TẢI (AUTO)" sums **all** snapshots → 3 × 4.791.480 =
  14.374.440 vs correct 4.791.480 in L2. (UI DRIVEN)
- 55 / TC-CUOC-BUG-03 — Bảng 2.3 payables hard-code "Chưa xác định"; OPS expenses never reach the
  debit workspace although the API returns `hqgsFee: 250000`. (UI DRIVEN)
- 56 / TC-CUOC-BUG-04 — receivable adds OPS expense amounts regardless of `customer_charge_amount = 0`.
- 57 / TC-CUOC-BUG-05 — `fuel_price_periods.created_by` null (no audit attribution).
- 58 / TC-OPS-BUG-02 — pin button `aria-label = "Ghim "` when the lot has no shipment code.

**Verified PASS (docx requirements):** OPS list/date/search, personal pin + F5 persistence + isolation,
expense auto-fill and save, wallet cards/history/smart tag, advance `RECORDED` without cash,
settlement 2 baskets + XLSX export (7.166 bytes), fleet read-only live status, freight formula
(3.978.000 + 813.480 = 4.791.480; km×2, liters 83.2), threshold ratchet (%5 → keeps old period),
XOR threshold 400, fuel period 201/409/403, override reason 400 + OPS 403 + accountant 200 with
contract freight preserved, non-retroactivity of frozen snapshots, both config UIs.

**QA gates:** no project files touched → typecheck/test suites not affected. `pnpm lint` (root) is
**red on HEAD independently of this pass**: 1 pre-existing error
`backend/src/tests/debit-detail-business-keys.test.ts:21` `prefer-const` (`let actorId` → `const`),
from commit `5f40ab7c`; 21 pre-existing warnings. Log: `qa/2026-09-20_ops-pricing-docx-qa/lint.log`.
Left untouched (unrelated file, user's call).

**Not covered:** mobile 390/820 viewports, roles beyond the six used, staging, receipt-photo upload
and accountant reconciliation board, Excel parity 48/48 (source workbook absent).

**Next step:** lead triages cards 52–58; #54/#56 are money-correctness and should be first, and any
fix must re-run the case IDs in `testplan/2026-09-20-ops-pricing-docx-qa.md` §2. `.ua` graph refresh
still owned by the post-commit hook (graph was already stale at session start).

## Lead reconciliation note (2026-09-21 morning)

Ticket ids renumbered to keep board ids stable: this pass's `20260920_52` (OPS
403) was merged into the in-flight `20260920_54-ops-expense-save-gate-unreachable`
(owner ruling recorded: auto-link via trucks); `20260920_53`→`_60`,
`20260920_54`→`_61`, `20260920_55`→`_62` (id collisions with closed/in-flight
cards). `20260920_56`–`_59` keep their ids. Evidence paths (qa/, gitignored) and
case ids (TC-OPS-BUG-01, TC-CUOC-BUG-01..05) unchanged.
