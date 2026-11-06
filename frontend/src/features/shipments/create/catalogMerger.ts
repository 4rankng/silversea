// Helpers for the create-form's inline catalogs. Lives in its own file so
// the workspace stays under its frozen structure-guard ceiling.
import type { Customer, Port, Route } from '@tingting/shared';
import type { CatalogData } from '../../../api/tripClient';

type CatalogMerger = (updater: (current: CatalogData | null) => CatalogData | null) => void;

/** Append or replace a customer in the bootstrap catalog. */
export function mergeCustomer(catalog: CatalogData | null, customer: Customer, merge: CatalogMerger) {
  if (!catalog) return;
  merge((current) => current ? {
    ...current,
    customers: [
      ...current.customers.filter((item) => item.id !== customer.id),
      customer,
    ],
  } : current);
}

/** Append or replace a port in the bootstrap catalog. */
export function mergePort(catalog: CatalogData | null, port: Port, merge: CatalogMerger) {
  if (!catalog) return;
  merge((current) => current ? {
    ...current,
    ports: [...(current.ports ?? []).filter((item) => item.id !== port.id), port],
  } : current);
}

/** Append or replace a route in the bootstrap catalog. The bootstrap
 *  carries routes with both `name` and `fullName` populated; the
 *  `RouteCreateDialog` returns a shorter record, so we normalise the two
 *  here. */
export function mergeRoute(catalog: CatalogData | null, route: Route, merge: CatalogMerger) {
  if (!catalog) return;
  merge((current) => current ? {
    ...current,
    routes: [
      ...current.routes.filter((item) => item.id !== route.id),
      { ...route, fullName: route.name, name: route.shortName || route.name },
    ],
  } : current);
}

/** SIL-335 (owner ruling 06/11 "ten hang tau go tay must be saved to db"):
 *  whether a typed carrier name still needs the catalog persist — it does
 *  when blank (nothing to persist) or when the bootstrap shippingLines list
 *  (DEFAULT ∪ active SHIPPING_LINE suppliers) does not already carry it.
 *  Case-insensitive on trimmed names, mirroring the server's dedupe. A
 *  missing catalog (bootstrap failed) conservatively returns true — the
 *  server side is idempotent (`created: false` for known names). */
export function shouldPersistShippingLine(name: string, catalog: CatalogData | null) {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (!catalog) return true;
  const normalized = trimmed.toLowerCase();
  return !(catalog.shippingLines ?? []).some((item) => item.name.trim().toLowerCase() === normalized);
}

/** Append a shipping-line name to the bootstrap catalog (dedupe by name,
 *  case-insensitive — the server dedupes display names case-insensitively
 *  too). Mirrors the server derivation after `createShippingLine` persisted
 *  the SHIPPING_LINE supplier — the local list stays a reflection of the
 *  shared catalog, never a substitute for it. */
export function mergeShippingLine(catalog: CatalogData | null, name: string, merge: CatalogMerger) {
  if (!catalog) return;
  const normalized = name.toLowerCase();
  merge((current) => current ? {
    ...current,
    shippingLines: [
      ...(current.shippingLines ?? []).filter((item) => item.name.trim().toLowerCase() !== normalized),
      { name },
    ],
  } : current);
}
