import type { DispatchDetailPlanFilters } from '../../../api/dispatchPlanningClient';

export interface DetailedPlanFilterState extends DispatchDetailPlanFilters {
  q: string;
  date: string;
  /** Inclusive transport-date scope: single day (presets) or range (popover).
   *  The topbar month scope writes dateFrom/dateTo (card 20260922_32); the
   *  screen presets overwrite both. */
  dateFrom: string;
  dateTo: string;
  direction: 'IMPORT' | 'EXPORT' | '';
  assignmentStatus: 'UNASSIGNED' | 'ASSIGNED' | '';
  pickupIds: number[];
  dropoffIds: number[];
  deliveryPointIds: number[];
  hourFrom: string;
  hourTo: string;
  /** Zone code from the DB taxonomy; '' = no zone filter. */
  zone: string;
  /** Exact-match customer scope; null = Tất cả (card 20260926_50). */
  customerId: number | null;
  /** '' = Tất cả; COMPLETE/MISSING intake-data predicate (card _50). */
  dataStatus: 'COMPLETE' | 'MISSING' | '';
  /** Card 20260927_61 advanced filters (CHIEF rulings 27/09). Assignment-
   *  scoped fields match the EFFECTIVE assignment; routeId rides the LOT. */
  truckPlate: string;
  driverId: number | null;
  carrierClass: 'OWN' | 'EXTERNAL' | '';
  trailerType: '20FT' | '40FT' | '';
  routeId: number | null;
}

export const EMPTY_DETAILED_PLAN_FILTERS: DetailedPlanFilterState = {
  q: '',
  date: '',
  dateFrom: '',
  dateTo: '',
  direction: '',
  assignmentStatus: '',
  pickupIds: [],
  dropoffIds: [],
  deliveryPointIds: [],
  hourFrom: '',
  hourTo: '',
  zone: '',
  customerId: null,
  dataStatus: '',
  truckPlate: '',
  driverId: null,
  carrierClass: '',
  trailerType: '',
  routeId: null,
};

export function createDefaultDetailedPlanFilters(): DetailedPlanFilterState {
  // No default transport date — /dispatch parity: the grid lists all allocated
  // fulfillments until the dispatcher filters by an explicit day.
  return { ...EMPTY_DETAILED_PLAN_FILTERS };
}

export type DetailPlanSortKey = 'runHour' | 'deliveryPoint' | 'customer' | null;
export type DetailPlanSortDirection = 'asc' | 'desc';

/** Query params shared by the list, load-more, and refresh requests. */
export function detailPlanQuery(filters: DetailedPlanFilterState, q: string) {
  return {
    ...(q ? { q } : {}),
    ...(filters.date ? { date: filters.date } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
    ...(filters.direction ? { direction: filters.direction } : {}),
    ...(filters.assignmentStatus ? { assignmentStatus: filters.assignmentStatus } : {}),
    ...(filters.pickupIds.length > 0 ? { pickupIds: filters.pickupIds } : {}),
    ...(filters.dropoffIds.length > 0 ? { dropoffIds: filters.dropoffIds } : {}),
    ...(filters.deliveryPointIds.length > 0 ? { deliveryPointIds: filters.deliveryPointIds } : {}),
    ...(filters.hourFrom ? { hourFrom: filters.hourFrom } : {}),
    ...(filters.hourTo ? { hourTo: filters.hourTo } : {}),
    ...(filters.zone ? { zone: filters.zone } : {}),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.dataStatus ? { dataStatus: filters.dataStatus } : {}),
    ...(filters.truckPlate ? { truckPlate: filters.truckPlate } : {}),
    ...(filters.driverId ? { driverId: filters.driverId } : {}),
    ...(filters.carrierClass ? { carrierClass: filters.carrierClass } : {}),
    ...(filters.trailerType ? { trailerType: filters.trailerType } : {}),
    ...(filters.routeId ? { routeId: filters.routeId } : {}),
  };
}

/** View signature of the in-flight/last fetch — page + every enumerated
 * filter. Lets the hook tell a real view change from a background refresh
 * tick without duplicating the field list in the component file. */
export function detailPlanViewSignature(page: number, q: string, filters: DetailedPlanFilterState) {
  return JSON.stringify([
    page,
    q,
    filters.date,
    filters.dateFrom,
    filters.dateTo,
    filters.direction,
    filters.assignmentStatus,
    filters.pickupIds,
    filters.dropoffIds,
    filters.deliveryPointIds,
    filters.hourFrom,
    filters.hourTo,
    filters.zone,
    filters.customerId,
    filters.dataStatus,
    filters.truckPlate,
    filters.driverId,
    filters.carrierClass,
    filters.trailerType,
    filters.routeId,
  ]);
}
