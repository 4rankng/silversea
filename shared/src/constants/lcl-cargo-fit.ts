// ─── REQ-19 depth audit (2026-10-21): LCL group cargo fit vs tải trọng ──────
//
// Doc khách (RẤT CAO): "Xây dựng thuật toán tính giá cước hàng lẻ dựa trên
// trọng tải tấn của xe và loại container (20/40 feet) trong trường hợp 1 xe
// đi gom nhận nhiều lô hàng lẻ cùng lúc."
//
// The accepted 2026-10-15 DEV SPEC resolves the PRICE half of that sentence:
// the group's chosen vehicle-size class (tấn 1.25T…15T hoặc Cont 20'/40') is
// the price-board lane key, with the Lô-1-100%/0₫ money law (see
// lcl-grouping.service.ts). This module resolves the TẢI TRỌNG half — the
// physical-fit advisory that was missing: given the class the dispatcher
// picked and the Σ cargoWeightKg of the grouped lots, does the consolidated
// cargo actually fit that truck?
//
// Deliberate boundaries (audit answers, do not "fix" without a new ruling):
//   • ADVISORY ONLY — never blocks the assignment, never reprices. The spec
//     prices by the operator's chosen class; this helper only tells the
//     operator whether that choice physically holds.
//   • NO CBM→20' conversion. "Loại container (20/40 feet)" is a pricing-class
//     kind in vehicle_size_classes, not a conversion target: no lot column
//     and no board expresses "N lô = 1 vỏ cont 20'". Container classes
//     therefore return CONTAINER_CLASS (the dispatcher weighs Σ CBM, shown
//     next to the fit line, against the shell by eye) — inventing container
//     volumetric capacities would be a new product decision.
//   • Tonnage comes from the class CODE ('5T' → 5000 kg) because the DM has
//     no numeric tonnage column; codes that don't parse honestly return
//     UNKNOWN_CLASS instead of a guessed capacity.
export type LclCargoFitStatus =
  | 'FITS'
  | 'OVER'
  | 'NO_WEIGHT'
  | 'CONTAINER_CLASS'
  | 'UNKNOWN_CLASS';

export interface LclCargoFitAssessment {
  status: LclCargoFitStatus;
  /** Σ of the lots' known cargoWeightKg (null when no lot carries weight). */
  totalWeightKg: number | null;
  /** Parsed tonnage of the truck class in kg; null for container/unknown. */
  tonnageKg: number | null;
}

/** How many lots carry no weight fact (drives the NO_WEIGHT advisory). */
export interface LclCargoFitInput {
  isContainer: boolean;
  /** vehicle_size_classes.code, e.g. '5T' / '1.25T' / 'CONT20'. */
  vehicleClassCode: string;
  /** Per-lot cargoWeightKg; null = the lot's weight is not on file. */
  cargoWeightKg: Array<number | null>;
}

/**
 * Parse a truck-tonnage class code into kg ('5T' → 5000, '1.25T' → 1250).
 * Container codes and anything else return null — an unparseable capacity is
 * reported honestly, never guessed.
 */
export function parseTonnageKg(code: string): number | null {
  const match = /^(\d+(?:[.,]\d+)?)\s*T$/i.exec(code.trim());
  if (!match) return null;
  const tons = Number(match[1]!.replace(',', '.'));
  if (!Number.isFinite(tons) || tons <= 0) return null;
  return Math.round(tons * 1000);
}

/**
 * Assess one consolidated group's cargo against its chosen pricing class.
 *
 *   FITS             truck class, Σ known kg ≤ tonnage
 *   OVER             truck class, Σ known kg > tonnage (advisory warning)
 *   NO_WEIGHT        truck class but no lot carries a weight fact
 *   CONTAINER_CLASS  cont 20/40 pricing class — price is per shell, kg fit
 *                    is not the unit (Σ CBM is the dispatcher's yardstick)
 *   UNKNOWN_CLASS    truck-kind class whose code doesn't parse to a tonnage
 */
export function assessLclCargoFit(input: LclCargoFitInput): LclCargoFitAssessment {
  const known = input.cargoWeightKg.filter((kg): kg is number => kg != null && Number.isFinite(kg));
  const totalWeightKg = known.length > 0
    ? known.reduce((sum, kg) => sum + kg, 0)
    : null;

  if (input.isContainer) {
    return { status: 'CONTAINER_CLASS', totalWeightKg, tonnageKg: null };
  }
  const tonnageKg = parseTonnageKg(input.vehicleClassCode);
  if (tonnageKg == null) {
    return { status: 'UNKNOWN_CLASS', totalWeightKg, tonnageKg: null };
  }
  if (totalWeightKg == null) {
    return { status: 'NO_WEIGHT', totalWeightKg: null, tonnageKg };
  }
  return {
    status: totalWeightKg > tonnageKg ? 'OVER' : 'FITS',
    totalWeightKg,
    tonnageKg,
  };
}
