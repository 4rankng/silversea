/**
 * Data Migration: Fix grossProfit for locked trips with ancillary fees
 *
 * C1 fix changed service margin from:  Σ(sellExVat - buyExVat)
 *                                     to: Σ(sellExVat - buyInclVat)
 *
 * The delta is: -Σ(buyAmount × vatRate / (1 + vatRate)) per APPROVED fee.
 * This is always ≤ 0, meaning stored grossProfit was overstated and must decrease.
 *
 * Ledger entries (TRIP_REVENUE, DRIVER_SALARY, etc.) are based on individual
 * amounts and do NOT reference grossProfit — they are unaffected.
 *
 * Usage: npx tsx scripts/migrate-service-margin.ts
 */
import { db } from '../src/db/index.js';
import * as s from '../src/db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';

const DEFAULT_FEE_VAT = 0.080;

async function migrateServiceMargin() {
  console.log('=== Service Margin Data Migration (C1 fix) ===\n');

  // 1. Find all LOCKED trips that have at least one APPROVED trip expense
  const tripsWithFees = await db
    .select({
      tripId: s.trips.id,
      tripCode: s.trips.tripCode,
      currentGrossProfit: s.trips.grossProfit,
      carrierType: s.trips.carrierType,
    })
    .from(s.trips)
    .innerJoin(
      s.tripExpenses,
      and(
        eq(s.tripExpenses.tripId, s.trips.id),
        eq(s.tripExpenses.approvalStatus, 'APPROVED'),
      ),
    )
    .where(and(eq(s.trips.status, 'LOCKED'), isNull(s.trips.deletedAt)))
    .groupBy(s.trips.id, s.trips.tripCode, s.trips.grossProfit, s.trips.carrierType);

  if (tripsWithFees.length === 0) {
    console.log('No locked trips with ancillary fees found. Nothing to migrate.');
    return;
  }

  console.log(`Found ${tripsWithFees.length} locked trips with ancillary fees.\n`);

  let updated = 0;
  let skipped = 0;
  let totalDelta = 0;

  for (const trip of tripsWithFees) {
    // 2. Get all APPROVED fees for this trip, joined with expense type for vatRate
    const fees = await db
      .select({
        buyAmount: s.tripExpenses.buyAmount,
        sellAmount: s.tripExpenses.sellAmount,
        expenseType: s.tripExpenses.expenseType,
        feeVatRate: s.forwarderExpenseTypes.vatRate,
      })
      .from(s.tripExpenses)
      .leftJoin(
        s.forwarderExpenseTypes,
        eq(s.tripExpenses.expenseType, s.forwarderExpenseTypes.code),
      )
      .where(
        and(
          eq(s.tripExpenses.tripId, trip.tripId),
          eq(s.tripExpenses.approvalStatus, 'APPROVED'),
        ),
      );

    // 3. Compute delta: new serviceMargin - old serviceMargin
    //    old: Σ(sellExVat - buyExVat)
    //    new: Σ(sellExVat - buyInclVat)
    //    delta = -Σ(buyAmount × vatRate / (1 + vatRate))
    let delta = 0;
    for (const fee of fees) {
      const feeVat = Number(fee.feeVatRate ?? DEFAULT_FEE_VAT);
      const buyAmt = Number(fee.buyAmount);
      if (feeVat > 0 && buyAmt > 0) {
        // Old formula stripped VAT from buy: buyExVat = buyAmt / (1+vat)
        // New formula keeps buy as-is: buyInclVat = buyAmt
        // Delta per fee = -(buyAmt - buyAmt/(1+vat)) = -buyAmt * vat/(1+vat)
        delta -= Math.round(buyAmt * feeVat / (1 + feeVat));
      }
    }

    if (delta === 0) {
      skipped++;
      continue;
    }

    const currentGp = Number(trip.currentGrossProfit || 0);
    const newGrossProfit = currentGp + delta;

    // 4. Update the trip's grossProfit
    await db
      .update(s.trips)
      .set({
        grossProfit: String(newGrossProfit),
        updatedAt: new Date(),
      })
      .where(eq(s.trips.id, trip.tripId));

    console.log(
      `  Trip ${trip.tripCode || trip.tripId}: grossProfit ${currentGp.toLocaleString('vi-VN')} → ${newGrossProfit.toLocaleString('vi-VN')} (Δ${delta.toLocaleString('vi-VN')})`,
    );

    updated++;
    totalDelta += delta;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Trips updated: ${updated}`);
  console.log(`Trips skipped (no change): ${skipped}`);
  console.log(`Total grossProfit delta: ${totalDelta.toLocaleString('vi-VN')} VND`);
  console.log(`\nDone.`);
}

migrateServiceMargin()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
