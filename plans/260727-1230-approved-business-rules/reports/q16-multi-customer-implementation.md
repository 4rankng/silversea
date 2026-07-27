# Q16 Multi-Customer Implementation

Date: 2026-07-27

## Result

Q16 is implemented with an explicit user-to-customer join model. A customer
account keeps its existing primary-customer compatibility pointer while an
administrator can grant access to more than one active customer entity.

## Enforced invariants

- An active CUSTOMER account must have at least one linked active customer.
- Customer links are capped at 100 per account.
- Deleted customer entities are excluded from new sessions and revoke stale
  session scope.
- Customer portal list, detail, confirmation, dispute, statement, and export
  requests enforce the selected linked entity.
- A selected entity is stored in the URL and restored on refresh or a shared
  deep link only when it remains in the authenticated account's allowed set.
- Legacy one-customer accounts and tokens remain compatible.

## Evidence

- Independent security/data-isolation review:
  `qa/2026-07-27_q16-multi-customer_independent-review.md`
- Backend focused verification:
  `qa/2026-07-27_q16-multi-customer_post-fix-backend-targeted-test.log`
- Frontend full regression and deep-link tests:
  `qa/2026-07-27_q16-multi-customer_frontend-targeted-test.log`
- Frontend typecheck:
  `qa/2026-07-27_q16-multi-customer_frontend-typecheck.log`
- Authenticated responsive browser fix loop and final PASS:
  `qa/2026-07-27_q16-multi-customer_visual-browser.log`
- Desktop/mobile screenshots:
  `qa/2026-07-27_q16-admin-customer-scope_desktop.png`,
  `qa/2026-07-27_q16-admin-customer-scope_mobile.png`,
  `qa/2026-07-27_q16-portal-customer-scope_desktop.png`, and
  `qa/2026-07-27_q16-portal-customer-scope_mobile.png`.

The final browser run proved two selected links in the admin editor, separate
portal requests for both entities, a persisted secondary selection, no
document or drawer-body horizontal overflow at 1440px and 375px, a 44px mobile
selector, and no console errors or failed responses.
