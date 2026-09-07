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
