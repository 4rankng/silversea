---
phase: 3
title: Regression and QA
status: completed
effort: medium
---

# Phase 3: Regression and QA

## Overview

Prove route compatibility, UI behavior, responsive layout, and deployability
with auditable artifacts.

## Implementation Steps

1. Add focused tests for workspace views, legacy redirect, labels, request
   proposal copy, and focus-query preservation.
2. Run affected frontend/shared typechecks, frontend tests, lint, build, and
   route/flow E2E. Save every run under `qa/`.
3. Run independent tester, debugger, code-reviewer, adversarial validation,
   documentation, project-management, and non-mutating git-status reviews.
4. Generate and validate cook workflow artifacts.
5. Run `make demo`.
6. Verify the deployed site and API health, then perform authenticated desktop
   and mobile checks for canonical/legacy URLs and horizontal overflow.
7. Update `HANDOFF.md` and run `pnpm context:check`.

## Success Criteria

- [x] All affected automated gates are green with `qa/` evidence.
- [x] Review decisions contain no unresolved blocker.
- [x] Workflow artifact validator passes.
- [x] Demo deploy succeeds and public health is green.
- [x] Authenticated desktop/mobile smoke checks pass.

## Failure handling

Fix and rerun any red affected gate. If an external baseline or infrastructure
failure cannot be repaired within scope, preserve the exact evidence and do
not claim completion or deploy past the mandatory gate.
