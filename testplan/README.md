# testplan/ — QA case library & verification plans

Purpose-built test assets for SilverSea. Text-only, git-tracked, small.
Reorganized 2026-09-26 (Chief order): bloated local evidence purged; retention policy added.

## Layout

| Path | Purpose |
|---|---|
| `testaccounts.txt` | CANONICAL test accounts for every environment. Byte-content sacred — never duplicate account data elsewhere; update this file only. |
| `qa/cases/` | Regression case library (dated waves + `case-QA-*` family). Every bugfix lands a case here first, per the repo AGENTS.md contract. |
| `qa/evidence/` | CURRENT-WAVE ONLY. Transit artifacts (screenshots, logs) backing open rungs. See retention policy. |
| `qa/artifacts/` | QA run command logs (exact command + exit + output). |
| `qa/scripts/`, `qa/lib/`, `package.json` | QA runner tooling. |
| `cases/` ← via `qa/cases/` | See above. |
| `flows/`, `roles/`, `matrix/`, `deploy/`, `fixtures/` | Test flows, role maps, coverage matrix, deploy test notes, fixtures. |
| `*.md` (dated) | Historical per-wave test/verification plans (09-10 → present). Append-only record; do not delete. |
| `qa/README.md`, `qa/_TEMPLATE.md` | QA runner docs + case template. |

## Evidence retention policy (law)

- **Evidence dirs are current-wave transit, not archive.** The durable QA record is the
  card docx on the Drive board, with screenshots embedded per the evidence law (09-15).
- At wave close, prior-wave `qa/evidence/2026-*` dirs are purged. On 2026-09-26 this
  purged 372 pre-09-26 dirs (~310MB). Folder target size: low tens of MB.
- If a claim ever needs its raw shots again, the card docx on the Drive board holds them.

## Adding a regression case

1. Copy `qa/_TEMPLATE.md`.
2. Name: `case-QA-<date>-<seq>-<slug>.md` (repro steps + expected + case ID).
3. Land it BEFORE or WITH the fix (AGENTS.md: update testplan first, re-test before done).
