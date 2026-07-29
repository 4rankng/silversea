## Code Review Summary

### Scope

- Files: 19 tracked frontend/shared/plan files plus 4 new frontend source/test files
- LOC: approximately +766 / -108, excluding generated QA artifacts and review reports
- Focus: uncommitted advance-workspace consolidation, legacy-route compatibility, role boundaries, responsive behavior, query preservation, and adjacent governance flow
- Scout findings: async focus targets, legacy query preservation, office-role access, mobile/tablet overflow, `REVERSED` history counts, and concurrent governance proposals were traced beyond the visible diff
- Decision: **PASS — APPROVED FOR RELEASE**

### Overall Assessment

The refreshed diff has no blocking correctness, security, authorization, API-contract, or performance regression. Earlier review gaps were corrected: governance now has a shared catalog/search/agent route entry, KPI filters are native buttons, mobile status filters are labelled selects, `REVERSED` counts are numeric, and asynchronous focus links retain their query state until the target exists.

The mandatory verification loop is now green. The final full E2E rerun passed, the isolated forwarder suite passed, and authenticated browser checks cover ADMIN, MANAGER, and ACCOUNTANT capabilities plus DRIVER denial. Responsive checks at 1440, 1024, 768, 390, and 320 report no page-level overflow.

### Critical Issues

None found.

### High Priority

None.

The earlier forwarder-portal navigation race did not reproduce: the isolated suite and final full rerun both passed. The final artifact records 16 suites, 252 tests, 249 passed, 0 failed, and 3 skipped (`qa/2026-07-29_advance-workspace_e2e.postfix.log:510-517`).

### Medium Priority

None.

The final manual artifact covers the required responsive boundaries (`qa/2026-07-29_advance-workspace_manual-qa.md:7-44`) and the ADMIN/MANAGER/ACCOUNTANT capability matrix (`qa/2026-07-29_advance-workspace_manual-qa.md:46-55`). The tester additionally verified DRIVER denial (`qa/2026-07-29_advance-workspace_tester.md:21-35`).

### Low Priority

#### 1. Governance filter query state is only read on initial mount

`frontend/src/pages/GovernanceActionsPage.tsx:162-166` initializes local filter state from `filter=all`, while the filter controls at `frontend/src/pages/GovernanceActionsPage.tsx:306-326` only update local state. Back/forward navigation that changes the query on the same mounted route can therefore leave the visible filter inconsistent with the URL.

This does not affect the new `/advances?view=...` contract and is not a landing blocker. If governance filter URLs are intended to be durable, derive the filter from search params or update the query from the controls.

#### 2. Loading states are not announced

The request and settlement loading containers remain visual-only (`frontend/src/pages/AdminAdvancesPage.tsx:451-454`, `frontend/src/pages/AdminAdvanceSettlementsPage.tsx:506-509`), despite the design contract requesting `role="status"` / `aria-live="polite"` (`plans/260729-1256-advance-workspace-consolidation/reports/ui-recommendations.md:134-146`).

This is an existing accessibility gap retained by the consolidation, not a new production regression.

### Edge Cases Found by Scout

- Legacy `/admin/advance-settlements` queries are copied and `view=settlements` is forced; unrelated parameters survive (`frontend/src/App.tsx:17-25`).
- Focus cleanup removes only `focus` and `fdur`, and a `MutationObserver` waits for asynchronously loaded rows before consuming the deep link (`frontend/src/hooks/useFocusDeepLink.ts:5-48`).
- ADMIN, MANAGER, and ACCOUNTANT retain workspace access; request proposal controls remain ADMIN/MANAGER and settlement review controls remain ADMIN/ACCOUNTANT.
- No new DB loop, N+1 query, raw SQL, sensitive-data exposure, or authorization bypass was introduced.
- The backend still permits one active approval and one active rejection governance action for the same advance request/version because uniqueness includes `actionKind` (`backend/src/db/schema.ts:996-1001`; insertion paths at `backend/src/services/advance.service.ts:250-351`). This is a pre-existing domain invariant gap. The refreshed diff no longer adds a capped client-side suppression scan or claims to solve it, and API/DB/governance mutation changes are explicitly outside this plan (`plan.md:31-32`). Track it as a separate backend task.

### Positive Observations

- The canonical route and legacy redirect preserve backwards compatibility without changing API, schema, ledger, or RBAC contracts.
- Request copy now distinguishes a governance proposal from final approval, while settlement actions retain their direct-review meaning.
- Governance route/title/search/agent contracts now share the catalog instead of drifting across independent literals.
- Post-fix frontend tests, frontend/shared typecheck, lint, build, isolated forwarder E2E, full E2E, and manual responsive/role checks are green.

### Recommended Actions

1. Proceed with the controller-owned simplification, artifact validation, and release workflow.
2. File the conflicting advance-request governance proposal invariant as a separate backend task with a transactional concurrency test.
3. Treat durable governance filter query state and loading announcements as non-blocking follow-up accessibility/URL-state cleanup.

### Metrics

- Type coverage: not measured
- Test coverage: not measured
- Frontend tests: 446 passed, 0 failed in the post-fix artifact
- Typecheck: frontend and shared green in post-fix artifacts
- Build: green in post-fix artifact
- Linting issues: 0 errors, 51 pre-existing warnings
- E2E: 16 suites; 249 passed, 0 failed, 3 skipped

### Plan Status

- Phase 1: implementation appears complete.
- Phase 2: implementation appears complete after the refreshed fixes, although its success-criterion boxes remain unchecked.
- Phase 3: review and QA criteria are green. The plan file still records it as pending; final task-state, artifact-validation, deployment, and handoff mutations remain controller-owned.

### Unresolved Questions

- Is durable `filter=all` governance navigation an intended public URL contract or only initial-link convenience?
- Which follow-up owner will enforce the backend invariant preventing contradictory active advance-request governance proposals?

Status: DONE
Summary: The refreshed implementation and final release evidence pass review; release is approved.
Concerns/Blockers: None for this diff. The contradictory governance-proposal invariant is pre-existing and should be tracked outside this UI-only plan.
