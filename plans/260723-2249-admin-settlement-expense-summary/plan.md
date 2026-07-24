# Admin settlement expense summary

Status: Complete

## Phases

- [x] Replace the raw trip/container wall with a compact, tested count summary.
- [x] Rebalance the desktop ledger and switch to record cards before columns become compressed.
- [x] Validate the responsive list, existing settlement workflow, and production build.

## Acceptance criteria

- Desktop and mobile rows no longer render concatenated trip or container identifiers.
- The row separates settlement identity from linked expense, unique trip, and unique container counts.
- Scope text remains grouped into intentional lines instead of wrapping word by word.
- Intermediate widths use two-column records; phones use one column.
- Empty settlements show a direct Vietnamese empty summary.
- The existing settlement detail route remains the only drill-down for the full expense breakdown.
- Unsupported readiness and general-expense claims are not shown from incomplete list data.
- Amounts, status, filtering, edit/reject actions, API payloads, database schema, and financial behavior remain unchanged.
- Focused tests, frontend lint/build, UI contract check, and `git diff --check` pass.

## Scope

See [phase-01-implementation.md](phase-01-implementation.md).
