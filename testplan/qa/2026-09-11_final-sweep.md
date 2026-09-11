# Final QA sweep plan — board-clear gate (2026-09-11)

**Run:** Team A cycle 1 · **Drafted by:** architect (reassigned from unresponsive QA per PM 12:30, authoritative per PM 12:31) · **Supersedes:** any competing sweep draft (merge, don't fork)
**Trigger:** ALL kanban tickets done → `make demo` staging cut → this plan executes ON STAGING. **No authenticated prod access, ever.**
**Deadline frame:** sweep must fit before the 17:50 SGT user report; internal target = board clear by 16:45.

## Phase 0 — post-deploy staging smoke (BLOCKING; no per-ticket check runs before this is green)

| # | Check | Pass | Evidence |
|---|---|---|---|
| 0.1 | Deploy pre-reqs | board ALL done; clean prod tree; `make demo` exits 0 | `2026-09-11_final-sweep_deploy.log` |
| 0.2 | Health | `GET https://vantai.tingting.vip/api/health` → 200 (unauthenticated) | same log |
| 0.3 | G-mig | per BE's staging-cut runbook (NOTES 13:45): via ssh psql, `__drizzle_migrations` carries 0067 prefix `2d8af75377` **AND** the MC-4 mini-cut's THREE migration sha256 prefixes: 0068_drop_governance_actions **`069b698197`**, 0069_shipment_finance_actions **`39a876192`** (amended: added shipment_id single-column index for dominant query path), 0070_salary_period_exclusions **`a8206d33b4`** (stamped 17:25 +07 from the user-session's working copies, recompute at cut if amended). **Key on the hash, not the row id** — staging ids run ahead of file numbers. **2026-09-11 merge-redo renumber:** the six MC-4 migrations shifted +1 on disk after the prod-merge redo (retire→0066, seed→0067, close_legacy→0068, drop_gov→0069, finance→0070, salary→0071); SQL content untouched, so every sha256 prefix above is unchanged and remains the verification anchor. |
| 0.4 | Bundle fingerprint | served entry-JS content hash must DIFFER from pre-cut, verified **twice ≥30s apart, cache-cold** (tag-race trap — a one-time flip proves nothing) | `2026-09-11_final-sweep_bundle.txt` |
| 0.5 | Login | staging account from `testplan/testaccounts.txt` authenticates; token lands in `localStorage['token']`. Caveat: if a prod→staging DB mirror happened since the last cut, re-run the bcrypt reset first (Abc123 rule) | screenshot 01 |
| 0.6 | Fixtures (AR risk baked in) | select/seed trips so ALL of: (a) one trip's container factory site has `contact_phone` populated AND one NULL — TC-DA-003 needs both halves; (b) one trip with ≥6 operation tags — TC-DA-001; (c) one trip with invoice master data + one without — TC-DA-005; (d) one POD-capable trip — TC-DA-007. NO new driver accounts; existing seeded drivers only | `2026-09-11_final-sweep_fixtures.sql` |

## Phase 1 — d80f76ae maker-checker removal (MC-1..MC-4, FS-executed per AR Amendment-5 + cycle-1 rulings)

- **MC-1:** all five `POST /governance-actions/:id/{check,approve,reject,return-for-evidence,cancel}` → 404. GovernanceActionsPage route gone; nav + global search carry no entry. Formerly-pending flows (trip-expense decisions, AR adjustment, advance-settlement reversal, recoverable-cost, credit-overrides create **with tier gate removed**) → 200 + row applied in-request (terminal status). Double-apply → 409. Self-approve 403 ban gone.
- **RBAC spot-audit (mandatory):** 3 sampled direct-write endpoints probed with a wrong-role token → 403 each. Removing approval steps must never remove authorization.
- **MC-2:** salary period close/reopen/adjustments apply directly; zero PENDING/approve vocabulary renders anywhere in the salary FE.
- **MC-3:** work-inbox accountant expense blocker gone; advance settlement applies directly; no pending `CHECKED_BY_ACCOUNTANT` states.
- **MC-4:** staging `to_regclass('drizzle.governance_actions')` IS NULL (dropped); soft-ref `governance_action_id` columns dropped iff Condition-A pre-check was 0 (verify + record counts); `governance_actions` absent from FE API client + BE schema exports.
- **MC-2/3 defer stamp (AR, 13:52):** PM/FS evidence VERIFIED — salary routes chain make→check→approve in-request via `autoApplySalaryGovernance` (salary.ts:149); remaining PENDING writes are transient in-transaction states. Defer of cosmetic type-union narrowing APPROVED. **Condition:** one DB assertion in this phase — after exercising the direct-apply flows, `SELECT count(*) FROM <affected tables> WHERE approval_status LIKE 'PENDING%'` = 0 (catches any lane not actually chained; work-inbox legacy-row reads exempt).
- Evidence: `2026-09-11_final-sweep_mc{1..4}_*.{log,png}`.

## Phase 2 — 36d0183d driver-app enhancements (spec @ `09dc2595`, incl. AR amendments + BE probe corrections)

TC-DA-001 chips on `/my-trips/:id` from `knownTagLabels[]` embed — label parity with board cards (same parseNote path); collapse ≤4 default when N≥6, Mở rộng/Thu gọn toggle. TC-DA-002 Tuyến row = `operational_sites.address` (not factory name), parity with master-plan route cell. TC-DA-003 Kho phone = `contact_phone` render when present, absent when NULL (Phase-0 fixtures). TC-DA-004 no `Đầu kéo|Mooc` text on mobile surface; API fields untouched (BE probe log). TC-DA-005 invoice block MST → Tên công ty → Địa chỉ, hidden without master data. TC-DA-006 exactly one Đóng/Trả chip (EXPORT→Đóng, IMPORT→Trả). TC-DA-007 POD Option A: `/pod` screen thumbnails + upload + tap→full-detail modal.
All rung-3: post-click screenshot + DOM assert + DB parity, cache-cold protocol, evidence filenames per the spec.

## Phase 3 — 18f4a2dd verify-and-close (no reimplementation)

CUS container supplemental edit saves directly on staging; DOM contains no approval vocabulary (`/duyệt|xét duyệt|gửi yêu cầu|chờ phê/` absent on the CUS drawer). Pass → close ticket.

## Phase 4 — 75be58a3 Task Management UI

Per PM spec: factory short-name first + route below; container+ports column; tag chips; **no Tác vụ column**. Screenshot per check at 1366 + 390.

## Phase 5 — earlier-wave spot checks (PM skeleton, merged)

- Catalog search matches taxCode / phone / contactPerson on customers + suppliers (d4ea9d9b regression).
- Master-plan card pairing intact at 901–1512px (responsive wave gate).
- One catalog page responsive spot check at 768.

## Triage & verdict

- Critical finding → immediate fix, PM assigns owner; minor → new backlog ticket, does NOT block the 17:50 report.
- Verdict line: `2026-09-11_final-sweep_gate.txt` — PASS only if Phases 0–4 all pass (or triaged critical fixes re-verified).
- Whole team executes under this plan; QA (if it surfaces) runs it and merges nothing that contradicts Phase 0's blocking order.
