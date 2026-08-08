/**
 * Seed ports/terminals from customer Excel data
 * Extracted from "29.7 - DATA PM.xlsx" - THÔNG TIN CẢNG BÃI sheet
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as s from '../db/schema.js';
import { ports as portsFromExcel } from './data/ports-from-excel.js';
import { normalizedTextEquals } from './seed-identity.js';
import { sql } from 'drizzle-orm';

/**
 * Seed ports/terminals for shipment operations
 * These populate the "Cảng/Điểm" dropdown in forms
 */
export async function seedPorts(): Promise<void> {
  const ports = portsFromExcel;

  if (ports.length === 0) {
    console.log('✅ No ports to seed (empty data)');
    return;
  }

  let createdCount = 0;
  let updatedCount = 0;

  for (const port of ports) {
    // Check if port already exists by name
    const [existing] = await db.select({ id: s.ports.id })
      .from(s.ports)
      .where(normalizedTextEquals(s.ports.name, port.name))
      .limit(1);

    // Generate code from port name (uppercase, no spaces)
    const code = port.name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '_')
      .substring(0, 20);

    const values = {
      code,
      name: port.name,
      address: port.address || null,
      city: 'Hải Phòng', // Default for these ports
    };

    if (existing) {
      await db.update(s.ports)
        .set({ ...values, deletedAt: null, updatedAt: new Date() })
        .where(eq(s.ports.id, existing.id));
      updatedCount++;
    } else {
      await db.insert(s.ports).values(values);
      createdCount++;
    }
  }

  console.log(`✅ Ports seeded! (${createdCount} new, ${updatedCount} updated)`);
  for (const p of ports.slice(0, 5)) {
    console.log(`   • ${p.name}`);
  }
  if (ports.length > 5) {
    console.log(`   • ... and ${ports.length - 5} more`);
  }
}
