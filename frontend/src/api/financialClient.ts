import { api } from '../lib/api';
import { toQuery } from '../lib/http/query';
import { fetchAllPaginated } from '../lib/http/paginate';
import { FINANCIAL, REPORTS } from '@tingting/shared';
import type {
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
  GenerateBillingDocumentInput,
} from '@tingting/shared';

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
}

export const financialClient = {
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

  getPayablesSummary: (category?: PayablesCategory) =>
    api.get<{
      items: PayableSummary[];
      totalOutstanding: string;
      totalSuppliers: number;
      overdueSuppliers: number;
    }>(`${REPORTS.PAYABLES_SUMMARY}${toQuery({ category })}`),

  postCommission: (data: { supplierId: number; amount: number; tripId?: number; note?: string }) =>
    api.post<{ ok: true }>(FINANCIAL.COMMISSIONS, data),

  getCustomerAging: (params?: { search?: string; page?: number; limit?: number }) => {
    const search = params?.search?.trim() || undefined;
    return api.get<CustomerAgingResponse>(
      `${REPORTS.RECEIVABLES_AGING}${toQuery({ search, page: params?.page, limit: params?.limit })}`,
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

  deleteBillingDocument: (id: number) =>
    api.delete<{ ok: true }>(FINANCIAL.BILLING_DOCUMENT(id)),

  /** Direct URL for authenticated blob download (used with fetch + auth header).
   *  Optional templateId overrides the doc's saved template for this export. */
  getBillingDocumentExportUrl: (id: number, templateId?: number | null) => {
    const base = FINANCIAL.BILLING_DOCUMENT_EXPORT(id);
    return templateId ? `${base}?templateId=${templateId}` : base;
  },
};
