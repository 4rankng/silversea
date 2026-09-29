// Driver cost-screen assignment flag — card 20260928_166 AC2.
//
// Split out of driverClient rather than added to it: driverClient.ts sits at
// 689L against a frozen 691L structure-guard ceiling that only shrinks, so a
// new method there cannot land. Same idiom as depositRefundClient.ts.

import { api } from '../lib/api';

/** Path of the driver's incidental-cost list for a trip. */
const incidentalCosts = (tripId: number) => `/driver/me/trips/${tripId}/incidental-costs`;

/**
 * Does this trip's truck have a live phơi-phiếu accountant?
 *
 * A driver must NOT be able to read the assignment map —
 * `listTruckAccountantAssignments` is behind `requireFinance` — so the backend
 * answers a single boolean. The PM asked for the 13/26 truck split to make
 * checking road fees easier; measured on local data 32 of 40 trucks are
 * unassigned, so the caller must WARN and never block. Naming the assigned
 * accountant would leak the accounting rota, and on an unassigned truck there
 * is no one to name, so the flag is a boolean and nothing more.
 *
 * Defaults to `true` (no warning) when the field is absent, so an older
 * backend degrades quietly instead of alarming every driver.
 */
export async function tripHasPhoiPhieuAccountant(tripId: number): Promise<boolean> {
  const wire = await api.get<{ hasAccountant?: boolean }>(incidentalCosts(tripId));
  return wire.hasAccountant !== false;
}
