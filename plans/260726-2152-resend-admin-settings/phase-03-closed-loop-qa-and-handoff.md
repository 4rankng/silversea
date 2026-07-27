---
phase: 3
title: Closed-loop QA and handoff
status: in-progress
priority: P1
dependencies:
  - 1
  - 2
effort: medium
---

# Phase 3: Closed-loop QA and handoff

## Overview

Close every affected repository gate, independently review the change, and
record auditable evidence without claiming unrelated dirty-worktree behavior.

## Requirements

- Save every gate output under `qa/`.
- Run focused tests first, then affected full gates from `AGENTS.md`.
- Perform manual desktop/mobile UI QA.
- Update docs only if the final contract warrants it.
- Update `HANDOFF.md` and run `pnpm context:check`.

## Implementation Steps

1. Run backend/frontend focused tests and fix until green.
2. Run root lint, backend/frontend typechecks and tests, `make build`, and E2E
   because an authenticated API flow changed.
3. Verify the admin page at desktop/tablet/mobile widths when the local stack is
   available; save screenshots or document a concrete browser blocker.
4. Run independent code review and save the report under `qa/`.
5. Sync all plan phases, write the handoff, journal the decision, and verify
   context.

## Success Criteria

- [ ] All affected automated gates green with exact-command artifacts. Full E2E
      remains red on the unrelated concurrent ADMIN unknown-route contract;
      focused Resend API E2E and all other affected gates are green.
- [x] Responsive manual QA green or honestly blocked with evidence.
- [x] Independent review has no unresolved code findings.
- [x] No TODO, skip, stub, or placeholder in the changed surface.
- [x] Plan, handoff, and context check match actual completion state.

## Risk Assessment

The worktree already contains unrelated portal and trip-image work. Gate
failures must be classified by ownership and this task must not revert or stage
those changes.
