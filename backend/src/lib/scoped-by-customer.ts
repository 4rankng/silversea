// Row-scope helper for the customer portal (Wave 2) and any operator endpoint
// that a CUSTOMER-role user can reach. Centralises the "what can this user
// see?" decision so individual routes don't repeat it.
//
// The helper is a PURE FUNCTION — it does not touch the DB or mutate its
// arguments. The auth middleware is responsible for populating
// `req.user.customerId` from the JWT (the login route carries it there).
//
// Semantics:
//
//   - CUSTOMER + customerId set      → force the query to the primary customer
//     link for that user. Any caller-supplied customerId is OVERWRITTEN so a
//     portal user cannot impersonate another customer by passing
//     `?customerId=<other>` in the query string.
//
//   - CUSTOMER + customerIds set      → force the query to the full linked
//     customer set. Use this for portal list endpoints that need to show all
//     linked accounts, not just the primary pointer.
//
//   - CUSTOMER + customerId absent   → apply a deny-all sentinel
//     (customerId = DENY_ALL_CUSTOMER_ID). The user is misconfigured (no
//     link to a customer row) and MUST NOT see anything until an operator
//     links their account. Showing zero rows is safer than leaking data;
//     the operator notices via a support ticket and fixes the mapping.
//
//   - non-CUSTOMER                    → passthrough. Operator roles are not
//     scoped by customer; the caller's customerId (if any) is preserved.
//
// Reusability: the helper is consumed by Wave 2 portal endpoints and by any
// Wave 3 financial-close endpoint that a customer may reach (e.g. their own
// debit notes). It is NOT wired into `/api/shipments` today — the customer
// portal ships its own `/api/portal/*` surface in Wave 2 behind the
// `customer_portal` Casbin resource.

import type { AuthUser } from '../middleware/auth';
import { Role } from '@tingting/shared';

/**
 * Sentinel "customer id" that matches no row. Used when a CUSTOMER-role user
 * has no `customerId` link — the resulting query returns zero rows rather
 * than leaking unrelated data. Negative because real `customers.id` values
 * are positive serials, so this can never collide.
 */
export const DENY_ALL_CUSTOMER_ID = -1;

/**
 * Returns true when the user is a CUSTOMER-role account whose queries must
 * be row-scoped to a single customer. Callers can use this to short-circuit
 * writes that don't make sense for a customer (e.g. "create trip" — customers
 * don't create trips, they only view their own).
 */
export function isCustomerScoped(user: Pick<AuthUser, 'role'>): boolean {
  return user.role === Role.CUSTOMER;
}

function normalizeCustomerIds(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => value != null && Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
}

function primaryCustomerId(user: Pick<AuthUser, 'customerId' | 'customerIds'>): number | null {
  return user.customerId ?? user.customerIds?.[0] ?? null;
}

/** Full linked customer set for a CUSTOMER-role account. Non-CUSTOMER → empty set. */
export function customerScopeIds(user: Pick<AuthUser, 'role' | 'customerId' | 'customerIds'>): number[] {
  if (!isCustomerScoped(user)) return [];
  return normalizeCustomerIds([
    ...(user.customerIds ?? []),
    user.customerId,
  ]);
}

/**
 * Row-scope a list query by the user's customer link.
 *
 * Pure: does not mutate `query`. Returns a new object.
 *
 * See the file header for the full semantics matrix.
 */
export function scopedByCustomer<Q extends { customerId?: number }>(
  user: Pick<AuthUser, 'role' | 'customerId' | 'customerIds'>,
  query: Q,
): Q {
  if (!isCustomerScoped(user)) {
    // Operator roles: passthrough — preserve any caller-supplied filter.
    return { ...query };
  }
  // CUSTOMER role: force the filter, regardless of what the caller passed.
  // This is the impersonation guard.
  return { ...query, customerId: primaryCustomerId(user) ?? DENY_ALL_CUSTOMER_ID };
}

/**
 * Row-scope a list query by the user's full customer link set.
 *
 * CUSTOMER users with one or more linked customers receive an `in (...)`
 * scope. Unmapped CUSTOMER users get the deny-all sentinel list.
 */
export function scopedByCustomerIds<Q extends { customerIds?: number[] }>(
  user: Pick<AuthUser, 'role' | 'customerId' | 'customerIds'>,
  query: Q,
): Q {
  if (!isCustomerScoped(user)) {
    return { ...query };
  }
  const ids = customerScopeIds(user);
  return { ...query, customerIds: ids.length > 0 ? ids : [DENY_ALL_CUSTOMER_ID] };
}

/**
 * True when the user may access rows belonging to the given customer id.
 * Used by detail endpoints to gate a single row: if the user is a CUSTOMER
 * scoped to customer 7 and the row's customerId is 8, the helper returns
 * false and the route returns 404 (not 403 — avoid leaking the row's
 * existence).
 */
export function canAccessCustomer(
  user: Pick<AuthUser, 'role' | 'customerId' | 'customerIds'>,
  customerId: number,
): boolean {
  if (!isCustomerScoped(user)) return true; // operator roles see all customers
  return customerScopeIds(user).includes(customerId);
}
