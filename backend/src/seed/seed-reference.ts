/**
 * Seed reference data: ports, routes, cargo_types, container_types.
 *
 * Routes come from the MẪU BÁO GIÁ section structure (Hải Phòng–NEWEB,
 * Hải Phòng–ASKEY, Hải Phòng–SUNRISE+SJ). Container types cover the sizes in
 * the pricing grid and sample trips.
 *
 * Part of plans/260731-customer-audit-reseed.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as s from '../db/schema.js';
import { ports, routes, containerTypes } from './data/index.js';

export interface ReferenceSeedResult {
  portByName: Map<string, number>;
  routeByName: Map<string, number>;
  containerTypeByCode: Map<string, number>;
}

export async function seedReference(): Promise<ReferenceSeedResult> {
  const portByName = new Map<string, number>();
  const routeByName = new Map<string, number>();
  const containerTypeByCode = new Map<string, number>();

  // --- Ports (unique on name via partial index? use code where available) ---
  for (const p of ports) {
    const [row] = await db.insert(s.ports).values({
      name: p.name,
      address: p.address || null,
      city: 'Hải Phòng',
      notes: p.web ? `Portal: ${p.web}` : null,
    }).onConflictDoNothing({ target: s.ports.name }).returning({ id: s.ports.id });
    if (row) {
      portByName.set(p.name.toLowerCase(), row.id);
    } else {
      const [existing] = await db.select({ id: s.ports.id }).from(s.ports)
        .where(sql`lower(btrim(${s.ports.name})) = lower(btrim(${p.name}))`);
      if (existing) portByName.set(p.name.toLowerCase(), existing.id);
    }
  }
  console.log(`✅ Ports seeded! (${ports.length})`);

  // --- Routes (unique on name where deletedAt is null) ---
  for (const r of routes) {
    const [row] = await db.insert(s.routes).values({
      name: r.name,
      distanceKm: r.twoWayKm ?? r.oneWayKm ?? null,
      fixedFuelAllowance: null,
    }).onConflictDoUpdate({
      target: s.routes.name,
      set: { distanceKm: r.twoWayKm ?? r.oneWayKm ?? null, updatedAt: new Date() },
    }).returning({ id: s.routes.id });
    routeByName.set(r.name.toLowerCase(), row!.id);
  }
  console.log(`✅ Routes seeded! (${routes.length})`);

  // --- Container types (unique on code) ---
  for (const ct of containerTypes) {
    const [row] = await db.insert(s.containerTypes).values({
      code: ct.code, name: ct.name,
    }).onConflictDoUpdate({
      target: s.containerTypes.code,
      set: { name: ct.name, updatedAt: new Date() },
    }).returning({ id: s.containerTypes.id });
    containerTypeByCode.set(ct.code, row!.id);
  }
  console.log(`✅ Container types seeded! (${containerTypes.length})`);

  // --- Cargo types: a container-cargo type used by shipments/trips ---
  await db.insert(s.cargoTypes).values({
    name: 'Hàng Container',
    requiresPhotos: true,
    isBulk: false,
  }).onConflictDoNothing();
  console.log('✅ Cargo type "Hàng Container" seeded');

  return { portByName, routeByName, containerTypeByCode };
}
