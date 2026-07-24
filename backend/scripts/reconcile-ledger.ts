/**
 * T4.10: Periodic Ledger Reconciliation Script
 *
 * Recomputes per-entity running balances from raw ledger entries
 * and compares against stored balance values. Reports discrepancies.
 * Also verifies trip↔ledger consistency (every LOCKED trip should have
 * corresponding ledger entries).
 *
 * Usage:
 *   npx tsx scripts/reconcile-ledger.ts          # Check only (exits 1 on issues)
 *   npx tsx scripts/reconcile-ledger.ts --fix     # Insert compensating ADJUSTMENT entries
 *
 * NOTE: --fix does NOT update existing ledger rows (ledger is append-only).
 *       Instead, it inserts a compensating ADJUSTMENT entry that corrects the
 *       running balance going forward. Requires connecting as a role with
 *       INSERT permission on ledger (e.g., tingting_app or superuser).
 *
 * Epic ref: §4.8
 */

import { db } from '../src/db';
import * as s from '../src/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { TripStatus, TxnType } from '@tingting/shared';

const FIX_MODE = process.argv.includes('--fix');

interface Discrepancy {
  entityType: string;
  entityId: number;
  storedBalance: number;
  computedBalance: number;
  diff: number;
}

interface TripLedgerGap {
  tripId: number;
  tripCode: string | null;
  issue: string;
}

// TxnType values to check for trip-ledger consistency
const TRIP_LEDGER_TXN_TYPES = [TxnType.TRIP_REVENUE, TxnType.DRIVER_SALARY] as const;

async function reconcileBalances(): Promise<Discrepancy[]> {
  console.log('\n📊 Phase 1: Per-entity balance reconciliation\n');

  // Single aggregated query: compute SUM(debit), SUM(credit) per entity
  // and get the latest row's stored balance — all in one round-trip
  const entitySums = await db.select({
    entityType: s.ledger.entityType,
    entityId: s.ledger.entityId,
    totalDebit: sql<string>`coalesce(sum(${s.ledger.debit}::numeric), 0)`,
    totalCredit: sql<string>`coalesce(sum(${s.ledger.credit}::numeric), 0)`,
    latestBalance: sql<string>`(SELECT l2.balance FROM ledger l2 WHERE l2.entity_type = ledger.entity_type AND l2.entity_id = ledger.entity_id ORDER BY l2.id DESC LIMIT 1)`,
    latestId: sql<number>`(SELECT l2.id FROM ledger l2 WHERE l2.entity_type = ledger.entity_type AND l2.entity_id = ledger.entity_id ORDER BY l2.id DESC LIMIT 1)`,
  }).from(s.ledger)
    .groupBy(s.ledger.entityType, s.ledger.entityId);

  const discrepancies: Discrepancy[] = [];

  for (const row of entitySums) {
    const storedBalance = Number(row.latestBalance);
    const totalDebit = Number(row.totalDebit);
    const totalCredit = Number(row.totalCredit);

    // Sign convention: CUSTOMER balance = totalDebit - totalCredit, DRIVER = totalCredit - totalDebit
    let computedBalance: number;
    if (row.entityType === 'CUSTOMER') {
      computedBalance = totalDebit - totalCredit;
    } else {
      computedBalance = totalCredit - totalDebit;
    }

    const diff = storedBalance - computedBalance; // positive = stored too high
    const absDiff = Math.abs(diff);
    const status = absDiff === 0 ? '✅' : '❌';

    console.log(`  ${status} ${row.entityType}#${row.entityId}: stored=${storedBalance}, computed=${computedBalance}, diff=${absDiff}`);

    if (absDiff !== 0) {
      discrepancies.push({
        entityType: row.entityType,
        entityId: row.entityId,
        storedBalance,
        computedBalance,
        diff,
      });

      if (FIX_MODE) {
        // Insert compensating ADJUSTMENT entry to correct the running balance
        // For CUSTOMER: if stored > computed, we need a credit (reduces balance)
        // For DRIVER: if stored > computed, we need a debit (reduces balance)
        const isCustomer = row.entityType === 'CUSTOMER';
        const compensatingDebit = isCustomer ? (diff < 0 ? absDiff : 0) : (diff > 0 ? absDiff : 0);
        const compensatingCredit = isCustomer ? (diff > 0 ? absDiff : 0) : (diff < 0 ? absDiff : 0);

        await db.insert(s.ledger).values({
          txnType: TxnType.ADJUSTMENT,
          entityType: row.entityType,
          entityId: row.entityId,
          debit: String(compensatingDebit),
          credit: String(compensatingCredit),
          balance: String(computedBalance), // corrected balance after compensation
          note: `Reconciliation auto-fix: correcting balance drift of ${absDiff}`,
        });
        console.log(`     🔧 Fixed: inserted compensating ADJUSTMENT entry (debit=${compensatingDebit}, credit=${compensatingCredit})`);
      }
    }
  }

  return discrepancies;
}

async function reconcileTrips(): Promise<TripLedgerGap[]> {
  console.log('\n📊 Phase 2: Trip↔Ledger consistency check\n');

  // Find all LOCKED trips
  const lockedTrips = await db.select({
    id: s.trips.id,
    tripCode: s.trips.tripCode,
    customerId: s.trips.customerId,
    driverId: s.trips.driverId,
    revenue: s.trips.revenue,
    driverSalary: s.trips.driverSalary,
  }).from(s.trips).where(eq(s.trips.status, TripStatus.LOCKED));

  const gaps: TripLedgerGap[] = [];

  for (const trip of lockedTrips) {
    let tripHasIssue = false;

    // Check customer revenue ledger entry
    const [customerEntry] = await db.select()
      .from(s.ledger)
      .where(and(
        eq(s.ledger.txnType, TxnType.TRIP_REVENUE),
        eq(s.ledger.txnId, trip.id),
        eq(s.ledger.entityType, 'CUSTOMER'),
      ))
      .limit(1);

    if (!customerEntry) {
      console.log(`  ❌ Trip #${trip.id} (${trip.tripCode}): Missing CUSTOMER TRIP_REVENUE entry`);
      gaps.push({ tripId: trip.id, tripCode: trip.tripCode, issue: 'Missing CUSTOMER TRIP_REVENUE entry' });
      tripHasIssue = true;
    } else {
      const expectedRevenue = Number(trip.revenue || 0);
      const actualDebit = Number(customerEntry.debit);
      if (actualDebit !== expectedRevenue) {
        console.log(`  ❌ Trip #${trip.id} (${trip.tripCode}): Revenue mismatch trip=${expectedRevenue} ledger=${actualDebit}`);
        gaps.push({ tripId: trip.id, tripCode: trip.tripCode, issue: `Revenue mismatch: trip=${expectedRevenue} ledger=${actualDebit}` });
        tripHasIssue = true;
      }
    }

    // Check driver salary ledger entry (if salary > 0)
    const salary = Number(trip.driverSalary || 0);
    if (salary > 0) {
      const [driverEntry] = await db.select()
        .from(s.ledger)
        .where(and(
          eq(s.ledger.txnType, TxnType.DRIVER_SALARY),
          eq(s.ledger.txnId, trip.id),
          eq(s.ledger.entityType, 'DRIVER'),
        ))
        .limit(1);

      if (!driverEntry) {
        console.log(`  ❌ Trip #${trip.id} (${trip.tripCode}): Missing DRIVER DRIVER_SALARY entry`);
        gaps.push({ tripId: trip.id, tripCode: trip.tripCode, issue: 'Missing DRIVER DRIVER_SALARY entry' });
        tripHasIssue = true;
      } else {
        const actualCredit = Number(driverEntry.credit);
        if (actualCredit !== salary) {
          console.log(`  ❌ Trip #${trip.id} (${trip.tripCode}): Salary mismatch trip=${salary} ledger=${actualCredit}`);
          gaps.push({ tripId: trip.id, tripCode: trip.tripCode, issue: `Salary mismatch: trip=${salary} ledger=${actualCredit}` });
          tripHasIssue = true;
        }
      }
    }

    if (!tripHasIssue) {
      console.log(`  ✅ Trip #${trip.id} (${trip.tripCode}): Ledger entries consistent`);
    }
  }

  // Batch check: ledger entries with no corresponding LOCKED trip
  // Use IN clause instead of N+1 per-entry queries
  const orphanEntries = await db.select({
    txnId: s.ledger.txnId,
    txnType: s.ledger.txnType,
  }).from(s.ledger)
    .where(sql`${s.ledger.txnType} IN (${sql.join(TRIP_LEDGER_TXN_TYPES.map(t => sql`${t}`), sql`, `)}) AND ${s.ledger.txnId} IS NOT NULL`)
    .groupBy(s.ledger.txnId, s.ledger.txnType);

  if (orphanEntries.length > 0) {
    const txnIds = orphanEntries.filter(e => e.txnId !== null).map(e => e.txnId!);

    // Batch fetch trip statuses
    const tripStatuses = await db.select({
      id: s.trips.id,
      status: s.trips.status,
    }).from(s.trips).where(sql`${s.trips.id} IN (${sql.join(txnIds.map(id => sql`${id}`), sql`, `)})`);

    const statusMap = new Map(tripStatuses.map(t => [t.id, t.status]));

    for (const entry of orphanEntries) {
      if (!entry.txnId) continue;
      const tripStatus = statusMap.get(entry.txnId);

      if (!tripStatus) {
        console.log(`  ⚠️  Ledger references trip #${entry.txnId} (${entry.txnType}) but trip does not exist`);
        gaps.push({ tripId: entry.txnId, tripCode: null, issue: `Orphan ledger entry: trip does not exist (${entry.txnType})` });
      } else if (tripStatus !== TripStatus.LOCKED) {
        console.log(`  ⚠️  Ledger references trip #${entry.txnId} but trip status is ${tripStatus} (not LOCKED)`);
        gaps.push({ tripId: entry.txnId, tripCode: null, issue: `Ledger entry for non-LOCKED trip (status: ${tripStatus})` });
      }
    }
  }

  return gaps;
}

async function main() {
  console.log('🔍 Ledger Reconciliation Report');
  console.log(`   Mode: ${FIX_MODE ? 'FIX (compensating entries)' : 'CHECK ONLY'}`);
  console.log(`   Time: ${new Date().toISOString()}`);

  const balanceDiscrepancies = await reconcileBalances();
  const tripGaps = await reconcileTrips();

  console.log('\n' + '═'.repeat(60));
  console.log('📋 Summary');
  console.log('═'.repeat(60));
  console.log(`  Balance discrepancies: ${balanceDiscrepancies.length}`);
  console.log(`  Trip↔Ledger gaps:     ${tripGaps.length}`);

  if (balanceDiscrepancies.length > 0 || tripGaps.length > 0) {
    if (FIX_MODE) {
      console.log('\n  🔧 Compensating entries inserted for balance drift.');
    } else {
      console.log('\n  ⚠️  Issues found. Run with --fix to insert compensating entries.');
    }
    if (!FIX_MODE) {
      process.exit(1);
    }
  } else {
    console.log('\n  ✅ All checks passed. Ledger is consistent.');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Reconciliation failed:', err);
  process.exit(1);
});
