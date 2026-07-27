---
title: Fix pending trip image preview
status: completed
priority: P1
effort: small
branch: main
tags: [trips, photos, frontend]
created: 2026-07-26
---

# Pending trip image preview

- [x] Prove the broken preview URL contract on trip edit.
- [x] Add a regression test and implement the minimal fix.
- [x] Run affected frontend, lint, build, and context gates.
- [x] Complete independent review and update the task handoff.

Acceptance: a newly selected container/seal image renders from its local
`blob:` URL before save, while persisted storage keys still render through the
authenticated `/api/photos/` route.
