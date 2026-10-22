// Pure pricing-basis decisions for the freight engine wiring (QA R32).
//
// No db import on purpose (backend tests are unit-only, 2026-10-19 ruling):
// `lockShipmentFreightRate` gathers rows with IO and delegates EVERY branch
// decision to the pure classifiers here, so the "đủ căn cứ / thiếu căn cứ"
// law of lot pricing is unit-testable without a database.
//
// Spec: BaoGia.md (khung giá) + CuocPhiPhuPhiDau.md §7 (lag) +
// PhuongAnTinhCuocTuDong.md §3.4 (thời điểm khóa: Ngày vận chuyển).

import { resolveContainerPriceClass } from '@tingting/shared';

// ─── Fuel-price lag precedence ───────────────────────────────────────────────

/**
 * Which lag shifts the fuel-price lookup date (Ngày vận chuyển − lag).
 *
 * Precedence (QA R32, BaoGia.md §2 "độ trễ áp giá dầu (lag)" là thuộc tính
 * khung giá):
 *   1. The customer's quotation frame in effect at the transport date — the
 *      frame header is the operator-editable contract the engine must honor.
 *   2. freight_rate_terms.fuel_lag_days — per-route fallback for customers
 *      with no effective frame (seed + legacy imports; NEWEB terms converge
 *      on lag 1/confirmed, so seeded customers price identically either way).
 *   3. 0 when neither source exists.
 */
export function effectiveFuelLagDays(
  frameLagDays: number | null | undefined,
  termsLagDays: number | null | undefined,
): number {
  if (frameLagDays != null && Number.isFinite(frameLagDays) && frameLagDays >= 0) {
    return Math.trunc(frameLagDays);
  }
  if (termsLagDays != null && Number.isFinite(termsLagDays) && termsLagDays >= 0) {
    return Math.trunc(termsLagDays);
  }
  return 0;
}

// ─── Lot pricing basis (đủ căn cứ → LOCK; thiếu căn cứ → SKIP, không bịa số) ─

export interface LotPricingGrounds {
  /** Lệnh chạy ngoài: bảng định mức cước nội bộ không áp dụng (spec §4). */
  isAdHoc: boolean;
  customerId: number | null;
  routeId: number | null;
  /** Dispatcher override (pricingRateKey) or container-type-derived CONT20/CONT40. */
  rateKey: string | null;
  /** The anchor container's appointment date (YYYY-MM-DD) when a typed
   *  container supplied the rate key; null on dispatch overrides. */
  containerTransportDate: string | null;
  /** Shipment expected delivery date (Ngày giao dự kiến). */
  expectedDeliveryDate: string | null;
  /** Last-resort date (dispatch passes the planned start day). */
  fallbackTransportDate?: string | null;
  /** Anchor container cargo weight (kg) — CONT20/CONT40 price-class ground. */
  containerCargoWeightKg: number | null;
}

export type LotPricingDecision =
  | { action: 'LOCK'; rateKey: string; transportDate: string; priceVehicleSizeClassCode?: string }
  | {
    action: 'SKIP';
    reason: 'AD_HOC' | 'NO_CUSTOMER' | 'NO_ROUTE' | 'NO_RATE_KEY' | 'NO_TRANSPORT_DATE' | 'MISSING_WEIGHT';
  };

/**
 * Decide whether a lot (FCL container / LCL) has đủ căn cứ for the engine:
 * tuyến (route) + khách + hạng xe (rate key) + ngày vận chuyển, and — for
 * container base classes — trọng tải to pick the LIGHT/HEAVY price column.
 * Thiếu căn cứ → SKIP (không bịa số): intake stays silent; the DISPATCH
 * caller turns MISSING_WEIGHT into its loud 409 (requirePrice, card _58
 * ruling 4c) exactly as before extraction.
 */
export function classifyLotPricingBasis(grounds: LotPricingGrounds): LotPricingDecision {
  if (grounds.isAdHoc) return { action: 'SKIP', reason: 'AD_HOC' };
  if (grounds.customerId == null) return { action: 'SKIP', reason: 'NO_CUSTOMER' };
  if (grounds.routeId == null) return { action: 'SKIP', reason: 'NO_ROUTE' };

  const rateKey = grounds.rateKey?.trim().toUpperCase() || null;
  if (!rateKey) return { action: 'SKIP', reason: 'NO_RATE_KEY' };

  // Date precedence mirrors the landed lock: a container-derived key anchors
  // to that container's appointment, else Ngày giao dự kiến, else the
  // dispatcher's planned start day.
  const transportDate = grounds.containerTransportDate
    ?? grounds.expectedDeliveryDate
    ?? grounds.fallbackTransportDate?.trim()
    ?? null;
  if (!transportDate) return { action: 'SKIP', reason: 'NO_TRANSPORT_DATE' };

  // Card 20260922_58 selection half: container base classes pick their PRICE
  // column from cargo weight (≥ 20,0t nặng; missing weight BLOCKS — never a
  // default). Norms stay keyed on the base class, so liters never change.
  if (/^(CONT20|CONT40)$/.test(rateKey)) {
    const weightKg = grounds.containerCargoWeightKg;
    if (weightKg == null || !Number.isFinite(weightKg) || weightKg <= 0) {
      return { action: 'SKIP', reason: 'MISSING_WEIGHT' };
    }
    const baseType = rateKey === 'CONT40' ? 'CONT40' as const : 'CONT20' as const;
    const resolution = resolveContainerPriceClass(baseType, weightKg / 1000);
    if (resolution.ok) {
      return { action: 'LOCK', rateKey, transportDate, priceVehicleSizeClassCode: resolution.code };
    }
    return { action: 'LOCK', rateKey, transportDate };
  }

  return { action: 'LOCK', rateKey, transportDate };
}
