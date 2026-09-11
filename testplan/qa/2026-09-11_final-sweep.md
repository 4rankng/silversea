# Final QA sweep plan — board-clear gate (2026-09-11)

**Run:** Team A cycle 1 · **Drafted by:** architect (reassigned from unresponsive QA per PM 12:30, authoritative per PM 12:31) · **Supersedes:** any competing sweep draft (merge, don't fork)
**Trigger:** ALL kanban tickets done → `make demo` staging cut → this plan executes ON STAGING. **No authenticated prod access, ever.**
**Deadline frame:** sweep must fit before the 17:50 SGT user report; internal target = board clear by 16:45.

## Phase 0 — post-deploy staging smoke (BLOCKING; no per-ticket check runs before this is green)

| # | Check | Pass | Evidence |
|---|---|---|---|
| 0.1 | Deploy pre-reqs | board ALL done; clean prod tree; `make demo` exits 0 | `2026-09-11_final-sweep_deploy.log` |
| 0.2 | Health | `GET https://vantai.tingting.vip/api/health` → 200 (unauthenticated) | same log |
| 0.3 | G-mig | staging `__drizzle_migrations` carries 0067 prefix `2d8af75377` **AND** the new MC-4 migration sha256 prefix (FS records the prefix at authoring in NOTES — sweep must read it from there, never guess). Missing either = **HARD STOP** via PM; never hand-patch | `2026-09-11_final-sweep_g-mig.log` |
| 0.4 | Bundle fingerprint | capture the served bundle chunk hash BEFORE testing (staging `:latest` tag-race trap — a one-time flip proves nothing; hard-reload after capture) | `2026-09-11_final-sweep_bundle.txt` |
| 0.5 | Login | staging account from `testplan/testaccounts.txt` authenticates; token lands in `localStorage['token']` | screenshot 01 |
| 0.6 | Fixtures (AR risk baked in) | select/seed trips so ALL of: (a) one trip's container factory site has `contact_phone` populated AND one NULL — TC-DA-003 needs both halves; (b) one trip with ≥6 operation tags — TC-DA-001; (c) one trip with invoice master data + one without — TC-DA-005; (d) one POD-capable trip — TC-DA-007. NO new driver accounts; existing seeded drivers only | `2026-09-11_final-sweep_fixtures.sql` |

## Phase 1 — d80f76ae maker-checker removal (MC-1..MC-4, FS-executed per AR Amendment-5 + cycle-1 rulings)

- **MC-1:** all five `POST /governance-actions/:id/{check,approve,reject,return-for-evidence,cancel}` → 404. GovernanceActionsPage route gone; nav + global search carry no entry. Formerly-pending flows (trip-expense decisions, AR adjustment, advance-settlement reversal, recoverable-cost, credit-overrides create **with tier gate removed**) → 200 + row applied in-request (terminal status). Double-apply → 409. Self-approve 403 ban gone.
- **RBAC spot-audit (mandatory):** 3 sampled direct-write endpoints probed with a wrong-role token → 403 each. Removing approval steps must never remove authorization.
- **MC-2:** salary period close/reopen/adjustments apply directly; zero PENDING/approve vocabulary renders anywhere in the salary FE.
- **MC-3:** work-inbox accountant expense blocker gone; advance settlement applies directly; no pending `CHECKED_BY_ACCOUNTANT` states.
- **MC-4:** staging `to_regclass('drizzle.governance_actions')` IS NULL (dropped); soft-ref `governance_action_id` columns dropped iff Condition-A pre-check was 0 (verify + record counts); `governance_actions` absent from FE API client + BE schema exports.
- Evidence: `2026-09-11_final-sweep_mc{1..4}_*.{log,png}`.

## Phase 2 — 36d0183d driver-app enhancements (spec @ `09dc2595`, incl. AR amendments + BE probe corrections)

TC-DA-001 chips on `/my-trips/:id` from `knownTagLabels[]` embed — label parity with board cards (same parseNote path); collapse ≤4 default when N≥6, Mở rộng/Thu gọn toggle. TC-DA-002 Tuyến row = `operational_sites.address` (not factory name), parity with master-plan route cell. TC-DA-003 Kho phone = `contact_phone` render when present, absent when NULL (Phase-0 fixtures). TC-DA-004 no `Đầu kéo|Mooc` text on mobile surface; API fields untouched (BE probe log). TC-DA-005 invoice block MST → Tên công ty → Địa chỉ, hidden without master data. TC-DA-006 exactly one Đóng/Trả chip (EXPORT→Đóng, IMPORT→Trả). TC-DA-007 POD Option A: `/pod` screen thumbnails + upload + tap→full-detail modal.
All rung-3: post-click screenshot + DOM assert + DB parity, cache-cold protocol, evidence filenames per the spec.

## Phase 3 — 18f4a2dd verify-and-close (no reimplementation)

CUS container supplemental edit saves directly on staging; DOM contains no approval vocabulary (`/duyệt|xét duyệt|gửi yêu cầu|chờ phê/` absent on the CUS drawer). Pass → close ticket.

## Phase 4 — 75be58a3 Task Management UI

Per PM spec: factory short-name first + route below; container+ports column; tag chips; **no Tác vụ column**. Screenshot per check at 1366 + 390.

## Triage & verdict

- Critical finding → immediate fix, PM assigns owner; minor → new backlog ticket, does NOT block the 17:50 report.
- Verdict line: `2026-09-11_final-sweep_gate.txt` — PASS only if Phases 0–4 all pass (or triaged critical fixes re-verified).
- Whole team executes under this plan; QA (if it surfaces) runs it and merges nothing that contradicts Phase 0's blocking order.
