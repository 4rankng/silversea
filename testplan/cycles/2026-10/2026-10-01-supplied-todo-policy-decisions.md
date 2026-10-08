# Supplied TODO policy decisions

Current owner decision2026-10-01: preserve the existing policies below. These
cases resolve proposed product changes; they do not require adding an action.

## QA-AUDIT-POLICY-220 — CUS fee catalog stays restricted

Open the shipment debit workspace as CUS. Expected: no forbidden quotation-fee
catalog request and no invented fee-price columns. A direct request to the
restricted catalog returns403; authorized roles retain their existing access.
Keep detail/export permissions separate from catalog permissions. Capture the
actual workspace and request log before claiming UI DRIVEN.

## QA-AUDIT-POLICY-245 — trip fields remain nonnegative

Enter a negative trip quantity, rate or allowance. Expected: the existing
validation rejects it without persisting the draft. Valid nonnegative values
retain their current rules. This decision does not change the separate signed
expense-row contract: negative rows remain visible and excluded from sums.
API/schema execution and actual form entry require separate evidence labels.

## QA-AUDIT-POLICY-252 — create DRAFT, then progress

Create a shipment using the existing supported form. Expected: creation uses
DRAFT, permits the currently supported partial record and progresses through
the existing readiness/ledger/fulfillment flow. There is no new SUBMIT button
or internal approval gate. Existing creation, invalid-submit and later
progression assertions remain; a read-only screen capture is not creation
or material progression proof.
