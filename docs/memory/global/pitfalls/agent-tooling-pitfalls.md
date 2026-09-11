---
name: "agent-tooling-pitfalls"
description: "Tooling traps: Bash cwd persistence (use git -C/make -C), pre-commit auto-staging in shared checkout, .ua staleness = red gate, react-query refocus closing dialogs, wrong-module hook imports, LOC ratchet, stale context-manifest"
folder: "global / pitfalls"
tags: ["pitfalls", "tooling", "pre-commit", "react-query", "bash"]
updatedAt: "2026-09-11T05:41:49.398Z"
author: "Architect (architect)"
---

# Agent tooling pitfalls (migrated from HANDOFF.md lessons + migration audit, 2026-09-10)

Traps in tooling/infra that have actually cost debugging or failed commands in this repo.

## Bash cwd persists across calls

A `cd frontend` for a typecheck gate makes later `git add` / `make demo` run from `frontend/` (symptom: `No rule to make target 'demo'`; QA artifacts landing in `frontend/qa/` which has 0 tracked files). Cost two failed deploy commands on 2026-09-03. **Always use `git -C`, `make -C`, or absolute paths; never rely on cwd being repo root.**

## Pre-commit hook auto-stages everything in the shared checkout

`scripts/githooks/pre-commit` typechecks + runs the structure guard when staged files touch a project — and in a shared checkout (two sessions), sweep commits can pick up peer WIP. File attribution is fragile; the 2026-09-09 wave ran deploys from a temp worktree at the pushed HEAD to avoid shipping peer WIP. Escape hatch `--no-verify` must be justified in the commit body.

## `.ua/` knowledge-base staleness is a red gate

The understand-anything Stop hook flags when `meta.json.gitCommitHash` lags HEAD; treat it like a failed QA gate — run the update before declaring done. A CSS-only diff adds no graph signal; full `/understand` rebuild needs a dedicated session (it lagged 9+ commits repeatedly in practice).

## react-query window-refocus closes dialogs (2026-09-09 regression wave)

List queries configured with refetch-on-focus made dialogs close when the browser window regained focus mid-QA. When driving UI tests that must survive a refocus, keep the whole click-through in ONE browser evaluation/session. (Source: staging regression wave 09-09, user auto-memory.)

## Wrong-module import trap (forwarder)

`useUpdateForwarderExpense` lives in `useForwarderQueries`, NOT `useQueries` — the page-test mock factory caught the wrong-module import immediately (2026-09-02). Always check which `useXxxQueries.ts` bucket owns a hook before importing.

## Structure guard LOC ratchet (frontend)

`frontend/src/tests/structure.guard.test.ts` freezes per-file LOC ceilings (plus formatter-clone ban); it runs in the pre-commit hook. Splits reduce ceilings; consolidations need the ceiling updated deliberately. Proven to bite: allocation workstream landed two api-client files over ceiling (2026-09-08 incident).

## Stale `.codex/context-manifest.json` (pre-migration state)

`pnpm context:check` was already failing before the 2026-09-10 migration with 6 missing paths (removed agent-runtime files `backend/src/agentSocket.ts`, `services/agent/*`, `shared/src/schemas/agent.ts`; `qa/README.md`; old roadmap plan) — and migration removed `ROADMAP.md` from the product-planning profile too. Don't trust the resolver's profile lists; scout with code intelligence. Fixing or decommissioning the manifest is an open cleanup.

## Untitled UI CLI failure modes

See skill `untitled-ui-component-workflow` (relative `--path` doubling, npm-install step failing benignly in pnpm workspaces, overwrite prompts, root-vs-frontend dir, 429 rate limits + website fallback).

## `git add <paths>` does NOT isolate a commit in the shared checkout (2026-09-11 incident)

The pre-commit hook section above warns about `git add -A` sweeps, but the 2026-09-11 incident was subtler: the architect staged ONLY its own file (`git add testplan/qa/<file>.md`) and committed — yet the commit carried a teammate's `git rm`-staged deletions (5 files, -1414 LOC) that were ALREADY sitting in the shared index. `git add` adds to the index; it never removes what a peer left staged, and `git commit` commits the whole index.

**Mechanical fix (binding):** in this shared checkout, always commit via **pathspec** — `git commit -m "…" -- <paths>` (commits only those paths regardless of index state) — or run `git diff --cached --name-only` immediately before every `git commit` and unstage peers (`git restore --staged <peer-paths>`). Never assume the index is clean just because you only added your own files.

Symptom was caught only because the commit summary printed unexpected `delete mode` lines — always read the commit result, not just the exit code.
