# Regression spec — card 20261003_306 expense list date-range 500

**Ticket:** 20261003_306 (impossible calendar day on /api/expenses answers 500 — card 20261001_256's class, sweep instance 2)
**Owner (implement):** backend
**Owner (verify):** qa
**Status (this doc):** PREP — execute at the next staging cut
**Cycle:** 2026-10 wave

## Goal

The expense list fed the raw fromDate/toDate query strings into gte/lte on the
DATE column expenses.expense_date; an impossible calendar day (2026-02-30)
made Postgres throw and the route answer 500. Fix: both range bounds parse
through the shared strict parser (backend/src/lib/range-date.ts — the
accounting route's parseRangeDate promoted to a lib and reused, one pattern
one implementation) answering a Vietnamese business 400 naming the bad value.

## Out of scope

- quotation-versions' `new Date(filter.from)` silent-roll (impossible days
  roll instead of rejecting — no 500, wrong window only): recorded on the
  card as out-of-class follow-up, not fixed here.

## Acceptance criteria

### TC-306-001 — Impossible day answers the business 400

- **Given** any account passing the financial family gate (ACCOUNTANT)
- **When** GET /api/expenses?fromDate=2026-02-30&toDate=2026-03-31
- **Then** HTTP 400 with `Khoảng ngày không hợp lệ: 2026-02-30` (value named);
  no 500, no stack
- **Assert:** `TZ=UTC npx tsx --test src/tests/expense-date-range-400.test.ts`
- **Evidence:** qa/2026-10-03_card306-red.log (red: got 500 with the failed
  Postgres query) → qa/2026-10-03_card306-green.log (2/2 green)

### TC-306-002 — Real and open ranges unchanged

- **Given** the same account
- **When** GET /api/expenses?fromDate=2026-02-01&toDate=2026-03-31 and GET
  /api/expenses with no range
- **Then** both 200 (empty list is fine)
- **Assert:** same suite, second test
- **Evidence:** qa/2026-10-03_card306-green.log

### TC-306-003 — The accounting route's contract survives the promotion

- **Given** the parseRangeDate extraction into the lib
- **When** the invoice-tracking suite runs (impossible day → 400 naming
  2026-09-31; valid day → 200)
- **Then** identical behavior to card 256's landed contract
- **Assert:** `TZ=UTC npx tsx --test src/tests/invoice-tracking.test.ts`
- **Evidence:** qa/2026-10-03_card306-invoice-regression.log
