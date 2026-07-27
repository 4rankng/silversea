# Session 07 — CUSTOMER portal

**Environment:** staging  
**Execution mode:** authenticated browser, read-only

## Result

The CUSTOMER shipment and debit-note empty states render cleanly at desktop,
tablet, 390px, and 320px without horizontal overflow. Two reproducible
customer-handover blockers were found:

1. `/portal/statement` requests `GET /api/portal/statement`, which returns
   HTTP 404. The page shows `Không thể tải sao kê công nợ. Vui lòng thử lại.`
   and disables XLSX/PDF actions at every required viewport.
2. CUSTOMER logout is not functional. Clicking the visible desktop `Đăng xuất`
   control and activating it with the keyboard both leave the authenticated
   session active on `/portal/shipments`. At mobile width, the
   `Mở menu tài khoản` control also remains collapsed after activation.

The statement and logout findings were reproduced by the controller after the
list-only role sweep. They override any earlier aggregate statement that the
CUSTOMER lane had zero network or functional failures.

## Route and viewport matrix

| Surface | Viewports | Result |
|---|---|---|
| `/portal/shipments` empty state | 1440x900, 768x1024, 390x844, 320x568 | PASS |
| `/portal/debit-notes` empty state | 1440x900, 768x1024, 390x844, 320x568 | PASS |
| `/portal/statement` | 1440x900, 768x1024, 390x844, 320x568 | FAIL — API 404 and error UI |
| `/`, `/dashboard`, unknown route | 390x844 | PASS — customer-safe redirect |
| `/trips`, `/users`, `/settings` | 390x844 | PASS — customer-safe redirect |
| Mobile account control | 390x844 | FAIL — remains collapsed |
| Desktop logout | 1440x900 | FAIL — session remains active after pointer and keyboard activation |

The retained screenshots are privacy-scrubbed. The controller visually
inspected the unredacted live render before scrubbing; no credential, session
material, or customer record is stored.

## Fixture-dependent coverage

| Case | Result | Reason |
|---|---|---|
| Own shipment detail | BLOCKED | No CUSTOMER shipment fixture |
| Own debit-note detail and confirm/dispute | BLOCKED | No CUSTOMER debit-note fixture |
| Foreign-ID and document authorization | BLOCKED | No safe own/foreign fixture pair |
| Valid statement export content | BLOCKED | Statement API is 404 and exports are disabled |

No fixture was created because business-data mutation was not authorized.

## Counts

- Route patterns exercised: 9
- Responsive route cells: 18
- PASS: 14
- FAIL: 6
- BLOCKED: 4
- NOT_RUN: 0
- Unexpected network failures: statement API returned HTTP 404 at four
  required viewports

Status: DONE_WITH_CONCERNS  
Summary: CUSTOMER empty states and route isolation are responsive, but statement loading/export and logout/account access fail.  
Concerns/Blockers: Handover NO-GO for the CUSTOMER role until statement and logout/account defects are fixed and re-tested; detail/privacy cases remain fixture-blocked.
