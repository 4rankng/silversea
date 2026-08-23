/**
 * The CUS shipment and Dispatcher planning workspaces are approved reference
 * surfaces. Broad presentation changes must leave them untouched while the
 * rest of the application adopts the operational-density contract.
 */
const FROZEN_OPERATIONAL_PREFIXES = [
  '/shipments',
  '/shipments-detail',
  '/dispatch',
  '/dispatch-detail',
] as const;

export function isFrozenOperationalSurface(pathname: string): boolean {
  return FROZEN_OPERATIONAL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function hasOperationalDensity(pathname: string): boolean {
  return !isFrozenOperationalSurface(pathname);
}

/** Safe for shared portal components that are rendered outside Layout. */
export function currentPathname(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname;
}
