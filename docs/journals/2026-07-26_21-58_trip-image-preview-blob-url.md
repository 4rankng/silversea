# Trip Preview `blob:` Rewrite Broke Unsaved Thumbnails

**Date**: 2026-07-26 21:58
**Severity**: Medium
**Component**: Frontend trip photo preview
**Status**: Resolved locally, not deployed

## What Happened

On trip create/edit, an unsaved container or seal row showed the orange `chưa lưu` badge, but the thumbnail image was broken immediately after upload/capture. The intended behavior was simple: keep the browser `blob:` preview visible until the row is saved, then switch to the persisted `/api/photos/...` URL.

## The Brutal Truth

This was a dumb assumption in a shared helper. We already had a valid local preview URL, and then we mangled it into a path the backend would never serve. The UI even told us the row was unsaved, which made the breakage more obvious and more embarrassing.

## Technical Details

`frontend/src/lib/api/photo.ts` treated every non-empty value as a persisted storage key unless it already started with `/api/photos/`. That meant a pending browser URL like `blob:https://...` became `/api/photos/blob%3Ahttps%3A...`, which the photo route cannot resolve. The regression was reproduced in the targeted frontend test before the fix and then verified again after the fix.

QA evidence:

- `qa/2026-07-26_trip-image-preview_frontend-test.pre-fix.log`
- `qa/2026-07-26_trip-image-preview_frontend-test.rerun.log`
- `qa/2026-07-26_trip-image-preview_frontend-test.final2.log`
- `qa/2026-07-26_trip-image-preview_typecheck-frontend.final.txt`
- `qa/2026-07-26_trip-image-preview_lint.final.txt`
- `qa/2026-07-26_trip-image-preview_build.final.log`
- `qa/2026-07-26_trip-image-preview_review.md`
- `qa/2026-07-26_trip-image-preview_manual.md`
- `qa/2026-07-26_trip-image-preview_context-check.log`

## What We Tried

We traced the preview path from the trip form into the shared photo helper, confirmed the unsaved row path intentionally stores a local `blob:` URL, and verified that backend photo serving was not the problem. The minimal fix was to add a `blob:` passthrough in `photoSrc()` and leave persisted storage keys on the authenticated photo route.

## Root Cause Analysis

The root cause was a broken abstraction boundary. `photoSrc()` was written for persisted photo references and later reused for temporary browser object URLs without adding a `blob:` case. That made the helper rewrite valid preview state into an invalid API path.

## Lessons Learned

Shared URL helpers need explicit branches for temporary client-only state. If a component can hold both unsaved preview data and persisted storage keys, the tests must cover both cases. Also, QA has to stay honest about concurrent work: broad gates can be red because other files are moving, so the red artifact and the green rerun both matter.

## Next Steps

Ship the local fix through the normal release process when authorized. This task is complete in the repo, but it is not deployed yet, and it should not be described as production-shipped until that actually happens.
