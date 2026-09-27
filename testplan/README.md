# testplan/ — QA case library & verification plans

Purpose-built test assets for SilverSea. Text-only, git-tracked, small.
Reorganized 2026-09-26 (Chief order): bloated local evidence purged; retention policy added.
Reorganized again 2026-09-27 (operator: "reorganize testplan/ to be more efficient, avoid bloated
shit"): every **dated** record now lives under `cycles/<YYYY-MM>/`; the two roots that used to
carry ~100 loose `2026-*` files (`testplan/` and `testplan/qa/`) are clean.

## Layout

| Path | Purpose |
|---|---|
| `testaccounts.txt` | CANONICAL test accounts for every environment. Byte-content sacred — never duplicate account data elsewhere; update this file only. |
| `cycles/<YYYY-MM>/` | **Every dated record** — per-ticket regression specs, wave plans, audit/remediation notes, run reports. Append-only; do not delete. One folder per cycle month, flat inside it. |
| `roles/` | 7 per-role walkthroughs (cus, dieuvan, laixe, ketoan, quanly-admin, vanhanh, khachhang). |
| `flows/` | 12 end-to-end flow specs (incl. `10-e2e-regression`, `12-cuocphi-phuphi-dau`). |
| `deploy/` | Deploy-window test notes + prod post-verify/realign scripts. |
| `fixtures/` | Data fixtures referenced by code (`frontend/scripts/generate-quotation-import-fixture.mjs`, `QuotationConfigPage.import.test.tsx`). Path is load-bearing — do not move without updating the readers. |
| `qa/` | The runner: `lib/` (harness), `scripts/` (CLI entry points), `cases/` (regression case library), `_TEMPLATE.md`, `README.md`. |
| `qa/evidence/` | CURRENT-WAVE ONLY, gitignored. Transit artifacts (screenshots, logs) backing open rungs. See retention policy. |
| `qa/artifacts/` | QA findings reports from closed cycles (text-only, git-tracked). Frozen: paths inside them are historical and are NOT rewritten when a spec moves. |

## Evidence retention policy (law)

- **Evidence dirs are current-wave transit, not archive.** The durable QA record is the
  card docx on the Drive board, with screenshots embedded per the evidence law (09-15).
- At wave close, prior-wave `qa/evidence/2026-*` dirs are purged. On 2026-09-26 this
  purged 372 pre-09-26 dirs (~310MB). Folder target size: low tens of MB.
- If a claim ever needs its raw shots again, the card docx on the Drive board holds them.

## Adding a regression case

1. Copy `qa/_TEMPLATE.md`.
2. Name it `cycles/<YYYY-MM>/<YYYY-MM-DD>_<ticket-slug>.md` (repro steps + expected + case ID).
   Runnable cases that the harness can execute go in `qa/cases/<topic>/` instead, and the
   driver script that produces their evidence goes in `qa/scripts/`.
3. Land it BEFORE or WITH the fix (AGENTS.md: update testplan first, re-test before done).
