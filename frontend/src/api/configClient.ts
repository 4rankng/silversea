import { api, fileCommandFingerprint } from '../lib/api';
import { toQuery } from '../lib/http/query';
import { fetchAllPaginated } from '../lib/http/paginate';
import type { PendingGovernanceResponse } from '../lib/governance';
import { CONFIG } from '@tingting/shared';
import type {
  Truck,
  Driver,
  FuelConfig, FuelPriceHistory,
  RoadConfig,
  CompanyInfo,
  SalaryPeriodRange,
  CapTableHistory,
  Supplier,
  ExpenseCategory,
  PaginatedResponse,
  Port,
  TirePosition,
  ContainerType,
  SealType,
  Route,
  RouteInput,
  Customer,
  PenaltyReason,
  RoadAllowance,
  Trailer,
  PricingTable,
  DebitNoteTemplate,
  DebitNoteTemplateInput,
  BillingDocumentType,
} from '@tingting/shared';

export const configClient = {
  getCustomers: async (page: number, search: string) => {
    const qs = toQuery({ page, limit: '10', search: search || undefined });
    return api.get<{ items: Customer[]; total: number }>(`${CONFIG.CUSTOMERS}${qs}`);
  },

  // DB-owned zone taxonomy (dispatch_zones) — drives port classification and
  // every zone-scoped dispatch surface; no zone constants exist client-side.
  // /active = active-only rows for dispatch readers (any config-read role);
  // the bare /dispatch-zones factory list (all statuses) is ADMIN-managed.
  getDispatchZones: () => api.get<{ items: Array<{ code: string; label: string; sortOrder: number }> }>(`${CONFIG.DISPATCH_ZONES}/active`),

  getTrucks: () => fetchAllPaginated<Truck>(CONFIG.TRUCKS),

  getDrivers: () => fetchAllPaginated<Driver>(CONFIG.DRIVERS),

  getSuppliers: async (page?: number, search?: string) =>
    api.get<PaginatedResponse<Supplier>>(
      `${CONFIG.SUPPLIERS}${toQuery({ page, limit: '10', search })}`,
    ),

  getExpenseCategories: async (page?: number, search?: string) =>
    api.get<PaginatedResponse<ExpenseCategory>>(
      `${CONFIG.EXPENSE_CATEGORIES}${toQuery({ page, search })}`,
    ),

  getCapTable: () => fetchAllPaginated<CapTableHistory>(CONFIG.CAP_TABLE),

  getFuelConfig: () => api.get<FuelConfig | null>(CONFIG.FUEL_CONFIG),

  saveFuelConfig: (data: {
    loadedNorm: number; emptyNorm: number; supplement: number;
    unitPrice: number; baseUnitPrice?: number | null; warningThreshold: number; criticalThreshold: number;
  }) => api.put<FuelConfig | PendingGovernanceResponse>(CONFIG.FUEL_CONFIG, data),

  getCompanyInfo: () => api.get<CompanyInfo>(CONFIG.COMPANY_INFO),

  saveCompanyInfo: (data: CompanyInfo) =>
    api.put<CompanyInfo | PendingGovernanceResponse>(CONFIG.COMPANY_INFO, data),

  uploadCompanyLogo: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.upload('/upload/company-logo', formData, {
      retryFingerprint: ['company-logo-upload', fileCommandFingerprint(file)].join(':'),
    }) as Promise<{ storageKey: string; url: string }>;
  },

  getRoadConfig: () => api.get<RoadConfig | null>(CONFIG.ROAD_CONFIG),

  saveRoadConfig: (data: {
    tollPerStation: number; returnCargoBonus: number;
    defaultDriverSalary: number; twoPointDeliveryBonus: number;
    vehicleShiftDefault: number;
  }) => api.put<RoadConfig | PendingGovernanceResponse>(CONFIG.ROAD_CONFIG, data),

  getPorts: () => fetchAllPaginated<Port>(CONFIG.PORTS),

  getTirePositions: () => fetchAllPaginated<TirePosition>(CONFIG.TIRE_POSITIONS),
  createTirePosition: (data: { name: string; sortOrder?: number; status?: 'ACTIVE' | 'INACTIVE' }) =>
    api.post<TirePosition>(CONFIG.TIRE_POSITIONS, data),
  updateTirePosition: (id: number, data: Partial<{ name: string; sortOrder: number; status: 'ACTIVE' | 'INACTIVE' }>) =>
    api.put<TirePosition>(CONFIG.TIRE_POSITION(id), data),
  deleteTirePosition: (id: number) => api.delete<{ ok: true }>(CONFIG.TIRE_POSITION(id)),

  getContainerTypes: () => fetchAllPaginated<ContainerType>(CONFIG.CONTAINER_TYPES),

  getSealTypes: () => fetchAllPaginated<SealType>(CONFIG.SEAL_TYPES),
  createSealType: (data: { name: string }) => api.post<SealType>(CONFIG.SEAL_TYPES, data),

  getRoutesList: (search?: string) =>
    fetchAllPaginated<Route>(CONFIG.ROUTES, search ? { search } : undefined),

  createRoute: (data: RouteInput) => api.post<Route>(CONFIG.ROUTES, data),

  getAllCustomers: (search?: string) =>
    fetchAllPaginated<Customer>(CONFIG.CUSTOMERS, search ? { search } : undefined),

  getSalaryPeriodResolve: (month: number, year: number) =>
    api.get<SalaryPeriodRange>(`${CONFIG.SALARY_PERIOD_RESOLVE}${toQuery({ month, year })}`),

  getPenaltyReasons: () => fetchAllPaginated<PenaltyReason>(CONFIG.PENALTY_REASONS),

  getFuelPriceHistory: () => api.get<FuelPriceHistory[]>(CONFIG.FUEL_PRICE_HISTORY),

  getRoadAllowances: () => fetchAllPaginated<RoadAllowance>(CONFIG.ROAD_ALLOWANCES),

  getTrailers: () => fetchAllPaginated<Trailer>(CONFIG.TRAILERS),

  getPricingTables: () => fetchAllPaginated<PricingTable>(CONFIG.PRICING_TABLES),

  getAllSuppliers: () => fetchAllPaginated<Supplier>(CONFIG.SUPPLIERS),

  getAllExpenseCategories: () => fetchAllPaginated<ExpenseCategory>(CONFIG.EXPENSE_CATEGORIES),

  // ─── Debit-note (Giấy báo nợ) templates ────────────────────────────────────
  /** All templates, unpaginated — for the config page list + dropdowns. */
  getDebitNoteTemplates: (documentType?: BillingDocumentType) =>
    fetchAllPaginated<DebitNoteTemplate>(
      CONFIG.DEBIT_NOTE_TEMPLATES,
      documentType ? { documentType } : undefined,
    ),

  getDebitNoteTemplate: (id: number) =>
    api.get<DebitNoteTemplate>(CONFIG.DEBIT_NOTE_TEMPLATE(id)),

  saveDebitNoteTemplate: (data: DebitNoteTemplateInput) =>
    api.post<DebitNoteTemplate | PendingGovernanceResponse>(CONFIG.DEBIT_NOTE_TEMPLATES, data),

  updateDebitNoteTemplate: (id: number, data: DebitNoteTemplateInput) =>
    api.put<DebitNoteTemplate | PendingGovernanceResponse>(CONFIG.DEBIT_NOTE_TEMPLATE(id), data),

  deleteDebitNoteTemplate: (id: number) =>
    api.delete<{ ok: true } | PendingGovernanceResponse>(CONFIG.DEBIT_NOTE_TEMPLATE(id)),
};
