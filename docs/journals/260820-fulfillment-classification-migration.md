---
date: 2026-08-20
title: Fulfillment classification migration and Drizzle snapshot tooling
severity: medium
status: focused checks green; broad acceptance pending
---

## Context

`shipment_fulfillments.dispatch_classification` needed a persisted default and
an invariant tying `LCL_SHIPMENT` rows to `LCL`. The change crossed existing
data, migration ordering, the Drizzle schema, and fulfillment creation and
replacement paths, so a cosmetic or application-only fix would have left old
rows and database writes inconsistent.

## What happened

- Custom forward migrations `0027`–`0030` were applied locally in order:
  `0027` backfilled only null classifications to `SINGLE`; `0028` added the
  `SINGLE` default and `NOT NULL`; `0029` corrected legacy LCL rows that had
  become `SINGLE`; and `0030` repeated the correction defensively before adding
  the LCL check constraint.
- The local migration evidence records the sequence applied successfully. The
  resulting invariant is that every `LCL_SHIPMENT` row is classified `LCL`;
  FCL paths persist `SINGLE`.
- Review found no remaining correctness, authorization, concurrency, or data
  integrity blocker. Focused migration checks, backend typecheck, and the
  relevant regression coverage are green.
- Drizzle Kit `0.31.10` has a confirmed snapshot-key generation defect in this
  repository: generated snapshots can retain the old nullable/no-default
  representation even when the SQL and application schema are correct. This
  is a tooling/history defect, not evidence that the applied runtime invariant
  is absent.
- Full-suite and E2E acceptance remain affected by shared database state and
  browser harness failures. Those failures do not invalidate the focused green
  migration evidence, but they do prevent claiming repo-wide acceptance.

## Decisions

- Keep the migrations forward-only and preserve the explicit order: normalize,
  tighten nullability, correct LCL data, then enforce the constraint.
- Treat the database constraint and application schema as joint authorities;
  do not rely on inferred classification in service code alone.
- Do not hand-edit generated or already-applied Drizzle metadata. If duplicate
  generation is needed, create a new reviewed forward migration and verify its
  SQL and snapshot history.
- Report focused QA separately from full-suite/E2E status; shared harness
  failures are unresolved verification limitations, not silently converted to
  product failures.

## Next

- Re-run broad backend and browser QA with isolated/serialized shared DB and
  browser harness state, then save the actual outputs under `qa/`.
- Before any future migration generation, verify Drizzle snapshot keys and
  generated SQL against the live schema and existing migration journal.
- Resolve or document the shared database/browser harness failures before
  release acceptance is declared.
