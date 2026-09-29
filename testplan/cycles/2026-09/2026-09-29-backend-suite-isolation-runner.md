# 2026-09-29 — Backend suite runner discipline (isolation runner is the standard)

**Ticket:** card 20260929_206 (card 20260928_164 verification command fake-red)
**Status:** DONE — rule recorded; fixture fixes landed in the same card

## The rule

The standard way to run a single backend suite is the isolation runner — each
suite gets its own throwaway database cloned from a clean template:

```
TZ=UTC node backend/scripts/test-isolated.mjs --concurrency 4 --filter <suite-name-substring>
```

A bare `TZ=UTC npx tsx --test src/tests/<suite>.test.ts` (from `backend/`)
runs straight against the shared local DB (`:5441`) and therefore sees every
row earlier runs left behind. It is only meaningful on a clean DB, and it
must never be recorded on a card as the verification command unless the card
also says so.

Evidence (card 20260928_164): the bare command on the dirty shared DB gave
1/8 pass with 7 duplicate-key deaths on `customers_active_name_tax_code_uniq_idx`
because earlier runs had left `card164 cust *` customers behind; the same file
under the isolation runner was green. The product was fine — the fixture was
not re-runnable.

## Obligations on suite authors

Regardless of runner, every suite that creates rows on a unique-constrained
surface (customer name with NULL tax_code COALESCEs to `''` and collides;
`users.username`; `trips.trip_code`) must be re-runnable on a dirty DB:

- carry a per-run unique suffix in those names (the `Date.now()`-based
  `suffix` convention used across `backend/src/tests/`), or
- clean up after itself in an `after()` hook, scoped to the suite's own
  created ids / own prefix — never a broad `WHERE`.

A counter alone (`${++seq}`, `${cleanup.length}`) is NOT unique-index-safe:
it restarts at 0 every run, so one crashed run poisons the next run's first
insert. Card 20260929_206 fixed this class in
`card164-driver-no-invoice-lot-cost.test.ts` (cleanup now actually executes;
its leaked-`card164-*` history motivated this note), `card7-fee-norms.test.ts`,
and `chiho-reconciliation.test.ts`.
