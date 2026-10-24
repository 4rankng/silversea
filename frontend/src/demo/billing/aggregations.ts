/**
 * Demo billing aggregations (SIL-160, spec doc_bb1b74fcfa8b §3).
 *
 * Pure selectors over the demo seed — no API, no state. Two sheets:
 *  - AR (phải thu khách hàng): every trip of a customer in a period, one row
 *    per chuyến, total = Σ cước (freight).
 *  - AP (phải trả nhà xe ngoài): every vendor trip in a period. The company
 *    advanced the port fees by bank transfer on the vendor's behalf
 *    (fee.method 'unc'), so thực trả = cước − UNC chi hộ. Driver-cash fees
 *    belong to the hoàn ứng lane and never enter this deduction.
 */
import { demoTrips } from '../data/seed';
import type { DemoCargoFlow, DemoContainerSize, DemoTrip } from '../data/types';
import { monthOf } from './format';

const byDateThenCode = (a: DemoTrip, b: DemoTrip) =>
  a.date === b.date ? a.code.localeCompare(b.code) : a.date.localeCompare(b.date);

/** '40′ · Hàng xuất' / '20′ · Hàng nhập' — the "loại" half of a cont cell. */
export function contKindLabel(size: DemoContainerSize, flow: DemoCargoFlow): string {
  return `${size}′ · ${flow === 'export' ? 'Hàng xuất' : 'Hàng nhập'}`;
}

/* ── AR — bảng kê phải thu khách hàng ─────────────────────────────────── */

export interface ArRow {
  tripId: string;
  date: string;
  bookingNo: string;
  billNo?: string;
  contNo: string;
  kindLabel: string;
  routeText: string;
  freightVnd: number;
}

export interface ArSheet {
  customerId: string;
  month: string;
  rows: ArRow[];
  tripCount: number;
  totalVnd: number;
}

/** Sum cước of every trip of one customer inside a 'YYYY-MM' period. */
export function arSheetFor(customerId: string, month: string): ArSheet {
  const rows = demoTrips
    .filter((trip) => trip.customerId === customerId && monthOf(trip.date) === month)
    .sort(byDateThenCode)
    .map((trip): ArRow => ({
      tripId: trip.id,
      date: trip.date,
      bookingNo: trip.bookingNo,
      billNo: trip.billNo,
      contNo: trip.contNo,
      kindLabel: contKindLabel(trip.size, trip.flow),
      routeText: trip.routeText,
      freightVnd: trip.freightVnd,
    }));

  return {
    customerId,
    month,
    rows,
    tripCount: rows.length,
    totalVnd: rows.reduce((sum, row) => sum + row.freightVnd, 0),
  };
}

/* ── AP — bảng kê phải trả nhà xe ngoài (cấn trừ UNC chi hộ) ──────────── */

export interface ApRow {
  tripId: string;
  code: string;
  date: string;
  contNo: string;
  /** Cước phải trả nhà xe. */
  freightVnd: number;
  /** UNC công ty chi hộ: Σ phí cảng method 'unc' của chuyến. */
  uncVnd: number;
  /** Thực trả = cước − UNC. */
  netVnd: number;
}

export interface ApSheet {
  vendorId: string;
  month: string;
  rows: ApRow[];
  tripCount: number;
  totalFreightVnd: number;
  totalUncVnd: number;
  totalNetVnd: number;
}

/** UNC chi hộ of a trip = every bank-transfer port fee, whatever its status. */
export function uncVndOfTrip(trip: DemoTrip): number {
  return trip.fees
    .filter((fee) => fee.method === 'unc')
    .reduce((sum, fee) => sum + fee.amountVnd, 0);
}

/** Vendor payable sheet: cước, UNC chi hộ và thực trả per chuyến in a period. */
export function apSheetFor(vendorId: string, month: string): ApSheet {
  const rows = demoTrips
    .filter((trip) => trip.vendorId === vendorId && monthOf(trip.date) === month)
    .sort(byDateThenCode)
    .map((trip): ApRow => {
      const uncVnd = uncVndOfTrip(trip);
      return {
        tripId: trip.id,
        code: trip.code,
        date: trip.date,
        contNo: trip.contNo,
        freightVnd: trip.freightVnd,
        uncVnd,
        netVnd: trip.freightVnd - uncVnd,
      };
    });

  return {
    vendorId,
    month,
    rows,
    tripCount: rows.length,
    totalFreightVnd: rows.reduce((sum, row) => sum + row.freightVnd, 0),
    totalUncVnd: rows.reduce((sum, row) => sum + row.uncVnd, 0),
    totalNetVnd: rows.reduce((sum, row) => sum + row.netVnd, 0),
  };
}

/* ── Kỳ mặc định ──────────────────────────────────────────────────────── */

/** The month holding the most seed trips — keeps the demo landing on data. */
export function demoDefaultMonth(): string {
  const counts = new Map<string, number>();
  for (const trip of demoTrips) {
    const key = monthOf(trip.date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}
