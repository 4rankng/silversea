# QA-AUDIT-WF-06 — history reads do not spend recognition quota

As local ACCOUNTANT rapidly open/filter/reload OCR fuel evidence at390/768/1440.
Expected: history stays accessible even with two recognition slots occupied;
the same persisted list is returned and no429 appears from upstream quota.
Run real HTTP burst history reads and show the existing Redis recognition window
unchanged. A disallowed role remains denied. Recognition POSTs still enforce two
per second. Persist-only storage is outside the upstream quota but retains all
existing auth/file/storage/idempotency checks. Save red429 URL/body, green DOM,
screenshots, driver/query logs. Full backend and E2E gates remain required.
