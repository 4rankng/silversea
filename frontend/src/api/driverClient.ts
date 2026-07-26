import { api } from '../lib/api';
import { toQuery } from '../lib/http/query';
import { DRIVER } from '@tingting/shared';
import type { VehicleAlert } from '@tingting/shared';

export const driverClient = {
  getTrips: async () => {
    return api.get<{
      items: Array<{
        id: number;
        departureDate: string;
        status: string;
        driverSalary: string | null;
        routeName: string | null;
        truckPlate: string | null;
      }>;
    }>(DRIVER.TRIPS);
  },

  getEarnings: async (month: number, year: number) => {
    return api.get<{
      baseSalary: string;
      tripIncome: string;
      penalties: string;
      netIncome: string;
      // F2 / B2 — trip-based income + outstanding payable.
      productionSalary: string;
      roadAllowance: string;
      paidOrAdvanced: string;
      payableBalance: string;
      adjustment?: number;
      supplementPay?: number;
      leaveDeduction?: number;
      standardWorkDays?: number;
      paidDays?: number;
      dailyRate?: number;
      periodStart?: string;
      periodEnd?: string;
    }>(`${DRIVER.EARNINGS}${toQuery({ month, year })}`);
  },

  getPenalties: async (params?: { dateFrom: string; dateTo: string }) => {
    return api.get<
      | Array<{
          id: number;
          driverId: number;
          tripId: number | null;
          tripCode?: string | null;
          reasonId: number | null;
          customReason: string | null;
          amount: string;
          date: string;
          reasonText?: string;
        }>
      | {
          items: Array<{
            id: number;
            driverId: number;
            tripId: number | null;
            tripCode?: string | null;
            reasonId: number | null;
            customReason: string | null;
            amount: string;
            date: string;
            reasonText?: string;
          }>;
        }
    >(`${DRIVER.PENALTIES}${toQuery(params)}`);
  },

  /** N5 / B4 — overdue/due reminders for the driver's truck. */
  getVehicleAlerts: async () => {
    return api.get<{ items: VehicleAlert[] }>(DRIVER.VEHICLE_ALERTS);
  },

  /** M8.3 — two-orders-per-day view (active + next today, firstOrderLate). */
  getTwoOrders: async () => {
    return api.get<{
      date: string;
      active: {
        id: number; tripCode: string | null; departureDate: string; status: string;
        routeName: string | null; truckPlate: string | null; customerName: string | null;
        containerNumbers: string[];
      } | null;
      next: {
        id: number; tripCode: string | null; departureDate: string; status: string;
        routeName: string | null; truckPlate: string | null; customerName: string | null;
        containerNumbers: string[];
      } | null;
      firstOrderLate: boolean;
      allToday: Array<{
        id: number; tripCode: string | null; departureDate: string; status: string;
        routeName: string | null; truckPlate: string | null; customerName: string | null;
        containerNumbers: string[];
      }>;
    }>(DRIVER.TWO_ORDERS);
  },

  /** M8.4 — list a trip's progress events (timeline, oldest-first). */
  listProgress: async (tripId: number) => {
    return api.get<{ items: Array<{
      id: number; tripId: number; driverId: number;
      eventType: string; occurredAt: string; note: string | null;
      recordedBy: number | null; createdAt: string;
    }> }>(DRIVER.PROGRESS(tripId));
  },

  /**
   * M8.4 — record a progress event. The `idempotencyKey` is sent in the
   * `Idempotency-Key` header so an offline-queue replay returns the original
   * event instead of duplicating (PRD M08-04-03, Q23). Returns the event +
   * a flag the caller can ignore (the HTTP status 201/200 distinction is
   * handled by the api wrapper resolving either as success).
   */
  recordProgress: async (
    tripId: number,
    body: { eventType: string; occurredAt: string; note?: string },
    idempotencyKey: string,
  ) => {
    return api.post<{
      id: number; tripId: number; driverId: number;
      eventType: string; occurredAt: string; note: string | null;
      recordedBy: number | null; createdAt: string;
    }>(DRIVER.PROGRESS(tripId), body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },
};
