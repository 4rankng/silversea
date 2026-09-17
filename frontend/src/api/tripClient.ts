import { api } from '../lib/api';
import { toQuery } from '../lib/http/query';
import type { TableSortDir } from '../lib/table-sort';
import { TRIPS, CATALOGS } from '@tingting/shared';
import type {
  Trip,
  TripDetail,
  TripPairRecord,
  TripExpense,
  TripInstruction,
  CreateTripRequest,
  CreateTripPairRequest,
  UpdateTripFiguresRequest,
  BulkUpdateTripFiguresRequest,
  BulkUpdateTripFiguresResponse,
  PaginatedResponse,
} from '@tingting/shared';

/**
 * Shape of the `/catalogs/bootstrap` blob. The canonical type lives here in the
 * API layer (the natural home for response shapes) and is re-exported by
 * `useCatalogs` so existing imports keep working. Drivers/forwarders receive a
 * portal-filtered subset; the fields those roles never see are nullable-tolerant
 * at the consumers, so this superset type is safe for both.
 */
export interface CatalogData {
  customers: Array<{ id: number; name: string; fullName?: string; shortName?: string; contactPerson: string | null; phone: string | null; isCarrier: boolean; linkedSupplierId: number | null }>;
  externalCarriers: Array<{ id: number; name: string; fullName?: string; isActive: boolean }>;
  trucks: Array<{ id: number; licensePlate: string; trailerPlateNumber: string | null; trailerType: '20FT' | '40FT' | null; currentTrailerId: number | null }>;
  drivers: Array<{ id: number; name: string; assignedTruckId: number | null; baseSalary: string | null }>;
  routes: Array<{ id: number; name: string; fullName?: string; shortName?: string; distanceKm: number | null; isMountain: boolean; fixedFuelAllowance: string | null; tollsStations: number | null; driverSalary: string | null; defaultLegs: Array<{ origin: string; destination: string; km: number; loadingType: string }> | null }>;
  cargoTypes: Array<{ id: number; name: string; requiresPhotos: boolean }>;
  trailers: Array<{ id: number; licensePlate: string; type: string; status: string }>;
  containerTypes: Array<{ id: number; code: string; name: string }>;
  ports: Array<{ id: number; name: string; code: string | null; city: string | null }>;
  forwarderExpenseTypes: Array<{
    id: number;
    code: string;
    name: string;
    requiresInvoice?: boolean;
    substituteEvidenceAllowed?: boolean;
    noInvoiceEvidenceTypes?: string[];
    noInvoicePerItemLimit?: string | null;
    noInvoicePerDayLimit?: string | null;
    defaultMarkup?: boolean;
    billingLabel?: string | null;
    vatRate?: string | null;
  }>;
  suppliers: Array<{ id: number; name: string; status: string }>;
  businessUnits?: Array<{ id: number; code: string | null; name: string }>;
  shippingLines?: Array<{ id?: number; name: string }>;
}

type ListTripsParams = {
  status?: string;
  limit?: number;
  page?: number;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  truckId?: number;
  driverId?: number;
  customerId?: number;
  /** Server-side sort (GET /api/trips whitelist); absent = default order. */
  sortBy?: string;
  sortDir?: TableSortDir;
};

export const tripClient = {
  listTrips: (params?: ListTripsParams) =>
    api.get<PaginatedResponse<TripDetail>>(`${TRIPS.LIST}${toQuery(params)}`),

  /** Fetch all pages of trips for a given filter set. */
  fetchAllTrips: async (
    params: Omit<ListTripsParams, 'page'> & { limit?: number },
  ): Promise<{ items: TripDetail[]; total: number }> => {
    const pageSize = params.limit ?? 100;
    const first = await tripClient.listTrips({ ...params, limit: pageSize, page: 1 });
    const totalPages = Math.ceil(first.total / pageSize);
    if (totalPages <= 1) return { items: first.items, total: first.total };
    const remaining = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) =>
        tripClient.listTrips({ ...params, limit: pageSize, page: i + 2 }),
      ),
    );
    return {
      items: [first, ...remaining].flatMap((r) => r.items),
      total: first.total,
    };
  },

  getTripsSummary: (params?: { dateFrom?: string; dateTo?: string }) =>
    api.get<{
      statusCounts: Record<string, number>;
      totalKm: number;
      totalFuel: number;
      totalRoad: number;
      totalRevenue: number;
      missingFuel: number;
      avgPer100: number;
      truckOptions: Array<{ id: number; licensePlate: string }>;
      customerOptions: Array<{ id: number; name: string }>;
    }>(`${TRIPS.LIST}/summary${toQuery(params)}`),

  getTrip: (id: number) => api.get<TripDetail>(TRIPS.DETAIL(id)),

  getAdjustments: (id: number) => api.get<{ items: Record<string, unknown>[] }>(TRIPS.ADJUSTMENTS(id)),

  createTrip: (data: CreateTripRequest) => api.post<Trip>(TRIPS.CREATE, data),

  copyTrip: (id: number) => api.post<Trip>(TRIPS.COPY(id), {}),

  updateTripPreDeparture: (
    id: number,
    data: UpdateTripFiguresRequest,
    opts?: { expectedUpdatedAt?: string },
  ) => api.put<Trip>(TRIPS.PRE_DEPARTURE(id), data, opts),

  updateTripActuals: (
    id: number,
    data: UpdateTripFiguresRequest,
    opts?: { expectedUpdatedAt?: string },
  ) => api.put<Trip>(TRIPS.ACTUALS(id), data, opts),

  bulkUpdateTripFigures: (data: BulkUpdateTripFiguresRequest) =>
    api.post<BulkUpdateTripFiguresResponse>(TRIPS.BULK_FIGURES, data),

  dispatchTrip: (id: number) => api.post<Trip>(TRIPS.DISPATCH(id), {}),

  createPair: (data: CreateTripPairRequest) => api.post<TripPairRecord>(TRIPS.PAIRS, data),

  lockTrip: (id: number, confirmZeroRevenue?: boolean, confirmNoPhoto?: boolean) =>
    api.post<Trip>(TRIPS.LOCK(id), { confirmZeroRevenue, confirmNoPhoto }),

  cancelTrip: (id: number) => api.post<Trip>(TRIPS.CANCEL(id), {}),

  reassignTrip: (id: number, data: { carrierType?: 'OWN' | 'EXTERNAL', truckId?: number | null, driverId?: number | null, externalCarrierId?: number | null, externalPlateNumber?: string | null, externalDriverName?: string | null, externalDriverPhone?: string | null, expectedVersion?: number }) =>
    api.patch<TripDetail>(TRIPS.REASSIGN(id), data),

  getPricing: (customerId: number, routeId: number, date?: string) =>
    api.get<{ price: number }>(
      `${CATALOGS.PRICING}${toQuery({ customerId, routeId, date })}`,
    ),

  // Bootstrap returns the full catalog blob consumed by useCatalogs.
  getBootstrap: () => api.get<CatalogData>(CATALOGS.BOOTSTRAP),

  listTripExpenses: (tripId: number) =>
    api.get<{ items: TripExpense[] }>(TRIPS.EXPENSES(tripId)),

  createTripExpense: (tripId: number, data: object) =>
    api.post<TripExpense>(TRIPS.EXPENSES(tripId), data),

  updateTripExpense: (tripId: number, eid: number, data: object) =>
    api.put<TripExpense>(TRIPS.EXPENSE(tripId, eid), data),

  deleteTripExpense: (tripId: number, eid: number) =>
    api.delete<{ ok: boolean }>(TRIPS.EXPENSE(tripId, eid)),

  // ─── Trip instructions (N2 / B1.3) ──────────────────────────────────────────
  // Manager-authored contact + free-text guidance. Returns null when no row
  // exists yet.
  getTripInstructions: (tripId: number) =>
    api.get<TripInstruction | null>(TRIPS.INSTRUCTIONS(tripId)),

  upsertTripInstructions: (
    tripId: number,
    data: { contactName?: string | null; contactPhone?: string | null; notes?: string | null },
  ) => api.put<TripInstruction>(TRIPS.INSTRUCTIONS(tripId), data),
};
