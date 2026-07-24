import { useQuery } from "@tanstack/react-query";
import { tripClient } from "../api/tripClient";
import type { CatalogData } from "../api/tripClient";
import { configClient } from "../api/configClient";
import type { PricingTable } from "@tingting/shared";
import { BOOTSTRAP_QUERY_KEY } from "./useCatalogs";
import { qk } from "../api/keys";

export interface SelectOption {
  id: number;
  label: string;
}

export interface DriverOption extends SelectOption {
  baseSalary: number;
}

export interface RouteOption extends SelectOption {
  name: string;
  distanceKm?: number;
  isMountain?: boolean;
  fixedFuelAllowance?: string | null;
  tollsStations?: number | null;
  driverSalary?: string | null;
  defaultLegs?: Array<{ origin: string; destination: string; km: number; loadingType: string }> | null;
}

export interface TruckOption extends SelectOption {
  currentTrailerId: number | null;
}

export interface TrailerOption extends SelectOption {
  type: string;
}

export interface TrailerTypeOption {
  value: string;
  label: string;
}

export interface TripOptions {
  customers: SelectOption[];
  carrierCustomers: SelectOption[];
  routes: RouteOption[];
  trucks: TruckOption[];
  trailerTypes: TrailerTypeOption[];
  drivers: DriverOption[];
  trailers: TrailerOption[];
  cargoTypes: SelectOption[];
  containerTypes: SelectOption[];
  pricingTables: PricingTable[];
  loading: boolean;
}

export function toDriverOption(driver: CatalogData['drivers'][number]): DriverOption {
  return {
    id: driver.id,
    label: driver.name,
    baseSalary: Number(driver.baseSalary) || 0,
  };
}

export function useTripOptions(): TripOptions {
  const bootstrapQuery = useQuery<CatalogData>({
    queryKey: BOOTSTRAP_QUERY_KEY,
    queryFn: () => tripClient.getBootstrap(),
    staleTime: 5 * 60 * 1000,
  });

  const pricingQuery = useQuery<PricingTable[]>({
    queryKey: qk.catalogs.pricingTables,
    staleTime: 5 * 60 * 1000,
    queryFn: () => configClient.getPricingTables(),
  });

  const catalog = bootstrapQuery.data;

  return {
    customers: catalog?.customers.map((c) => ({ id: c.id, label: c.name })) ?? [],
    carrierCustomers: catalog?.customers.filter(c => c.isCarrier).map(c => ({ id: c.id, label: c.name })) ?? [],
    routes:
      catalog?.routes.map((r) => ({
        id: r.id,
        label: `${r.name}${r.distanceKm ? ` (${r.distanceKm} km)` : ""}`,
        name: r.name,
        distanceKm: r.distanceKm ?? undefined,
        isMountain: r.isMountain,
        fixedFuelAllowance: r.fixedFuelAllowance,
        tollsStations: r.tollsStations,
        driverSalary: r.driverSalary,
        defaultLegs: r.defaultLegs,
      })) ?? [],
    trucks: catalog?.trucks.map((t) => ({ id: t.id, label: t.licensePlate, currentTrailerId: t.currentTrailerId ?? null })) ?? [],
    trailerTypes: [{ value: '20FT', label: '20FT' }, { value: '40FT', label: '40FT' }],
    drivers: catalog?.drivers.map(toDriverOption) ?? [],
    trailers: catalog?.trailers?.map((t) => ({ id: t.id, label: t.licensePlate, type: t.type })) ?? [],
    cargoTypes: catalog?.cargoTypes.map((c) => ({ id: c.id, label: c.name })) ?? [],
    containerTypes: catalog?.containerTypes.map((c) => ({ id: c.id, label: c.name || c.code || `Loại #${c.id}` })) ?? [],
    pricingTables: pricingQuery.data ?? [],
    loading: bootstrapQuery.isLoading || pricingQuery.isLoading,
  };
}
