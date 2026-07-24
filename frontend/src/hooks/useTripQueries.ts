import { useQuery } from '@tanstack/react-query';
import { tripClient } from '../api/tripClient';
import { configClient } from '../api/configClient';
import { financialClient } from '../api/financialClient';
import { qk } from '../api/keys';
import type { TripDetail, Truck as TruckType, Driver as DriverType } from '@tingting/shared';
import { useSalaryPeriod } from './useCatalogQueries';

export interface NormalizedTrip {
  id: number;
  customerId: number;
  customerName: string;
  customerReference?: string;
  truckId: number;
  truckPlate: string;
  driverId: number;
  driverName: string;
  routeId: number;
  routeName: string;
  trailerType: string;
  cargoTypeId: number;
  status: string;
  departureDate: string;
  notes?: string;
  tripCode?: string;
  carrierType?: 'OWN' | 'EXTERNAL';
  externalCarrierId?: number | null;
  externalPlateNumber?: string | null;
  externalDriverName?: string | null;
  externalDriverPhone?: string | null;
}

export function normalizeTrip(t: TripDetail): NormalizedTrip {
  const isExternal = t.carrierType === 'EXTERNAL';
  return {
    id: t.id,
    customerId: t.customerId,
    customerName: t.customer?.name ?? '',
    customerReference: t.customerReference ?? undefined,
    truckId: t.truckId,
    truckPlate: isExternal ? (t.externalPlateNumber ?? 'Xe ngoài') : (t.truck?.licensePlate ?? ''),
    driverId: t.driverId,
    driverName: isExternal ? (t.externalDriverName ?? 'Lái xe ngoài') : (t.driver?.name ?? ''),
    routeId: t.routeId,
    routeName: t.route?.name ?? '',
    trailerType: t.trailerType ?? '',
    cargoTypeId: t.cargoTypeId,
    status: t.status,
    departureDate: t.departureDate ?? '',
    notes: t.notes ?? undefined,
    tripCode: t.tripCode ?? undefined,
    carrierType: t.carrierType as 'OWN' | 'EXTERNAL' | undefined,
    externalCarrierId: t.externalCarrierId,
    externalPlateNumber: t.externalPlateNumber,
    externalDriverName: t.externalDriverName,
    externalDriverPhone: t.externalDriverPhone,
  };
}

export function useTripDetail(id: string | undefined) {
  return useQuery<TripDetail>({
    queryKey: qk.trips.detail(id),
    enabled: !!id,
    queryFn: () => tripClient.getTrip(Number(id)),
  });
}

export function useTripAdjustments(id: number) {
  return useQuery({
    queryKey: qk.trips.adjustments(id),
    enabled: id > 0,
    queryFn: () => tripClient.getAdjustments(id),
    select: (data) => data.items,
  });
}

export function useTripCosts(month: number, year: number) {
  const salaryPeriodQuery = useSalaryPeriod(month, year);

  const tripsQuery = useQuery<TripDetail[]>({
    queryKey: qk.trips.costs(month, year, salaryPeriodQuery.data?.start),
    enabled: !!salaryPeriodQuery.data,
    queryFn: async () => {
      const res = await tripClient.listTrips({
        status: 'LOCKED',
        limit: 100,
        dateFrom: salaryPeriodQuery.data!.start,
        dateTo: salaryPeriodQuery.data!.end,
      });
      return res.items;
    },
    staleTime: 2 * 60 * 1000,
  });

  return {
    ...tripsQuery,
    salaryPeriod: salaryPeriodQuery.data,
  };
}

export function useMonthlyTrips(year: number, month: number) {
  const salaryPeriodQuery = useSalaryPeriod(month, year);

  const tripsQuery = useQuery<TripDetail[]>({
    queryKey: qk.trips.monthly(year, month, salaryPeriodQuery.data?.start),
    enabled: !!salaryPeriodQuery.data,
    queryFn: async () => {
      const res = await tripClient.fetchAllTrips({
        limit: 100,
        dateFrom: salaryPeriodQuery.data!.start,
        dateTo: salaryPeriodQuery.data!.end,
      });
      return res.items;
    },
    staleTime: 2 * 60 * 1000,
  });

  return {
    ...tripsQuery,
    salaryPeriod: salaryPeriodQuery.data,
  };
}

export function useCreatedTrips() {
  return useQuery<TripDetail[]>({
    queryKey: qk.trips.created,
    queryFn: async () => {
      const res = await tripClient.listTrips({ status: 'CREATED', limit: 100 });
      return res.items;
    },
  });
}

export function useDispatchData() {
  return useQuery<{
    drivers: DriverType[];
    trucks: TruckType[];
    pendingTrips: NormalizedTrip[];
    activeTrips: NormalizedTrip[];
    pendingTotal: number;
    activeTotal: number;
  }>({
    queryKey: qk.trips.dispatch,
    queryFn: async () => {
      const [driversRes, trucksRes, pendingRes, activeRes] = await Promise.all([
        configClient.getDrivers(),
        configClient.getTrucks(),
        tripClient.fetchAllTrips({ status: 'CREATED' }),
        tripClient.fetchAllTrips({ status: 'IN_TRANSIT' }),
      ]);
      return {
        drivers: driversRes,
        trucks: trucksRes,
        pendingTrips: pendingRes.items.map(normalizeTrip),
        activeTrips: activeRes.items.map(normalizeTrip),
        pendingTotal: pendingRes.total,
        activeTotal: activeRes.total,
      };
    },
  });
}

/**
 * Live fleet positions — polled every 25s to match the backend GPS cache TTL.
 * Mirrors the `useUnreadCount` / `useBadgeCounts` polling precedent. Degrades
 * gracefully: `data.error` is set when the provider is unavailable.
 *
 * `enabled` defaults on (Dispatch page). Trip-detail passes `enabled` gated to
 * IN_TRANSIT trips so viewing a completed/cancelled trip doesn't poll the GPS
 * cache forever.
 */
export function useLiveFleet(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.liveFleet.all,
    queryFn: () => tripClient.getLiveFleet(),
    enabled: options?.enabled ?? true,
    refetchInterval: 10_000,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useBadgeCounts(options?: { enabled?: boolean }) {
  return useQuery<{ dispatchCount: number; penaltiesCount: number }>({
    queryKey: qk.trips.badgeCounts,
    queryFn: async () => {
      const [tripsRes, penaltiesRes] = await Promise.all([
        tripClient.listTrips({ status: 'CREATED', limit: 1 }),
        financialClient.getPenalties(),
      ]);
      return {
        dispatchCount: tripsRes.total ?? 0,
        penaltiesCount: penaltiesRes.total ?? 0,
      };
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    enabled: options?.enabled ?? true,
  });
}
