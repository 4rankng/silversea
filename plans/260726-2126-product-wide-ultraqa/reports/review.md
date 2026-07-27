# UltraQA review

Date: 2026-07-26
Reviewer: Codex self-review

## Findings

1. Open defect: `MANAGER` dispatch still triggers `403 /api/admin/app-settings` because `DispatchPage` reads strict-admin app settings directly.
2. Open defect: `ACCOUNTANT` is granted backend audit-log read access but is
   redirected away from `/audit-logs` by the frontend.
3. Open product gap: PRD M1.7 two-way cargo pairing is not implemented.
4. No new regressions were found in the clerk or Forwarder surfaces after the
   fixes. Final evidence is green in
   `qa/2026-07-26_product-wide-ultraqa_manual-clerk-notifications-rerun4.log`
   and
   `qa/2026-07-26_product-wide-ultraqa_e2e-forwarder.final2.log`.

## Verified fixed surfaces

- Clerk home and deny redirects
- Clerk customer bootstrap
- Clerk shipment detail fetch path
- Clerk container-type bootstrap
- Clerk notification-bell permission mismatch
- Forwarder missing-container-number validation
- Expense unknown-supplier validation

## QA evidence

- Functional/visual matrix: `plans/260726-2126-product-wide-ultraqa/reports/visual-functional-results.md`
- Browser logs and screenshots: `qa/2026-07-26_product-wide-ultraqa_*`
- Automated reruns: lint, backend/frontend tests and typechecks, build, focused
  role E2E suites

## Scope review

- The Forwarder route refinement is intentionally local. The shared schema
  remains permissive for draft workflows.
- E2E fixture changes align assertions and payloads with current public
  contracts. The independent review identified non-failing assertions; those
  were tightened and rerun. This exposed and led to the expense
  unknown-supplier fix.
- The Accountant and Manager permission mismatches remain red because product
  authority is ambiguous.
