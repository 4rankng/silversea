---
phase: 1
title: Consolidate navigation and routes
status: completed
effort: small
---

# Phase 1: Consolidate navigation and routes

## Overview

Establish one canonical route and consistent labels without changing
authorization.

## Implementation Steps

1. Add the lazy workspace route at `/advances`.
2. Redirect `/admin/advance-settlements` to
   `/advances?view=settlements`, preserving the source query.
3. Consolidate sidebar, page catalog, search registry, and browser-title copy.
4. Rename `/governance-actions` to `Trung tâm phê duyệt`.
5. Fix focus-query cleanup so it does not erase `view`.

## Success Criteria

- [ ] Canonical and legacy URLs resolve for ADMIN, MANAGER, and ACCOUNTANT.
- [ ] Navigation contains no duplicate settlement destination.
- [ ] Route/search/title labels agree.
- [ ] Focus cleanup preserves unrelated URL parameters.

## Files

- `frontend/src/App.tsx`
- `frontend/src/components/Layout.tsx`
- `frontend/src/data/searchRegistry.ts`
- `frontend/src/hooks/useFocusDeepLink.ts`
- `frontend/src/lib/routes.ts`
- `shared/src/navigation/pageCatalog.ts`

## Rollback

Restore the original page route bindings and navigation entries; no persisted
data migration is involved.
