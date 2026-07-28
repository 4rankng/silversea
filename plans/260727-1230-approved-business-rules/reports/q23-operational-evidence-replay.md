# Q23 operational evidence replay

Date: 2026-07-28

Status: DONE

## Scope

- `POST /api/upload/company-logo`
- `POST /api/upload`
- `POST /api/upload/trips/:tripId/photos/:type/delete`
- `POST /api/ocr`
- `POST /api/ocr/persist-only`
- `POST /api/geotag`

## Result

Every scoped material write now requires an `Idempotency-Key`. The key and a
canonical payload that includes the uploaded file hash are persisted through
`runIdempotent()`. Exact replays return the original response, while reusing a
key with changed bytes or metadata returns `409`.

Upload storage names are deterministic from the endpoint, actor, and command
key. This closes the external-storage/database crash window: a retry converges
on the same object name and existing `trip_photos` row instead of creating a
second object or row. Photo deletion locks and removes the database row once,
then performs best-effort external deletion; the saved command result handles
an exact retry without a second mutation.

Geotag writes execute inside the idempotency transaction. OCR capture and
persist-only calls reuse the deterministic photo identity, and exact replay
does not repeat recognition or persistence.

## Verification

- Focused backend test: 8/8 passed.
- Backend typecheck: passed.
- Changed-file lint: passed.
- Evidence:
  - `qa/2026-07-28_q23-operational-evidence_backend-test.log`
  - `qa/2026-07-28_q23-operational-evidence_backend-typecheck.log`
  - `qa/2026-07-28_q23-operational-evidence_lint.log`

## Boundary

This closes the upload, OCR, and geotag class. It does not by itself prove
universal Q23 coverage for every material mutation in the 204-endpoint
inventory.
