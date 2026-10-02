import { db } from '../db';
import * as schema from '../db/schema';
import { normalizeSeedText } from './seed-identity';

/** Card 20260921_7 ladder + card 20260922_1 — the driver road/allowance fee
 *  norms (định mức) as CONFIG DATA, fill-only: missing codes insert with the
 *  customer's amounts; existing rows are NEVER written (a hand-tuned amount
 *  or a deactivated norm stays as the environment set it). The card-7
 *  migration seeded these historically; this module is the live seed source
 *  that rides the make-demo seed step. */
const NORMS: ReadonlyArray<{
  code: string; label: string; amount: string; costType: string; costGroup: string;
}> = [
  { code: 'LIFT_DROP_ALLOWANCE', label: 'Phụ cấp nâng/hạ Lạch Huyện, TIL, Hateco', amount: '50000', costType: 'LIFT_DROP_ZONE', costGroup: 'DRIVER_ROAD' },
  { code: 'NIGHT_RETURN', label: 'Trả đêm', amount: '100000', costType: 'ROAD_ALLOWANCE', costGroup: 'DRIVER_ROAD' },
  { code: 'TURNAROUND', label: 'Chạy hàng quay đầu', amount: '100000', costType: 'ROAD_ALLOWANCE', costGroup: 'DRIVER_ROAD' },
  { code: 'OVERLOAD', label: 'Chạy hàng quá tải', amount: '200000', costType: 'ROAD_ALLOWANCE', costGroup: 'DRIVER_ROAD' },
  { code: 'ICD_RELOCATION', label: 'Đảo chuyển ICD/Đăng Khoa', amount: '200000', costType: 'ROAD_ALLOWANCE', costGroup: 'DRIVER_ROAD' },
  { code: 'SUNDAY', label: 'Chạy hàng chủ nhật', amount: '200000', costType: 'ROAD_ALLOWANCE', costGroup: 'DRIVER_ROAD' },
  { code: 'SHIFT', label: 'Lưu ca', amount: '200000', costType: 'ROAD_ALLOWANCE', costGroup: 'DRIVER_ROAD' },
  { code: 'SPECIAL_CONTAINER', label: 'Cont 45\'HC / Cont lạnh', amount: '200000', costType: 'ROAD_ALLOWANCE', costGroup: 'DRIVER_ROAD' },
];

export async function seedDriverFeeNorms(): Promise<{ inserted: number }> {
  let inserted = 0;
  const existing = await db.select({ id: schema.driverFeeNorms.id, code: schema.driverFeeNorms.code })
    .from(schema.driverFeeNorms);
  const byCode = new Map(existing.filter((row) => row.code).map((row) => [normalizeSeedText(row.code), row] as const));
  for (const norm of NORMS) {
    if (byCode.has(normalizeSeedText(norm.code))) continue;
    await db.insert(schema.driverFeeNorms).values({
      code: norm.code,
      label: norm.label,
      amount: norm.amount,
      costType: norm.costType,
      costGroup: norm.costGroup,
    });
    inserted += 1;
  }
  return { inserted };
}
