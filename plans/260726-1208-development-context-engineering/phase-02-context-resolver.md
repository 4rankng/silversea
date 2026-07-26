---
phase: 2
title: Context Resolver
status: completed
effort: ''
priority: P2
dependencies:
  - 1
---

# Phase 2: Context Resolver

## Overview

Provide a machine-readable context manifest and a deterministic local resolver.

## Implementation Steps

1. Add `.codex/context-manifest.json` with focused profiles for product planning,
   backend/API, database, shared contracts, finance, frontend, agent runtime,
   deployment, and documentation.
2. Add `scripts/context-for.mjs` supporting path/keyword inference,
   `--profile`, `--json`, and `--check`.
3. Add root package scripts `context`, `context:check`, and `context:test`.
4. Add Node tests for profile matching, deduplication, explicit profiles,
   no-match behavior, and manifest validation.

## Success Criteria

- [x] Resolver output is deterministic and compact.
- [x] Overlapping profiles merge context and QA without duplicates.
- [x] Invalid/missing manifest references fail `--check`.
- [x] No network, database, or application boot is required.

## Risk Assessment

Over-broad matching would recreate exhaustive context loading. Profiles therefore
use explicit path prefixes, exact paths, and bounded keyword lists.
