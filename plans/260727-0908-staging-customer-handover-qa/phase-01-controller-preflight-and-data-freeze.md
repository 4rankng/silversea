---
phase: 1
title: Controller Preflight and Data Freeze
status: completed
priority: P1
dependencies: []
---

# Phase 1: Controller Preflight and Data Freeze

## Overview

Establish a reproducible staging baseline, provision the authorized CLERK
identity, allocate read-only fixtures, and release the role sessions only after
health, version, authentication, and data-safety checks pass.

## Requirements

- Verify public site and API health, deployed build identity when exposed,
  current date/time zone, browser version, and clean console/network baseline.
- If no build/version is exposed, fingerprint the fetched HTML, sorted asset
  URLs and hashes, plus stable response headers. Record the fingerprint at the
  start and end of every session; never merge evidence across fingerprints.
- Authenticate all supplied roles in separate contexts. Create one dedicated
  CLERK account through the supported ADMIN UI/API, verify its role, and keep
  its credential only in the secure run context.
- Generate the canonical 483-row manifest: 338 module cases, 23 Q cases, and
  122 expanded module-specific HT cells. Assign every row and route to exactly
  one primary session; cross-role assertions may reference it.
- Allocate a unique run ID and read-only fixture aliases. Inventory existing records
  that must never be modified.
- Decide before execution whether the CLERK account remains available for the
  customer demo or is disabled after QA; record the decision without its secret.

## Session procedure

1. Capture health, landing, login, logout, invalid-login, and session-expiry smoke.
2. Confirm account roles and role-specific home routes without changing data.
3. Select existing read-only prerequisites for trips, shipments, expenses,
   advances, debit notes, salary, fuel, and exports. Do not manufacture missing
   lifecycle states.
4. Publish the manifest, fixture aliases, build fingerprint, privacy rules, and
   exclusive ownership rules to Sessions 02-09.
5. Stop the run if build identity changes, auth becomes unstable, fixtures
   collide, or customer-owned data cannot be distinguished from test data.

## Success Criteria

- [ ] Seven roles authenticate with expected homes and isolated sessions.
- [ ] CLERK provisioning and lifecycle decision are recorded without credentials.
- [ ] All 483 execution rows and every route have one owner and evidence target.
- [ ] Read-only fixture aliases and protected staging records are clearly identified.
- [ ] Preflight report and actual command/browser evidence exist under `reports/` and `qa/`.

## Risks

Parallel work against mutable staging can invalidate results. Freeze the build,
keep business data read-only, and stop if another actor changes a fixture.
