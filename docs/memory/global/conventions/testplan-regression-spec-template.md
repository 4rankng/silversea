---
name: "testplan-regression-spec-template"
description: "Use testplan/qa/_TEMPLATE.md as the starting point for cycle-scoped regression specs; share the Environment/Accounts/Verification/Evidence/Pass-criteria/Gates/Anti-lying/Not-covered boilerplate once instead of duplicating it per spec."
folder: "global / conventions"
tags: ["testplan", "qa", "conventions", "context-efficiency"]
updatedAt: "2026-09-10T11:33:53.016Z"
author: "Custom Agent (project optimization)"
---

---
description: Use testplan/qa/_TEMPLATE.md when producing cycle-scoped regression specs (one file per ticket per cycle). Eliminates ~280 lines of boilerplate duplication across the 4 specs in a typical cycle.
---

# Testplan regression spec template

Cycle-scoped regression specs in `testplan/qa/` (one file per ticket per cycle, e.g.
`2026-09-10_dispatch-detailed-plan.md`) MUST start from `testplan/qa/_TEMPLATE.md`
and carry only the ticket-specific parts:

- **Goal** (what changes, in what surface, with what scope guardrail)
- **Out of scope**
- **Acceptance criteria** (TC-NNN blocks with Given/When/Then/Assert/Evidence)
- **Linked artifacts** (ticket id, companion specs, memory references)

The shared header blocks — Environment, Accounts, Verification protocol, Evidence
bundle, Pass criteria, QA gates, Anti-lying guardrails, What is NOT covered — live
in `_TEMPLATE.md` ONCE. Do not re-paste them per spec.

Audit baseline (cycle 1, 2026-09-10): the 4 specs carried ~280 lines of duplicate
boilerplate (~34% of file body); template adoption targets ~50% line reduction
and ~60% token reduction per spec loaded for verification.

When producing a new regression spec:
1. Copy `_TEMPLATE.md` to `testplan/qa/<YYYY-MM-DD>_<ticket-slug>.md`.
2. Fill the ticket-specific sections; leave the shared header untouched.
3. If the ticket introduces a section the template does not cover (rare — e.g.
   a new auth pattern), add it to the template FIRST, then copy.

The `testplan/qa/README.md` has the full lifecycle (PREP → READY → RUNNING → DONE)
and naming convention.
