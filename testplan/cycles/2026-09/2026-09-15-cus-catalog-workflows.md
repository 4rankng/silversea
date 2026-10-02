# CUS catalog workflow corrections

Scope: CUS and dispatcher customer/route catalog frontend. Browser validation is owned by the root agent; no automated tests, lint, typecheck or build are requested for this pass.

## CAT-SEARCH-01 — Preserve server customer search matches
1. Open `/config/customers` as CUS.
2. Search a customer's short name, phone suffix or contact person's name that does not occur in its full name/MST.
3. Expect the matching customer to remain visible. Clear search and confirm the full list returns.

## CAT-SORT-01 — Every visible customer sort header works
1. Open `/config/customers` with at least two distinct values for each visible column.
2. Click each sortable header twice: full name, short name, customer code, tax code, address, contact person, phone, accountant name/phone, contact information and the two payment terms.
3. Expect ascending then descending ordering by that column's displayed value, with absent values last and numeric terms ordered numerically.

## CAT-CLEAR-01 — Clearing optional identity fields persists
1. Edit a customer containing MST, contact person, phone, other contact information and accountant name/phone.
2. Clear those optional fields; keep the required name. Save.
3. Reopen the record and reload the page. Expect all cleared fields to remain empty and unrelated fields unchanged.

## CAT-ERROR-01 — Customer save errors remain visible in the dialog
1. Add or edit a customer using a name/MST already used by another customer.
2. Save; expect the server error inside the open dialog near its save action and entered values preserved.
3. Correct and retry, or cancel and reopen another record. Expect the previous error cleared when starting a new operation.

## CAT-ERROR-02 — Route save errors remain visible in the dialog
1. Add/edit a route with an existing route code or another rejected value.
2. Save; expect the server error inside the dialog, with form values retained.
3. Correct/retry or cancel/reopen. Expect no stale error from the previous operation.

Verification status: CODE-READ ONLY until root browser evidence is recorded. No browser or automated commands were run by the catalog subagent.
