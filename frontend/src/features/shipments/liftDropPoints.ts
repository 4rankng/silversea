/**
 * LCL/FCL lift (Nâng) and drop (Hạ) point resolution — ONE rule for every
 * surface that names a lot's two operating points: the create form (which
 * writes them), Kế hoạch Tổng quát, Kế hoạch Chi tiết Xe and the lot detail.
 *
 * FCL — `shipment_containers.pickup_port_id` / `dropoff_port_id` already MEAN
 * Cảng nâng / Cảng hạ in entry, CUS and the master plan. Never reverse them for
 * an export lot; a lot split across several points joins with ' · '.
 *
 * LCL — the lot owns no container, so its two points are the intake sites and
 * the single "Kho (CFS/Cảng)" field changes meaning with the direction
 * (user directive 2026-10-17):
 *   IMPORT: Nâng = Kho lấy hàng (CFS/Cảng), Hạ = Nhà máy (Điểm trả hàng).
 *   EXPORT: Nâng = Nhà máy (Điểm lấy hàng), Hạ = Kho trả hàng (CFS/Cảng).
 *
 * The lot's stored `pickup_location` / `delivery_location` are the free-text
 * lift/drop names (the same columns the seed fills for every lot), so they back
 * up a half whose catalog site was never picked.
 */
export type LiftDropCargoMode = 'FCL' | 'LCL' | null | undefined;
export type LiftDropTradeDirection = 'IMPORT' | 'EXPORT' | null | undefined;

export interface LiftDropPointInput {
  cargoMode?: LiftDropCargoMode;
  tradeDirection?: LiftDropTradeDirection;
  /** LCL Kho (CFS/Cảng) point: catalog site display name or the typed text. */
  warehouseName?: string | null;
  /** LCL Nhà máy point: catalog site display name or the typed text. */
  factoryName?: string | null;
  /** FCL container pickup port names (already = Cảng nâng). */
  containerLiftNames?: ReadonlyArray<string | null | undefined> | null;
  /** FCL container dropoff port names (already = Cảng hạ). */
  containerDropNames?: ReadonlyArray<string | null | undefined> | null;
  /** Stored free-text lift point (`shipments.pickup_location`). */
  liftFallback?: string | null;
  /** Stored free-text drop point (`shipments.delivery_location`). */
  dropFallback?: string | null;
}

export interface LiftDropPoints {
  lift: string | null;
  drop: string | null;
}

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** Distinct non-empty names in first-seen order, joined for display. */
function joinPoints(names: ReadonlyArray<string | null | undefined> | null | undefined): string | null {
  const distinct: string[] = [];
  for (const name of names ?? []) {
    const value = clean(name);
    if (value && !distinct.includes(value)) distinct.push(value);
  }
  return distinct.length ? distinct.join(' · ') : null;
}

export function resolveLiftDropPoints(input: LiftDropPointInput): LiftDropPoints {
  const warehouse = clean(input.warehouseName);
  const factory = clean(input.factoryName);
  if (input.cargoMode === 'LCL') {
    const exportLot = input.tradeDirection === 'EXPORT';
    return {
      lift: (exportLot ? factory : warehouse) ?? clean(input.liftFallback),
      drop: (exportLot ? warehouse : factory) ?? clean(input.dropFallback),
    };
  }
  return {
    lift: joinPoints(input.containerLiftNames) ?? clean(input.liftFallback),
    drop: joinPoints(input.containerDropNames) ?? clean(input.dropFallback),
  };
}
