# HANDOFF.md — agent-contract rewrite + tree sweep (+ preserved journal warning)

**Updated:** 2026-09-29 00:20 (+08)
**Controller:** Claude Code session (user-directed: contract rewrite → OpenWiki/.ua/ClaudeKit retirement → "commit all code in logical chunks")
**Status:** LANDED — 8 commits on `prod` (b63b39ae..a4413cbf + handoff). One follow-up open: isolated re-adjudication of 16 backend suites that ran red under DB contention.

## Goal

`AGENTS.md` is the single canonical agent contract every runtime follows; `CLAUDE.md` is a thin `@AGENTS.md` import; OpenWiki, the `.ua` knowledge base, and project ClaudeKit are retired; the whole working tree is swept into logical commits.

## Commit ledger (this wave)

- `b63b39ae` docs(agents): contract rewrite + OpenWiki/.ua retirement (machine blocks md5-verified)
- `02f137d5` docs(adr): PM rulings for the parked chi-phi cards
- `4cd7b694` chore(gate): pre-commit typechecks backend test files too (card 201)
- `13bcf5c6` chore(frontend): tokenizer closure loop-variable binding (B023)
- `9e5d0933` chore(kanban): measured AC verdicts on the 09-28 shipments cards
- `e1060f0a` fix(frontend): phone filter rows share one line; status tabs justify
- `a4413cbf` feat(accounting): signed expense amounts; totals drop negative rows (cards 197/181/147) + carrierType fixture fix
- handoff commit (this file)

## QA

- Root lint 0 errors (38 pre-existing warnings) · frontend typecheck 0 · ShipmentsTabs styles test 4/4 · backend test-inclusive typecheck 0 (after fixing `carrierType` in the new card197 fixture — column removed in the schema lean-down) · design drift FELL (rawZIndex 81→80).
- Artifacts: `qa/2026-09-28_agents-contract-rewrite_lint.log`, `qa/2026-09-28_full-sweep_backend-typecheck-test.log`.
- **Open item:** the full backend suite finished `exit 1` on 16 files while a second session's suite ran concurrently on the shared dev DB (connection-pool death mid-run: ECONNREFUSED, "Connection is closed"; 20s timeout patterns). The flagged files need one isolated re-run once the DB is quiet; a real regression there gets a follow-up fix commit. Typecheck (both bars) is green; the commit carries the caveat in its body.

## Decisions (user-directed)

- Numbered contract sections §1–§11; standing directives promoted into §2 Non-negotiables (append-only history, prod untouchable, tickets-before-fixes, sweep-the-class, internal-IDs-never-user-facing).
- CONTEXT.md authority order → pointer to AGENTS.md §1; handoff field list lives in CONTEXT.md (ROADMAP.md / HANDOFF.example.md references removed everywhere — both files were deleted at eef1e9b5).
- `.claude/` moved to `~/.claude-removals/silversea-prod-20260928/`; only `skills/kanban-work` stays in the repo.

## Concurrent work

Another session is actively running backend suites on this checkout (card 164 verification, full node --test sweep from 00:11). Its runs are untouched; the 16-file adjudication waits for its window.

## ⚠️ Preserved from 09-27 handoff: journal-restamp warning

Do not commit a restamped/renumbered `backend/drizzle/meta/_journal.json` — especially not via `--no-verify`. Risk: 42710 duplicate-object class on the next staging + prod migrate. A real migration only APPENDS; if the append-only guard refuses → `git checkout -- backend/drizzle/meta/_journal.json` and regenerate properly.

## Next

- Isolated re-run of the 16 flagged backend files (see qa log for the list); follow-up fix commit if any fail solo.
- `.codex/context-manifest.json` still references deleted `ROADMAP.md` + `HANDOFF.example.md` → `pnpm context:check` exits 1 (pre-existing; manifest untouched — shared machine config).
- The Understand-Anything Stop hook in `.zcode/config.json` references the removed `.ua/`; remove `.zcode/` when retiring that runtime.
- `.claude/` removal takes effect next session (project hooks/skills gone except kanban-work; MCP servers unaffected via root `.mcp.json`).
- The moved ClaudeKit copy sits at `~/.claude-removals/silversea-prod-20260928/` — delete whenever; nothing references it.
