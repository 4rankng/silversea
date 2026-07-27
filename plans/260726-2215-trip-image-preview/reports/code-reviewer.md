# Code Review — Pending Trip Image Preview

## Verdict

**APPROVED**

No critical, high, medium, or low findings in the scoped photo helper/test diff.

## Scope

- Reviewed:
  - `frontend/src/lib/api/photo.ts`
  - `frontend/src/lib/api/photo.test.ts`
- Traced, but unchanged by this task:
  - `frontend/src/hooks/useTripFormPhotos.ts`
  - `frontend/src/components/trip/ContainerInstancesCard.tsx`
  - `frontend/src/hooks/use-trip-form-submit.ts`
  - all shared `photoSrc` consumers
- Excluded from attribution: concurrent customer-portal, `App.tsx`, and other unrelated worktree changes. Those changes are moving during this review and currently break broader build/typecheck checks; they are not caused by this photo fix.

## Findings by severity

### Critical

None.

### High

None.

### Medium

None.

### Low

None.

### Informational

- `useTripFormPhotos` has no hook-unmount cleanup for pending object URLs. Existing paths do revoke them when a photo is removed or replaced, a row is removed, or pending photos are flushed after save (`useTripFormPhotos.ts:116-126`, `134-153`, `207-258`; `ContainerInstancesCard.tsx:180-183`, `307-309`, `370-377`). Navigation away with unsaved pending photos can therefore retain the underlying blobs until the document unloads. This lifecycle gap predates the scoped diff and is not a reason to block the resolver fix.
- `DriverContainerCard.tsx` contains a separate local `photoSrc` implementation. It is not an importer of the changed shared helper and its current server-backed flow does not receive the trip form's pending object URLs. It is therefore outside this fix's blast radius.

## Spec and root-cause check

The implementation fixes the root contract violation rather than hiding the broken-image symptom:

1. For an unsaved container row, `uploadContainerPhoto` intentionally creates and returns a browser object URL (`useTripFormPhotos.ts:170-195`).
2. `ContainerInstancesCard` stores that URL, recognizes it as pending, and passes it through the shared `photoSrc` resolver for both thumbnail and lightbox rendering (`ContainerInstancesCard.tsx:208-273`, `288-320`).
3. The previous resolver treated every non-`/api/photos/` string as a persisted storage key, producing `/api/photos/blob%3A...`.
4. The new `blob:` guard preserves the already-renderable local URL. It does not alter the existing persisted storage-key or `/api/photos/...` branches.

This matches the plan acceptance criterion: pending images render locally before save, while persisted storage keys continue through the authenticated photo route.

## Caller and trust-boundary review

- `ContainerInstancesCard`: gains the intended pending preview behavior for thumbnail and lightbox URLs.
- `CompanyInfoConfigPage`: supplies a persisted logo storage key; behavior is unchanged.
- Trip-detail `ContainersCard`: supplies persisted container/seal keys; behavior is unchanged.
- Persisted references still call `getAuthenticatedPhotoUrl`, so the existing JWT query-token behavior remains intact.
- A `blob:` URL is browser-local and is not sent through the protected photo endpoint. The new branch neither bypasses backend authorization for persisted photos nor exposes the JWT.
- The change adds no async work, shared mutable state, database calls, API shape changes, or exported type changes. No race, N+1, schema, or backwards-compatibility issue was found.

## Test adequacy and verification

The focused test covers both sides of the changed contract:

- a pending `blob:` URL is returned byte-for-byte unchanged;
- a persisted storage key is encoded and receives the cached auth token.

Fresh verification:

```text
Command: cd frontend && pnpm vitest run src/lib/api/photo.test.ts
Result: PASS — 1 file, 2 tests
```

The test is appropriately scoped to the pure resolver where the regression occurred. A component test would duplicate React wiring without providing stronger evidence for this one-branch contract fix.

Broad build/typecheck results are intentionally not used to judge this diff because unrelated concurrent portal/App changes currently break those gates. The controller must still close the repository-required QA loop once the concurrent worktree is stable.

## Scope-creep check

The scoped implementation consists of the `blob:` passthrough, its contract comment, and one focused test file. No backend, hook, component, authentication, or persistence behavior was changed.

Status: DONE
Summary: The one-line `blob:` passthrough corrects the proven resolver contract violation, preserves authenticated persisted-photo behavior, and is covered by a passing focused regression test. Verdict: APPROVED.
Concerns/Blockers: No blocker in the scoped diff. Broader gates remain the controller's responsibility after unrelated concurrent frontend changes stabilize.
