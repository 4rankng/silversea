import { Banknote, Fuel, type LucideIcon } from 'lucide-react';
import { TripStatus, type TripDetail } from '@tingting/shared';

export interface TripListContainer {
  containerNumber: string;
  containerTypeId: number | null;
  containerTypeCode: string | null;
  containerTypeName: string | null;
}

export interface TripListRow extends TripDetail {
  containers?: TripListContainer[];
}

export type StatusFilter = '' | TripStatus;

export const STATUS_PILL_CLASS: Record<TripStatus, string> = {
  [TripStatus.CREATED]: 'pill-moi',
  [TripStatus.IN_TRANSIT]: 'pill-dang',
  [TripStatus.COMPLETED]: 'pill-htth',
  [TripStatus.CANCELED]: 'pill-huy',
};

export const DEFAULT_WARN_THRESHOLD = 37;
export const PAGE_SIZE = 25;

export function buildTripCode(trip: TripDetail): string {
  if (trip.tripCode) return trip.tripCode;
  return '—';
}

/**
 * Format a number as Vietnamese currency with no symbol and no decimals.
 * Companion to `formatCurrency` in lib/format.ts which always includes " ₫".
 * Used by trip-table cells that place the unit in a separate span.
 */
export function formatMoney(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(Math.round(n));
}

export interface ConsumptionInfo {
  liters: number;
  per100: number;
}

export function getTripDistance(trip: TripDetail): number {
  if (trip.legs && trip.legs.length > 0) {
    return trip.legs.reduce((sum, leg) => sum + Number(leg.km), 0);
  }
  return Number(trip.route?.distanceKm ?? 0);
}

export function calcConsumption(trip: TripDetail): ConsumptionInfo | null {
  const fuel = trip.fuelLiters ? Number(trip.fuelLiters) : null;
  const distance = getTripDistance(trip);
  if (!fuel || !distance) return null;
  return { liters: fuel, per100: (fuel / distance) * 100 };
}

export function getTripDisplayGrossProfit(trip: TripDetail): number {
  if (trip.carrierType !== 'EXTERNAL') {
    return Number(trip.grossProfit ?? 0);
  }

  const revenue = Number(trip.revenue ?? 0);
  const externalFreightCost = Number(trip.externalFreightCost ?? 0);
  if (!revenue || !externalFreightCost) {
    return Number(trip.grossProfit ?? 0);
  }

  const vatRate = Number(trip.vatRate ?? 0.08);
  return Math.round(revenue / (1 + vatRate)) - Math.round(externalFreightCost / (1 + vatRate));
}

export interface MissingIndicator {
  icon: LucideIcon;
  label: string;
}

export function getMissingIndicators(trip: TripDetail): MissingIndicator[] {
  if (trip.status === TripStatus.CANCELED || trip.status === TripStatus.CREATED) return [];
  const missing: MissingIndicator[] = [];
  const revenue = Number(trip.revenue ?? 0);
  if (!revenue) missing.push({ icon: Banknote, label: 'Chưa nhập doanh thu' });
  const fuel = Number(trip.fuelLiters ?? 0);
  if (!fuel) missing.push({ icon: Fuel, label: 'Chưa khai báo dầu' });
  return missing;
}

export type DataCompleteness = 'complete' | 'incomplete' | 'na';

export function getDataCompleteness(trip: TripDetail): DataCompleteness {
  if (trip.status === TripStatus.CREATED || trip.status === TripStatus.CANCELED) return 'na';
  const revenue = Number(trip.revenue ?? 0);
  const fuel = Number(trip.fuelLiters ?? 0);
  const road = Number(trip.totalRoadAllowance ?? 0);
  const salary = Number(trip.driverSalary ?? 0);
  if (revenue > 0 && fuel > 0 && road > 0 && salary > 0) return 'complete';
  return 'incomplete';
}
