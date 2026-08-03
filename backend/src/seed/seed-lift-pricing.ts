import { and, eq } from 'drizzle-orm';
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
          const values = {
            portId,
            containerTypeId,
            direction,
            loadState,
            unitPrice: String(unitPrice),
            effectiveDate,
            note: 'Biểu giá mẫu O2C — cần xác nhận theo hợp đồng cảng/bãi',
          } as const;
          const [existing] = await db.select({ id: s.liftPricing.id })
            .from(s.liftPricing)
            .where(and(
              eq(s.liftPricing.portId, portId),
              eq(s.liftPricing.containerTypeId, containerTypeId),
              eq(s.liftPricing.direction, direction),
              eq(s.liftPricing.loadState, loadState),
              eq(s.liftPricing.effectiveDate, effectiveDate),
            ))
            .limit(1);
          if (existing) {
            await db.update(s.liftPricing).set({
              ...values,
              deletedAt: null,
              updatedAt: new Date(),
            }).where(eq(s.liftPricing.id, existing.id));
          } else {
            await db.insert(s.liftPricing).values(values);
          }
          count += 1;
        }
      }
    }
  }

  console.log(`✅ Lift-pricing matrix seeded! (${count} rows)`);
}
