import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { configClient } from '../api/configClient';
import { qk } from '../api/keys';
import type { TableSortState } from '../lib/table-sort';
import type {
  Truck as TruckType,
  Driver as DriverType,
  FuelConfig,
  RoadConfig,
  CompanyInfo,
  SalaryPeriodRange,
  CapTableHistory,
  Port as PortType,
  ContainerType as ContainerTypeType,
} from '@tingting/shared';

export function useCapTable() {
  return useQuery<CapTableHistory[]>({
    queryKey: qk.catalogs.capTable,
    queryFn: () => configClient.getCapTable(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSalaryPeriod(month: number, year: number) {
  return useQuery<SalaryPeriodRange>({
    queryKey: qk.catalogs.salaryPeriod(month, year),
    queryFn: () => configClient.getSalaryPeriodResolve(month, year),
    staleTime: 30 * 60 * 1000,
    enabled: month >= 1 && month <= 12 && year >= 2000,
  });
}

export function useFuelConfig() {
  return useQuery<FuelConfig | null>({
    queryKey: qk.catalogs.fuelConfig,
    queryFn: () => configClient.getFuelConfig(),
    staleTime: 10 * 60 * 1000,
  });
}

export function useRoadConfig() {
  return useQuery<RoadConfig | null>({
    queryKey: qk.catalogs.roadConfig,
    queryFn: () => configClient.getRoadConfig(),
    staleTime: 10 * 60 * 1000,
  });
}

export function useCompanyInfo() {
  return useQuery<CompanyInfo>({
    queryKey: qk.catalogs.companyInfo,
    queryFn: () => configClient.getCompanyInfo(),
    staleTime: 10 * 60 * 1000,
  });
}

export function useTrucksAndDrivers(options?: { enabled?: boolean }) {
  return useQuery<{ trucks: TruckType[]; drivers: DriverType[] }>({
    queryKey: qk.catalogs.trucksDrivers,
    queryFn: async () => {
      const [trucks, drivers] = await Promise.all([
        configClient.getTrucks(),
        configClient.getDrivers(),
      ]);
      return { trucks, drivers };
    },
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useSuppliers(page?: number, search?: string, sort?: TableSortState | null) {
  return useQuery({
    // Sort fields ride the key (composed, not bare) so each order caches apart.
    queryKey: [...qk.catalogs.suppliers(page, search), sort?.by ?? null, sort?.dir ?? null],
    queryFn: () => configClient.getSuppliers(page, search, sort),
  });
}

export function useExpenseCategories(page?: number, search?: string) {
  return useQuery({
    queryKey: qk.catalogs.expenseCategories(page, search),
    queryFn: () => configClient.getExpenseCategories(page, search),
  });
}

/* ── Config mutations ── */

export function useSaveFuelConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof configClient.saveFuelConfig>[0]) =>
      configClient.saveFuelConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.catalogs.fuelConfig });
      queryClient.invalidateQueries({ queryKey: qk.configCounts.fuelConfig });
    },
  });
}

export function useSaveRoadConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof configClient.saveRoadConfig>[0]) =>
      configClient.saveRoadConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.catalogs.roadConfig });
    },
  });
}

export function useSaveCompanyInfo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof configClient.saveCompanyInfo>[0]) =>
      configClient.saveCompanyInfo(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.catalogs.companyInfo });
      queryClient.invalidateQueries({ queryKey: qk.configCounts.companyInfo });
    },
  });
}

/* ── Config entity queries (for pages that currently use raw api.get) ── */

export function usePorts() {
  return useQuery<PortType[]>({
    queryKey: qk.catalogs.ports,
    queryFn: () => configClient.getPorts(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useContainerTypes() {
  return useQuery<ContainerTypeType[]>({
    queryKey: qk.catalogs.containerTypes,
    queryFn: () => configClient.getContainerTypes(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useRoutesDropdown() {
  return useQuery({
    queryKey: qk.catalogs.routesDropdown,
    queryFn: () => configClient.getRoutesList(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAllCustomers() {
  return useQuery({
    queryKey: qk.catalogs.allCustomers,
    queryFn: () => configClient.getAllCustomers(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useRoadAllowances() {
  return useQuery({
    queryKey: qk.catalogs.roadAllowances,
    queryFn: () => configClient.getRoadAllowances(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useTrailers() {
  return useQuery({
    queryKey: qk.catalogs.trailers,
    queryFn: () => configClient.getTrailers(),
    staleTime: 5 * 60 * 1000,
  });
}

export function usePricingTables() {
  return useQuery({
    queryKey: qk.catalogs.pricingTables,
    queryFn: () => configClient.getPricingTables(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAllSuppliers() {
  return useQuery({
    queryKey: qk.catalogs.allSuppliers,
    queryFn: () => configClient.getAllSuppliers(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useTirePositions() {
  return useQuery({
    queryKey: qk.catalogs.tirePositions,
    queryFn: () => configClient.getTirePositions(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateTirePosition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof configClient.createTirePosition>[0]) =>
      configClient.createTirePosition(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.catalogs.tirePositions });
      queryClient.invalidateQueries({ queryKey: qk.configCounts.tirePositions });
    },
  });
}

export function useUpdateTirePosition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof configClient.updateTirePosition>[1] }) =>
      configClient.updateTirePosition(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.catalogs.tirePositions });
      queryClient.invalidateQueries({ queryKey: qk.configCounts.tirePositions });
    },
  });
}

export function useDeleteTirePosition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await configClient.deleteTirePosition(id);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.catalogs.tirePositions });
      queryClient.invalidateQueries({ queryKey: qk.configCounts.tirePositions });
    },
  });
}

export function useAllExpenseCategories() {
  return useQuery({
    queryKey: qk.catalogs.allExpenseCategories,
    queryFn: () => configClient.getAllExpenseCategories(),
    staleTime: 5 * 60 * 1000,
  });
}
