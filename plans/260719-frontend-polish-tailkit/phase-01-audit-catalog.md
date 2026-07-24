---
phase: 1
title: Audit & catalog
status: completed
priority: P2
effort: 3h
dependencies: []
---

# Phase 1: Audit & catalog

## Overview

Build a side-by-side map: every existing NEPO UI primitive ↔ its Tailkit nearest-neighbor ↔ a keep/upgrade verdict. Output is a single markdown artifact; no production code changes.

## Requirements

- **Functional:** produce `audit.md` (in plan dir) with one section per primitive family.
- **Non-functional:** every verdict cites concrete Tailkit identifiers and concrete NEPO file:line refs. No hand-wavy "looks nicer".

## Architecture

No code changes. Uses Tailkit MCP tools + Read/Grep on the frontend. Deliverable is markdown only.

## Related Code Files

- Read: `frontend/src/components/UI.tsx`
- Read: `frontend/src/components/shared/` (all 16 files)
- Read: `frontend/src/design-system/` (DataTable, Pagination, EmptyState, forms/, hooks/)
- Read: `frontend/src/components/ui/` (DropdownMenu, Select)
- Read: `frontend/src/styles/tokens.css`, `base.css`, `utilities.css`
- Create: `plans/260719-frontend-polish-tailkit/audit.md`

## Implementation Steps

1. **Inventory NEPO primitives.** List every export from `components/UI.tsx`, `components/shared/index.ts`, `design-system/index.ts`, and `components/ui/`. Capture props, file:line, and a screenshot-in-words (what does it look like today).

2. **Find Tailkit nearest-neighbors.** For each NEPO primitive, run `mcp__tailkit__search_components` with 2-3 query variants. Pick the closest 1-2 Tailkit identifiers. Use `browse_catalog` for systematic coverage of: `statistics`, `empty-states`, `cards`, `tables`, `alerts`, `badges`, `buttons`, `forms`, `navigation`, `feedback`.

3. **Score the gap.** For each pair, assign one of:
   - `KEEP` — NEPO version is at parity or better. No action.
   - `UPGRADE` — Tailkit version has a real improvement (better a11y, responsive behavior, micro-interaction, empty/loading state). Candidate for Phase 4.
   - `MISSING` — NEPO has no equivalent and the gap matters (e.g. skeleton states, toast variants, command palette, data-table column visibility).
   - `N/A` — Tailkit has no equivalent (e.g. PlateTag, LocationAutocomplete, Money formatter — domain-specific).

4. **Capture tokens vs palette.** Note every Tailkit snippet that uses hardcoded `bg-gray-*` / `text-slate-*` / `dark:` so Phase 3 knows the retokenization surface upfront.

5. **Write `audit.md`.** One table per family. Include the Tailkit identifier, the NEPO file:line, the verdict, and a one-line rationale.

6. **Demo the MCP for the user.** Run 2-3 `get_component_code` calls live so the user sees what the tooling returns. This is part of the deliverable — the user asked "see how" the MCP helps, so showing the workflow matters.

## Success Criteria

- [ ] `audit.md` exists and covers all 30+ NEPO primitives across the four layers.
- [ ] Every `UPGRADE` / `MISSING` verdict has a concrete Tailkit identifier attached.
- [ ] Tailkit usage of Tailwind v3 palette classes is flagged for Phase 3 retokenization planning.
- [ ] User has seen at least one live `mcp__tailkit__get_component_code` call and the returned shape (HTML/React).

## Risk Assessment

- **Risk:** audit becomes an exhaustive 200-row spreadsheet that nobody reads. *Mitigation:* cap at the ~30 NEPO primitives; skip Tailkit subcategories that have no NEPO analog.
- **Risk:** Tailkit search relevance is uneven (e.g. "data table with filters" returned zero hits). *Mitigation:* fall back to `browse_catalog` category-by-category when search misses.
