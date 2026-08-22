/**
 * Billing document shared helpers — money/checksum/VAT primitives used by BOTH
 * the persistence core (billing-document.service) and the extracted
 * template/draft modules. A leaf so draft generation can import these without
 * importing (and cycling through) the core that re-exports it.
 */
import { createHash } from 'node:crypto';
import { inArray, desc } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import type {
  BillingDocumentLine,
  BillingVatRate,
  BillingVatTreatment,
} from '@tingting/shared';

export const VAT_TREATMENT_VERSION = 'VAT-V1' as const;

const ALLOWED_VAT_RATES = new Set<number>([0, 0.05, 0.08, 0.10]);

function normalizeVatRate(value: string | number | null | undefined): BillingVatRate {
  const rate = Number(value ?? 0);
  if (!ALLOWED_VAT_RATES.has(rate)) {
    throw new ApiError(409, `Thuế suất VAT ${rate} không thuộc chính sách đang hiệu lực.`);
  }
  return rate as BillingVatRate;
}

/** Effective incl-VAT amount for a line: excluded → 0, else override ?? base. */
export function effectiveAmount(line: { excluded?: boolean | null; baseAmount: number; amountOverride?: number | null; grossAmount?: number | null }): number {
  if (line.excluded) return 0;
  if (line.grossAmount != null) return Number(line.grossAmount);
  const override = line.amountOverride;
  return override != null ? Number(override) : Number(line.baseAmount);
}

export function postingChecksum(posting: {
  id: number;
  tripId: number;
  version: number;
  tripVersion: number;
  reason: string;
  effectiveAt: Date | string;
}): string {
  return createHash('sha256').update(JSON.stringify({
    id: posting.id,
    tripId: posting.tripId,
    version: posting.version,
    tripVersion: posting.tripVersion,
    reason: posting.reason,
    effectiveAt: posting.effectiveAt instanceof Date
      ? posting.effectiveAt.toISOString()
      : new Date(posting.effectiveAt).toISOString(),
  })).digest('hex');
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

export function documentVatTotals(lines: readonly BillingDocumentLine[]) {
  return lines.reduce((totals, line) => {
    if (line.excluded) return totals;
    totals.net += Number(line.netAmount ?? line.baseAmount ?? 0);
    totals.tax += Number(line.taxAmount ?? 0);
    totals.gross += Number(line.grossAmount ?? effectiveAmount(line));
    return totals;
  }, { net: 0, tax: 0, gross: 0 });
}

export function buildTripSourceVersionToken(version: number | null | undefined): string | null {
  return Number.isInteger(version) && Number(version) > 0 ? `trip:${version}` : null;
}

export function buildExpenseSourceVersionToken(input: {
  updatedAt: Date | string | null | undefined;
  approvalStatus: string | null | undefined;
  sellAmount: string | number | null | undefined;
}): string | null {
  if (!input.updatedAt || !input.approvalStatus) return null;
  const updatedAt = input.updatedAt instanceof Date
    ? input.updatedAt.toISOString()
    : new Date(input.updatedAt).toISOString();
  return `expense:${updatedAt}:${input.approvalStatus}:${Number(input.sellAmount ?? 0)}`;
}

export type CustomerDebitTripCandidate = {
  id: number;
  tripCode: string | null;
  customerId: number;
  shipmentId: number | null;
  fulfillmentId: number | null;
  status: string;
  departureDate: string;
  completionDate: string | null;
  revenue: string | null;
  fuelSurchargeAmount: string | null;
  routeName: string | null;
  notes: string | null;
  truckPlate: string | null;
  trailerPlateNumber: string | null;
  externalPlateNumber: string | null;
  version: number;
  vatRate: string;
  updatedAt: Date;
  financialPostingId: number;
  financialPostingVersion: number;
  financialPostingTripVersion: number;
  financialPostingReason: string;
  financialPostingEffectiveAt: Date;
  shipmentCustomerId: number | null;
  tradeDirection: 'IMPORT' | 'EXPORT' | null;
  billNumber: string | null;
  factoryName: string | null;
  expectedDeliveryDate: string | null;
  cargoVolumeCbm: string | null;
  packageCount: number | null;
  packageType: string | null;
};

export type TripPodStatusSummary = {
  status: 'DRAFT' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | null;
  rejectionReason: string | null;
};

export function buildTripBlockedReason(
  candidate: Pick<CustomerDebitTripCandidate,
    'shipmentId' | 'fulfillmentId' | 'customerId' | 'shipmentCustomerId' | 'status'>,
  customerId: number,
  latestPod: TripPodStatusSummary | undefined,
): string | null {
  if (!candidate.shipmentId || !candidate.fulfillmentId) {
    return 'Chuyến chưa gắn fulfillment của lô hàng.';
  }
  if (candidate.customerId !== customerId || candidate.shipmentCustomerId !== customerId) {
    return 'Chuyến không thuộc đúng khách hàng của Giấy báo nợ.';
  }
  if (candidate.status !== 'COMPLETED') {
    return 'Chuyến chưa ở trạng thái hoàn thành.';
  }
  if (!latestPod || latestPod.status == null || latestPod.status === 'DRAFT') {
    return 'Chưa có e-POD đã duyệt.';
  }
  if (latestPod.status === 'SUBMITTED') {
    return 'e-POD đang chờ duyệt.';
  }
  if (latestPod.status === 'REJECTED') {
    return latestPod.rejectionReason?.trim()
      ? `e-POD bị từ chối: ${latestPod.rejectionReason.trim()}`
      : 'e-POD bị từ chối.';
  }
  return null;
}

export async function loadLatestPodStatusByTrip(
  tripIds: number[],
  executor: Pick<Tx, 'select'> | typeof db = db,
): Promise<Map<number, TripPodStatusSummary>> {
  const map = new Map<number, TripPodStatusSummary>();
  if (tripIds.length === 0) return map;
  const rows = await executor.select({
    tripId: s.tripPodSubmissions.tripId,
    status: s.tripPodSubmissions.status,
    rejectionReason: s.tripPodSubmissions.rejectionReason,
    submissionVersion: s.tripPodSubmissions.submissionVersion,
    id: s.tripPodSubmissions.id,
  }).from(s.tripPodSubmissions)
    .where(inArray(s.tripPodSubmissions.tripId, tripIds))
    .orderBy(s.tripPodSubmissions.tripId, desc(s.tripPodSubmissions.submissionVersion), desc(s.tripPodSubmissions.id));
  for (const row of rows) {
    if (map.has(row.tripId)) continue;
    map.set(row.tripId, {
      status: row.status,
      rejectionReason: row.rejectionReason ?? null,
    });
  }
  return map;
}

