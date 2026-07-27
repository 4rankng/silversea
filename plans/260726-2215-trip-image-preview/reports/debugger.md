# Trip 95 Pending Container Photo Preview RCA

## Executive summary

Exact symptom: on `https://vantai.tingting.vip/trips/95/edit`, after uploading or capturing a container/seal photo for a newly added unsaved container row, the tile shows the orange `chưa lưu` badge but the thumbnail image is broken.

Expected: while the row is still unsaved, the UI should render the browser `blob:` preview immediately, then swap to the persisted `/api/photos/...` URL after `Lưu cập nhật`.

Actual: the pending `blob:` preview is rewritten to `/api/photos/blob%3A...`, which the backend will never serve, so the `<img>` breaks before the save.

## Minimal reproduction

1. Open `/trips/95/edit`.
2. Add a new container row, or use any row with no server `id` yet.
3. Capture/upload a container or seal photo before clicking `Lưu cập nhật`.
4. Observe the orange `chưa lưu` badge and a broken thumbnail.

## Hypotheses tested

### H1. Backend OCR/upload returned a bad URL

Eliminated.

- `uploadContainerPhoto()` returns a backend `photoUrl` only when both `tripId` and `containerId` exist (`frontend/src/hooks/useTripFormPhotos.ts:177-190`).
- When the row cannot be linked yet, it creates a local browser URL itself with `URL.createObjectURL(file)` and returns that as `pending: true` (`frontend/src/hooks/useTripFormPhotos.ts:191-195`).
- So the broken `blob:` value is client-generated, not returned by `/api/ocr`.

### H2. `/api/photos` auth/token serving is broken

Eliminated for this incident.

- The orange `chưa lưu` badge is only rendered when the stored URL starts with `blob:` (`frontend/src/components/trip/ContainerInstancesCard.tsx:233-270`).
- The `/api/photos` router only accepts persisted storage-key shapes such as `trips/<id>/...`, `expense-photos/...`, `debit-note-templates/...`, or `company-assets/...`; anything else returns `400 Đường dẫn ảnh không hợp lệ` (`backend/src/routes/upload.ts:343-363`).
- A pending preview should never hit `/api/photos` at all.

### H3. The pending `blob:` preview is being rewritten incorrectly before render

Confirmed.

- `handleCapture()` stores the returned `url` directly into `row.photoKeys` (`frontend/src/components/trip/ContainerInstancesCard.tsx:305-320`).
- `renderPhotoLane()` correctly detects that value as pending via `u.startsWith("blob:")`, shows `chưa lưu`, but still renders `<img src={photoSrc(u)} />` (`frontend/src/components/trip/ContainerInstancesCard.tsx:232-270`).
- Pre-fix `photoSrc()` in `HEAD` rewrites every non-empty, non-`/api/photos/` value into `/api/photos/${encodeURIComponent(value)}` (`frontend/src/lib/api/photo.ts` in `HEAD`, lines 36-39).
- Direct evaluation of that logic on July 26, 2026 21:47 SGT produced:
  `/api/photos/blob%3Ahttps%3A%2F%2Fvantai.tingting.vip%2Fpreview-id`
- That path is invalid for the backend photo router, so the thumbnail cannot load.

## Timeline / code path

1. User captures a photo on trip edit for a row that has no `containerId` yet.
2. `uploadContainerPhoto()` intentionally does **not** persist to the server, to avoid orphan trip-level photos; it returns a local `blob:` URL instead (`frontend/src/hooks/useTripFormPhotos.ts:166-195`).
3. `ContainerInstancesCard` stores that `blob:` URL in `row.photoKeys` and marks it pending (`frontend/src/components/trip/ContainerInstancesCard.tsx:233-270`, `305-320`).
4. The same component calls `photoSrc(u)` for the `<img>` element (`frontend/src/components/trip/ContainerInstancesCard.tsx:245-251`).
5. Pre-fix `photoSrc()` rewrites the `blob:` value into `/api/photos/blob%3A...` (`frontend/src/lib/api/photo.ts` in `HEAD`, lines 36-39).
6. `/api/photos` rejects that path shape (`backend/src/routes/upload.ts:343-363`), so the browser shows a broken image.

## Root cause

Root cause: the shared frontend helper `photoSrc()` assumed every renderable photo reference was either a persisted storage key or an existing `/api/photos/...` URL. That assumption became false once the trip form started storing unsaved per-container previews as browser `blob:` URLs.

Evidence chain:

- Pending unsaved row photos are a supported state: `ContainerFormRow.photoKeys` explicitly allows in-flight `blob:` previews and documents that `photoSrc()` should render both (`frontend/src/hooks/useTripFormState.ts:54-58`).
- The pending row path is intentional in edit/create flows: `uploadContainerPhoto()` buffers when `containerId` is missing (`frontend/src/hooks/useTripFormPhotos.ts:166-195`).
- The rendering component recognizes the pending state but still routes it through `photoSrc()` (`frontend/src/components/trip/ContainerInstancesCard.tsx:233-270`).
- Pre-fix `photoSrc()` has no `blob:` passthrough and rewrites the value into an impossible `/api/photos/...` path (`frontend/src/lib/api/photo.ts` in `HEAD`, lines 36-39).

## Why now / exposure condition

This bug is latent in `photoSrc()`, but it only becomes visible when the caller passes a local browser object URL.

Exposure condition:

- Trip exists, but the container row does not have a saved `containerId` yet.
- User uploads/captures a container or seal photo before clicking `Lưu cập nhật`.
- The UI stores `blob:` in `photoKeys` and immediately renders it.

That is why the screenshot includes the orange `chưa lưu` badge: the failing case is specifically the unsaved-row preview path, not persisted photo serving.

## Blast radius

Current confirmed impact:

- `frontend/src/components/trip/ContainerInstancesCard.tsx` on trip create/edit flows for unsaved container/seal row photos.

Not currently implicated:

- `frontend/src/pages/config/CompanyInfoConfigPage.tsx` also uses the shared `photoSrc()` helper, but only with persisted logo storage keys.

Latent related risk:

- `frontend/src/components/trip/DriverContainerCard.tsx:84-87` duplicates the same non-`blob:` assumption locally. I found no evidence in this task that the driver flow currently feeds it `blob:` URLs, but it would fail the same way if a pending local-preview path is introduced there later.

## Smallest testable fix

Frontend-only fix:

- In `frontend/src/lib/api/photo.ts`, return `value` unchanged when it starts with `blob:`.
- Keep the existing persisted-key behavior for storage keys and `/api/photos/...` URLs.
- Add/keep a focused unit test that asserts:
  - `photoSrc('blob:...') === 'blob:...'`
  - `photoSrc('trips/95/container-image.jpg') === '/api/photos/trips%2F95%2Fcontainer-image.jpg?token=...'`

No backend change is needed.

## Current worktree evidence

The local worktree already contains exactly that smallest fix in `frontend/src/lib/api/photo.ts` and a focused test in `frontend/src/lib/api/photo.test.ts`.

Verification run:

- `cd frontend && pnpm vitest run src/lib/api/photo.test.ts`
- Result on July 26, 2026 21:46 SGT: `1` test file passed, `2` tests passed.

## Unresolved questions

None for this incident. The production symptom is fully explained by the client-side `blob:` rewrite.

Status: DONE
Summary: Broken pending thumbnail on `/trips/95/edit` is caused by `photoSrc()` rewriting unsaved `blob:` previews into invalid `/api/photos/blob%3A...` paths. The smallest fix is a `blob:` passthrough guard in `frontend/src/lib/api/photo.ts`; the current local worktree already contains that fix plus a passing targeted test.
Concerns/Blockers: The fix appears to be present only in the current local worktree diff, so production will remain broken until that diff is reviewed and shipped.
