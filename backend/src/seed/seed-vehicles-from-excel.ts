/**
 * Seed trucks/trailers from customer Excel data
 * Extracted from "29.7 - DATA PM.xlsx" - LOẠI HÌNH XE sheet
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as s from '../db/schema/index.js';
import { vehicles } from './data/index.js';
import { normalizedTextEquals } from './seed-identity.js';
import { reassignTruckDriverInTx } from '../services/truck-driver-assignment.service';

/**
 * Seed vehicles with their truck/trailer combinations
 * Creates both trucks entries and links drivers
 */
export async function seedVehiclesFromExcel(): Promise<void> {
  if (vehicles.length === 0) {
    console.log('✅ No vehicles to seed (empty data)');
    return;
  }

  let createdCount = 0;
  let updatedCount = 0;
  let driverLinks = 0;

  for (const vehicle of vehicles) {
    // Extract trailer type from truck type
    let trailerType: '20FT' | '40FT' | null = null;
    if (vehicle.type.includes('40FT') || vehicle.type.includes('40')) {
      trailerType = '40FT';
    } else if (vehicle.type.includes('20FT') || vehicle.type.includes('20')) {
      trailerType = '20FT';
    }

    // Check if truck already exists by license plate
    const [existingTruck] = await db.select({ id: s.trucks.id })
      .from(s.trucks)
      .where(normalizedTextEquals(s.trucks.licensePlate, vehicle.licensePlate))
      .limit(1);

    const truckValues = {
      licensePlate: vehicle.licensePlate,
      trailerPlateNumber: vehicle.trailerPlate || null,
      trailerType,
      status: 'ACTIVE' as const,
    };

    let truckId: number;
    if (existingTruck) {
      await db.update(s.trucks)
        .set({ ...truckValues, deletedAt: null, updatedAt: new Date() })
        .where(eq(s.trucks.id, existingTruck.id));
      truckId = existingTruck.id;
      updatedCount++;
    } else {
      const [created] = await db.insert(s.trucks)
        .values(truckValues)
        .returning({ id: s.trucks.id });
      truckId = created!.id;
      createdCount++;
    }

    // Link driver if specified
    if (vehicle.driver) {
      const [existingDriver] = await db.select({ id: s.drivers.id })
        .from(s.drivers)
        .where(normalizedTextEquals(s.drivers.name, vehicle.driver))
        .limit(1);

      if (existingDriver) {
        await db.transaction((tx) => reassignTruckDriverInTx(tx, {
          truckId,
          driverId: existingDriver.id,
          createdBy: null,
        }));
        driverLinks++;
      }
    }
  }

  console.log(`✅ Vehicles seeded! (${createdCount} new, ${updatedCount} updated, ${driverLinks} driver links)`);
  for (const v of vehicles) {
    console.log(`   • ${v.licensePlate} (${v.type}) - ${v.driver || 'No driver'}`);
  }
}
