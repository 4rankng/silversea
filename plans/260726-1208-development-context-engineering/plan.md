---
title: Repository Development Context Engineering
description: >-
  Add progressive, structured, and verifiable repository context loading for
  software-development agents.
status: completed
priority: P2
branch: main
tags:
  - docs
  - infra
  - developer-experience
blockedBy: []
blocks: []
created: '2026-07-26T04:03:28.959Z'
createdBy: 'ck:plan'
source: skill
---

# Repository Development Context Engineering

## Overview

Create a compact development-context layer above the existing closed-loop SDLC.
Agents load stable repository facts first, resolve only the task-specific sources
they need, preserve current task state in a standard handoff, and verify the
context map for drift. No application behavior, API, schema, or UI changes.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Context Contract](./phase-01-context-contract.md) | Completed |
| 2 | [Context Resolver](./phase-02-context-resolver.md) | Completed |
| 3 | [Verification and Handoff](./phase-03-verification-and-handoff.md) | Completed |

## Dependencies

- Existing `AGENTS.md` remains the workflow authority.
- `ROADMAP.md` remains the product-priority authority and is loaded only for
  planning or scope work.
- No dependency on the product roadmap phases; this plan changes development
  process only.

## Acceptance Criteria

- `CONTEXT.md` defines authority, repository map, loading protocol, and context hygiene.
- `.codex/context-manifest.json` maps task profiles to focused sources and QA gates.
- `pnpm context -- <path-or-keyword>` returns deterministic, deduplicated context.
- `pnpm context:check` fails on missing files, duplicate profiles, or malformed entries.
- Ignored local `HANDOFF.md` matches the existing Codex hook, uses a tracked
  template, and records live task state without claiming unrelated changes.
- Focused tests and root lint pass; evidence is saved under `qa/`.
