// SIL-693 seam — the billing VAT math, db-free (2026-10-19 owner unit-test
// ruling: backend/src/tests must not import the db chain). Split out of
// billing-document-shared.service so the Debit Note line builder
// (shipment-cost-lock-lines.ts) can be unit-pinned as BEHAVIOR, the same seam
// as lcl-effective-freight.ts. billing-document-shared re-exports these
// symbols so its existing import surface stays byte-identical.
import { ApiError } from '../errors';
import type { BillingVatRate, BillingVatTreatment } from '@tingting/shared';

export const VAT_TREATMENT_VERSION = 'VAT-V1' as const;

const ALLOWED_VAT_RATE_BY_VALUE: Record<number, true> = { 0: true, 0.05: true, 0.08: true, 0.10: true };

function normalizeVatRate(value: string | number | null | undefined): BillingVatRate {
  const rate = Number(value ?? 0);
  if (!ALLOWED_VAT_RATE_BY_VALUE[rate]) {
    throw new ApiError(409, `Thuế suất VAT ${rate} không thuộc chính sách đang hiệu lực.`);
  }
  return rate as BillingVatRate;
}

export function calculateVatSnapshot(
  grossAmount: number,
  rateInput: string | number | null | undefined,
  treatmentInput?: BillingVatTreatment,
) {
  const gross = Math.round(Number(grossAmount));
  if (!Number.isFinite(gross) || gross < 0) throw new ApiError(409, 'Giá trị gồm VAT không hợp lệ.');
  const rate = normalizeVatRate(rateInput);
  const treatment = treatmentInput ?? (rate === 0 ? 'ZERO_RATED' : 'STANDARD');
  if ((treatment === 'STANDARD') !== (rate > 0)) {
    throw new ApiError(409, 'Cách xử lý VAT không khớp thuế suất.');
  }
  const net = treatment === 'STANDARD'
    ? Math.floor(gross / (1 + rate) + 0.5)
    : gross;
  const tax = gross - net;
  return {
    vatTreatment: treatment,
    vatRate: rate,
    vatTreatmentVersion: VAT_TREATMENT_VERSION,
    netAmount: net,
    taxAmount: tax,
    grossAmount: gross,
  } as const;
}
