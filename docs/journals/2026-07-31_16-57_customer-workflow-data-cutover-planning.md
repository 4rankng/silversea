# Customer cutover planning exposed a split between app state and source truth

**Date**: 2026-07-31 16:57
**Severity**: High
**Component**: Customer workflow alignment and local/staging data cutover
**Status**: Blocked

## What Happened

We finished the planning pass for the customer workflow and data cutover, and the verdict is blunt: the app is only partially aligned with the customer’s operating chain. The source folder is not a clean production seed. It is a mix of template workbooks, demo accounting data, and contract variants that do not agree on core settlement rules.

The plan now treats contract text as the authority for payment, acceptance, detention, and dispute timing; workbook rows are only domain inventory unless they are explicitly approved. The cutover also has to preserve the control plane exactly as-is: user identities, credentials, roles, status, access links, and all user-owned rows stay intact by default. Only rows explicitly listed in an approved, environment-specific disposition manifest may be replaced, and `user_shipment_links` must be rebuilt against the new shipment IDs. Sequence reuse is off the table.

## The Brutal Truth

This is the kind of planning that feels tedious until you realize how easy it would be to wreck the customer’s live access or silently corrupt finance history. The frustrating part is that the app looks close on paper, but the sources are messy enough that a lazy import would have been wrong in three different ways at once. We are not “cleaning up demo data”; we are separating authority from noise, and that is slower because it has to be correct.

## Technical Details

- The source audit shows the workbook family is mixed: templates, demo rows, and report surfaces, not one authoritative seed set.
- The contract samples conflict on payment term, detention threshold, and explicit versus deemed acceptance, so contract versioning has to be per customer.
- The plan requires immutable preservation of existing user accounts, user-owned rows, and business-unit/driver access, with only approved customer mapping changes.
- `user_shipment_links` must be rebuilt after shipment IDs change.
- Staging cutover needs a separate go/no-go, a tested backup restore, and a verified rollback path before any maintenance window is approved.
- The next dependency is `plans/260730-2232-customer-service-finance-workflow/`; that blocker stays real until its decision gates close.

## What We Tried

- Read the active plan, phase files, and both research reports.
- Compared the planned cutover against the current app and source inventory.
- Traced which data must be preserved versus rebuilt.

None of that produced a shortcut. It just confirmed that a safe cutover is a controlled sequence, not a reset button.

## Root Cause Analysis

The root problem is source ambiguity. The customer materials do not form a single canonical dataset, and the app currently mixes “implemented enough for workflow” with “not yet authoritative for cutover.” If we had tried to move faster, we would have imported sample logic as truth and stranded preserved accounts.

## Lessons Learned

- Never treat demo accounting rows as production history.
- Never assume one contract version fits every customer.
- Never rebuild business data without an explicit preservation contract for users, links, and history.
- Never touch staging before local restore/reconciliation is proven first.

## Next Steps

- Close the upstream customer-service/finance decision gates first.
- Build the source manifest and workflow coverage matrix.
- Design the dry-run import and preservation tooling before any destructive action.
- Rehearse restore locally, then ask for a separate staging go/no-go.
