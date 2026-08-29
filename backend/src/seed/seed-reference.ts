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
import * as s from '../db/schema/index.js';
import { ports, routes, containerTypes } from './data/index.js';
import { normalizedTextEquals } from './seed-identity.js';

export interface ReferenceSeedResult {
  portByName: Map<string, number>;
  routeByName: Map<string, number>;
  containerTypeByCode: Map<string, number>;
}

export async function seedReference(): Promise<ReferenceSeedResult> {
  return db.transaction(async (tx) => {
    // Reference names do not all have simple database unique constraints.
    // Serialize the idempotent resolve/update/insert sequence across concurrent
    // setup processes instead of allowing duplicate ports, routes, or cargo.
    await tx.execute(sql`select pg_advisory_xact_lock(2026080101)`);

    const portByName = new Map<string, number>();
    const routeByName = new Map<string, number>();
    const containerTypeByCode = new Map<string, number>();

  // --- Ports (name is not a database unique key; resolve before insert) ---
  for (const p of ports) {
    // Match across live AND soft-deleted rows, preferring live: a soft-deleted
    // duplicate (e.g. a merged terminal) resolves to its id instead of seeding
    // a second row under the same name.
    const [existing] = await tx.select({ id: s.ports.id }).from(s.ports)
      .where(sql`lower(btrim(${s.ports.name})) = lower(btrim(${p.name}))`)
      .orderBy(sql`${s.ports.deletedAt} asc nulls first`)
      .limit(1);
    if (existing) {
      portByName.set(p.name.toLowerCase(), existing.id);
      continue;
    }
    const [row] = await tx.insert(s.ports).values({
      name: p.name,
      address: p.address || null,
      city: 'Hải Phòng',
      notes: p.web ? `Portal: ${p.web}` : null,
    }).returning({ id: s.ports.id });
    portByName.set(p.name.toLowerCase(), row!.id);
  }
  console.log(`✅ Ports seeded! (${ports.length})`);

  // --- Routes (unique on name where deletedAt is null) ---
  for (const r of routes) {
    const [existing] = await tx.select({ id: s.routes.id }).from(s.routes)
      .where(sql`${s.routes.deletedAt} is null and lower(btrim(${s.routes.name})) = lower(btrim(${r.name}))`)
      .limit(1);
    if (existing) {
      await tx.update(s.routes).set({
        distanceKm: r.twoWayKm ?? r.oneWayKm ?? null,
        updatedAt: new Date(),
      }).where(sql`${s.routes.id} = ${existing.id}`);
      routeByName.set(r.name.toLowerCase(), existing.id);
      continue;
    }
    const [row] = await tx.insert(s.routes).values({
      name: r.name,
      shortName: r.name.split(/[+-]/)[0]!.trim(),
      distanceKm: r.twoWayKm ?? r.oneWayKm ?? null,
      fixedFuelAllowance: null,
    }).returning({ id: s.routes.id });
    routeByName.set(r.name.toLowerCase(), row!.id);
  }
  console.log(`✅ Routes seeded! (${routes.length})`);

  // --- Container types (unique on code) ---
  for (const ct of containerTypes) {
    const [existing] = await tx.select({ id: s.containerTypes.id })
      .from(s.containerTypes)
      .where(normalizedTextEquals(s.containerTypes.code, ct.code))
      .limit(1);
    if (existing) {
      await tx.update(s.containerTypes).set({
        name: ct.name,
        deletedAt: null,
        updatedAt: new Date(),
      }).where(sql`${s.containerTypes.id} = ${existing.id}`);
      containerTypeByCode.set(ct.code, existing.id);
      continue;
    }
    const [created] = await tx.insert(s.containerTypes).values({
      code: ct.code,
      name: ct.name,
    }).returning({ id: s.containerTypes.id });
    containerTypeByCode.set(ct.code, created!.id);
  }
  console.log(`✅ Container types seeded! (${containerTypes.length})`);

  // --- Cargo types: a container-cargo type used by shipments/trips ---
  const [existingContainerCargo] = await tx.select({ id: s.cargoTypes.id })
    .from(s.cargoTypes)
    .where(sql`lower(btrim(${s.cargoTypes.name})) = lower(btrim('Hàng Container'))`)
    .limit(1);
  if (!existingContainerCargo) {
    await tx.insert(s.cargoTypes).values({
      name: 'Hàng Container',
      requiresPhotos: true,
      isBulk: false,
    });
  }
  console.log('✅ Cargo type "Hàng Container" seeded');

    return { portByName, routeByName, containerTypeByCode };
  });
}
