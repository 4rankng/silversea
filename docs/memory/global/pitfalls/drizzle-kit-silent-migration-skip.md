---
name: "drizzle-kit-silent-migration-skip"
description: "Contains the drizzle-kit 0.31.10 silent-exit-1 migration-skip trap: symptom (0066 applies, 0067 silently skipped, no diagnostics), the G-mig post-migrate journal-hash check (2d8af75377), prod hand-patch = user approval, fix path"
folder: "global / pitfalls"
tags: ["drizzle", "migrations", "deploy-gate", "staging", "prod"]
updatedAt: "2026-09-10T14:07:17.409Z"
author: "Project Manager (pm)"
---

# Drizzle-kit silent migration skip (0.31.10)

## Symptom
`drizzle-kit migrate` (drizzle-kit **0.31.10**) hits migration 0067, **silently exits 1** — no diagnostics, no error text. 0066 applies; **0067 is skipped without any output**. SQL verified clean by applying it manually via psql.

## Incident
Found 2026-09-10 ~21:57 +07 by the backend agent during the chunk-7 approval-removal wave: local DB was missing 0067 (`__drizzle_migrations` lacked hash `2d8af75377`). Applied manually (psql + journal row) after backup `/tmp/silversea-db-backups/pre-0067-215730.dump`.

## Detection (mandatory post-migrate check, wave ruling G-mig)
After every `make demo` / `make deploy` migrate step, verify the DB actually contains the newest migration:
```sql
SELECT hash FROM drizzle.__drizzle_migrations WHERE hash = '2d8af75377';  -- 0067
```
Read-only. Staging: before QA handoff. Prod: after cutover, alongside the bare `GET /api/health`. If missing → HARD STOP, escalate to pm; on prod NEVER hand-patch (journal-row insert = prod DB write requiring the USER's explicit approval, obtained via pm).

## Why it's dangerous
- Exit code 1 with no stderr — scripts/gates reading only "command didn't crash" or grepping for error text see nothing.
- The next migration stays unapplied while everything else looks deployed; schema-dependent features then fail in ways that look like code bugs (e.g. TC-007 staging would fail on missing swept-pending state, not on migration).
- Related but DISTINCT mechanism from the renumber/content-hash trap in [[main-prod-merge-readiness]] (that one re-applies or skips on hash match of renumbered files; this one silently aborts mid-batch).

## Fix path
Manual: psql apply 0067 + insert `__drizzle_migrations` journal row, backup first. Structural: upgrade drizzle-kit past 0.31.10 and re-verify `make migrate` applies 0067 cleanly on a scratch DB — treat any future silent-exit as a red gate. See [[testing-and-deploy-environments]] for deploy rails.
