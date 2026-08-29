import { db } from './index.js';
import * as s from './schema/index.js';
import { isNotNull, sql } from 'drizzle-orm';

async function migrateTrailers() {
  console.log('Starting trailer migration...');

  try {
    const result = await db.transaction(async (tx) => {
      const existingTrailers = await tx.select({ count: sql<number>`count(*)::int` }).from(s.trailers);
      if (existingTrailers[0].count > 0) {
        console.log(`Trailers table already has ${existingTrailers[0].count} rows — skipping.`);
        return { skipped: true };
      }

      const trucksWithTrailers = await tx
        .select({
          id: s.trucks.id,
          trailerPlateNumber: s.trucks.trailerPlateNumber,
          trailerType: s.trucks.trailerType,
        })
        .from(s.trucks)
        .where(isNotNull(s.trucks.trailerPlateNumber));

      console.log(`Found ${trucksWithTrailers.length} trucks with trailer plates.`);

      const uniqueCombos = new Map<string, { licensePlate: string; type: '20FT' | '40FT' }>();
      for (const t of trucksWithTrailers) {
        const key = `${t.trailerPlateNumber}|${t.trailerType ?? '40FT'}`;
        if (!uniqueCombos.has(key)) {
          uniqueCombos.set(key, {
            licensePlate: t.trailerPlateNumber!,
            type: (t.trailerType ?? '40FT') as '20FT' | '40FT',
          });
        }
      }

      console.log(`Extracted ${uniqueCombos.size} unique trailer combinations.`);

      const insertedTrailers = await tx
        .insert(s.trailers)
        .values(
          Array.from(uniqueCombos.values()).map((combo) => ({
            licensePlate: combo.licensePlate,
            type: combo.type,
          }))
        )
        .returning({ id: s.trailers.id, licensePlate: s.trailers.licensePlate });

      console.log(`Inserted ${insertedTrailers.length} trailers.`);

      const trucksUpdated = await tx.execute(sql`
        UPDATE trucks SET current_trailer_id = tr.id
        FROM trailers tr
        WHERE trucks.trailer_plate_number = tr."license_plate"
          AND trucks.current_trailer_id IS NULL
      `);
      console.log(`Updated currentTrailerId on ${trucksUpdated.count} trucks.`);

      const tripsUpdated = await tx.execute(sql`
        UPDATE trips SET
          trailer_id = tr.current_trailer_id,
          trailer_type = COALESCE(trips.trailer_type, tl.type)
        FROM trucks tr
        JOIN trailers tl ON tr.current_trailer_id = tl.id
        WHERE trips.truck_id = tr.id
          AND tr.current_trailer_id IS NOT NULL
          AND trips.trailer_id IS NULL
      `);
      console.log(`Updated trailerId on ${tripsUpdated.count} trips.`);

      return {
        skipped: false,
        trailersInserted: insertedTrailers.length,
        trucksUpdated: trucksUpdated.count,
        tripsUpdated: tripsUpdated.count,
      };
    });

    if ('skipped' in result && result.skipped) {
      console.log('Migration skipped — trailers already exist.');
    } else {
      console.log('Migration complete.');
      console.log(`  Trailers inserted: ${result.trailersInserted}`);
      console.log(`  Trucks updated:    ${result.trucksUpdated}`);
      console.log(`  Trips updated:     ${result.tripsUpdated}`);
    }

    process.exit(0);
  } catch (err) {
    console.error('Trailer migration failed:', err);
    process.exit(1);
  }
}

migrateTrailers();
