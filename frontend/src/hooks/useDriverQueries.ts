import { useQuery } from '@tanstack/react-query';
import { driverClient } from '../api/driverClient';
import { qk } from '../api/keys';

export function useDriverTrips() {
  return useQuery({
    queryKey: qk.driver.trips,
    queryFn: () => driverClient.getTrips(),
  });
}

export function useDriverTaskDetail(tripId?: number) {
  return useQuery({
    queryKey: qk.driver.tripDetail(tripId),
    queryFn: () => driverClient.getTaskDetail(tripId as number),
    enabled: Number.isInteger(tripId) && Number(tripId) > 0,
  });
}

export function useDriverTaskProgress(tripId?: number) {
  return useQuery({
    queryKey: qk.driver.tripProgress(tripId),
    queryFn: () => driverClient.listProgress(tripId as number),
    enabled: Number.isInteger(tripId) && Number(tripId) > 0,
  });
}

export function useDriverEvidenceStatus(tripId?: number) {
  return useQuery({
    queryKey: qk.driver.evidenceStatus(tripId),
    queryFn: () => driverClient.getEvidenceStatus(tripId as number),
    enabled: Number.isInteger(tripId) && Number(tripId) > 0,
  });
}

export function useDriverEarnings(month: number, year: number) {
  return useQuery({
    queryKey: qk.driver.earnings(month, year),
    queryFn: () => driverClient.getEarnings(month, year),
    enabled: month >= 1 && month <= 12 && year >= 2000,
  });
}

export function useDriverPenalties(params?: { dateFrom: string; dateTo: string }) {
  return useQuery({
    queryKey: qk.driver.penalties(params),
    queryFn: () => driverClient.getPenalties(params),
  });
}

/** N5 / B4 — the driver's truck compliance/service reminders (overdue/due). */
export function useDriverVehicleAlerts() {
  return useQuery({
    queryKey: qk.driver.vehicleAlerts,
    queryFn: () => driverClient.getVehicleAlerts(),
    // Reminders are not urgent enough to refetch frequently; stale for an hour
    // is fine (a manager edits the dates, the driver sees them next visit).
    staleTime: 60 * 60 * 1000,
  });
}

/** M8.3 — two-orders-per-day view (active + next today, firstOrderLate). */
export function useDriverTwoOrders() {
  return useQuery({
    queryKey: qk.driver.twoOrders,
    queryFn: () => driverClient.getTwoOrders(),
  });
}

/** M8.6 — driver payslip periods (own issued salary periods with earnings). */
export function useDriverPayslips() {
  return useQuery({
    queryKey: qk.driver.payslips,
    queryFn: () => driverClient.getPayslips(),
  });
}

/** Driver-app "Hành trình" screen — New Orders / Running / History board. */
export function useDriverJourneyBoard() {
  return useQuery({
    queryKey: qk.driver.journeyBoard,
    queryFn: () => driverClient.getJourneyBoard(),
  });
}
