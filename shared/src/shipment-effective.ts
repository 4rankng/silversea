/**
 * Effective-value helpers for shipment container planning.
 *
 * One Bill/Booking stays one shipment while each FCL container becomes the
 * authoritative unit for factory, appointment, dispatch, and vehicle planning
 * (SILVER L1 program contract). Every surface that needs "which factory does
 * this container serve" or "which date does this container plan on" resolves
 * through these helpers instead of re-deriving precedence per endpoint.
 *
 * Pure functions — no DB access. The SQL mirrors land where they first enter
 * a query and must stay paired with these rules (see dispatch planning).
 */

/** Business timezone for all shipment planning surfaces. +07, no DST. */
export const SHIPMENT_BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** Fixed +07 offset in minutes — Asia/Ho_Chi_Minh has no DST. */
const BUSINESS_ZONE_OFFSET_MINUTES = 7 * 60;

export interface EffectiveFactoryInput {
  /** Container-level site authority (Phase-2 column; null on legacy rows). */
  containerOperationalSiteId?: number | null;
  /** Shipment-level site — LCL/default/legacy fallback. */
  shipmentOperationalSiteId?: number | null;
  /** Free-text factory from legacy/manual intake; last resort. */
  shipmentFactoryName?: string | null;
}

export interface EffectiveFactory {
  /** Resolved site authority, if any level produced one. */
  operationalSiteId: number | null;
  /**
   * Display label. Site id resolves to null label only when a snapshot
   * lookup is deferred to the caller — the id stays authoritative.
   */
  factoryName: string | null;
  /** Which precedence level produced the value. */
  source: 'CONTAINER_SITE' | 'SHIPMENT_SITE' | 'SHIPMENT_FACTORY_TEXT' | 'NONE';
}

/**
 * Effective factory precedence (program decision 3, minus the snapshot level
 * which callers consult through their own fulfillment projections):
 * container site → shipment site → shipment `factoryName` text.
 */
export function resolveEffectiveFactory(input: EffectiveFactoryInput): EffectiveFactory {
  if (input.containerOperationalSiteId != null) {
    return {
      operationalSiteId: input.containerOperationalSiteId,
      factoryName: null,
      source: 'CONTAINER_SITE',
    };
  }
  if (input.shipmentOperationalSiteId != null) {
    return {
      operationalSiteId: input.shipmentOperationalSiteId,
      factoryName: null,
      source: 'SHIPMENT_SITE',
    };
  }
  const text = input.shipmentFactoryName?.trim();
  if (text) {
    return {
      operationalSiteId: null,
      factoryName: text,
      source: 'SHIPMENT_FACTORY_TEXT',
    };
  }
  return { operationalSiteId: null, factoryName: null, source: 'NONE' };
}

export interface EffectiveDateInput {
  cargoMode: 'FCL' | 'LCL' | null | undefined;
  /** Per-container appointment instant (ISO string or Date). */
  containerAppointmentAt?: string | Date | null;
  /** Shipment-level promised date (YYYY-MM-DD). */
  shipmentExpectedDeliveryDate?: string | null;
}

/**
 * Effective fulfillment/planning date (program decision 4):
 * FCL = container appointment cast to the Asia/Ho_Chi_Minh local date,
 * falling back to the shipment's expectedDeliveryDate; LCL = expected date.
 *
 * This deliberately lets FCL containers plan on different days than their
 * siblings — per-container planning is the accepted new behavior. Legacy
 * noon-UTC date-only appointments cast to their correct local date.
 */
export function resolveEffectiveFulfillmentDate(input: EffectiveDateInput): string | null {
  if (input.cargoMode === 'FCL' && input.containerAppointmentAt != null) {
    const localDate = localDateInBusinessZone(input.containerAppointmentAt);
    if (localDate) return localDate;
  }
  return input.shipmentExpectedDeliveryDate ?? null;
}

/**
 * Cast an instant (ISO string or Date) to its YYYY-MM-DD local date in the
 * business timezone. Returns null for unparseable input — callers decide
 * whether that means "fall back" or "invalid".
 */
export function localDateInBusinessZone(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time + BUSINESS_ZONE_OFFSET_MINUTES * 60_000)
    .toISOString()
    .slice(0, 10);
}
