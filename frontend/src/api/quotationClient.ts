import { api } from '../lib/api';
import { QUOTATION_PATHS, type QuotationCreateInput, type QuotationUpdateInput, type QuotationView } from '@tingting/shared';

// Quotation live-view frames (card 20260922_66). LIST returns frames without
// cells (the live grid assembles on the detail route); money columns arrive
// as numbers on QuotationCellView; heSo is numeric(8,4) on the wire. Paths
// are root-relative — the api client prefixes /api.

/** Frame row from LIST (no cells — the grid assembles per detail fetch). */
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
  get(id: number): Promise<QuotationView> {
    return api.get<QuotationView>(QUOTATION_PATHS.DETAIL(id));
  },
  create(body: QuotationCreateInput): Promise<QuotationView> {
    return api.post<QuotationView>(QUOTATION_PATHS.LIST, body, withIdempotencyKey());
  },
  update(id: number, body: QuotationUpdateInput): Promise<QuotationView> {
    return api.put<QuotationView>(QUOTATION_PATHS.DETAIL(id), body, withIdempotencyKey());
  },
};
