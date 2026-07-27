export type TripPairingBlockCode =
  | 'SAME_TRIP'
  | 'MISSING_PLANNED_WINDOW'
  | 'INVALID_PLANNED_WINDOW'
  | 'MISSING_LOCATION'
  | 'MISSING_CAPACITY'
  | 'MISSING_CARGO_WEIGHT'
  | 'OVERLOAD'
  | 'OVERLAP'
  | 'IMPOSSIBLE_REPOSITION'
  | 'INSUFFICIENT_TRAVEL_BUFFER';

export type TripPairBreakReason =
  | 'FIRST_TRIP_CANCELED'
  | 'SECOND_TRIP_CANCELED'
  | 'LATE_COMPLETION';

export interface TripPairingCandidate {
  tripId: number;
  tripCode?: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  canonicalOrigin: string | null;
  canonicalDestination: string | null;
  cargoWeightKg: number | null;
  loadedDistanceKm?: number | null;
}

export interface TripPairingVehicle {
  vehicleCapacityKg: number | null;
  averageRepositionSpeedKph?: number;
  stopBufferMinutes?: number;
}

export interface TripPairingReposition {
  distanceKm: number | null;
}

export interface TripPairingMetrics {
  emptyDistanceKm: number | null;
  combinedEfficiencyPercent: number | null;
  actualGapMinutes: number | null;
  requiredGapMinutes: number | null;
}

export interface TripPairingEvaluation extends TripPairingMetrics {
  eligible: boolean;
  firstTripId: number;
  secondTripId: number;
  orderedTripIds: [number, number];
  blockingCodes: TripPairingBlockCode[];
}

export interface TripPairSnapshot extends TripPairingMetrics {
  firstTripId: number;
  secondTripId: number;
}

export interface TripPairBreakState {
  status: 'ACTIVE' | 'BROKEN';
  breakReason: TripPairBreakReason | null;
  survivingTripId: number | null;
  lateByMinutes: number | null;
}

const DEFAULT_REPOSITION_SPEED_KPH = 35;
const DEFAULT_STOP_BUFFER_MINUTES = 30;

export function canonicalizePairingLocation(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function toFiniteNumber(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseIsoDateTime(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function orderCandidates(
  a: TripPairingCandidate,
  b: TripPairingCandidate,
): [TripPairingCandidate, TripPairingCandidate] {
  const aStart = parseIsoDateTime(a.plannedStartAt)?.getTime() ?? Number.POSITIVE_INFINITY;
  const bStart = parseIsoDateTime(b.plannedStartAt)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aStart !== bStart) return aStart <= bStart ? [a, b] : [b, a];
  return a.tripId <= b.tripId ? [a, b] : [b, a];
}

export function buildTripPairSnapshot(
  first: TripPairingCandidate,
  second: TripPairingCandidate,
  vehicle: TripPairingVehicle,
  reposition: TripPairingReposition = { distanceKm: null },
): TripPairingEvaluation {
  const [orderedFirst, orderedSecond] = orderCandidates(first, second);
  const blockingCodes: TripPairingBlockCode[] = [];

  if (orderedFirst.tripId === orderedSecond.tripId) {
    blockingCodes.push('SAME_TRIP');
  }

  const firstStart = parseIsoDateTime(orderedFirst.plannedStartAt);
  const firstEnd = parseIsoDateTime(orderedFirst.plannedEndAt);
  const secondStart = parseIsoDateTime(orderedSecond.plannedStartAt);
  const secondEnd = parseIsoDateTime(orderedSecond.plannedEndAt);
  if (!firstStart || !firstEnd || !secondStart || !secondEnd) {
    blockingCodes.push('MISSING_PLANNED_WINDOW');
  } else {
    if (firstEnd <= firstStart || secondEnd <= secondStart) {
      blockingCodes.push('INVALID_PLANNED_WINDOW');
    }
    if (firstEnd > secondStart) {
      blockingCodes.push('OVERLAP');
    }
  }

  const firstOrigin = canonicalizePairingLocation(orderedFirst.canonicalOrigin);
  const firstDestination = canonicalizePairingLocation(orderedFirst.canonicalDestination);
  const secondOrigin = canonicalizePairingLocation(orderedSecond.canonicalOrigin);
  const secondDestination = canonicalizePairingLocation(orderedSecond.canonicalDestination);
  if (!firstOrigin || !firstDestination || !secondOrigin || !secondDestination) {
    blockingCodes.push('MISSING_LOCATION');
  }

  const capacityKg = toFiniteNumber(vehicle.vehicleCapacityKg);
  if (capacityKg == null || capacityKg <= 0) {
    blockingCodes.push('MISSING_CAPACITY');
  }

  const firstCargoKg = toFiniteNumber(orderedFirst.cargoWeightKg);
  const secondCargoKg = toFiniteNumber(orderedSecond.cargoWeightKg);
  if (firstCargoKg == null || secondCargoKg == null) {
    blockingCodes.push('MISSING_CARGO_WEIGHT');
  } else if (capacityKg != null && (firstCargoKg > capacityKg || secondCargoKg > capacityKg)) {
    blockingCodes.push('OVERLOAD');
  }

  let emptyDistanceKm: number | null = 0;
  if (firstDestination && secondOrigin && firstDestination !== secondOrigin) {
    const repositionKm = toFiniteNumber(reposition.distanceKm);
    if (repositionKm == null || repositionKm < 0) {
      blockingCodes.push('IMPOSSIBLE_REPOSITION');
      emptyDistanceKm = null;
    } else {
      emptyDistanceKm = repositionKm;
    }
  }

  let actualGapMinutes: number | null = null;
  let requiredGapMinutes: number | null = null;
  if (firstEnd && secondStart && !blockingCodes.includes('MISSING_PLANNED_WINDOW') && !blockingCodes.includes('INVALID_PLANNED_WINDOW')) {
    actualGapMinutes = Math.floor((secondStart.getTime() - firstEnd.getTime()) / 60000);
    const repositionKm = emptyDistanceKm ?? 0;
    const averageSpeed = vehicle.averageRepositionSpeedKph ?? DEFAULT_REPOSITION_SPEED_KPH;
    const stopBuffer = vehicle.stopBufferMinutes ?? DEFAULT_STOP_BUFFER_MINUTES;
    requiredGapMinutes = Math.ceil((repositionKm / averageSpeed) * 60) + stopBuffer;
    if (actualGapMinutes < requiredGapMinutes) {
      blockingCodes.push('INSUFFICIENT_TRAVEL_BUFFER');
    }
  }

  const loadedDistanceKm = (toFiniteNumber(orderedFirst.loadedDistanceKm) ?? 0)
    + (toFiniteNumber(orderedSecond.loadedDistanceKm) ?? 0);
  const combinedEfficiencyPercent = emptyDistanceKm == null
    ? null
    : round2((loadedDistanceKm + emptyDistanceKm) > 0
      ? (loadedDistanceKm / (loadedDistanceKm + emptyDistanceKm)) * 100
      : 0);

  return {
    eligible: blockingCodes.length === 0,
    firstTripId: orderedFirst.tripId,
    secondTripId: orderedSecond.tripId,
    orderedTripIds: [orderedFirst.tripId, orderedSecond.tripId],
    blockingCodes,
    emptyDistanceKm,
    combinedEfficiencyPercent,
    actualGapMinutes,
    requiredGapMinutes,
  };
}

export function breakTripPairOnCancellation(
  pair: TripPairSnapshot,
  canceledTripId: number,
): TripPairBreakState {
  if (canceledTripId === pair.firstTripId) {
    return {
      status: 'BROKEN',
      breakReason: 'FIRST_TRIP_CANCELED',
      survivingTripId: pair.secondTripId,
      lateByMinutes: null,
    };
  }
  if (canceledTripId === pair.secondTripId) {
    return {
      status: 'BROKEN',
      breakReason: 'SECOND_TRIP_CANCELED',
      survivingTripId: pair.firstTripId,
      lateByMinutes: null,
    };
  }
  return {
    status: 'ACTIVE',
    breakReason: null,
    survivingTripId: null,
    lateByMinutes: null,
  };
}

export function breakTripPairOnLateCompletion(
  pair: TripPairSnapshot,
  actualFirstTripEndAt: string | null,
  plannedSecondTripStartAt: string | null,
): TripPairBreakState {
  const actualEnd = parseIsoDateTime(actualFirstTripEndAt);
  const plannedSecondStart = parseIsoDateTime(plannedSecondTripStartAt);
  if (!actualEnd || !plannedSecondStart || pair.requiredGapMinutes == null) {
    return {
      status: 'ACTIVE',
      breakReason: null,
      survivingTripId: null,
      lateByMinutes: null,
    };
  }

  const actualGapMinutes = Math.floor((plannedSecondStart.getTime() - actualEnd.getTime()) / 60000);
  if (actualGapMinutes >= pair.requiredGapMinutes) {
    return {
      status: 'ACTIVE',
      breakReason: null,
      survivingTripId: null,
      lateByMinutes: null,
    };
  }

  return {
    status: 'BROKEN',
    breakReason: 'LATE_COMPLETION',
    survivingTripId: pair.secondTripId,
    lateByMinutes: pair.requiredGapMinutes - actualGapMinutes,
  };
}
