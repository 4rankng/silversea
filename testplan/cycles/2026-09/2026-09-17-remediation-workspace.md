# Accounting workspace remediation — 2026-09-17

Baseline prod `0df231ab`. Existing reproduction evidence: `plans/260917-meticulous-qa/reports/workspace.md`.

| Case | Reproduction | Expected |
|---|---|---|
| FIX-WS-06 | Road 300k + shift 200k + estimated toll 100k; actual toll80k + extra20k, paired work | Work total/breakdown600k, shared fees once, allowances500k preserved; missing norm remains unknown |
| FIX-WS-13 | Open report; click group/total/settled/remaining | Read-only source drilldown agrees with current filters and payment cutoff |
| FIX-WS-14 | Mixed confirmed sources, fee-name search | Matching work and sources only, no ignored confirmation/search controls |
| FIX-WS-15 | Departure and displayed appointment differ, near VN midnight | Work date filters use the shown Vietnam appointment day |
| FIX-WS-16 | Distinct customer/factory | Both identities and route visible |
| FIX-WS-17 | Locked shipment existing deposit | Accountant can change documentary/refund fields; principal controls disabled and API remains locked |
| FIX-WS-INV | New supplier invoice fee with one real trip, multiple trips or no trip | Single real trip links one mirror; ambiguous trip requires explicit choice; no fake trip or cash; retry/update does not duplicate |
| FIX-WS-STATE | Change report direction/cutoff; tabs/back/reload | Report filter URL preserves chosen meaning |

Update automated regression cases; execute actual local browser interactions at 7175/3001 with uniquely owned FIX17 fixtures. Save screenshots, DOM/HTTP and persisted proof. No production mutation, schema additions, commits or silent approval/offline features.

- **FIX-WS-INVOICE-GROUP:** After a supplier invoice links to an internal SilverSea trip, OUT report groups that invoice by supplier without presenting the supplier as SILVERSEA_INTERNAL; a supplier's invoices across vehicles remain one supplier group. Keep carrier classification on actual transport expenses.

- **FIX-WS-TABLET:** At820px all work identity, notes and three totals must be visible without horizontal table scrolling; preserve compact desktop table and mobile cards.
- **FIX-WS-REPORT-LOCALE:** Report cutoff/expense dates use Vietnamese display formatting and readable source labels; source IDs remain available for traceability.

- **FIX-WS-INV-PARTIAL:** Two fulfillments, only one dispatched trip: saving an invoice without explicit ownership must remain unlinked; explicit chosen valid trip can link it once. Do not infer that the first dispatched work owns a shipment-wide fee.

- **FIX-WS-CUTOFF-DRAFT:** Clear and type the report payment cutoff; keep the blank/partial draft rather than refilling today, and update URL/API only after a complete valid date. Calendar selection and URL reload remain supported.

- **FIX-WS-ADVANCE-HISTORY:** A reconciliation using multiple advances shows each original request ID, assigned amount and reason in read-only detail. Released batches retain the same rows. Missing historical detail is explicit, never inferred from the total.

- **FIX-WS-ADMIN-ROLES / TC-1003:** Open Users as ADMIN and inspect all role filter pills. All eight roles must be present using current canonical labels: Quản trị viên, Quản lý, Kế toán, Lái xe, Nhân viên vận hành, Khách hàng, CUS, Điều vận. The CUS abbreviation is the shared product label; do not omit the role assertion.
