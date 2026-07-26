# 2026-07-26 12:15 — Context-engineering: system-prompt extraction + playbook

**Task.** `/ck:cook --autonomous read <claude.ai public artifact> and implement
context engineering enhancement`. The artifact was a generic educational guide
on context engineering (system prompts, RAG, tools, structured output,
multi-agent orchestration) — not a spec. After scouting, it was clear the repo
**already implements every primitive** the guide describes (orchestrator ReAct
loop, six deterministic lanes, RAG via knowledge-retrieval + embeddings,
token-attribution, multi-provider failover, rate limiting). The lowest-blast-
radius interpretation was chosen: extract the existing inline system-prompt
builder into a composable, tested module and codify the architecture as a
playbook doc.

**Scope decision (declined clarification → committed to composed Option 4).**
The `AskUserQuestion` call to pin down scope was declined by the user, so the
most defensible interpretation was taken: behavior-preserving code refactor +
codifying documentation. This avoided both (a) touching public contracts in an
ambiguous task and (b) producing a doc-only deliverable that would feel like
make-work on a production repo.

## What changed

1. **`backend/src/services/agent/system-prompt.ts` (NEW)** — extracted
   `buildSystemPrompt` from `orchestrator.ts` into a composable module.
   Exposes `buildSystemPromptSections` (named, ordered sections: persona → time
   → toolPolicy → tourPolicy → uiPolicy → route → responseShape) plus the
   original `buildSystemPrompt` for byte-identical orchestrator consumption.
2. **`backend/src/services/agent/orchestrator.ts` (MODIFIED)** — removed the
   inline `buildSystemPrompt` function and `STRUCTURED_RESPONSE_HINT` constant;
   imports them from the new module; removed the now-unused `todayIsoVn` import.
   No other orchestrator logic touched.
3. **`backend/src/tests/agent-system-prompt.test.ts` (NEW)** — 15 tests in two
   layers: golden parity (byte-identical output for representative inputs) and
   section contract (which sections fire for which tool/message combinations).
4. **`docs/context-engineering/playbook.md` (NEW)** — maps each abstract
   context-engineering principle from the artifact to concrete repo code, with
   a mermaid turn-flow diagram, anti-pattern catalog, and an extension guide.
5. **`AGENTS.md` (MODIFIED, 1 line)** — added a single bullet under "Local dev
   quick reference" pointing at the playbook.

## Why this shape

- **Behavior-preserving extraction** is the safest possible "enhancement": it
  improves the surface (testability, modularity, future per-role few-shot or
  token-budget work) without changing any model-facing string. The golden
  parity tests prove this.
- **Codifying the architecture in a playbook** turns the artifact's generic
  advice into a code-specific reference doc that grounds future contributors.
  This is where the artifact's *real* value lives for a repo that already has
  the primitives.
- **Avoiding contract changes** (no touch to `AgentResponse`, `AgentDirective`,
  SSE shape, `callMiniMax` signature, tool registry) keeps blast radius
  proportionate to the ambiguous scope.

## QA outcome (all green for the affected surface)

| Gate | Result | Artifact |
|------|--------|----------|
| Lint | 0 errors (11 pre-existing warnings in unrelated files) | `qa/2026-07-26_context-engineering_lint.log` |
| Backend tsc | 0 new errors (2 pre-existing baseline in untouched `salary-period-close.service.ts`) | `qa/2026-07-26_context-engineering_backend-tsc.log` |
| Backend agent tests | **213/213 pass** | `qa/2026-07-26_context-engineering_backend-test-agent.log` |
| Backend re-run (post-review fix) | **15/15 pass** | `qa/2026-07-26_context-engineering_backend-test-rerun.log` |
| Frontend tsc | 0 errors | `qa/2026-07-26_context-engineering_frontend-tsc.log` |
| Frontend tests | **220/220 pass** | `qa/2026-07-26_context-engineering_frontend-test.log` |
| Build (`pnpm build`) | exit 0 | `qa/2026-07-26_context-engineering_build.log` |
| Code review | APPROVE | `qa/2026-07-26_context-engineering_review.md` |

## Pre-existing infra note (NOT a regression)

Full `pnpm test` glob hangs in `src/tests/email-service.test.ts` after its M3.3
sub-tests complete — the runner becomes idle but never exits. The file is
unrelated to this change (no import path to `services/agent/*`). Captured with
evidence in `qa/2026-07-26_context-engineering_backend-test-infra-note.md` per
AGENTS.md ("If a gate is genuinely blocked by infra or flakiness, say so with
evidence"). Triaged as pre-existing; not in this task's scope.

## Review fixes applied

- **Low (test timezone flakiness):** replaced the test's local `todayIsoVn`
  helper (which double-corrected via `getTimezoneOffset` and could drift near
  date boundaries on non-UTC runners) with a direct import of the production
  `todayIsoVn` from `./tools/period.js`. Golden string can no longer drift.
- **Nit (unnecessary cast):** removed the `as AgentContext` cast in the test
  fixture; the literal already satisfies the type.

## Scope-interleaving flag

The working tree contains a **separate, pre-existing** body of WIP from a
different "Repository Development Context Engineering" task (`CONTEXT.md`,
`HANDOFF.example.md`, `.codex/context-manifest.json`, `scripts/context-for.mjs`,
`scripts/context-for.test.mjs`, `package.json` context scripts, the
"Development context loading" block at the top of `AGENTS.md`, and
`plans/260726-1208-...`). **None of those files are part of this task.** They
were already present in the working tree when this task started. If committing,
they should be split into separate commits/PRs.

## Emotional honesty

The task arrived genuinely ambiguous — "implement context engineering
enhancement" against a generic guide, on a repo that already has a mature agent
stack. I declined to guess at a larger scope (token-budget pruning, per-role
few-shot, multi-agent orchestration) without confirmation, and the
clarification was declined. The composed refactor + doc option is the safest
non-trivial interpretation, but it is *one* interpretation, not *the*
interpretation. If the user had a specific pillar in mind (token budgets,
multi-agent, dynamic few-shot), this delivery will feel under-scoped and a
follow-up is welcome.
