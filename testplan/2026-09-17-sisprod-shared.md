# Production UI audit regressions

Run locally against the latest production source. Capture post-click screenshots,
DOM assertions and the browser driver log under `qa/2026-09-17-sisprod/root`.

## SIS-001 — Calendar year boundary

As Admin or Accountant, open Salary, choose January 2026 in the topbar month
picker, then click Previous month. Expect December 2025 in both the topbar and
salary heading/API period. Click Next: expect January 2026. Repeat under React
StrictMode and check rapid multiple steps and December-to-January rollover.
No data writes are expected. Baseline local browser reproduced December 2024.

## SIS-002 — Notification mutation failure and recovery

As a user with unread notifications, open Notifications and click Read all while
the request is locally forced to fail before reaching the API. Expect an
accessible error, unchanged unread entries, and an enabled retry action. Restore
the network and retry: unread count and entries update from the API. Repeat using
the topbar notification panel. A failed single mark-read action followed by a
successful mark-all must clear the earlier error. Record the local notification IDs and
read state; never run this fault-injection check against production.

## SIS-003 — Notification pagination recovery

Load a notification feed with more than one page, then fail the next-page request.
Already-loaded notifications remain visible, an error is announced and Load more
can be retried. Restore the network and retry. No duplicate entries or blank feed.
Also fail a background refresh: retain existing entries, announce that the data
may be stale and offer explicit retry; clear the error after successful refresh.

## SIS-004 — Service outage preserves authentication

Trigger a 503 on an authenticated data request in the local browser, then restore
the service and retry. The session token remains, the page does not redirect to
login and the same session loads data after recovery. Backend real dependency
failure coverage and invalid-token denial are recorded separately in
`2026-09-17-auth-dependency-outage.md`.
