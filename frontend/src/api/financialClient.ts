import { api } from '../lib/api';
import { toQuery } from '../lib/http/query';
import { fetchAllPaginated } from '../lib/http/paginate';
import { FINANCIAL, REPORTS, WORKSPACES } from '@tingting/shared';
import type {
  AccountantWorkInboxItem,
  LedgerEntry,
  CustomerStatement,
  PayableSummary,
  PayablesCategory,
  SupplierStatement,
  ExpenseWithRefs,
  PaginatedResponse,
  Penalty,
  AdvanceSettlementWithRefs,
  BillingDocument,
  BillingDocumentDraft,
  BillingDocumentEntityType,
  BillingDocumentType,
  SaveBillingDocumentInput,
  WorkInboxResponseOf,
  GenerateBillingDocumentInput,
} from '@tingting/shared';

export type FuelInvoiceStatus = 'DRAFT' | 'RECORDED' | 'VOIDED' | 'REVERSED' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface FuelInvoiceAllocation {
  id?: number;
  fuelInvoiceId?: number;
  tripId: number;
  truckId: number | null;
  tripExpenseId: number | null;
  voucherReference: string;
  voucherDate: string;
  liters: string;
  amount: string;
  note: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface FuelInvoice {
  id: number;
  version: number;
  supplierId: number;
  invoiceNumber: string;
  invoiceDate: string;
  currency: 'VND';
  totalLiters: string;
  unitPrice: string;
  totalAmount: string;
  approvalStatus: FuelInvoiceStatus;
  note: string | null;
  createdBy: number | null;
  approvedBy: number | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  allocations?: FuelInvoiceAllocation[];
}

export interface FuelInvoiceAllocationInput {
  tripId: number;
  truckId?: number | null;
  tripExpenseId?: number | null;
  voucherReference: string;
  voucherDate: string;
  liters: number;
  note?: string | null;
}

export interface FuelInvoiceInput {
  supplierId: number;
  invoiceNumber: string;
  invoiceDate: string;
  totalLiters: number;
  unitPrice: number;
  note?: string | null;
  allocations: FuelInvoiceAllocationInput[];
}

export interface CustomerAging {
  customerId: number;
  customerName: string;
  contactInfo: string | null;
  linkedSupplierId: number | null;
  linkedSupplierApBalance: number;
  netBalance: number;
  totalOutstanding: number;
  aging: { current: number; d30: number; d60: number; over90: number };
  maxOverdueDays: number;
}

export interface CustomerAgingResponse {
  customers: CustomerAging[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  /** Full-set aggregates for the KPI strip (server-computed, page-independent). */
  totals: {
    total: number;
    current: number; d30: number; d60: number; over90: number;
    currentCusts: number; d30Custs: number; d60Custs: number; over90Custs: number;
    overdueCount: number;
    highRiskCount: number;
  };
}

export const financialClient = {
  getWorkInbox: (view: 'ACTION' | 'WAITING', page = 1, sort?: { sortBy?: string; sortDir?: 'asc' | 'desc' }) =>
    api.get<WorkInboxResponseOf<AccountantWorkInboxItem>>(
      `${WORKSPACES.FINANCIAL_INBOX}${toQuery({ view, page, limit: 100, sortBy: sort?.sortBy, sortDir: sort?.sortDir })}`,
    ),

  getLedgerEntries: (params?: { entityType?: string; limit?: number }) =>
    api.get<PaginatedResponse<LedgerEntry>>(
      `${FINANCIAL.LEDGER}${toQuery(params)}`,
    ),

  getAllLedgerEntries: (params?: { entityType?: string }) =>
    fetchAllPaginated<LedgerEntry>(
      FINANCIAL.LEDGER,
      params?.entityType ? { entityType: params.entityType } : undefined,
    ),

  getCustomerStatement: (id: number, range?: { dateFrom?: string; dateTo?: string }) =>
    api.get<CustomerStatement>(
      `${FINANCIAL.CUSTOMER_STATEMENT(id)}${toQuery(range)}`,
    ),

  getSupplierStatement: (id: number, range?: { dateFrom?: string; dateTo?: string }) =>
    api.get<SupplierStatement>(
      `${FINANCIAL.SUPPLIER_STATEMENT(id)}${toQuery(range)}`,
    ),

  getCarrierPayableStatement: (id: number, range?: { dateFrom?: string; dateTo?: string }) =>
    api.get<SupplierStatement>(
      `${FINANCIAL.CARRIER_PAYABLE_STATEMENT(id)}${toQuery(range)}`,
    ),

  getPenalties: (params?: Record<string, string>) =>
    api.get<PaginatedResponse<Penalty>>(
      `${FINANCIAL.PENALTIES}${toQuery(params as Record<string, string | number | undefined>)}`,
    ),

  getExpenses: (filters?: {
    truckId?: number;
    supplierId?: number;
    categoryId?: number;
    fromDate?: string;
    toDate?: string;
    page?: number;
    pageSize?: number;
  }) =>
    api.get<PaginatedResponse<ExpenseWithRefs>>(
      `${FINANCIAL.EXPENSES}${toQuery(filters)}`,
    ),

  getPayablesSummary: (params?: {
    category?: PayablesCategory;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
  }) =>
    api.get<{
      items: PayableSummary[];
      totalOutstanding: string;
      totalSuppliers: number;
      overdueSuppliers: number;
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      totals: {
        current: number; d30: number; d60: number; over90: number;
        currentCount: number; d30Count: number; d60Count: number; over90Count: number;
      };
    }>(`${REPORTS.PAYABLES_SUMMARY}${toQuery(params)}`),

  getFuelInvoices: async (filters?: { supplierId?: number; status?: FuelInvoiceStatus }) => {
    const items: FuelInvoice[] = [];
    let cursor: string | undefined;
    do {
      const page = await api.get<{ items: FuelInvoice[]; nextCursor: string | null }>(
        `${FINANCIAL.FUEL_INVOICES}${toQuery({
          ...filters,
          paginated: true,
          limit: 100,
          cursor,
        })}`,
      );
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
  },

  getFuelInvoice: (id: number) =>
    api.get<FuelInvoice>(FINANCIAL.FUEL_INVOICE(id)),

  createFuelInvoice: (data: FuelInvoiceInput) =>
    api.post<FuelInvoice>(FINANCIAL.FUEL_INVOICES, data),

  updateFuelInvoice: (id: number, data: FuelInvoiceInput, expectedVersion: number) =>
    api.put<FuelInvoice>(FINANCIAL.FUEL_INVOICE(id), {
      ...data,
      expectedVersion,
    }),

  postCommission: (data: { supplierId: number; amount: number; tripId?: number; note?: string }) =>
    api.post<{ ok: true }>(FINANCIAL.COMMISSIONS, data),

  getCustomerAging: (params?: { search?: string; page?: number; limit?: number; bucket?: 'all' | 'current' | 'd30' | 'd60' | 'over90'; sortBy?: string; sortDir?: 'asc' | 'desc' }) => {
    const search = params?.search?.trim() || undefined;
    return api.get<CustomerAgingResponse>(
      `${REPORTS.RECEIVABLES_AGING}${toQuery({ search, page: params?.page, limit: params?.limit, bucket: params?.bucket && params.bucket !== 'all' ? params.bucket : undefined, sortBy: params?.sortBy, sortDir: params?.sortDir })}`,
    );
  },

  getAdminSettlementDetail: (id: number) =>
    api.get<AdvanceSettlementWithRefs>(FINANCIAL.ADVANCE_SETTLEMENT_DETAIL(id)),

  getSettlementExportUrl: (id: number, format: 'xlsx' | 'pdf') =>
    `/api${FINANCIAL.ADVANCE_SETTLEMENT_EXPORT(id, format)}`,

  getAdvanceBalances: () =>
    api.get<{
      totalOutstanding: string;
      items: Array<{ forwarderId: number; name: string | null; outstanding: string }>;
    }>(FINANCIAL.ADVANCE_BALANCES),

  postDriverPayout: (driverId: number, data: {
    amount: number;
    method: 'CASH' | 'BANK';
    payoutDate: string;
    note?: string;
    receiptId?: string;
  }) => api.post<{ id: number }>(FINANCIAL.DRIVER_PAYOUT(driverId), data),

  // ─── Billing documents (debit notes + payment statements) ───────────────────
  generateBillingDraft: (data: GenerateBillingDocumentInput) =>
    api.post<BillingDocumentDraft>(FINANCIAL.BILLING_DOCUMENT_GENERATE, data),

  saveBillingDocument: (data: SaveBillingDocumentInput) =>
    api.post<BillingDocument>(FINANCIAL.BILLING_DOCUMENTS, data),

  updateBillingDocument: (id: number, data: SaveBillingDocumentInput) =>
    api.put<BillingDocument>(FINANCIAL.BILLING_DOCUMENT(id), data),

  listBillingDocuments: (entityType: BillingDocumentEntityType, entityId: number, type?: BillingDocumentType) =>
    api.get<BillingDocument[]>(
      `${FINANCIAL.BILLING_DOCUMENTS}${toQuery({ entityType, entityId, type })}`,
    ),

  getBillingDocument: (id: number) =>
    api.get<BillingDocument>(FINANCIAL.BILLING_DOCUMENT(id)),

  /** §7.2 issue request; 409 carries details:[{message}] per missing condition. */
  issueBillingDocument: (id: number, data: { expectedVersion: number; reason: string }) =>
    api.post<unknown>(FINANCIAL.BILLING_DOCUMENT_ISSUE(id), data),

  deleteBillingDocument: (id: number) =>
    api.delete<{ ok: true }>(FINANCIAL.BILLING_DOCUMENT(id)),

  /** Direct URL for authenticated blob download (used with fetch + auth header).
   *  Optional templateId overrides the doc's saved template for this export. */
  getBillingDocumentExportUrl: (id: number, templateId?: number | null) => {
    const base = FINANCIAL.BILLING_DOCUMENT_EXPORT(id);
    return templateId ? `${base}?templateId=${templateId}` : base;
  },
};
