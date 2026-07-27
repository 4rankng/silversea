# Phase 02 — Verify and review

## Gates

- `pnpm lint`
- `cd backend && npx tsc --noEmit`
- `cd backend && pnpm test`
- `cd frontend && npx tsc -b`
- `cd frontend && pnpm test`
- `make build`
- `cd e2e && ./run_all.sh`
- Independent code review and local responsive browser verification.

Every run records command, output, timestamp, and status under `qa/`.
