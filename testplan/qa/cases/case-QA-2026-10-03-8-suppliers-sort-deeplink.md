# Case QA-2026-10-03-8 — /suppliers honors the URL sort pair on load (freeze-halting small)

- **Case ID:** QA-2026-10-03-8
- **Reported:** 2026-10-03, lead (from QA's re-gate): the gate seeded `?sortBy=&sortDir=` in the URL and the page
  fetched unsorted until a header press.
- **Surface:** /suppliers — the table filters bag seeding from the URL on mount.
- **Mutation surface:** none — sort requests are read-only.
- **Status:** case PREPARED — fix landed (see card for sha); local rung on the card; staging rung owed at wave cut.

## Steps

1. Login admin → open `/suppliers?sortBy=name&sortDir=asc` directly (deep link).
2. The FIRST list request carries `sortBy=name&sortDir=asc` (network tab) and the grid renders
   name-sorted.
3. A header press still re-toggles (asc → desc) and the request follows.
4. `?sortDir=desc` alone (no sortBy) fetches without a sort param (readTableSort drops invalid pairs).

## Expected

- The deep link is honored by the first fetch; no unsorted window.

## Local rung (2026-10-03)

- API request carried `sortBy=name&sortDir=asc` on first load; rows rendered from the sorted response
  (screenshot qa/2026-10-03_suppliers-sorted-deeplink.png).
