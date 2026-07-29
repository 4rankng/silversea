---
phase: 3
title: Closed-loop verification and handoff
status: completed
effort: medium
---

# Phase 03 — Closed-loop verification and handoff

## Gates

- `pnpm lint`
- `cd backend && npx tsc --noEmit`
- `cd backend && pnpm test`
- `cd frontend && npx tsc -b`
- `cd frontend && pnpm test`
- `make build`
- `cd e2e && ./run_all.sh`
- `pnpm context:check`
- `git diff --check`

Capture every run, including red-to-green reruns, under `qa/2026-07-29_shipment-operations-*`.

## Independent checks

- Tester validates acceptance coverage and regression evidence.
- Debugger investigates any red gate and records root cause.
- Code reviewer checks schema compatibility, role reachability, optimistic locking, audit, dispatch, and responsive behavior.
- Docs manager synchronizes user-visible workflow/roadmap notes only where required.
- Project status and `HANDOFF.md` reflect verified state, not intended state.

## Release boundary

Do not commit, push, deploy, or import customer workbook data without separate user authorization.

## Done

- [x] Every affected automated gate is green with an immutable `qa/` artifact.
- [x] Independent review has no unresolved critical/high finding.
- [x] Browser evidence covers desktop/mobile and the role matrix, or an explicit infrastructure blocker is recorded.
- [x] Plan, roadmap/docs if needed, harness, and `HANDOFF.md` match verified reality.
