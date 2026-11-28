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
  /** shipments.rev_group_id — set while the lot is a REV-merge member. */
  revGroupId?: string | null;
}

export type LotPricingDecision =
  | { action: 'LOCK'; rateKey: string; transportDate: string; priceVehicleSizeClassCode?: string }
  | {
    action: 'SKIP';
    reason: 'AD_HOC' | 'REV_GROUPED' | 'NO_CUSTOMER' | 'NO_ROUTE' | 'NO_RATE_KEY' | 'NO_TRANSPORT_DATE' | 'MISSING_WEIGHT';
  };

/**
 * Decide whether a lot (FCL container / LCL) has đủ căn cứ for the engine:
 * tuyến (route) + khách + hạng xe (rate key) + ngày vận chuyển, and — for
 * container base classes — trọng tải to pick the LIGHT/HEAVY price column.
 * A REV-merge member never qualifies (the group owns its cước thu — the
 * REV_GROUPED skip above). Thiếu căn cứ → SKIP (không bịa số): intake stays
 * silent; the DISPATCH caller turns MISSING_WEIGHT into its loud 409
 * (requirePrice, card _58 ruling 4c) exactly as before extraction.
 */
export function classifyLotPricingBasis(grounds: LotPricingGrounds): LotPricingDecision {
  if (grounds.isAdHoc) return { action: 'SKIP', reason: 'AD_HOC' };
  // Merged-LCL 0-share supersede law (QA logic wave 28/11, groups d25e82a1 /
  // 9c0f42bb): while a lot is a REV-merge member the GROUP owns its cước thu
  // — Lô 1 carries 100% of the group freight, members 2..N carry the cited
  // 0₫ stamp (spec 23/10). A per-lot engine freeze on a member (intake
  // create/edit, container reconcile, dispatch issue) re-materialized the
  // lot's OWN lane price as the latest snapshot row, and the max-id-wins
  // boards read the secondary's freight AGAIN while Lô 1 still carries the
  // group freight — the double-count. A grouped lot therefore never has đủ
  // căn cứ for its own freeze: the group surface (merge, Lô-1 manual price,
  // per-lot outputs after Tách nhóm) is the only writer of a member's money.
  if (grounds.revGroupId != null) return { action: 'SKIP', reason: 'REV_GROUPED' };
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

// ─── SIL-898 — declared cargo weight, the row-visible chain ──────────────────

/**
 * A stored weight counts as DECLARED only when it parses to a positive,
 * finite kilogram value. A `0.00` container line is not a declaration —
 * nobody books zero tons of cargo — so it must never shadow the next source
 * of the chain, and must never block pricing as if it were a declared zero
 * (staging 07/11: a lot re-entered "5000", issued fine, then the line was
 * zeroed and the same row started 409ing "Thiếu trọng tải" it did not have
 * the day before).
 */
export function positiveWeightKg(value: unknown): number | null {
  if (value == null || value === '') return null;
  const kg = Number(value);
  return Number.isFinite(kg) && kg > 0 ? kg : null;
}

/**
 * The booking root behind a per-container lot reference: `R3Q-676-2` and
 * `R3Q-680-B` are lots 2/B of bookings `R3Q-676` and `R3Q-680`. Stripping ONE
 * trailing `-<token>` segment is deliberately conservative — a reference
 * whose remainder loses its separator shape (`R3Q-676` → `R3Q`) is kept whole
 * so a single-lot booking never collapses into a mega-family that could
 * inherit a stranger's weight.
 */
export function bookingFamilyRoot(reference: string | null | undefined): string | null {
  const ref = reference?.trim() ?? '';
  if (!ref) return null;
  const stripped = ref.replace(/-[A-Za-z0-9]+$/, '');
  return stripped.includes('-') && stripped.length > 0 ? stripped : ref;
}
