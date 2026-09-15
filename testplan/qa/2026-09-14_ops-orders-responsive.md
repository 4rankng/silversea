# Ops orders: narrow-screen work plan

Observed local-browser defect: `qa/ui-polish-final/ops-ops-orders-390.png` shows a 960px table clipped within a 390px phone. Container, bill, status and the expense action are outside the visible workspace. The fixed search width also forces a mostly empty additional toolbar row.

| Case | Reproduction | Expected result |
|---|---|---|
| OPS-RESP-01 | Open `/ops/orders` as Ops at 390px and 768px with long customer/route values and multiple containers. | Every shipment shows identity, customer, route, containers, bill/booking, status, pin and expense action in labelled flat rows. No horizontal scrolling is needed to reach fields or actions. No nested cards. |
| OPS-RESP-02 | Open the same plan at 1024px and 1440px where the workspace fits the columns. | A semantic comparison table is retained; long values wrap inside their own cell. |
| OPS-RESP-03 | Search by shipment/container and change the selected date at phone width. | Date and search use available space without overflowing. Focus is visible and coarse-pointer targets remain at least 44px. Existing debounce/date semantics are preserved. |
| OPS-RESP-04 | Pin the second shipment, unpin it, and open its `Khai chi phí` action at phone width. | Existing pin ordering/mutation behavior is retained; expense form opens for the correct shipment with bill and containers populated. |
| OPS-RESP-05 | Load an empty plan and a plan containing a missing route. | Empty state spans the workspace; the missing route remains explicitly labelled instead of silently omitted. |

Automated results: `qa/2026-09-14_ops-orders-responsive_*`. Coordinating agent records the final Chrome screenshot and interactions after the build.
