import { TripStatus, type PnlTripDetail, type TripDetail } from '@tingting/shared';

export type FinanceTripDetail = PnlTripDetail;

export function groupFinanceTripDetails(
  trips: TripDetail[],
  reportDetails?: PnlTripDetail[],
): Map<number, FinanceTripDetail[]> {
  const grouped = new Map<number, FinanceTripDetail[]>();
  if (reportDetails) {
    for (const detail of reportDetails) {
      const details = grouped.get(detail.vehicleBucketId) ?? [];
      details.push(detail);
      grouped.set(detail.vehicleBucketId, details);
    }
  } else {
    for (const trip of trips) {
      if (trip.status !== TripStatus.COMPLETED) continue;
      const truckId = financeVehicleBucketId(trip);
      const details = grouped.get(truckId) ?? [];
      details.push(toFinanceTripDetail(trip));
      grouped.set(truckId, details);
    }
  }
  for (const details of grouped.values()) {
    details.sort((a, b) => b.departureDate.localeCompare(a.departureDate));
  }
  return grouped;
}

const amount = (value: string | number | null | undefined): number => Number(value ?? 0) || 0;

export function financeVehicleBucketId(trip: TripDetail): number {
  if (trip.carrierType === 'EXTERNAL') return 0;
  return trip.truckId ?? -1;
}

/**
 * Rebuild the visible trip-level cost equation from the stored inputs. This is
 * intentionally an arithmetic check only: a matching total does not prove the
 * accountant entered the underlying business figures correctly.
 */
export function toFinanceTripDetail(trip: TripDetail): FinanceTripDetail {
  const isExternal = trip.carrierType === 'EXTERNAL';
  const vatRate = amount(trip.vatRate);
  const grossRevenue = amount(trip.revenue);
  const freightExVat = vatRate > 0 ? Math.round(grossRevenue / (1 + vatRate)) : grossRevenue;
  const customerCommission = amount(trip.customerCommission);
  const revenue = freightExVat - customerCommission;
  const fuelOrHireCost = isExternal ? amount(trip.externalFreightCost) : amount(trip.totalFuelCost);
  const roadAllowance = isExternal ? 0 : amount(trip.totalRoadAllowance);
  const tollAndCompanyTickets = isExternal ? 0 : amount(trip.tollCost) + amount(trip.tollsDiscount);
  const driverAndAllowances = isExternal
    ? 0
    : amount(trip.driverSalary) + amount(trip.twoPointDeliveryBonus) + amount(trip.vehicleShiftAllowance);
  const reconciledExtraCost = amount(trip.reconciledExtraCost);
  const reconstructedCost = fuelOrHireCost + roadAllowance + tollAndCompanyTickets + driverAndAllowances + reconciledExtraCost;
  const totalCost = amount(trip.totalCost);
  const costDifference = totalCost - reconstructedCost;

  return {
    id: trip.id,
    tripCode: trip.tripCode || 'Lệnh chưa có mã',
    departureDate: trip.departureDate,
    routeName: trip.route?.name || 'Chưa có tuyến',
    revenue,
    customerCommission,
    fuelOrHireCost,
    roadAllowance,
    tollAndCompanyTickets,
    driverAndAllowances,
    reconciledExtraCost,
    totalCost,
    allocatedFleetFixedCost: 0,
    totalCostWithFleetFixedCost: totalCost,
    profit: revenue - totalCost,
    netProfitAfterFleetFixedCost: revenue - totalCost,
    costDifference,
    costMatches: Math.abs(costDifference) <= 1,
    isExternal,
    vehicleBucketId: financeVehicleBucketId(trip),
  };
}
