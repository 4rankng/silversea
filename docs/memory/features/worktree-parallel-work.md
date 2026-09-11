---
name: "worktree-parallel-work"
description: "Amendment: default to file-disjoint direct commits on prod; worktrees shelved unless user re-affirms per case"
folder: "features"
tags: []
updatedAt: "2026-09-10T06:26:10.680Z"
author: "Project Manager (pm)"
---

## Worktree parallel-work convention (user directive 2026-09-10 ~14:25 SGT)

Use git worktrees to parallelize independent code tasks across agents:
- Each parallel writer works in its own worktree on a task branch (e.g. `git worktree add <path> -b work/<topic> origin/prod`), gates green → commit there.
- **Merge-back to prod is AUTHORIZED for task worktree branches** once gates pass (user explicitly authorized "commit merge back to prod branch") — this carve-out supersedes the general no-merge-into-prod rule FOR task worktrees only. Foreign/unrelated branches still never merge into prod. Merge sequentially (one at a time, coordinate via pm) to avoid push races; file-disjoint chunks merge conflict-free.
- Still binding: direct-commit rule for single-lane work, no merges touching main, no prod access beyond deploy + bare health.

Trigger: user suggested worktrees while chunks 3-7 of the approval removal were serialized behind a single writer despite file-disjoint clusters.

## Worktree convention AMENDED (2026-09-10 ~14:50 SGT) — default is DIRECT COMMITS ON PROD

The [[worktree-parallel-work]] carve-out is SHELVED as a default: the repo's AGENTS.md trunk-based contract ("all work on prod/main, no branches") plus the user's binding "never merge any branch to prod" ruling make branch-based work ambiguous for agents. Fullstack correctly halted on the conflict.

**Standing resolution:** parallel writers work as FILE-DISJOINT direct committers on the prod branch (each owns disjoint files, commits + pushes its own chunks; push races resolve via pull --ff-only + re-push). Worktree/branch usage ONLY if the user explicitly re-affirms it for a specific case — and if used, AGENTS.md's trunk-based section must be reconciled in the same change so on-file rules never contradict live directives.
