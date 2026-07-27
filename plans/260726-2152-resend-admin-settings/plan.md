---
title: Admin-managed Resend email credential
description: >-
  Move the Resend delivery credential from process environment configuration to
  encrypted ADMIN-managed application settings.
status: in-progress
priority: P2
branch: main
tags:
  - feature
  - frontend
  - backend
  - api
blockedBy: []
blocks: []
created: '2026-07-26T13:52:57.409Z'
createdBy: 'ck:plan'
source: skill
---

# Admin-managed Resend email credential

## Overview

Add a write-only Resend credential panel to the existing ADMIN application
settings page. Persist the key under `email.resend_api_key`, encrypt it with the
existing settings-secret utility, and resolve it at send time through a
race-safe cache. Remove `RESEND_API_KEY` as an email runtime source while
retaining sender name/address environment configuration.

Implementation is complete. Phase 3 remains in progress because the full E2E
gate is still red on an unrelated concurrent ADMIN unknown-route redirect
contract, while backend 1,413/1,413, root lint, full frontend 298/298, build,
focused API checks, manual browser QA, and review are green.

## Acceptance Criteria

- ADMIN can configure, replace, and explicitly clear the Resend API key.
- API responses expose configuration state and a masked suffix, never plaintext.
- Blank input preserves the current key; clear is explicit and confirmed.
- The next email attempt uses the saved value without process restart.
- Production without a configured key records a failed attempt; development and
  tests may retain console simulation.
- Existing portal work and unrelated dirty files remain untouched.
- Affected lint, typecheck, tests, build, manual responsive QA, review, and
  context checks have artifacts under `qa/`. The feature-specific checks are
  green; landing remains blocked by a concurrent ADMIN unknown-route E2E
  failure outside this task's files.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Credential contract and runtime](./phase-01-credential-contract-and-runtime.md) | Completed |
| 2 | [Admin settings UI](./phase-02-admin-settings-ui.md) | Completed |
| 3 | [Closed-loop QA and handoff](./phase-03-closed-loop-qa-and-handoff.md) | In Progress |

## Dependencies

No blocking cross-plan dependency. The active customer-portal and trip-photo
plans touch different owned files; this task avoids their modified routing and
navigation files.
