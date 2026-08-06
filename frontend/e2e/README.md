# E2E Test Suite

Playwright-based end-to-end tests for Silver Sea staging QA.

## Setup

```bash
# Install dependencies (already done)
pnpm --filter frontend add -D @playwright/test

# Install browsers
pnpm --filter frontend exec playwright install chromium
```

## Running Tests

```bash
# Run all E2E tests
pnpm --filter frontend test:e2e

# Run in headed mode (watch browser)
pnpm --filter frontend test:e2e:headed

# Debug mode (inspect, step through)
pnpm --filter frontend test:e2e:debug
```

## Test Structure

- `o2c-lifecycle.spec.ts` - Order-to-Cash workflow tests (OPS-002 to OPS-015)
- `finance-workflows.spec.ts` - Financial process tests (FIN-003 to FIN-015)
- `fixtures/` - Test data and files

## Credentials

All tests use staging credentials:
- URL: https://vantai.tingting.vip
- Password: Abc123 (all users)
- Users: admin, giamdoc, ketoan, laixe, giaonhan, customer, dieuvan, cus

## Coverage

Currently covers:
- 11 O2C lifecycle tests
- 7 Finance workflow tests
- Total: 18 E2E test cases

## Adding New Tests

1. Create new `.spec.ts` file in `e2e/` directory
2. Use test.describe() for grouping
3. Use proper selectors (text=, role=, data-testid=)
4. Follow naming: `<feature>-<workflow>.spec.ts`

## CI Integration

Tests can run in CI with:
```bash
pnpm --filter frontend test:e2e --reporter=json
```

Results output to `playwright-results.json`.
