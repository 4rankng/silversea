# Driver document regression follow-up

Scope: local driver journey, trip detail and e-POD screens. No approval flow or offline queue.

## DRV-FOLLOWUP-001 — Document operations obey the current trip state

1. Open an in-transit trip's e-POD screen with both required document types present.
2. Start replacing a document and immediately attempt to complete the trip.
3. Repeat while offline, under an accounting lock, and for a cancelled/completed trip.

Expected: document preparation/upload and completion cannot run concurrently. Offline/locked/finished screens explain why editing is unavailable and keep existing documents readable. Completion is unavailable until any pending document operation finishes.

## DRV-FOLLOWUP-002 — Repeated document selection does not create competing uploads

1. Select a large image for one required document type.
2. While preparation/upload is pending, attempt another selection or camera capture.
3. Make an upload fail, then retry the same file.

Expected: only one document operation runs at a time, including image preparation. The controls show busy feedback immediately. Failure is visible and releases the controls; retrying the same file is possible.

## DRV-FOLLOWUP-003 — Existing driver regression fixtures match the live shell

Run the focused driver suites with the journey month context and current visible text. Preserve behavioral assertions for keyboard navigation, mandatory document gating, note formatting, failure handling, and route identity.

Expected: existing behavioral cases execute against the current page contracts, with no skipped cases or relaxed interaction checks.

Browser coverage is recorded separately by the controller. Unit execution does not claim browser coverage.

## DRV-FOLLOWUP-004 — Cancelled orders cannot be accepted or edited

1. Open a driver-owned trip whose server status is the canonical `TripStatus.CANCELED`, with no acceptance milestone.
2. Inspect the order detail, container section, fuel section and document footer.

Expected: no acceptance button/banner; container and seal are read-only; fuel capture is unavailable; the footer explains cancellation and links only to viewing existing documents. Existing document viewing remains accessible.

## DRV-FOLLOWUP-005 — Tablet document columns share content rows

1. Open an editable e-POD page at 820×1180 with a short first document heading and longer wrapped second heading.
2. Compare the top and bottom edges of both capture/upload action rows and their document rows.
3. Repeat with a read-only completed submission, then at a narrow phone width.

Expected: side-by-side groups share content-sized header/action/file tracks; actions have matching heights with a minimum 44px touch target. No fixed heading height or empty action track in read-only mode. Phone groups remain compact and stacked.
