import { db } from '../db/index.js';
import * as s from '../db/schema.js';
import type { ReferenceSeedResult } from './seed-reference.js';

const PORTS = ['cảng tân vũ', 'cảng đình vũ', 'bãi sitc', 'bãi gft'];
const CONTAINER_TYPES = ['20DC', '40DC', '40HC'];

export async function seedLiftPricing(reference: ReferenceSeedResult): Promise<void> {
  const effectiveDate = '2026-08-01';
  let count = 0;

  for (const [portIndex, portName] of PORTS.entries()) {
    const portId = reference.portByName.get(portName);
    if (!portId) continue;

    for (const [typeIndex, code] of CONTAINER_TYPES.entries()) {
      const containerTypeId = reference.containerTypeByCode.get(code);
      if (!containerTypeId) continue;

      for (const direction of ['LIFT_UP', 'LIFT_DOWN'] as const) {
        for (const loadState of ['LOADED', 'EMPTY'] as const) {
          const base = 850_000 + portIndex * 50_000 + typeIndex * 180_000;
          const unitPrice = base
            + (direction === 'LIFT_UP' ? 100_000 : 0)
            + (loadState === 'LOADED' ? 150_000 : 0);
          await db.insert(s.liftPricing).values({
            portId,
            containerTypeId,
            direction,
            loadState,
            unitPrice: String(unitPrice),
            effectiveDate,
            note: 'Biểu giá mẫu O2C — cần xác nhận theo hợp đồng cảng/bãi',
          }).onConflictDoUpdate({
            target: [
              s.liftPricing.portId,
              s.liftPricing.containerTypeId,
              s.liftPricing.direction,
              s.liftPricing.loadState,
              s.liftPricing.effectiveDate,
            ],
            set: { unitPrice: String(unitPrice), updatedAt: new Date() },
          });
          count += 1;
        }
      }
    }
  }

  console.log(`✅ Lift-pricing matrix seeded! (${count} rows)`);
}
