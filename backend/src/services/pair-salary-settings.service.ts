// Pair salary settings (lương cặp ghép chuyến — LoHangKepKetHop §4.2,
// TC-GHEP-007). The driver of a paired run is paid `cuốc cơ bản + phụ phí`
// (NOT the sum of two single wages). The surcharge per pair kind lives in
// app_settings so kế toán/admin tunes it without a deploy; pairing and the
// figures-recalc path both read it LIVE from here — never hard-coded.
import { inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';

const KEYS = {
  kep: 'salary.pair_surcharge_kep',
  ketHop: 'salary.pair_surcharge_ket_hop',
} as const;

export interface PairSalarySettings {
  /** Surcharge (VND) added to the base cuốc for a KEP pair. */
  kepSurcharge: number;
  /** Surcharge (VND) added to the base cuốc for a KET_HOP pair. */
  ketHopSurcharge: number;
}

function parseVnd(value: string | null | undefined): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clampVnd(value: number): number {
  const parsed = Math.trunc(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function getPairSalarySettingsFrom(q: typeof db | Tx = db): Promise<PairSalarySettings> {
  const rows = await q
    .select({ key: s.appSettings.key, value: s.appSettings.value })
    .from(s.appSettings)
    .where(inArray(s.appSettings.key, [KEYS.kep, KEYS.ketHop]));
  const values = new Map(rows.map((row) => [row.key, row.value]));
  return {
    kepSurcharge: parseVnd(values.get(KEYS.kep)),
    ketHopSurcharge: parseVnd(values.get(KEYS.ketHop)),
  };
}

export async function savePairSalarySettings(tx: Tx, next: PairSalarySettings): Promise<PairSalarySettings> {
  const now = new Date();
  const entries: Array<readonly [string, number]> = [
    [KEYS.kep, clampVnd(next.kepSurcharge)],
    [KEYS.ketHop, clampVnd(next.ketHopSurcharge)],
  ];
  for (const [key, value] of entries) {
    await tx
      .insert(s.appSettings)
      .values({ key, value: String(value) })
      .onConflictDoUpdate({
        target: s.appSettings.key,
        set: { value: String(value), updatedAt: now },
      });
  }
  return {
    kepSurcharge: clampVnd(next.kepSurcharge),
    ketHopSurcharge: clampVnd(next.ketHopSurcharge),
  };
}

/** The single read point for "what surcharge does this pair kind pay". */
export function pairSurchargeFor(
  kind: 'KEP' | 'KET_HOP',
  settings: PairSalarySettings,
): number {
  return kind === 'KEP' ? settings.kepSurcharge : settings.ketHopSurcharge;
}
