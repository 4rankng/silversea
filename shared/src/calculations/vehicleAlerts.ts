import type { VehicleAlert, VehicleAlertField } from '../types';

/**
 * N5 / A12 + B4 — pure helper that turns a truck's user-keyed compliance /
 * service dates into actionable alerts.
 *
 * - Skips null / empty dates.
 * - `daysUntil` = ceil((date - today) / day). Dates are parsed as local
 *   midnight from 'YYYY-MM-DD' so timezone does not shift the day count.
 * - `status`: overdue (< 0), due (<= leadDays), ok (otherwise).
 * - Returns ONLY non-'ok' alerts (overdue + due), sorted by daysUntil asc so
 *   the most urgent item surfaces first.
 *
 * Pure & deterministic — `today` and `leadDays` are injectable for tests.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Vietnamese labels shown to drivers/managers. */
export const VEHICLE_ALERT_LABELS: Record<VehicleAlertField, string> = {
  nextInspectionDate: 'Hạn đăng kiểm',
  insuranceExpiryDate: 'Hạn bảo hiểm',
  lastOilServiceDate: 'Thay dầu kế tiếp',
};

/** Input shape — accepts partial truck rows so callers can pass a subset. */
export interface VehicleAlertInput {
  nextInspectionDate?: string | null;
  insuranceExpiryDate?: string | null;
  lastOilServiceDate?: string | null;
}

/**
 * Parse 'YYYY-MM-DD' as local midnight. Returns NaN for empty/invalid input
 * so the caller's `Number.isFinite` guard drops it cleanly.
 *
 * Using `new Date('YYYY-MM-DD')` would parse as UTC and shift the day in some
 * timezones; constructing from the three numeric parts keeps it local.
 */
function parseLocalMidnight(value: string | null | undefined): number {
  if (!value || typeof value !== 'string') return NaN;
  const trimmed = value.trim();
  if (!trimmed) return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (!match) return NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return NaN;
  const ms = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

export function computeVehicleAlerts(
  truck: VehicleAlertInput,
  today: Date = new Date(),
  leadDays = 30,
): VehicleAlert[] {
  // Normalise `today` to local midnight so the day diff isn't skewed by the
  // current time-of-day (a 23:59 "today" vs 00:00 target would otherwise round
  // up to an extra day).
  const todayMs = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    0, 0, 0, 0,
  ).getTime();

  const fields: VehicleAlertField[] = [
    'nextInspectionDate',
    'insuranceExpiryDate',
    'lastOilServiceDate',
  ];

  const alerts: VehicleAlert[] = [];
  for (const field of fields) {
    const raw = truck[field];
    const targetMs = parseLocalMidnight(raw);
    if (!Number.isFinite(targetMs)) continue;

    // ceil so any partial day still counts as "1 day away" — a date due
    // later today is reported as 0, tomorrow as 1, etc.
    const diffDays = (targetMs - todayMs) / MS_PER_DAY;
    const daysUntil = Math.ceil(diffDays);

    const status = daysUntil < 0 ? 'overdue' : daysUntil <= leadDays ? 'due' : 'ok';
    if (status === 'ok') continue;

    alerts.push({
      field,
      label: VEHICLE_ALERT_LABELS[field],
      date: raw as string,
      daysUntil,
      status,
    });
  }

  alerts.sort((a, b) => a.daysUntil - b.daysUntil);
  return alerts;
}
