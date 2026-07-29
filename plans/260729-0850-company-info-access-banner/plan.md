---
title: Company info access and dashboard reminder
status: in_progress
priority: P1
effort: small
branch: main
tags: [company-info, dashboard, rbac, frontend]
created: 2026-07-29
---

# Company info access and dashboard reminder

- [x] Trace company-info persistence, frontend routing, backend RBAC, and dashboard composition.
- [x] Add explicit office-role route coverage for the company-info page.
- [x] Show an actionable dashboard warning while company information is not configured.
- [ ] Run all affected QA gates and independent review.
- [ ] Update the task handoff with verified results.

Current blocker: the latest broad frontend rerun still has an unrelated
`ShipmentsPage.test.tsx` failure, and the latest E2E rerun hit backend
connection refusals during suite startup.

Acceptance: ADMIN, MANAGER, and ACCOUNTANT can open and submit company-info
changes through the existing governed save flow; the office dashboard shows a
non-dismissible setup warning until every schema-required company field has a
non-blank persisted value, including on seeded installs whose blank placeholder
rows already have timestamps.
