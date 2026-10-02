import { Role } from '@tingting/shared';

/**
 * Which roles may REACH the combined-invoice tracking page.
 *
 * Card 20260928_178 asks for this to be verifiable "bằng test phân quyền,
 * không chỉ bằng việc ẩn menu" — by a role test, not by hiding a menu item.
 * Hiding the link proves nothing about the route: the URL is still typed, the
 * item is still reachable, and a refactor that drops a role from the guard
 * would leave the nav looking identical. So the admitted set is a named
 * policy here and the route asks this function, which means a test can pin
 * the policy itself.
 *
 * The split inside the page is deliberate and separate: reaching the page is
 * read access (CUS included), while WRITING is `WRITE_ROLES` on the page,
 * mirroring the server's `requireRoles` gate on write endpoints. Keep the two
 * distinct — widening this list grants CUS the tracker, and only that.
 */
export const INVOICE_TRACKING_ROLES: readonly Role[] = [
  Role.ADMIN,
  Role.MANAGER,
  Role.ACCOUNTANT,
  Role.CUS,
];

/**
 * True when `role` may open /accounting/invoice-tracking.
 *
 * `role` is a plain string, not `Role`, because that is what
 * `getModernRole(user?.role)` actually returns — it is a legacy shim mapping
 * CLERK→CUS and FORWARDER→OPS, and its declared return type is `string`. The
 * route guard used to compare that string against `Role.*` inline, which worked
 * but was untyped; the type error surfaced the moment the comparison moved into
 * a named function. `Role` is a string enum, so membership still compares the
 * same way — this just admits what is really being passed instead of casting.
 */
export function canViewInvoiceTracking(role: string | null | undefined): boolean {
  return role != null && INVOICE_TRACKING_ROLES.includes(role as Role);
}
