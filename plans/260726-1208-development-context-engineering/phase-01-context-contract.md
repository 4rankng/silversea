---
phase: 1
title: Context Contract
status: completed
effort: ''
priority: P2
dependencies: []
---

# Phase 1: Context Contract

## Overview

Define the stable and dynamic context layers used by coding agents.

## Implementation Steps

1. Add `CONTEXT.md` as the concise repository context entrypoint.
2. Add tracked `HANDOFF.example.md` plus ignored local `HANDOFF.md` with goal,
   scope, decisions, owned changes, QA, and next-step fields.
3. Update `AGENTS.md` with the progressive loading protocol while preserving
   concurrent user-owned edits.
4. Keep product requirements in `ROADMAP.md` and PRD files; link rather than duplicate.

## Success Criteria

- [x] Authority and source-of-truth order is explicit.
- [x] Stable facts are separated from current task state.
- [x] Agents are told not to bulk-load PRDs, plans, or unrelated source trees.
- [x] No application runtime file is modified by this phase.

## Risk Assessment

The main risk is duplicated or stale guidance. Mitigate by keeping `CONTEXT.md`
short, linking authorities, and validating referenced paths through the manifest.
