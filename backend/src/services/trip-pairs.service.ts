import {
  type CreateTripPairInput,
  TripStatus,
  type TripPairKind,
  type TripPairRecord,
  type TripPairSummary,
} from '@tingting/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { applyTripPatch } from './trip-composite.service';
import { ApiError } from '../errors';
import {
  breakTripPairOnCancellation,
  breakTripPairOnLateCompletion,
  buildTripPairSnapshot,
  canonicalizePairingLocation,
  type TripPairSnapshot,
} from './trip-pairing.service';
import type { Tx } from './trip-shared';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { getPairSalarySettingsFrom, pairSurchargeFor } from './pair-salary-settings.service';

interface TripRowForPairing {
  id: number;
  tripCode: string | null;
  version: number;
  status: string | null;
  departureDate: string;
  routeId: number;
  plannedStartAt: Date | null;
  plannedEndAt: Date | null;
  canonicalOrigin: string | null;
  canonicalDestination: string | null;
  cargoWeightKg: string | null;
  vehicleCapacityKg: string | null;
  activeTripPairId: number | null;
  activeTripPairOrder: number | null;
  truckId: number | null;
  driverId: number | null;
  carrierType: string;
  revenue: string | null;
  totalCost: string | null;
  grossProfit: string | null;
  driverSalary: string | null;
  tollsStations: number;
  tollPerStationApplied: string | null;
  tollDeduction: string | null;
  tollCost: string | null;
  routeDistanceKm?: number | null;
}

type PairDraftInput = CreateTripPairInput['firstTrip'];

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toDbDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, 'Thời gian kế hoạch không hợp lệ');
  }
  return parsed;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  return String(value);
}

/**
 * O2C "kẹp hàng" (backhaul) toll dedup (PRD Bước 2, 01/08/2026). A paired
 * two-way trip physically pays the closed-loop VETC toll once, so the second
 * trip carries a `tollDeduction` equal to its gross toll. This returns the
 * derived-field delta to persist on the second trip so its stored `tollCost` and
 * `totalCost` stay consistent with `computeTripTotals` (net = max(0, gross − ded)).
 * Trip 1 keeps its full toll (the pair bears the toll once across both trips).
 */
function backhaulTollDeductionForSecond(trip: TripRowForPairing): {
  tollDeduction: string;
  tollCost: string;
  totalCostDelta: number;
} {
  const grossToll = (trip.tollsStations ?? 0) * Number(trip.tollPerStationApplied ?? 0);
  const previousNetToll = Number(trip.tollCost ?? 0);
  const newNetToll = Math.max(0, grossToll - grossToll);
  return {
    tollDeduction: String(grossToll),
    tollCost: String(newNetToll),
    totalCostDelta: newNetToll - previousNetToll,
  };
}

function firstBlockingMessage(code: string): string {
  switch (code) {
    case 'SAME_TRIP':
      return 'Không thể ghép một chuyến với chính nó';
    case 'MISSING_PLANNED_WINDOW':
      return 'Cần nhập đủ giờ bắt đầu và kết thúc kế hoạch cho cả hai chuyến';
    case 'INVALID_PLANNED_WINDOW':
      return 'Giờ kết thúc phải sau giờ bắt đầu cho cả hai chuyến';
    case 'MISSING_LOCATION':
      return 'Cần nhập đủ điểm đi và điểm đến cho cả hai chuyến';
    case 'MISSING_CAPACITY':
      return 'Thiếu thông tin tải trọng xe';
    case 'MISSING_CARGO_WEIGHT':
      return 'Thiếu thông tin trọng lượng hàng';
    case 'OVERLOAD':
      return 'Trọng lượng hàng vượt quá tải trọng xe';
    case 'OVERLAP':
      return 'Hai chuyến bị chồng thời gian';
    case 'IMPOSSIBLE_REPOSITION':
      return 'Không xác định được quãng đường xe rỗng giữa hai chuyến';
    case 'INSUFFICIENT_TRAVEL_BUFFER':
      return 'Không đủ thời gian di chuyển xe rỗng giữa hai chuyến';
    default:
      return 'Không thể ghép hai chuyến này';
  }
}

function assertExpectedVersion(
  trip: TripRowForPairing,
  expectedVersion: number | undefined,
) {
  if (expectedVersion !== undefined && trip.version !== expectedVersion) {
    throw new ApiError(409, 'Dữ liệu chuyến đi đã bị thay đổi. Vui lòng tải lại trang.');
  }
}

function assertMatchingNumberField(
  tripLabel: string,
  fieldLabel: string,
  supplied: number,
  authoritative: string | number | null | undefined,
) {
  const authoritativeNumber = toNumber(authoritative);
  if (authoritativeNumber == null) return;
  if (Math.abs(supplied - authoritativeNumber) > 0.001) {
    throw new ApiError(422, `${tripLabel}: ${fieldLabel} không khớp dữ liệu chuyến hiện tại. Vui lòng tải lại trang.`);
  }
}

function assertMatchingDateField(
  tripLabel: string,
  fieldLabel: string,
  supplied: string,
  authoritative: Date | null,
) {
  if (!authoritative) return;
  const suppliedMs = toDbDate(supplied).getTime();
  if (suppliedMs !== authoritative.getTime()) {
    throw new ApiError(422, `${tripLabel}: ${fieldLabel} không khớp dữ liệu chuyến hiện tại. Vui lòng tải lại trang.`);
  }
}

function assertMatchingLocationField(
  tripLabel: string,
  fieldLabel: string,
  supplied: string,
  authoritative: string | null,
) {
  if (!authoritative) return;
  if (canonicalizePairingLocation(supplied) !== canonicalizePairingLocation(authoritative)) {
    throw new ApiError(422, `${tripLabel}: ${fieldLabel} không khớp dữ liệu chuyến hiện tại. Vui lòng tải lại trang.`);
  }
}

function assertTripDraftMatchesAuthority(
  tripLabel: string,
  supplied: PairDraftInput,
  authoritative: TripRowForPairing,
) {
  assertMatchingDateField(tripLabel, 'Giờ bắt đầu kế hoạch', supplied.plannedStartAt, authoritative.plannedStartAt);
  assertMatchingDateField(tripLabel, 'Giờ kết thúc kế hoạch', supplied.plannedEndAt, authoritative.plannedEndAt);
  assertMatchingLocationField(tripLabel, 'Điểm đi', supplied.canonicalOrigin, authoritative.canonicalOrigin);
  assertMatchingLocationField(tripLabel, 'Điểm đến', supplied.canonicalDestination, authoritative.canonicalDestination);
  assertMatchingNumberField(tripLabel, 'Trọng lượng hàng', Number(supplied.cargoWeightKg), authoritative.cargoWeightKg);
  assertMatchingNumberField(tripLabel, 'Tải trọng xe', Number(supplied.vehicleCapacityKg), authoritative.vehicleCapacityKg);
}

function assertPairableTrips(first: TripRowForPairing, second: TripRowForPairing, kind: TripPairKind) {
  if (first.carrierType !== 'OWN' || second.carrierType !== 'OWN') {
    throw new ApiError(422, 'Chỉ có thể ghép 2 chiều cho chuyến xe nội bộ');
  }
  if (!first.truckId || !second.truckId || first.truckId !== second.truckId) {
    throw new ApiError(422, kind === 'KEP'
      ? 'Không đủ điều kiện kẹp hàng: hai lệnh phải dùng cùng một biển số xe.'
      : 'Hai chuyến phải dùng cùng một xe để ghép 2 chiều');
  }
  if (!first.driverId || !second.driverId || first.driverId !== second.driverId) {
    throw new ApiError(422, kind === 'KEP'
      ? 'Không đủ điều kiện kẹp hàng: hai lệnh phải dùng cùng một tài xế.'
      : 'Hai chuyến phải dùng cùng một lái xe để ghép 2 chiều');
  }
  if (first.activeTripPairId || second.activeTripPairId) {
    throw new ApiError(409, 'Một trong hai chuyến đã nằm trong cặp điều vận khác');
  }
  if (first.status === TripStatus.CANCELED || second.status === TripStatus.CANCELED) {
    throw new ApiError(409, 'Không thể ghép chuyến đã hủy');
  }
  if (first.status === TripStatus.COMPLETED || second.status === TripStatus.COMPLETED) {
    throw new ApiError(409, 'Không thể ghép chuyến đã hoàn thành');
  }
  if (second.status === TripStatus.COMPLETED) {
    throw new ApiError(409, 'Chuyến thứ hai đã hoàn thành nên không thể ghép tiếp');
  }
}

function toPairSnapshot(row: {
  firstTripId: number;
  secondTripId: number;
  emptyDistanceKm: string | null;
  combinedEfficiencyPercent: string | null;
  actualGapMinutes: number | null;
  requiredGapMinutes: number | null;
}): TripPairSnapshot {
  return {
    firstTripId: row.firstTripId,
    secondTripId: row.secondTripId,
    emptyDistanceKm: toNumber(row.emptyDistanceKm),
    combinedEfficiencyPercent: toNumber(row.combinedEfficiencyPercent),
    actualGapMinutes: row.actualGapMinutes,
    requiredGapMinutes: row.requiredGapMinutes,
  };
}

function serializePairRecord(row: {
  id: number;
  status: string;
  pairKind: string;
  firstTripId: number;
  secondTripId: number;
  emptyDistanceKm: string | null;
  combinedEfficiencyPercent: string | null;
  requiredGapMinutes: number | null;
  actualGapMinutes: number | null;
  breakReason: string | null;
  survivingTripId: number | null;
  lateByMinutes: number | null;
  createdBy: number | null;
  brokenBy: number | null;
  brokenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): TripPairRecord {
  return {
    id: row.id,
    status: row.status as TripPairRecord['status'],
    pairKind: row.pairKind as TripPairRecord['pairKind'],
    firstTripId: row.firstTripId,
    secondTripId: row.secondTripId,
    emptyDistanceKm: toText(row.emptyDistanceKm),
    combinedEfficiencyPercent: toText(row.combinedEfficiencyPercent),
    requiredGapMinutes: row.requiredGapMinutes,
    actualGapMinutes: row.actualGapMinutes,
    breakReason: row.breakReason as TripPairRecord['breakReason'],
    survivingTripId: row.survivingTripId,
    lateByMinutes: row.lateByMinutes,
    createdBy: row.createdBy,
    brokenBy: row.brokenBy,
    brokenAt: toIso(row.brokenAt),
    createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(row.updatedAt) ?? new Date().toISOString(),
  };
}

async function loadTripsForPairing(tx: Tx, tripIds: [number, number]) {
  // Trips-split: revenue/toll-cost block reads from the financial sidecar and
  // carrierType from the carrier sidecar; the row lock stays on trips only
  // (`of`), matching the pre-split lock footprint.
  const rows = await tx.select({
    id: s.trips.id,
    tripCode: s.trips.tripCode,
    version: s.trips.version,
    status: s.trips.status,
    departureDate: s.trips.departureDate,
    routeId: s.trips.routeId,
    plannedStartAt: s.trips.plannedStartAt,
    plannedEndAt: s.trips.plannedEndAt,
    canonicalOrigin: s.trips.canonicalOrigin,
    canonicalDestination: s.trips.canonicalDestination,
    cargoWeightKg: s.trips.cargoWeightKg,
    vehicleCapacityKg: s.trips.vehicleCapacityKg,
    activeTripPairId: s.trips.activeTripPairId,
    activeTripPairOrder: s.trips.activeTripPairOrder,
    truckId: s.trips.truckId,
    driverId: s.trips.driverId,
    carrierType: s.tripCarrierInfo.carrierType,
    revenue: s.tripFinancialState.revenue,
    totalCost: s.tripFinancialState.totalCost,
    grossProfit: s.tripFinancialState.grossProfit,
    driverSalary: s.tripFinancialState.driverSalary,
    tollsStations: s.trips.tollsStations,
    tollPerStationApplied: s.tripFinancialState.tollPerStationApplied,
    tollDeduction: s.tripFinancialState.tollDeduction,
    tollCost: s.tripFinancialState.tollCost,
  }).from(s.trips)
    .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .where(and(inArray(s.trips.id, tripIds), isNull(s.trips.deletedAt)))
    .orderBy(s.trips.id)
    .for('update', { of: [s.trips] });

  if (rows.length !== 2) {
    throw new ApiError(404, 'Không tìm thấy đủ hai chuyến để ghép');
  }

  const containerWeights = await tx.select({
    tripId: s.tripContainers.tripId,
    cargoWeightKg: sql<string | null>`
      case
        when count(${s.tripContainers.cargoWeightKg}) > 0
          then sum(${s.tripContainers.cargoWeightKg})::text
        else null
      end
    `,
  }).from(s.tripContainers)
    .where(inArray(s.tripContainers.tripId, tripIds))
    .groupBy(s.tripContainers.tripId);

  const containerWeightByTripId = new Map(
    containerWeights.map((row) => [row.tripId, row.cargoWeightKg]),
  );
  const byId = new Map(rows.map((row) => [row.id, {
    ...row,
    cargoWeightKg: row.cargoWeightKg ?? containerWeightByTripId.get(row.id) ?? null,
  }]));
  return {
    first: byId.get(tripIds[0]) as TripRowForPairing,
    second: byId.get(tripIds[1]) as TripRowForPairing,
  };
}

async function loadRouteDistances(
  executor: Tx | typeof db,
  routeIds: number[],
) {
  if (routeIds.length === 0) return new Map<number, number | null>();
  const rows = await executor.select({
    id: s.routes.id,
    distanceKm: s.routes.distanceKm,
  }).from(s.routes).where(inArray(s.routes.id, routeIds));
  return new Map(rows.map((row) => [row.id, row.distanceKm]));
}

interface PairingContainerInfo {
  containerNumber: string | null;
  containerTypeCode: string | null;
}

/**
 * Each pairing kind has container-level rules: KEP requires two 20' shells
 * (one mooc = 2 × 20' slots); KET_HOP requires the SAME shell across both
 * orders when both sides already carry a number — at dispatch stage a lô may
 * legitimately not have its vỏ yet (PRD: skip then, CUS bổ sung sau).
 * Resolves each trip's container from tripContainers first, then falls back
 * to the fulfillment's shipment container (fulfillment-built trips snapshot
 * into tripContainers, but the fulfillment link alone is authoritative too).
 * First row per trip wins (1 trip = 1 container; deterministic by lowest id).
 */
async function loadPairingContainerInfo(
  tx: Tx,
  tripIds: [number, number],
): Promise<[PairingContainerInfo | null, PairingContainerInfo | null]> {
  const byTrip = new Map<number, PairingContainerInfo>();
  const tripRows = await tx.select({
    tripId: s.tripContainers.tripId,
    containerNumber: s.tripContainers.containerNumber,
    containerTypeCode: s.containerTypes.code,
  }).from(s.tripContainers)
    .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.tripContainers.containerTypeId))
    .where(inArray(s.tripContainers.tripId, tripIds))
    .orderBy(asc(s.tripContainers.id));
  for (const row of tripRows) {
    if (!byTrip.has(row.tripId)) {
      byTrip.set(row.tripId, {
        containerNumber: row.containerNumber,
        containerTypeCode: row.containerTypeCode ?? null,
      });
    }
  }

  const missing = tripIds.filter((tripId) => !byTrip.has(tripId));
  if (missing.length > 0) {
    const fulfillmentRows = await tx.select({
      tripId: s.trips.id,
      containerNumber: s.shipmentContainers.containerNumber,
      containerTypeCode: s.containerTypes.code,
    }).from(s.trips)
      .innerJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.trips.fulfillmentId))
      .leftJoin(s.shipmentContainers, eq(s.shipmentContainers.id, s.shipmentFulfillments.shipmentContainerId))
      .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
      .where(inArray(s.trips.id, missing))
      .orderBy(asc(s.shipmentFulfillments.id));
    for (const row of fulfillmentRows) {
      if (!byTrip.has(row.tripId)) {
        byTrip.set(row.tripId, {
          containerNumber: row.containerNumber,
          containerTypeCode: row.containerTypeCode ?? null,
        });
      }
    }
  }

  return [byTrip.get(tripIds[0]) ?? null, byTrip.get(tripIds[1]) ?? null];
}

export async function createTripPair(
  input: CreateTripPairInput,
  actorId: number,
  transaction?: Tx,
): Promise<TripPairRecord> {
  const execute = async (tx: Tx) => {
    const tripReferences = await tx.select({ shipmentId: s.trips.shipmentId })
      .from(s.trips)
      .where(and(inArray(s.trips.id, [input.firstTripId, input.secondTripId]), isNull(s.trips.deletedAt)));
    const shipmentIds = [...new Set(tripReferences
      .map((trip) => trip.shipmentId)
      .filter((id): id is number => id != null))].sort((a, b) => a - b);
    for (const shipmentId of shipmentIds) {
      await assertShipmentAccountingUnlocked(tx, shipmentId);
    }
    const locked = await loadTripsForPairing(tx, [input.firstTripId, input.secondTripId]);
    const routeDistances = await loadRouteDistances(tx, [locked.first.routeId, locked.second.routeId]);
    locked.first.routeDistanceKm = routeDistances.get(locked.first.routeId) ?? null;
    locked.second.routeDistanceKm = routeDistances.get(locked.second.routeId) ?? null;
    assertExpectedVersion(locked.first, input.firstTrip.expectedVersion);
    assertExpectedVersion(locked.second, input.secondTrip.expectedVersion);
    const kind: TripPairKind = input.pairKind ?? 'KET_HOP';
    assertPairableTrips(locked.first, locked.second, kind);
    assertTripDraftMatchesAuthority('Chuyến 1', input.firstTrip, locked.first);
    assertTripDraftMatchesAuthority('Chuyến 2', input.secondTrip, locked.second);

    // Kind-specific container/day rules (LoHangKepKetHop §1, TC-GHEP-002…005).
    const [firstContainer, secondContainer] = await loadPairingContainerInfo(tx, [input.firstTripId, input.secondTripId]);
    if (kind === 'KEP') {
      if (locked.first.departureDate !== locked.second.departureDate) {
        throw new ApiError(422, 'Không đủ điều kiện kẹp hàng: hai lệnh phải khởi hành cùng một ngày.');
      }
      const isTwentyFoot = (info: PairingContainerInfo | null) => (info?.containerTypeCode ?? '').startsWith('20');
      if (!isTwentyFoot(firstContainer) || !isTwentyFoot(secondContainer)) {
        throw new ApiError(422, 'Không đủ điều kiện kẹp hàng: kẹp hàng yêu cầu 2 container 20ft trên cùng 1 mooc.');
      }
    }
    if (
      kind === 'KET_HOP'
      && firstContainer?.containerNumber?.trim()
      && secondContainer?.containerNumber?.trim()
      && firstContainer.containerNumber.trim() !== secondContainer.containerNumber.trim()
    ) {
      throw new ApiError(422, 'Ghép kết hợp yêu cầu tái sử dụng đúng một vỏ container — hai lệnh đang mang số vỏ khác nhau.');
    }

    const firstCapacity = toNumber(locked.first.vehicleCapacityKg);
    const secondCapacity = toNumber(locked.second.vehicleCapacityKg);
    if (firstCapacity == null || secondCapacity == null) {
      throw new ApiError(422, firstBlockingMessage('MISSING_CAPACITY'));
    }
    if (Math.abs(firstCapacity - secondCapacity) > 0.001) {
      throw new ApiError(422, 'Tải trọng xe phải thống nhất giữa hai chuyến ghép');
    }

    const evaluation = buildTripPairSnapshot(
      {
        tripId: locked.first.id,
        tripCode: locked.first.tripCode,
        plannedStartAt: toIso(locked.first.plannedStartAt),
        plannedEndAt: toIso(locked.first.plannedEndAt),
        canonicalOrigin: locked.first.canonicalOrigin,
        canonicalDestination: locked.first.canonicalDestination,
        cargoWeightKg: toNumber(locked.first.cargoWeightKg),
        loadedDistanceKm: locked.first.routeDistanceKm,
      },
      {
        tripId: locked.second.id,
        tripCode: locked.second.tripCode,
        plannedStartAt: toIso(locked.second.plannedStartAt),
        plannedEndAt: toIso(locked.second.plannedEndAt),
        canonicalOrigin: locked.second.canonicalOrigin,
        canonicalDestination: locked.second.canonicalDestination,
        cargoWeightKg: toNumber(locked.second.cargoWeightKg),
        loadedDistanceKm: locked.second.routeDistanceKm,
      },
      {
        vehicleCapacityKg: firstCapacity,
      },
      { kind },
    );

    // KEP legs run simultaneously, so there is no first/second ordering to
    // enforce — keep the ordering assertion on sequential (KET_HOP) pairs only.
    if (
      kind !== 'KEP'
      && (evaluation.orderedTripIds[0] !== input.firstTripId
        || evaluation.orderedTripIds[1] !== input.secondTripId)
    ) {
      throw new ApiError(422, 'Chuyến đầu phải bắt đầu trước chuyến tiếp theo');
    }
    if (!evaluation.eligible) {
      throw new ApiError(422, firstBlockingMessage(evaluation.blockingCodes[0] ?? ''));
    }

    const [pair] = await tx.insert(s.tripPairs).values({
      status: 'ACTIVE',
      pairKind: kind,
      firstTripId: input.firstTripId,
      secondTripId: input.secondTripId,
      emptyDistanceKm: toText(evaluation.emptyDistanceKm),
      combinedEfficiencyPercent: toText(evaluation.combinedEfficiencyPercent),
      requiredGapMinutes: evaluation.requiredGapMinutes,
      actualGapMinutes: evaluation.actualGapMinutes,
      createdBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    const firstUpdate = {
      plannedStartAt: locked.first.plannedStartAt,
      plannedEndAt: locked.first.plannedEndAt,
      canonicalOrigin: locked.first.canonicalOrigin?.trim() ?? null,
      canonicalDestination: locked.first.canonicalDestination?.trim() ?? null,
      cargoWeightKg: toText(locked.first.cargoWeightKg),
      vehicleCapacityKg: toText(locked.first.vehicleCapacityKg),
      activeTripPairId: pair.id,
      activeTripPairOrder: 1,
      version: sql`${s.trips.version} + 1`,
      updatedAt: new Date(),
    } as const;
    const secondUpdate = {
      plannedStartAt: locked.second.plannedStartAt,
      plannedEndAt: locked.second.plannedEndAt,
      canonicalOrigin: locked.second.canonicalOrigin?.trim() ?? null,
      canonicalDestination: locked.second.canonicalDestination?.trim() ?? null,
      cargoWeightKg: toText(locked.second.cargoWeightKg),
      vehicleCapacityKg: toText(locked.second.vehicleCapacityKg),
      activeTripPairId: pair.id,
      activeTripPairOrder: 2,
      version: sql`${s.trips.version} + 1`,
      updatedAt: new Date(),
    } as const;

    // O2C "kẹp hàng": the second trip of a backhaul pair nets out its VETC toll
    // (paid once for the pair). Persist the dedup plus the matching derived
    // tollCost/totalCost so the row stays consistent with computeTripTotals.
    const secondToll = backhaulTollDeductionForSecond(locked.second);
    // Pair salary (TC-GHEP-007): the second trip's wage becomes the configured
    // pair surcharge (lương cặp = cuốc cơ bản trên trip 1 + phụ phí trên trip 2,
    // never the sum of two single cuốc). The pre-pair wage is stashed on the
    // pair row so a break restores the exact standard value. With no surcharge
    // configured (0) the rule stays inactive — pairing must not silently zero
    // an existing wage before kế toán has set a real phụ phí.
    const salarySettings = await getPairSalarySettingsFrom(tx);
    const secondSurcharge = pairSurchargeFor(kind, salarySettings);
    const applyPairSalary = secondSurcharge > 0;
    const previousSecondSalary = Number(locked.second.driverSalary ?? 0);
    const salaryDelta = applyPairSalary ? secondSurcharge - previousSecondSalary : 0;
    const previousSecondTotalCost = Number(locked.second.totalCost ?? 0);
    const appliedTotalCostDelta = secondToll.totalCostDelta + salaryDelta;
    const secondTotalCost = Math.max(0, previousSecondTotalCost + appliedTotalCostDelta);
    const secondGrossProfit = Number(
      locked.second.grossProfit
      ?? (Number(locked.second.revenue ?? 0) - previousSecondTotalCost),
    ) - appliedTotalCostDelta;

    await tx.update(s.trips).set(firstUpdate).where(eq(s.trips.id, input.firstTripId));
    await tx.update(s.trips).set(secondUpdate).where(eq(s.trips.id, input.secondTripId));
    // Apply backhaul toll dedup (+ pair salary when configured) to the second
    // trip's financial block. Trips-split: these route to trip_financial_state.
    await applyTripPatch(tx, input.secondTripId, {
      tollDeduction: secondToll.tollDeduction,
      tollCost: secondToll.tollCost,
      ...(applyPairSalary ? { driverSalary: String(secondSurcharge) } : {}),
      totalCost: String(secondTotalCost),
      grossProfit: String(secondGrossProfit),
      updatedAt: new Date(),
    });
    if (applyPairSalary) {
      await tx.update(s.tripPairs).set({
        secondSalaryStash: String(previousSecondSalary),
        updatedAt: new Date(),
      }).where(eq(s.tripPairs.id, pair.id));
    }

    // Non-blocking advisories. KEP on different routes is allowed by spec —
    // the warning makes the dispatcher's explicit decision visible.
    const warnings: string[] = [];
    if (kind === 'KEP' && locked.first.routeId !== locked.second.routeId) {
      warnings.push('Hai lệnh khác tuyến đường — Điều vận tự xác nhận chạy kẹp cùng lúc.');
    }
    return warnings.length > 0 ? { ...serializePairRecord(pair), warnings } : serializePairRecord(pair);
  };
  return runInTx(transaction, execute);
}

async function clearActivePairOnTrips(tx: Tx, tripIds: number[]) {
  if (tripIds.length === 0) return;
  // Only clears pair-linkage fields. Toll restore for the surviving trip is
  // handled by the caller (breakPersistedTripPair); the canceled/non-surviving
  // trip is zeroed by the cancellation flow elsewhere.
  await tx.update(s.trips).set({
    activeTripPairId: null,
    activeTripPairOrder: null,
    updatedAt: new Date(),
  }).where(inArray(s.trips.id, tripIds));
}

async function breakPersistedTripPair(tx: Tx, args: {
  pairId: number;
  breakReason: 'FIRST_TRIP_CANCELED' | 'SECOND_TRIP_CANCELED' | 'LATE_COMPLETION';
  survivingTripId: number | null;
  lateByMinutes: number | null;
  actualGapMinutes?: number | null;
  actorId: number;
  firstTripId: number;
  secondTripId: number;
  secondSalaryStash: number | null;
}) {
  await tx.update(s.tripPairs).set({
    status: 'BROKEN',
    breakReason: args.breakReason,
    survivingTripId: args.survivingTripId,
    lateByMinutes: args.lateByMinutes,
    actualGapMinutes: args.actualGapMinutes ?? null,
    brokenBy: args.actorId,
    brokenAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(s.tripPairs.id, args.pairId));

  await clearActivePairOnTrips(tx, [args.firstTripId, args.secondTripId]);

  // O2C "kẹp hàng": the second trip's VETC toll was netted out while paired.
  // When the pair breaks, restore the survivor's full toll so the pair does not
  // silently lose a toll. (The canceled/non-surviving trip is zeroed elsewhere.)
  if (args.survivingTripId != null) {
    // Trips-split: composed read — the toll/cost restore math consumes the
    // financial block.
    const [survivor] = await tx.select({
      tollsStations: s.tripsComposite.tollsStations,
      tollPerStationApplied: s.tripsComposite.tollPerStationApplied,
      tollDeduction: s.tripsComposite.tollDeduction,
      tollCost: s.tripsComposite.tollCost,
      totalCost: s.tripsComposite.totalCost,
      revenue: s.tripsComposite.revenue,
      grossProfit: s.tripsComposite.grossProfit,
    }).from(s.tripsComposite).where(eq(s.tripsComposite.id, args.survivingTripId)).limit(1);
    if (survivor && Number(survivor.tollDeduction ?? 0) > 0) {
      const grossToll = (survivor.tollsStations ?? 0) * Number(survivor.tollPerStationApplied ?? 0);
      const previousNetToll = Number(survivor.tollCost ?? 0);
      const restoredCostDelta = grossToll - previousNetToll;
      const restoredTotalCost = Math.max(0, Number(survivor.totalCost ?? 0) + restoredCostDelta);
      const restoredGrossProfit = Number(
        survivor.grossProfit
        ?? (Number(survivor.revenue ?? 0) - Number(survivor.totalCost ?? 0)),
      ) - restoredCostDelta;
      // Trips-split: restored toll/cost block routes to trip_financial_state.
      await applyTripPatch(tx, args.survivingTripId, {
        tollDeduction: '0',
        tollCost: String(grossToll),
        totalCost: String(restoredTotalCost),
        grossProfit: String(restoredGrossProfit),
        updatedAt: new Date(),
      });
    }
  }

  // Pair salary restore (TC-GHEP-008): the second trip carried the pair
  // surcharge while paired; breaking the pair returns its standard cuốc from
  // the stash. Skipped when the second trip itself was canceled (the
  // cancellation flow zeroes it) or has already completed with its wage
  // posted — a completed trip's figures only change through governed
  // corrections.
  if (args.breakReason !== 'SECOND_TRIP_CANCELED' && args.secondSalaryStash != null) {
    const [second] = await tx.select({
      status: s.trips.status,
      driverSalary: s.tripFinancialState.driverSalary,
      totalCost: s.tripFinancialState.totalCost,
      grossProfit: s.tripFinancialState.grossProfit,
    }).from(s.trips)
      .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
      .where(eq(s.trips.id, args.secondTripId))
      .limit(1);
    const currentSalary = Number(second?.driverSalary ?? 0);
    if (
      second
      && second.status !== TripStatus.COMPLETED
      && second.status !== TripStatus.CANCELED
      && currentSalary !== args.secondSalaryStash
    ) {
      const salaryDelta = args.secondSalaryStash - currentSalary;
      const restoredTotalCost = Math.max(0, Number(second.totalCost ?? 0) + salaryDelta);
      const restoredGrossProfit = Number(second.grossProfit ?? 0) - salaryDelta;
      await applyTripPatch(tx, args.secondTripId, {
        driverSalary: String(args.secondSalaryStash),
        totalCost: String(restoredTotalCost),
        grossProfit: String(restoredGrossProfit),
        updatedAt: new Date(),
      });
    }
  }
}

export async function applyTripPairLifecycleEffects(
  tx: Tx,
  args: {
    tripId: number;
    activeTripPairId: number | null;
    activeTripPairOrder: number | null;
    targetStatus: TripStatus;
    actorId: number;
    completedAt?: Date | null;
  },
) {
  if (!args.activeTripPairId) return;

  const [pair] = await tx.select({
    id: s.tripPairs.id,
    status: s.tripPairs.status,
    firstTripId: s.tripPairs.firstTripId,
    secondTripId: s.tripPairs.secondTripId,
    secondSalaryStash: s.tripPairs.secondSalaryStash,
    emptyDistanceKm: s.tripPairs.emptyDistanceKm,
    combinedEfficiencyPercent: s.tripPairs.combinedEfficiencyPercent,
    requiredGapMinutes: s.tripPairs.requiredGapMinutes,
    actualGapMinutes: s.tripPairs.actualGapMinutes,
  }).from(s.tripPairs)
    .where(eq(s.tripPairs.id, args.activeTripPairId))
    .limit(1)
    .for('update');

  if (!pair || pair.status !== 'ACTIVE') return;

  if (args.targetStatus === TripStatus.CANCELED) {
    const nextState = breakTripPairOnCancellation(
      toPairSnapshot(pair),
      args.tripId,
    );
    if (nextState.status === 'BROKEN' && nextState.breakReason) {
      await breakPersistedTripPair(tx, {
        pairId: pair.id,
        breakReason: nextState.breakReason,
        survivingTripId: nextState.survivingTripId,
        lateByMinutes: nextState.lateByMinutes,
        actorId: args.actorId,
        firstTripId: pair.firstTripId,
        secondTripId: pair.secondTripId,
        secondSalaryStash: toNumber(pair.secondSalaryStash),
      });
    }
    return;
  }

  if (args.targetStatus !== TripStatus.COMPLETED || pair.firstTripId !== args.tripId) {
    return;
  }

  const [secondTrip] = await tx.select({
    plannedStartAt: s.trips.plannedStartAt,
  }).from(s.trips)
    .where(eq(s.trips.id, pair.secondTripId))
    .limit(1);

  const actualGapMinutes = args.completedAt && secondTrip?.plannedStartAt
    ? Math.floor((secondTrip.plannedStartAt.getTime() - args.completedAt.getTime()) / 60000)
    : null;
  const nextState = breakTripPairOnLateCompletion(
    toPairSnapshot(pair),
    toIso(args.completedAt),
    toIso(secondTrip?.plannedStartAt ?? null),
  );
  if (nextState.status === 'BROKEN' && nextState.breakReason) {
    await breakPersistedTripPair(tx, {
      pairId: pair.id,
      breakReason: nextState.breakReason,
      survivingTripId: nextState.survivingTripId,
      lateByMinutes: nextState.lateByMinutes,
      actualGapMinutes,
      actorId: args.actorId,
      firstTripId: pair.firstTripId,
      secondTripId: pair.secondTripId,
      secondSalaryStash: toNumber(pair.secondSalaryStash),
    });
  }
}

export async function loadTripPairingSummaries(
  tripRows: Array<{
    id: number;
    activeTripPairId: number | null;
    activeTripPairOrder: number | null;
  }>,
): Promise<Map<number, TripPairSummary>> {
  const rows = tripRows.filter(
    (row): row is { id: number; activeTripPairId: number; activeTripPairOrder: number } =>
      row.activeTripPairId != null && row.activeTripPairOrder != null,
  );
  if (rows.length === 0) return new Map();

  const pairIds = [...new Set(rows.map((row) => row.activeTripPairId))];
  const pairRows = await db.select({
    id: s.tripPairs.id,
    status: s.tripPairs.status,
    pairKind: s.tripPairs.pairKind,
    firstTripId: s.tripPairs.firstTripId,
    secondTripId: s.tripPairs.secondTripId,
    emptyDistanceKm: s.tripPairs.emptyDistanceKm,
    combinedEfficiencyPercent: s.tripPairs.combinedEfficiencyPercent,
    requiredGapMinutes: s.tripPairs.requiredGapMinutes,
    actualGapMinutes: s.tripPairs.actualGapMinutes,
    breakReason: s.tripPairs.breakReason,
    survivingTripId: s.tripPairs.survivingTripId,
    lateByMinutes: s.tripPairs.lateByMinutes,
  }).from(s.tripPairs).where(inArray(s.tripPairs.id, pairIds));

  const pairById = new Map(pairRows.map((row) => [row.id, row]));
  const partnerIds = rows.flatMap((row) => {
    const pair = pairById.get(row.activeTripPairId);
    if (!pair) return [];
    return [row.activeTripPairOrder === 1 ? pair.secondTripId : pair.firstTripId];
  });
  const uniquePartnerIds = [...new Set(partnerIds)];
  const partnerRows = uniquePartnerIds.length === 0 ? [] : await db.select({
    id: s.trips.id,
    tripCode: s.trips.tripCode,
    status: s.trips.status,
    departureDate: s.trips.departureDate,
    routeName: s.routes.name,
  }).from(s.trips)
    .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .where(and(inArray(s.trips.id, uniquePartnerIds), isNull(s.trips.deletedAt)));
  const partnerById = new Map(partnerRows.map((row) => [row.id, row]));

  return new Map(rows.flatMap((row) => {
    const pair = pairById.get(row.activeTripPairId);
    if (!pair) return [];
    const partnerId = row.activeTripPairOrder === 1 ? pair.secondTripId : pair.firstTripId;
    const partner = partnerById.get(partnerId);
    if (!partner) return [];
    return [[row.id, {
      pairId: pair.id,
      order: row.activeTripPairOrder as 1 | 2,
      pairKind: pair.pairKind as TripPairSummary['pairKind'],
      status: pair.status as TripPairSummary['status'],
      partnerTripId: partner.id,
      partnerTripCode: partner.tripCode,
      partnerStatus: (partner.status ?? TripStatus.CREATED) as TripStatus,
      partnerDepartureDate: partner.departureDate,
      partnerRouteName: partner.routeName,
      emptyDistanceKm: toText(pair.emptyDistanceKm),
      combinedEfficiencyPercent: toText(pair.combinedEfficiencyPercent),
      requiredGapMinutes: pair.requiredGapMinutes,
      actualGapMinutes: pair.actualGapMinutes,
      breakReason: pair.breakReason as TripPairSummary['breakReason'],
      survivingTripId: pair.survivingTripId,
      lateByMinutes: pair.lateByMinutes,
    } satisfies TripPairSummary]];
  }));
}
