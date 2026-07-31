# Customer Service To Finance Workflow

This document records the implemented customer-service-to-finance chain and its
rollout controls. It is a workflow/runbook reference, not a claim that anything
has been production-activated.

## Scope

- Reuse the existing shipment, billing-document, receivable, payable, treasury,
  profitability, and role-workspace authorities.
- Keep `WORKFLOW_ROLLOUT_MODE` server-owned and defaulted to `OFF`.
- Document the phase-6 rollout path, migration order, and rollback floor.
- Keep Treasury book balance separate from bank-statement reconciliation.

## Authority Chain

| Domain | Implemented authority | Notes |
|---|---|---|
| Booking / shipment intake | `shipments` | The booking and dossier flow starts here; the shipment routes remain the first operational entry point. |
| Customer-service coordination | `customer_visible_events` + `customer_event_acknowledgements` | Customer-safe milestones, delivery-plan updates, document updates, and debit-note confirmations are stored as filtered event records, not a chat system. |
| Recoverable cost review | `recoverable_costs` | Visible only when the workflow is ACTIVE and the user has the matching capability. |
| Debit note / AR posting | `billing_documents` | Debit Note remains the sole receivable authority; the legal-invoice path is reference-only. |
| Cash application | `payment_receipts` + `payment_allocations` | Cash receipt and allocation are the collection authorities. |
| Treasury book balance | `treasury_accounts` + `treasury_movements` | Source-linked book balance only; not a bank-reconciliation engine. |
| Profitability | `trip_financial_postings` + `profitability_snapshots` | Profitability is tied to the canonical posting/version chain, not inferred from raw trip edits. |
| Role/capability projection | `/api/auth/login` and `/api/auth/me` | Both responses include `workflowRolloutMode` and server-derived capabilities. |

## Role Workspaces

| Role | Workspace behavior | Primary paths |
|---|---|---|
| `ADMIN` | Full internal shell with dashboard, operations, finance, treasury, profitability, and config access as allowed by backend policy. | `/dashboard`, `/dispatch`, `/shipments`, `/finance`, `/debt`, `/payables`, `/expenses`, `/profit`, `/finance/treasury` |
| `MANAGER` | Internal shell with executive dashboard first, then operations and finance/reporting destinations. | `/dashboard`, `/dispatch`, `/shipments`, `/finance`, `/debt`, `/payables`, `/expenses`, `/profit` |
| `ACCOUNTANT` | Finance-first ordering. In ACTIVE mode, treasury and profitability appear only when the server capability allows it. | `/debt`, `/payables`, `/expenses`, `/finance`, `/profit`, `/finance/treasury` |
| `CLERK` | Assigned shipment queue plus narrow document-processing and recoverable-cost surfaces. | `/shipments`, `/clerk/shipments/new`, `/clerk/shipments/:id/docs`, `/recoverable-costs` |
| `CUSTOMER` | Separate customer portal shell. | `/portal/shipments`, `/portal/debit-notes`, `/portal/statement` |
| `DRIVER` | Separate driver portal shell. | `/my-trips`, `/my-earnings`, `/my-penalties` |
| `FORWARDER` | Separate forwarder portal shell. | `/my-forwarder-trips`, `/my-advances`, `/my-settlements` |

Notes:

- The internal shell is shared by `ADMIN`, `MANAGER`, `ACCOUNTANT`, and
  `CLERK`.
- The customer, driver, and forwarder portals remain separate shells.
- Executive reporting remains `ADMIN` / `MANAGER` only; there is no `CEO`
  role in the product model.

## Rollout Modes

`WORKFLOW_ROLLOUT_MODE` is parsed from the environment in
[`backend/src/config/index.ts`](../backend/src/config/index.ts) and defaults to
`OFF` when unset.

| Mode | Behavior |
|---|---|
| `OFF` | Legacy behavior only. New workflow reads/writes are not advertised, and `requireWorkflowActive` returns 503 for the protected surfaces. |
| `SHADOW` | New authorities can write or compare in the background, but the new workflow is not advertised as active. Use this for parity checks and backfill validation. |
| `ACTIVE` | Approved role workspaces and workflow capabilities become visible to the frontend, and workflow-gated routes become usable. |

The frontend does not decide security on its own. It consumes the server-returned
mode and capability list from `/api/auth/login` and `/api/auth/me`.

## Migration Order

The rollout migrations are additive and must stay in order:

1. `backend/drizzle/0166_superb_molten_man.sql`
   - Adds the core workflow rows and columns:
     - `billing_document_disputes`
     - `billing_document_recoverable_claims`
     - `customer_visible_events`
     - `customer_event_acknowledgements`
     - `profitability_snapshots`
     - `profitability_snapshot_dimensions`
     - `salesperson_assignments`
     - `treasury_accounts`
     - `treasury_movements`
     - `trip_financial_postings`
     - supporting columns on `billing_documents`, `dispatch_handoffs`,
       `ledger`, `payment_receipts`, and `trip_expenses`
2. `backend/drizzle/0167_gigantic_krista_starr.sql`
   - Adds the foreign-key links that connect the new authorities to each other.
3. `backend/drizzle/0168_wonderful_rattler.sql`
   - Extends governance validation so treasury account and treasury movement
     actions are valid subjects/actions.

Do not reorder these files when applying or documenting the workflow rollout.

## Activation Prerequisites

Rollout should not move beyond `OFF` until the following are true:

- The customer decision record at
  [`plans/260730-2232-customer-service-finance-workflow/reports/customer-decision-questions-vi.txt`](../plans/260730-2232-customer-service-finance-workflow/reports/customer-decision-questions-vi.txt)
  has explicit answers filled in under each `TRẢ LỜI KHÁCH HÀNG` line for the
  blocking questions.
- The phase-1 decision gates and authority map remain the accepted reference
  for D1–D4, with D5 already mapped to `CLERK`.
- The prior phases and the phase-6 closed-loop QA checks are green.
- The rollout is still reversible at the current stage and no production
  deployment is being claimed by this document.

The customer decision file is important because it records the product/legal
answers for:

- D1 legal invoice authority
- D2 treasury foundation and cutover
- D3 customer communication authority
- D4 attribution and canonical financial posting/version
- D5 CUS scope mapping to `CLERK`

## Treasury Book Balance

Treasury book balance is a source-linked ledger view over `treasury_accounts`
and `treasury_movements`.

- It is computed from opening balance plus posted inflows minus posted
  outflows.
- It is not a bank-statement reconciliation.
- Unsupported activity stays partial/unavailable rather than being guessed.

This distinction matters for the finance dashboard: the dashboard should show
the actual book balance authority, not infer cash from AR/AP totals.

## Rollback Compatibility Floor

The workflow is reversible only up to the compatibility floor described in the
phase plan.

- Before treasury cutover, the rollout can move between `OFF` and `SHADOW`
  without deleting authority data.
- After treasury cutover, a rollback build must still respect the linked
  treasury movement contract. A build that can post money without the linked
  treasury movement does not meet the floor.
- Disabling the workflow should turn off the surfaces and write hooks; it should
  not delete the underlying shipment, billing-document, or snapshot history.

## Key API Paths

| Path | Purpose |
|---|---|
| `POST /api/auth/login` | Returns the authenticated user, `workflowRolloutMode`, and server capabilities. |
| `GET /api/auth/me` | Returns the current user profile plus the same rollout and capability projection. |
| `GET /api/shipments` | Shipment list for the internal workspace and clerk-scoped queue. |
| `POST /api/shipments/quick` | Clerk/mobile quick-create path for shipments. |
| `GET /api/shipments/:id` | Shipment detail. |
| `POST /api/recoverable-costs` / `GET /api/recoverable-costs` | Recoverable-cost review and request flow. |
| `POST /api/recoverable-costs/:id/request` | Create a recoverable-cost request with idempotency. |
| `GET /api/finance/billing-documents` | Billing-document listing. |
| `POST /api/finance/billing-documents/generate` | Draft Debit Note / statement preview. |
| `POST /api/finance/billing-documents` | Save a billing-document snapshot. |
| `POST /api/finance/billing-documents/:id/issue` | Issue a billing document. |
| `POST /api/finance/billing-documents/:id/send-for-confirmation` | Workflow-gated confirmation handoff. |
| `GET /api/finance/billing-documents/:id/export` | Export as XLSX or printable HTML/PDF. |
| `POST /api/finance/treasury/accounts/setup` | Treasury account setup. |
| `POST /api/finance/treasury/accounts/:id/cutover` | Treasury cutover. |
| `GET /api/finance/treasury/position` | Treasury book-balance view. |
| `POST /api/finance/treasury/movements/:id/reversal` | Treasury movement reversal. |
| `GET /api/portal` | Customer portal surfaces. |
| `GET /api/driver/me` and `GET /api/forwarder/me` | Separate portal shells for driver and forwarder roles. |

## QA And Runbook

Use the repo’s closed-loop QA convention and save every command output under
`qa/`.

Recommended verification sequence for this workflow:

1. Confirm the decision file is populated and the rollout mode is still
   `OFF` or `SHADOW` as intended for the current environment.
2. Verify the migration order is preserved before any rollout change.
3. Run the targeted backend and frontend typechecks/tests that cover the touched
   surfaces.
4. Run the broader gates when shared contracts or RBAC change:
   - `pnpm lint`
   - `cd backend && npx tsc --noEmit`
   - `cd backend && pnpm test`
   - `cd frontend && npx tsc -b`
   - `cd frontend && pnpm test`
   - `make build`
   - `cd e2e && ./run_all.sh`
5. Keep the rollout in `SHADOW` until parity is proven, then move to `ACTIVE`
   only if the explicit activation prerequisites are satisfied.
6. If parity or authorization checks fail, return to `OFF`/`SHADOW` and keep the
   underlying authority data intact for diagnosis.

## Related Sources

- [`docs/customer-workflow-gap-analysis.md`](./customer-workflow-gap-analysis.md)
- [`docs/prd/business-logic-qa-proposals.md`](./prd/business-logic-qa-proposals.md)
- [`plans/260730-2232-customer-service-finance-workflow/plan.md`](../plans/260730-2232-customer-service-finance-workflow/plan.md)
- [`plans/260730-2232-customer-service-finance-workflow/phase-06-role-workspaces-rollout-and-closed-loop-qa.md`](../plans/260730-2232-customer-service-finance-workflow/phase-06-role-workspaces-rollout-and-closed-loop-qa.md)
