// Trip mutations barrel: pure rules live in trip-mutations-shared, create/copy
// in trip-create, the figures update in trip-figure-updates, and small
// lifecycle ops in trip-lifecycle-ops. This file is the compatibility barrel —
// named re-exports only, importers unchanged.
export type {
  CommittedLegacyFuelInput,
  RevenueUpdateInput,
  StoredRevenue,
} from './trip-mutations-shared.service';
export {
  assertCustomerCommissionWithinRevenue,
  applyCommittedLegacyFuelFreeze,
  resolveRevenue,
  shouldMarkRevenueOverride,
  buildCopiedTripValues,
  buildCopiedTripLegValues,
} from './trip-mutations-shared.service';
export { createTrip, copyTrip } from './trip-create.service';
export { updateTripFigures } from './trip-figure-updates.service';
export type { TripFigureUpdateInput } from './trip-figure-updates.service';
export {
  getTripStatusOr404,
  markTripPodRecovered,
  updateDepartureDate,
  reassignTrip,
  deleteTrip,
} from './trip-lifecycle-ops.service';
