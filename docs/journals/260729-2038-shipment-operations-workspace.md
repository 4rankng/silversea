# Shipment operations workbook workflow landed, then the docs page bit back

**Date**: 2026-07-29 20:38
**Severity**: High
**Component**: Shipment operations workflow, clerk dossier editor, browser QA
**Status**: Resolved

## What Happened

We turned the customer’s spreadsheet-driven shipment workflow into an in-app flow: shipment search now runs server-side, shipment create/update surfaces the new operational fields, the register exposes admin/manager actions, and the clerk dossier can now persist the additional planning data. That part is done.

The messy part was verification. The first browser QA path wasted time on a fragile login script that kept failing on Puppeteer selector behavior, then on a manual list-page assumption that there would always be a shipment row to click. The real fix was to stop pretending the UI login mattered for QA and seed a real JWT through the auth API, then navigate the real routes.

An adversarial review also found a genuine bug: the clerk dossier could not actually clear `cargoMode` back to unknown. The UI offered `— Chưa xác định —`, but the save payload dropped `cargoMode` entirely and left stale LCL data behind. That is exactly the kind of bug that makes a “successful” save lie to the user.

## The Brutal Truth

The frustrating part is that the implementation looked finished until the review forced a second look. We nearly shipped a form that told the user it had cleared the cargo mode while the database would still have kept the old LCL values. That is the kind of bug that turns “workflow automation” into expensive data rot.

## Technical Details

- Added shipment planning fields through schema, migration, service, route, and shared schema layers.
- Full backend suite now passes: `1860` tests, `363` suites.
- Browser QA now passes for authenticated admin/manager/accountant flows.
- Review found one real issue in `ClerkShipmentDocsPage.tsx`: empty cargo mode was omitted from `updateShipment`, so clearing to unknown did not persist.

## What We Tried

- Direct login-form automation in Puppeteer.
- Clicking through the shipments list for detail access.
- Reusing the same payload shape for FCL/LCL/unknown modes.

All three were wrong in different ways. The login script was brittle, the list-page assumption was false in the QA environment, and the payload shape needed explicit nulls for the cleared state.

## Root Cause Analysis

We trusted the visible UI state instead of the persisted contract. The save path for `cargoMode` was written as if “empty” meant “omit it,” but the actual domain requirement was “clear it to null and clear the dependent LCL fields too.”

## Lessons Learned

- If a form offers a clear/unknown state, the save path must carry that state explicitly.
- Browser QA should use the app’s auth contract, not a brittle form automation path, when the goal is route and role verification.
- Reviews that find one real contract bug are worth more than a hundred green screenshots.

## Next Steps

- Keep the clear-path regression test in place.
- Watch for search performance on production-sized shipment data.
- If the shipment workbook expands again, re-run the same end-to-end contract review before broadening the workflow.
