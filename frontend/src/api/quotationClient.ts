import { api } from '../lib/api';
import { QUOTATION_PATHS, type QuotationCreateInput, type QuotationUpdateInput, type QuotationView } from '@tingting/shared';

export interface QuotationVersionRow {
  version: number;
  triggerKind: 'MANUAL_EDIT' | 'FUEL_APPROVED' | 'IMPORT' | string;
  releasedBy: number | null;
  releasedAt: string | null;
}

const TRIGGER_KIND_LABELS: Record<string, string> = {
  MANUAL_EDIT: 'Chỉnh sửa tay',
  FUEL_APPROVED: 'Duyệt cập nhật giá dầu',
  IMPORT: 'Nhập file',
};
export function triggerKindLabel(kind: string): string {
  return TRIGGER_KIND_LABELS[kind] ?? kind;
}

// Quotation live-view frames (card 20260922_66). LIST returns frames without
// cells (the live grid assembles on the detail route); money columns arrive
// as numbers on QuotationCellView; heSo is numeric(8,4) on the wire. Paths
// are root-relative — the api client prefixes /api.

/** Frame row from LIST (no cells — the grid assembles per detail fetch). */
/** Card _64 Phase A — one Chi-phí-khác catalog row (routing opaque; labels data-driven). */
export interface QuotationFeeRow {
  id: number;
  feeName: string;
  subType: string | null;
  defaultAmount: number | null;
  routing: 'OTHER_COSTS' | 'DEDICATED_CUSTOMS' | 'DEDICATED_LACH_HUYEN';
  note: string | null;
  sortOrder: number;
}

export interface QuotationFrame {
  id: number;
  customerId: number;
  customerName: string;
  templateName: string;
  effectiveDate: string;
  note: string | null;
}

function withIdempotencyKey(): { headers: Record<string, string> } {
  return { headers: { 'Idempotency-Key': crypto.randomUUID() } };
}

export const quotationClient = {
  list(): Promise<QuotationFrame[]> {
    return api.get<QuotationFrame[]>(QUOTATION_PATHS.LIST);
  },
  /** Card _64 Phase A — active frame's Chi-phí-khác catalog (routing opaque). */
  getActiveFees(customerId: number): Promise<{ items: QuotationFeeRow[] }> {
    return api.get<{ items: QuotationFeeRow[] }>(`/quotations/fees/active?customerId=${customerId}`);
  },
  get(id: number): Promise<QuotationView> {
    return api.get<QuotationView>(QUOTATION_PATHS.DETAIL(id));
  },
  create(body: QuotationCreateInput): Promise<QuotationView> {
    return api.post<QuotationView>(QUOTATION_PATHS.LIST, body, withIdempotencyKey());
  },
  update(id: number, body: QuotationUpdateInput): Promise<QuotationView> {
    return api.put<QuotationView>(QUOTATION_PATHS.DETAIL(id), body, withIdempotencyKey());
  },
  /** Card 20260922_61: kế toán's "ĐỒNG Ý CẬP NHẬT BÁO GIÁ" batch list. */
  listFuelApprovals(status?: string): Promise<{ items: QuotationFuelApprovalRow[]; total: number }> {
    return api.get<{ items: QuotationFuelApprovalRow[]; total: number }>(
      `${QUOTATION_PATHS.FUEL_APPROVALS}${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    );
  },
  decideFuelApprovals(ids: number[], decision: 'AGREED' | 'DECLINED'): Promise<{ updated: Array<{ id: number; customerId: number; status: string }> }> {
    return api.post(QUOTATION_PATHS.FUEL_APPROVALS_DECIDE, { ids, decision }, withIdempotencyKey());
  },
  /** Card 20260922_57: xlsx import — parse returns a PREVIEW (no writes);
   *  commit is per-sheet transactional and always creates NEW frames. */
  importPreview(file: File): Promise<ImportPreviewPayload> {
    const body = new FormData();
    body.append('file', file);
    return api.upload(QUOTATION_PATHS.IMPORT, body) as Promise<ImportPreviewPayload>;
  },
  importCommit(file: File): Promise<{ results: Array<{ sheet: string; quotationId: number | null; customerName: string; errors: string[] }> }> {
    const body = new FormData();
    body.append('file', file);
    return api.upload(QUOTATION_PATHS.IMPORT_COMMIT, body, withIdempotencyKey()) as Promise<{ results: Array<{ sheet: string; quotationId: number | null; customerName: string; errors: string[] }> }>;
  },
  exportQuotation(id: number): Promise<Blob> {
    return api.getBlob(QUOTATION_PATHS.DETAIL(id) + '/export');
  },
  /** Card _62: version history — newest-first list + one frozen payload. */
  listVersions(id: number, filter?: { from?: string; to?: string }): Promise<{ items: QuotationVersionRow[]; total: number }> {
    const params = new URLSearchParams();
    if (filter?.from) params.set('from', filter.from);
    if (filter?.to) params.set('to', filter.to);
    const query = params.toString();
    return api.get<{ items: QuotationVersionRow[]; total: number }>(
      `${QUOTATION_PATHS.DETAIL(id)}/versions${query ? `?${query}` : ''}`,
    );
  },
  getVersionPayload(id: number, version: number): Promise<QuotationView> {
    return api.get<QuotationView>(`${QUOTATION_PATHS.DETAIL(id)}/versions/${version}`);
  },
  exportVersion(id: number, version: number): Promise<Blob> {
    return api.getBlob(`${QUOTATION_PATHS.DETAIL(id)}/export?version=${version}`);
  },
};

export interface ImportPreviewRowPayload {
  classCode: string; classLabel: string;
  heSo: number | null; liters: number | null; giaCos: number | null;
  basePrice: number | null; billingKmOneWay: number | null; error: string | null;
}
export interface ImportPreviewSheetPayload {
  sheet: string; customerName: string | null; customerId: number | null;
  customerTaxCode: string | null; baseFuelPrice: number | null; fuelLagDays: number | null;
  roundingMode: 'NONE' | 'THOUSAND' | 'TEN_THOUSAND';
  routes: Array<{ factoryName: string; routeId: number | null; matchedRouteName: string | null; sharePct: number | null; rows: ImportPreviewRowPayload[]; errors: string[] }>;
  errors: string[];
}
export interface ImportPreviewPayload { sheets: ImportPreviewSheetPayload[]; totalErrors: number; }

export interface QuotationFuelApprovalRow {
  id: number;
  fuelPricePeriodId: number;
  customerId: number;
  quotationId: number;
  status: 'PENDING' | 'AGREED' | 'DECLINED';
  customerName: string;
  periodUnitPrice: string;
  periodEffectiveFrom: string;
  quotationName: string;
  quotationEffectiveDate: string;
  decidedAt: string | null;
}
