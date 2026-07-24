import { db } from './db';
import * as s from './db/schema';

async function resetAndSeed() {
  console.log('🗑️ Clearing existing data...');

  // Clear tables in correct order (respecting foreign keys)
  await db.delete(s.tripLegs);
  await db.delete(s.tripPhotos).catch(() => {});
  await db.delete(s.trips);
  await db.delete(s.ledger);
  await db.delete(s.penalties);
  await db.delete(s.expensePhotos);
  await db.delete(s.expenses);
  await db.delete(s.expenseCategories);
  await db.delete(s.pricingTables);
  await db.delete(s.roadAllowances);
  await db.delete(s.drivers);
  await db.delete(s.trucks);
  await db.delete(s.routes);
  await db.delete(s.cargoTypes);
  await db.delete(s.customers);
  await db.delete(s.users);
  await db.delete(s.fuelConfig);
  await db.delete(s.penaltyReasons);

  console.log('✅ Data cleared!');
  console.log('🔄 Running fresh seed...');

  // Run the new modular seed
  await import('./seed');
}

resetAndSeed().catch(err => {
  console.error('❌ Reset failed:', err);
  process.exit(1);
});
