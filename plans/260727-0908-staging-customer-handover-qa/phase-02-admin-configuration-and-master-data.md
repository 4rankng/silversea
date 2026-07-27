---
phase: 2
title: ADMIN Configuration and Master Data
status: completed
priority: P1
dependencies:
  - 1
---

# Phase 2: ADMIN Configuration and Master Data

## Overview

Run the ADMIN visual lane across the global shell, configuration catalog,
master data, user administration, audit, monitoring, and direct-only config
routes. This session is read-only; form checks use transient unsaved input.

## Coverage

- Shell: `/`, `/dashboard`, unknown route, profile/password dialog, logout,
  sidebar/drawer, notifications, all visible navigation.
- ADMIN-only: `/users`, `/audit-logs`, `/chatbot-monitoring`,
  `/config/app-settings`, `/config/faq-entries`.
- Config and master data: every `/config/*` route in the route inventory,
  including direct-only fuel norms, weight tiers, lift pricing, ancillary
  revenue, templates, truck owners, tire positions, company and finance config.
- PRD focus: M2 configuration, M6 suppliers/AP master data, M12 fuel norms, and
  cross-cutting HT-01/02/05/06/07/09.

## Session procedure

1. Capture every route at the three standard viewports and ADMIN home at 320px.
2. Verify search/filter/paging, form labels, validation, cancel/dirty guards,
   masks for write-only secrets, and role-appropriate actions.
3. Open create/edit/delete flows using transient inputs but do not persist or
   delete shared records in this session.
4. Test representative unauthorized API/direct URLs later in Session 09; here,
   record the ADMIN positive surface and network/console cleanliness.

## Success Criteria

- [ ] Every ADMIN and config route has route, viewport, state, and screenshot evidence.
- [ ] No credential, secret, or private payload appears in UI, logs, or screenshots.
- [ ] No horizontal overflow, hidden primary action, unreadable table/card, or broken dialog.
- [ ] Direct-only configuration pages are not omitted from the matrix.

## Risks

Configuration writes have broad blast radius. Without separate explicit
authorization, every save/reload/create/delete case is `NOT_RUN` with reason
`MUTATION_NOT_AUTHORIZED`; it is not queued implicitly for Session 09.
