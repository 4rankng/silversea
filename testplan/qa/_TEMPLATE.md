# Regression spec — `<TICKET_ID>` <SHORT_TITLE>

**Ticket:** <TICKET_ID> (<ONE-LINE-FEATURE-DESCRIPTION>)
**Owner (implement):** <backend|fullstack|frontend>
**Owner (verify):** qa
**Status (this doc):** PREP — ready to execute when <implementer> lands + staging cut
**Cycle:** <PM cycle label, e.g. PM cycle 1, Team B>

## Goal

<2-4 sentences: WHAT changes, IN WHAT surface, WITH WHAT scope guardrail. Copy the wording style from existing 2026-09-10_* regression specs.>

## Out of scope

<Bullet list of explicit non-goals. Cross-reference other tickets by id when relevant.>

## Acceptance criteria

> All UI verifications are rung 3 (`UI DRIVEN`); API verifications are rung 2 (`DB/API VERIFIED`) but the UI side of each is rung 3. (Delete this preamble if the ticket has no UI surface.)

### TC-<PREFIX>-NNN — <Short criterion name>

- **Given** <precondition — exact role + env + state>
- **When** <exact click / API call>
- **Then** <observable outcome, rung 3 if UI>
- **Assert:** <`browser_evaluate` / `curl` / DB query>
- **Evidence:** <artifact paths under `qa/`>

<!-- Repeat the TC block above for every criterion. Keep acceptance TCs short;
     long scenarios belong in `testplan/flows/<NN>-<flow>.md`. -->

<!-- ============================================================== -->
<!-- Everything below this banner is shared across all regression    -->
<!-- specs. DO NOT duplicate it in the new spec; the QA harness and  -->
<!-- the next agent reading this file already know it.               -->
<!-- ============================================================== -->

## Environment & accounts (canonical — see `testplan/testaccounts.txt`)

| Slot | Value |
|---|---|
| Local UI | `http://localhost:7175` |
| Local API | `http://localhost:3002/api` |
| Staging UI | `https://vantai.tingting.vip` |
| Staging API | `https://vantai.tingting.vip/api` |
| **No prod access** | deploy + bare health only, per `AGENTS.md` |
| Browser | AgentsRoom embedded browser (`browser_set_viewport` for mobile widths) |
| API tool | `curl` / `node fetch` (asserts only); qa harness `ctx.apiGet` for evidence |
| DB | psql only for audit/seed inspections; no raw SQL in test scripts |
| Password | `Abc123` (all roles, all envs) |
| Role → username | `testplan/testaccounts.txt` — read at runtime by `lib/env.mjs` |

Surface-specific role mapping lives in the **Goal** or per-TC **Given** block;
no separate accounts table per spec.

## Verification protocol

1. **Auth flow** — `ctx.login('<ROLE>')` (or driver `puppeteer-spa-auth`).
2. **API probes** — `curl` with bearer token; capture full request + response to `qa/<DATE>_<SCOPE>_api-XXX.log`.
3. **UI probes** — `browser_evaluate` for DOM assertions, `browser_screenshot` per surface.
4. **DB probes** — through `/api/...` endpoints preferred; psql only for audit-history / seed inspections (drizzle ORM only rule applies to *application behaviour*, not qa inspections).
5. **No raw SQL in test scripts** — qa inspection lines live in `.sql` artifacts for reproducibility, never inside test cases themselves.

## Evidence bundle

```
qa/
├── <DATE>_<SCOPE>_ui-NNN-<step>.png        # one per UI TC
├── <DATE>_<SCOPE>_ui-NNNb-<step>.png      # additional variants
├── <DATE>_<SCOPE>_ui-driver.log           # driver script + DOM asserts
├── <DATE>_<SCOPE>_api-NNN.log             # one per API TC
├── <DATE>_<SCOPE>_db-NNN.sql              # one per DB TC
├── <DATE>_<SCOPE>_gates.log               # full QA gate run output
└── <DATE>_<SCOPE>_gate.txt                # pass/fail verdict
```

## Pass criteria

PASS iff **every** TC above holds on **staging first** (local-only run is a smoke test). Any TC FAIL on staging is a cycle FAIL with `fix-and-re-run` block appended to the failing artifact; PM relays to <implementer role> before the next ticket.

## QA gates required (run before push)

```
pnpm lint                                          # 0 errors
cd backend && npx tsc --noEmit                     # 0 errors
cd backend && pnpm test                            # all pass
cd frontend && npx tsc -b                          # 0 errors
cd frontend && pnpm test                           # all pass
make build                                          # succeeds
```

Add `cd e2e && ./run_all.sh` for tickets that touch shared contracts, Drizzle
schemas, financial calculations (`shared/src/calculations/`), or RBAC.

Per-chunk commit + push (after every task rule from `testing-and-deploy-environments`).

- **Evidence:** `qa/<DATE>_<SCOPE>_gates.log`

## Anti-lying guardrails

- "Backend says it works" with no API call = rung 1.
- Hitting `POST /api/...` and seeing `200` = rung 2 only; verify the **status field** is the expected applied state and the **ledger/DB row** is present (rung 3 = UI + DB side-effect proof).
- "No dead UI remains" without a `browser_evaluate` chip/badge regex = rung 1.
- Coverage must be **exhaustive** across the in-scope surface — partial coverage = BLOCKED, not PASS.
- Audit history checks are non-negotiable: if a migration rewrote historical rows, the ticket fails even if the new flows work.

## What is NOT covered (be honest)

<List at minimum: other roles, mobile viewport (unless ticket is mobile), staging vs local, error/rollback path. The block is never empty.>

## Linked artifacts

- Ticket: `<TICKET_ID>` (kanban, <status>)
- Companion specs in this cycle: <paths>
- Memory: <[[memory-note-name]]> — <one-line description of relevant note>
