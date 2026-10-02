---
date: 2026-10-01
status: accepted
deciders: Frank Nguyen
source: Explicit owner decision in the local audit session
scope: Supplied TODO cards220,245,252
---

# Preserve the current access, trip-input and shipment-creation policies

The supplied TODO reports requested product decisions. The owner explicitly
selected the current policies during the2026-10-01 audit:

- CUS quotation-fee catalog access stays restricted. Do not widen catalog
  permissions or invent fee-price columns. Existing authorized roles and
  separate debit-detail/export permissions remain governed by their contracts.
- Trip quantity, rate and allowance fields stay nonnegative. This does not
  change signed expense rows, which remain visible and excluded from totals
  under the accepted expense rule.
- Shipment creation stays DRAFT with later progression through the existing
  readiness, ledger and fulfillment flow. Do not add a SUBMIT action or an
  internal approval workflow.

These decisions resolve the three proposed policy changes without a runtime
behavior change. Regression cases are QA-AUDIT-POLICY-220,
QA-AUDIT-POLICY-245 and QA-AUDIT-POLICY-252. Evidence of a preserved policy is
reported per executed path; recording this decision alone is CODE-READ ONLY.
