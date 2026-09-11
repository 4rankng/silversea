# Project Memory: index

Synced from the AgentsRoom server at **2026-09-11T10:44:38.815Z**
(server revision `2026-09-11T05:41:49.588Z`).

HOW TO USE THIS DIRECTORY

- READ is local: open a note with `Read`, or `Grep` this directory. No tool call, no network.
- Each line here is a retrieval CUE, not the note. Open the file for the real content.
- WRITE is remote: create or update notes ONLY with the `memory_save` MCP tool.
  These files are a one-way mirror of a server row shared with every user of
  the project. Editing a `.md` here does nothing: the next sync overwrites it.
- STALE? This mirror refreshes when the project opens and after every agent
  write. If the stamp above looks old, or a note contradicts the code you are
  reading, call `memory_list` to force a fresh fetch and trust that instead.

18 notes.

## Notes

- **design-system-contracts** : Enforced UI contracts: control density (sm/md/xs + 44px coarse-pointer floor, pointer-based not width-based), card-grid pairing rules, operational color...
  `features/design-system-contracts.md`
- **frontend-architecture** : Contains the frontend two-layer architecture rules, cross-feature helper placement, and the journey-board tag-pool embedding contract
  `features/frontend-architecture.md`
- **prd-roadmap-and-decisions** : PRD structure, O2C business flow (CUS→dispatch→driver, e-POD, Hoàn thành chuyến), locked decisions (shipments keystone, all 23 Q&A proposals accepted...
  `features/prd-roadmap-and-decisions.md`
- **responsive-space-utilisation** : Outcome + verification protocol + standard location for the responsive space-utilisation program shipped 2026-09-10
  `features/responsive-space-utilisation.md`
- **supplier-carrier-link** : Contains the supplier→carrier customer link contract (Bug A 2026-09-09): ensure logic, backfill script usage, pinned tests, tax-code normalization pitfall...
  `features/supplier-carrier-link.md`
- **test-debt-and-db-lean-down** : Governance direct-apply + PENDING_EXPENSE_APPROVAL retirement re-pin map (clusters A-E with efforts), DB lean-down shipped decisions and the do-NOT-drop...
  `features/test-debt-and-db-lean-down.md`
- **worktree-parallel-work** : Amendment: default to file-disjoint direct commits on prod; worktrees shelved unless user re-affirms per case
  `features/worktree-parallel-work.md`
- **main-prod-merge-readiness** : Contains the main→prod merge readiness verdict (2026-09-10 scout): the drizzle migration renumber/hash-skip trap, the 4 additive migrations prod will receive...
  `global/architecture/main-prod-merge-readiness.md`
- **agent-working-contract** : The migrated AGENTS.md/CONTEXT.md working contract: trunk-based git, closed-loop SDLC, QA gates table, pre-commit compile gate, qa/ artifacts, testplan...
  `global/conventions/agent-working-contract.md`
- **kanban-task-tracking** : STANDING DIRECTIVE: all tasks tracked on the kanban backlog board — created on assignment, dependency-chained, statuses moved live; never chat-only tracking
  `global/conventions/kanban-task-tracking.md`
- **testing-and-deploy-environments** : Standing rule: commit + push after every task/chunk — never batch-push at the end
  `global/conventions/testing-and-deploy-environments.md`
- **testplan-regression-spec-template** : Use testplan/qa/_TEMPLATE.md as the starting point for cycle-scoped regression specs; share the...
  `global/conventions/testplan-regression-spec-template.md`
- **agent-tooling-pitfalls** : Tooling traps: Bash cwd persistence (use git -C/make -C), pre-commit auto-staging in shared checkout, .ua staleness = red gate, react-query refocus closing...
  `global/pitfalls/agent-tooling-pitfalls.md`
- **approval-teardown-prose-sweep-2026-09-11** : After approval-flow teardown through 3bf44195: where to find dead-prose references and where NOT to sweep (testplans ARE the verification criteria; PRD labels...
  `global/pitfalls/approval-teardown-prose-sweep-2026-09-11.md`
- **css-grid-orphan-parity-trap** : Contains the CSS nth-child/display:none orphan trap in filter grids and the cross-lane CSS coordination convention from the 2026-09-09 responsive audit
  `global/pitfalls/css-grid-orphan-parity-trap.md`
- **deploy-tag-race-verification** : Contains the 2026-09-10 staging :latest tag-race incident: why a one-time bundle-flip check proves nothing, the two-stage make-demo kill, rollback-snapshot...
  `global/pitfalls/deploy-tag-race-verification.md`
- **drizzle-kit-silent-migration-skip** : Contains the drizzle-kit 0.31.10 silent-exit-1 migration-skip trap: symptom (0066 applies, 0067 silently skipped, no diagnostics), the G-mig post-migrate...
  `global/pitfalls/drizzle-kit-silent-migration-skip.md`
- **load-failure-retry-duplication** : 15+ duplicated 'Không tải được + Thử lại' affordances across the frontend; should be extracted to a single LoadFailureRetry primitive before more call-sites...
  `global/pitfalls/load-failure-retry-duplication.md`
