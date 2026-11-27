# 2026-11-27 — SIL-1095/1096/1098/1103/1104/1105/1107 — gates

Scope of this run: re-verify the seven board tickets against the code on `main`,
close the gaps that were still open (SIL-1107 three layers + global search,
SIL-1096 false-missing flash, SIL-1105 wording, CHANGELOG), then push to `main`
WITHOUT deploying (owner rule for this batch).

## Environment

- Repo: `/Volumes/LexarSSD/projects/silversea`, branch `main`
- Base commit before this run: `5ce4440f` (in sync with `origin/main`)
- Local Postgres: `postgres://…@localhost:5441/silversea` (container `ss-prod-db`)
  — 223 shipments · 89 trips · 2 pod submissions · 0 document-set facts
- No deploy performed (owner rule: "KHÔNG make deploy").

## Gates

| Gate | Command | Result |
|---|---|---|
| Backend typecheck | `cd backend && npx tsc --noEmit` | exit 0, 0 errors |
| Frontend typecheck | `cd frontend && npx tsc -b` | exit 0, 0 errors |
| Backend unit | `cd backend && pnpm test:unit` | 1743 tests, 1743 pass, 0 fail |
| Shared package | `cd shared && pnpm test` | 339 tests, 339 pass, 0 fail |
| FE scoped (SIL-1096/1105/1107 + palette) | `npx vitest run` (8 files) | 67 tests, 67 pass |
| FE scoped (e-POD surfaces touched by the shared label move) | `npx vitest run` (7 files) | 136 tests, 136 pass |
| Lint (every file this run changed) | `npx eslint <files>` | 0 errors (1 pre-existing warning in `OpsExpenseFormModal.tsx:345`, untouched by this run) |

Two pre-existing red gates on `main` were fixed here (both in files this run
already touched, both required for the gates above to be green):

- `backend/src/tests/debit-round-payable-ledger.test.ts` — a `numeric` column
  received a `number` (drizzle numeric is string-typed). Landed by the
  SIL-1092 lane on 27/11.
- `shared/src/schemas/customer-service-finance.test.ts` — the response payload
  missed `adjustmentCounts`, required by K6.41 (SIL-1025, 26/11).

## Runtime evidence (DB/API verified — rung 2)

`listShipmentDocumentDebt` against the local database (throwaway script, removed
after the run):

```
debt rows: 215
rows carrying 3 layers: 215
rows with an open e-POD layer: 196
rows with an open phoi layer: 56

epod sample: { layer: "EPOD", status: "Chưa có", ok: false, applicable: true,
  missingDocuments: ["Phiếu bãi / phiếu hạ", "Biên bản giao nhận có ký nhận"],
  detail: "2 tài liệu e-POD chưa lưu trên 1 chuyến" }

phoi sample: { layer: "PHOI", status: "Chưa nhận phơi", ok: false, applicable: true,
  missingDocuments: ["Phiếu phơi chuyến TRP-202611-0028", "Phiếu phơi chuyến TRP-202611-0029"],
  detail: "Chưa nhận phơi 2/2 chuyến" }

lot without a trip: { layer: "PHOI", status: "Không có chuyến đi lấy phơi",
  ok: true, applicable: false }
```

This proves the new batched query (DISTINCT ON over every visible lot + the
e-POD / phơi fact loaders) runs against a real database and returns the three
independent layers with their missing-document names.

## Coverage statement

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| SIL-1107 three-layer "Nợ chứng từ" + global search | DB/API verified (rung 2) | the run above; `backend/src/tests/unit/sil1107-document-debt-layers.test.ts` (9 tests); `frontend/src/pages/DocumentDebtPage.test.tsx` (6 tests); `frontend/src/data/searchRegistry.test.ts` | no UI DRIVEN pass — the screen was not clicked in a browser; QA to confirm the table at 390/768/1440 |
| SIL-1096 readiness panel (4 conditions, reason + cách bổ sung) | code-read + unit (rung 1) | `frontend/src/pages/accounting/debit-close-readiness.test.ts`, `DebitReadinessPopover.test.tsx`, `AccountingDebitClosePage.sil1096.test.tsx` | no UI DRIVEN pass |
| SIL-1105 offline save copy | unit (rung 1) | `ExpenseCreateDrawer.sil1105-network.test.tsx`, `OpsExpenseFormModal.sil1105-network.test.tsx` | no UI DRIVEN pass |
| SIL-1095 / 1098 / 1103 / 1104 | code-read only for this run (rung 1) — already shipped by earlier lanes, re-verified against the current source | see the board comments on each ticket | no new UI drive in this run; their own QA passes stand |
