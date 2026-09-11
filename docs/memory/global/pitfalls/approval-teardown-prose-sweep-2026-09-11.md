---
name: "approval-teardown-prose-sweep-2026-09-11"
description: "After approval-flow teardown through 3bf44195: where to find dead-prose references and where NOT to sweep (testplans ARE the verification criteria; PRD labels are RETAINED per Amendment 2 ruling B). Audit 2026-09-11."
folder: "global / pitfalls"
tags: ["pitfall", "audit", "approval-removal", "docs-hygiene", "testplan"]
updatedAt: "2026-09-11T02:15:05.397Z"
author: "Agent"
---

# Approval-teardown prose sweep (audit 2026-09-11, cycle-1)

After the 18f4a2dd approval-queue teardown landed through 3bf44195, a fresh agent reading the tree could mistake three categories of "approval" mentions for stale prose. None of them are. The audit (this wave's custom step) verified each.

## Categories — what's dead vs. what's not

### Category A — REMOVED, sweep target (these references would be stale)

The dashboard approval-queue UI leg was torn down. Anything referencing these in docs/ + AGENTS.md + CONTEXT.md is dead prose and should be deleted if it creeps back:

- `ManagerDecisionInbox` (component, removed from `DashboardPage.tsx`)
- `ApprovalQueueCard` (component, removed)
- `useApprovalQueue` (hook, removed)
- `DASHBOARD_APPROVAL_QUEUE` (constant, deleted in chunk-C2; `shared/src/constants/api-paths.ts:152`, zero repo-wide refs)
- `getApprovalQueue` (service function, deleted along with `approval-queue.service.ts`)
- `/dashboard/approval-queue` (route, dead)
- `/api/approval/*` route family (does not exist)

**Source-tree verification at audit time:**
```bash
grep -rnE 'ManagerDecisionInbox|ApprovalQueueCard|useApprovalQueue|DASHBOARD_APPROVAL_QUEUE|getApprovalQueue|approval-queue\.service' \
  backend/src/ frontend/src/
# 0 hits at audit time — clean.
```

**Where Category A prose legitimately lives (NOT stale — leave alone):**
- `testplan/qa/2026-09-10_approval-removal-chunk{4,6,7}.md` — these ARE the verification criteria for the teardown (TC-CHUNK4-A1, TC-CHUNK7-001 through TC-CHUNK7-006). Don't delete; the names appear in the assertions themselves.
- `testplan/18f4a2dd-verification-checklist.md` — this IS the verification master checklist. Lines 149-153 reference `/dashboard/approval-queue`, `ApprovalQueueCard`, `ManagerDecisionInbox` as F2 rule checks.
- `testplan/qa/artifacts/2026-09-10_approval-removal-chunk7_*` — QA run reports showing the teardown PASSED. Historical evidence.
- `testplan/qa/artifacts/2026-09-{08,09,10}_*_frontend-test.log` — historical test logs that PASSED ManagerDecisionInbox tests **before the teardown** (those tests have since been removed). The logs themselves are archive.

### Category B — RETAINED-FLOW labels (do NOT sweep; these are alive by design)

Per Amendment 2 ruling B (pm, 2026-09-10), the salary/settlement maker-checker vocabulary is RETAINED for three kept flows: TRIP_EXPENSE maker-checker, CREDIT_OVERRIDE tier escalation, TRIP_AR adjustments. Mentions of "phê duyệt" / "Duyệt" / "Chờ phê duyệt" / "PENDING_APPROVAL" in these specific contexts are alive, not stale:

- `docs/prd/QuyTrinhO2C.md:264,294,313,318` — admin reopen / hồ sơ khóa / chi phí đã duyệt / mở lại phê duyệt Admin. These reference retained-flow gates, NOT the removed dashboard queue.
- `frontend/src/pages/GovernanceActionsPage.tsx:61,67,387` — status labels for retained maker-checker rows (TRIP_EXPENSE / CREDIT_OVERRIDE / TRIP_AR). The X1 label sweep confirmed these stay.
- `frontend/src/components/dashboard/*` — only the ManagerDecisionInbox / ApprovalQueueCard / useApprovalQueue components were removed; the governance-actions list surface was NOT touched.
- `backend/src/routes/financial/governance-actions.routes.ts` — `/governance-actions/:id/{check,approve,reject,return-for-evidence,cancel}` endpoints RETAINED for the kept flows.
- `backend/src/services/work-inbox.service.ts:226` — the `:226` `tripExpenses.approvalStatus='PENDING'` query is RETAINED; it feeds the kept accountant expense/settlement blocker ("Chi phí đang chờ phê duyệt").
- `frontend/src/lib/*` and shared schemas that reference `PENDING_APPROVAL` as a status enum value (not a removed-flow control). The status value is alive for kept flows.

**Audit-time grep for Category B (kept-flow labels):**
```bash
grep -rn 'PENDING_APPROVAL|Chờ phê duyệt|phê duyệt|approvalStatus.*PENDING' \
  docs/ frontend/src/ backend/src/ shared/src/ \
  | grep -v 'testplan/qa/.*approval-removal' \
  | grep -v 'testplan/18f4a2dd-verification'
# RETAINED-flow sites only — per Amendment 2 ruling B. No sweep.
```

### Category C — Historical / generated (NOT dead, NOT teaching sources)

These mention Category A symbols but are NOT active prose — they are records of past state:

- `HANDOFF.md:238` — references ManagerDecisionInbox as "already implemented" at the 2026-08-23 P0-W1 task. This is a historical note about a past work item; the current state (teardown landed) supersedes it. The HANDOFF.md is the controller-state snapshot, not a teaching doc — new agents read AGENTS.md + .agentsroom/memory/, not HANDOFF.md. Don't edit HANDOFF.md just for this; it's accurate as a record of what was true at that point in time.
- `.ua/knowledge-graph.json` + `.ua/fingerprints.json` — generated by `/understand` skill. Will refresh on the next `/understand` rebuild. Out of scope for prose sweep.
- `repomix-output.xml` — generated by `repomix` skill. Same as above.

## Audit protocol (for the next agent doing this sweep)

```bash
# 1. Source-tree teardown verification (Category A):
grep -rnE 'ManagerDecisionInbox|ApprovalQueueCard|useApprovalQueue|DASHBOARD_APPROVAL_QUEUE|getApprovalQueue|approval-queue\.service' backend/src/ frontend/src/
# Expect: 0 hits in active code. If non-zero: the teardown regressed — surface to pm.

# 2. Testplan sweep (Category B kept-flow vs Category A stale):
for f in testplan/qa/*.md testplan/*.md; do
  hits=$(grep -cE 'phê duyệt|approval-queue|ManagerDecisionInbox|getApprovalQueue|DASHBOARD_APPROVAL_QUEUE' "$f")
  echo "$f: $hits"
  # The verification specs themselves legitimately carry the strings; only flag hits in OUT-of-scope docs.
done

# 3. Agent-context sweep:
grep -nE 'phê duyệt|approval-queue|ManagerDecisionInbox|getApprovalQueue|DASHBOARD_APPROVAL_QUEUE' AGENTS.md CONTEXT.md
# Expect: 0 hits (or hits only in retained-flow contexts — see docs/prd/QuyTrinhO2C.md style).
```

## Wave refresh artifacts (this cycle's deliverables)

For every staging checklist in the wave, the G-mig migration-hash check (verify `__drizzle_migrations` carries hash prefix `2d8af75377` after every migrate) was added per pm Amendment 2 2026-09-10:

- `testplan/qa/2026-09-10_dispatch-detailed-plan.md` — G-mig section + TC-DDP-008 (carrier-less auto-load) + TC-DDP-009 (fleet-fetch retry)
- `testplan/qa/2026-09-10_driver-mobile-ui.md` — G-mig section
- `testplan/qa/2026-09-10_replace-tags.md` — TC-REPLACE-TAGS-008 (G-mig)
- `testplan/qa/2026-09-10_driver-app-enhancements.md` (NEW, for 36d0183d) — 7 TCs + G-mig section

## Anti-lying for the audit step itself

- "I grep'd and found X" without category-tagging each hit = rung 1. Each hit must be classified: Category A (dead, sweep), B (retained, leave), or C (historical, leave).
- "I read the testplans and they look fine" without enumerating the verification-criteria files = rung 1. The testplans ARE the assertion set — they must carry the strings.
- "HANDOFF.md mentions it, must be stale" = wrong read. HANDOFF.md is controller-state, not the teaching source for new agents.

## Linked artifacts

- Spec: `testplan/18f4a2dd-verification-checklist.md` (F2 rule for the dashboard queue teardown)
- Findings: `testplan/qa/artifacts/2026-09-10_approval-removal-chunk7_be-rerun-backend.md` (the local re-run that PASSED TC-004..008)
- Source-tree proof: this audit ran `grep -rnE 'ManagerDecisionInbox|...'` against `backend/src/` + `frontend/src/` and confirmed 0 hits at audit time.
- Memory: [[agent-working-contract]] (trunk-based git + closed-loop SDLC), [[frontend-architecture]] (test convention)
