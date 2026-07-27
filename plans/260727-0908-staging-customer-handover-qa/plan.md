---
title: Staging Customer Handover Visual Regression
description: >-
  Run auditable staging visual and functional regression across every supplied
  role, PRD module, responsive viewport, and customer-handover workflow.
status: pending
priority: P1
branch: main
tags:
  - qa
  - frontend
  - auth
  - critical
blockedBy: []
blocks: []
created: '2026-07-27T01:03:43.018Z'
createdBy: 'ck:plan'
source: skill
---

# Staging Customer Handover Visual Regression

## Overview

Prepare `https://vantai.tingting.vip/` for customer handover through multiple
bounded test sessions. Cover the six supplied staging roles plus a controlled
CLERK account authorized by the user. Use the manual cases in
`docs/regression-testing/`, the PRD delivery matrix, and the current route
inventory. A green result proves current staging behavior; it does not convert
unsigned PRD proposals or Q01-Q23 into accepted customer requirements.

## Scope boundary

- In: all reachable pages; role navigation and direct-URL denial; core workflows;
  desktop/tablet/mobile visuals; Vietnamese copy; exports; error/empty/loading
  states; cross-module reconciliation; customer-ready evidence.
- In: creation and later retention/disablement of one controlled CLERK staging
  account. This is the only staging mutation currently authorized. Keep
  credentials out of Git, screenshots, logs, reports, and chat summaries.
- Out: product redesign, deployment, production testing, silent PRD decisions,
  and business/configuration/profile/password mutation.
- Known non-pass items to classify explicitly: M1.7 is not implemented; M7.2
  proposed acceptance cases lack direct proof; all 66 PRD sections, 122
  module-wide criteria, and Q01-Q23 remain unsigned customer authority.

## Canonical coverage and result model

Freeze a manifest before fan-out with exactly:

- 338 module test cases from M01-M12.
- 23 Q01-Q23 proposal cases.
- 122 module-specific HT cells: ten per module, plus two additional M03 cells.
- Total: 483 execution rows. The 12 generic `TC-HT-*` headings are templates
  expanded into the 122 HT cells; the illustrative `TC-...` in the README is
  not an executable case.

Each row carries three orthogonal statuses:

| Axis | Allowed values |
|---|---|
| Execution | `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`, `NOT_APPLICABLE` |
| Reason, required for BLOCKED/NOT_RUN | `FIXTURE`, `ENVIRONMENT`, `AUTHORITY`, `MUTATION_NOT_AUTHORIZED` |
| Delivery | `implemented`, `partial`, `not_found` |
| Authority | `accepted`, `modified`, `pending`, `rejected`, `not_required` |

Never convert `partial`/`not_found` delivery or `pending` authority into an
execution failure. Never convert a rendered page into a functional pass.

## Execution model

```text
Session 01 preflight
        |
        +--> Sessions 02-08 in parallel: isolated role/visual lanes
        |
        +--> Session 09: read-only cross-role reconciliation and RBAC
        |
        +--> Session 10: retest, reconcile evidence, customer verdict
```

Sessions 02-08 may navigate, filter, export, open forms, and inspect validation
in parallel. They must not approve, close, pay, dispatch, upload, save, delete,
or edit records. Session 09 is read-only reconciliation/RBAC by default.
Mutation-dependent cases use execution `NOT_RUN` with reason
`MUTATION_NOT_AUTHORIZED`. A serialized disposable-data extension may run only
after separate user authorization.

Recommended scheduler within a four-slot controller/worker budget:

| Wave | Sessions | Reason |
|---|---|---|
| 0 | 01 | Freeze build, accounts, fixtures, and matrix before fan-out |
| 1 | 02 ADMIN + 05 DRIVER + 07 CUSTOMER | Completed |
| 2 | 03 MANAGER + 06 FORWARDER + 08 CLERK | Completed |
| 3 | 04 ACCOUNTANT | Completed |
| 4 | 09 | Completed |
| 5 | 10 | Completed |

## Shared test contract

- Viewports for every reachable page: `1440x900`, `768x1024`, `390x844`.
  Also check `320x568` for each role home and primary action, especially DRIVER,
  FORWARDER, CUSTOMER, and CLERK. Add `667x375` landscape to driver/field
  orientation-sensitive pages.
- Fresh browser context per role. Never reuse cookies across roles.
- For every page record: final URL, visible role navigation, main content,
  primary actions, console errors, failed requests, horizontal overflow, touch
  target usability, text wrapping, empty/loading/error behavior, and screenshot.
- Every execution row uses the canonical result model above. Screenshots alone
  never prove persistence, RBAC, export fidelity, camera/GPS, offline recovery,
  or financial reconciliation.
- Discover current IDs through the UI/API. Never hard-code historical IDs.
- Evidence:
  `qa/<date>_customer-handover_sNN_<role>_<viewport>_<surface>.<ext>` and
  `plans/260727-0908-staging-customer-handover-qa/reports/session-NN-<role-or-scope>.md`.
  Include timestamp, environment/build fingerprint, exact test-case IDs,
  three-axis status, reproduction, and evidence paths.

## Privacy-safe evidence

- Persist only sanitized evidence. Mask customer names, identifiers, document
  numbers, personal data, financial values, secrets, and free-text notes before
  screenshots. Preserve layout dimensions while masking.
- Do not persist HAR, video, browser trace, storage state, cookies, auth headers,
  request/response bodies, or raw downloaded customer documents.
- Network artifacts contain method, redacted route template, status, timing,
  and failure class only. Remove query values and payloads.
- Open exports in an OS temporary directory, verify type/opening/schema/totals
  in memory, record sanitized assertions plus size/checksum, then delete the raw
  file. Never add downloaded documents to the repository.
- If a defect needs raw private evidence, stop and request an approved secure
  evidence channel. Do not save it under `qa/` or a session report.
- Sanitized `qa/` artifacts follow repository retention. Each session checks
  its output for secrets and private data before handoff.

## Session handoff protocol

Each run reads `AGENTS.md`, `CONTEXT.md`, its assigned phase, the matching
regression module files, and only the relevant route/PRD report sections.
It must not overwrite `HANDOFF.md`. It owns only its named report and QA
artifacts. End every report with:

```text
Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
Summary: one or two sentences
Counts: PASS / FAIL / BLOCKED / NOT_RUN / NOT_APPLICABLE
Concerns/Blockers: exact test IDs and evidence paths
```

## Coverage allocation

| Session | Owner | PRD / surface |
|---|---|---|
| 01 | Controller | health, release identity, accounts, fixtures, route matrix, CLERK provisioning |
| 02 | ADMIN | global shell, master/config pages, users, app settings, audit/chatbot, M2/M6/M12 config |
| 03 | MANAGER | dashboard, dispatch, fleet, trips, shipments, approvals, audit, finance/profit; M1/M3/M11 |
| 04 | ACCOUNTANT | pricing, expenses, AR, AP, payroll, penalties, settlements, fuel; M2/M4-M7/M11/M12 |
| 05 | DRIVER | all `/my-*` pages, trip evidence, earnings/payslips/penalties; M8/M12 |
| 06 | FORWARDER | trips, advances, expenses, settlements, uploads; M4/M9 |
| 07 | CUSTOMER | row-scoped shipments, debit notes, statements/exports, confirm/dispute; M3/M5 |
| 08 | CLERK | shipment quick-create, documents/containers, readiness/handoff and denial; M10 |
| 09 | Controller | read-only cross-role reconciliation/RBAC; optional separately authorized stateful extension |
| 10 | Controller/reviewer | Completed |

## Release verdict

The report issues two verdicts. `VISUAL HANDOVER GO` requires zero unresolved
P0/P1 visual/access failures, zero cross-role/customer data leaks, zero broken
role landing/navigation paths, no primary-action overflow at required
viewports, valid core exports, and complete evidence for every in-scope
route/module/role cell. `FUNCTIONAL CERTIFICATION` remains incomplete when
mutation-dependent cases are not run. `CONDITIONAL GO` requires named customer
acceptance of remaining visual/product/authority gaps. Otherwise the visual
result is `NO-GO`.

Overall customer handover cannot be unconditional while any P0/P1 functional
case is `BLOCKED`/`NOT_RUN`, M1.7 remains `not_found`, or a critical
parameterized page lacks a safe fixture. A conditional visual/demo handover
must record the named approver, approved scope, build fingerprint, expiry,
excluded cases, and customer-visible limitations.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Controller Preflight and Data Freeze](./phase-01-controller-preflight-and-data-freeze.md) | Completed |
| 2 | [ADMIN Configuration and Master Data](./phase-02-admin-configuration-and-master-data.md) | Completed |
| 3 | [MANAGER Dispatch Fleet and Executive Views](./phase-03-manager-dispatch-fleet-and-executive-views.md) | Completed |
| 4 | [ACCOUNTANT Finance AR AP Payroll and Fuel](./phase-04-accountant-finance-ar-ap-payroll-and-fuel.md) | Completed |
| 5 | [DRIVER Mobile Operations](./phase-05-driver-mobile-operations.md) | Completed |
| 6 | [FORWARDER Field Operations](./phase-06-forwarder-field-operations.md) | Completed |
| 7 | [CUSTOMER Portal](./phase-07-customer-portal.md) | Completed |
| 8 | [CLERK Coverage Contingency](./phase-08-clerk-coverage-contingency.md) | Completed |
| 9 | [Cross-Role Stateful Journeys and RBAC](./phase-09-cross-role-stateful-journeys-and-rbac.md) | Completed |
| 10 | [Consolidation Retest and Handover Verdict](./phase-10-consolidation-retest-and-handover-verdict.md) | Completed |

## Dependencies

- Source baseline:
  [`../260726-2126-product-wide-ultraqa/`](../260726-2126-product-wide-ultraqa/).
- Intended future delivery:
  [`../silversea-prd-roadmap/`](../silversea-prd-roadmap/); it does not block
  testing current staging behavior.
- Execution requires staging availability, the supplied role accounts, the
  user-authorized CLERK account, and stable read-only fixture data.

## Acceptance criteria

- [ ] The manifest contains exactly 483 execution rows with one owner and final result.
- [ ] All seven roles have landing, navigation, direct-URL denial, logout, and responsive evidence.
- [ ] Every reachable page has desktop/tablet/mobile evidence and no unclassified failures.
- [ ] Existing records support read-only reconciliation of operating, money,
      payroll, fuel, and customer-portal chains; mutation-only cases are `NOT_RUN`.
- [ ] M1.7, M7.2, partial delivery, and Q01-Q23 are reported honestly, not normalized into passes.
- [ ] A separate reviewer reconciles test-case counts, evidence paths, failures, and the final GO decision.
