/**
 * Repair trip salaries created with the retired month-specific workday divisor.
 *
 * Dry-run is the default. Writes require both `--apply` and
 * `--i-have-signoff` because this changes trip costs, profit, and (for trips
 * already posted to the ledger) driver payables.
 *
 * The matcher is intentionally narrow: it changes only non-locked OWN trips
 * whose stored salary exactly equals baseSalary / oldCalendarDivisor × wageDays.
 * Manual overrides are not candidates.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, client } from '../src/db';
import * as s from '../src/db/schema';
import { identifyLegacyTripSalary } from '../src/services/legacy-trip-salary-repair';
import { LedgerService } from '../src/services/ledger.service';
import { TxnType } from '@tingting/shared';

const APPLY = process.argv.includes('--apply');
const HAVE_SIGNOFF = process.argv.includes('--i-have-signoff');
const WRITE_MODE = APPLY && HAVE_SIGNOFF;

const tripIdFlag = process.argv.indexOf('--trips');
const requestedTripIds = tripIdFlag === -1
  ? null
  : (process.argv[tripIdFlag + 1] ?? '')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);

if (tripIdFlag !== -1 && requestedTripIds?.length === 0) {
  console.error('--trips requires a comma-separated list of positive trip IDs.');
  process.exit(2);
}

if (APPLY && !HAVE_SIGNOFF) {
  console.log('DRY RUN — --apply was ignored because --i-have-signoff is missing.');
}

const baseConditions = [
  isNull(s.trips.deletedAt),
  eq(s.trips.carrierType, 'OWN'),
  inArray(s.trips.status, ['CREATED', 'IN_TRANSIT', 'COMPLETED']),
];
if (requestedTripIds) baseConditions.push(inArray(s.trips.id, requestedTripIds));

async function loadRows(executor: typeof db = db) {
  return executor.select({
    id: s.trips.id,
    version: s.trips.version,
    tripCode: s.trips.tripCode,
    status: s.trips.status,
    carrierType: s.trips.carrierType,
    departureDate: s.trips.departureDate,
    driverId: s.trips.driverId,
    driverName: s.drivers.name,
    baseSalary: s.drivers.baseSalary,
    tripWageDays: s.trips.tripWageDays,
    driverSalary: s.trips.driverSalary,
    totalCost: s.trips.totalCost,
    grossProfit: s.trips.grossProfit,
  }).from(s.trips)
    .innerJoin(s.drivers, eq(s.drivers.id, s.trips.driverId))
    .where(and(...baseConditions))
    .orderBy(s.trips.id);
}

function classify(row: Awaited<ReturnType<typeof loadRows>>[number]) {
  const repair = identifyLegacyTripSalary({
    status: row.status,
    carrierType: row.carrierType,
    departureDate: row.departureDate,
    baseSalary: Number(row.baseSalary ?? 0),
    tripWageDays: Number(row.tripWageDays ?? 0),
    storedDriverSalary: Number(row.driverSalary ?? 0),
  });
  return repair ? { row, repair } : null;
}

async function main() {
  const candidates = (await loadRows()).map(classify).filter((item) => item !== null);

  console.log(`Mode: ${WRITE_MODE ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Legacy salary candidates: ${candidates.length}`);
  for (const { row, repair } of candidates) {
    console.log(
      `${row.tripCode ?? `Trip ${row.id}`} (${row.driverName}): ` +
      `${repair.legacyDriverSalary.toLocaleString('vi-VN')} -> ` +
      `${repair.correctedDriverSalary.toLocaleString('vi-VN')} VND ` +
      `(delta ${repair.salaryDelta.toLocaleString('vi-VN')})`,
    );
  }

  if (!WRITE_MODE || candidates.length === 0) return;

  await db.transaction(async (tx) => {
    for (const candidate of candidates) {
      // Serialize with ordinary trip edits and status transitions, then
      // reclassify from the locked row before touching financial values.
      await tx.execute(sql`
        SELECT ${s.trips.id}
        FROM ${s.trips}
        WHERE ${s.trips.id} = ${candidate.row.id}
        FOR UPDATE
      `);

      const [fresh] = await tx.select({
        id: s.trips.id,
        version: s.trips.version,
        tripCode: s.trips.tripCode,
        status: s.trips.status,
        carrierType: s.trips.carrierType,
        departureDate: s.trips.departureDate,
        driverId: s.trips.driverId,
        driverName: s.drivers.name,
        baseSalary: s.drivers.baseSalary,
        tripWageDays: s.trips.tripWageDays,
        driverSalary: s.trips.driverSalary,
        totalCost: s.trips.totalCost,
        grossProfit: s.trips.grossProfit,
      }).from(s.trips)
        .innerJoin(s.drivers, eq(s.drivers.id, s.trips.driverId))
        .where(eq(s.trips.id, candidate.row.id))
        .limit(1);
      const current = fresh && classify(fresh);
      if (!current) {
        throw new Error(`Trip ${candidate.row.id} changed after the dry-run scan; aborting.`);
      }
      if (current.row.totalCost == null || current.row.grossProfit == null) {
        throw new Error(
          `Trip ${current.row.id} has no stored totalCost/grossProfit; run the canonical recost workflow instead.`,
        );
      }

      const oldTotalCost = Number(current.row.totalCost);
      const oldGrossProfit = Number(current.row.grossProfit);
      const updated = await tx.update(s.trips).set({
        driverSalary: String(current.repair.correctedDriverSalary),
        totalCost: String(oldTotalCost + current.repair.salaryDelta),
        grossProfit: String(oldGrossProfit - current.repair.salaryDelta),
        version: current.row.version + 1,
        updatedAt: new Date(),
      }).where(and(
        eq(s.trips.id, current.row.id),
        eq(s.trips.version, current.row.version),
      )).returning({ id: s.trips.id });
      if (updated.length !== 1) {
        throw new Error(`Trip ${current.row.id} version changed during repair; aborting.`);
      }

      if (current.row.status === 'COMPLETED' && current.row.driverId) {
        const [postedSalary] = await tx.select({
          count: sql<number>`count(*)::int`,
          netPayable: sql<string>`
            coalesce(sum(${s.ledger.credit}::numeric - ${s.ledger.debit}::numeric), 0)
          `,
        })
          .from(s.ledger)
          .where(and(
            eq(s.ledger.txnId, current.row.id),
            eq(s.ledger.entityType, 'DRIVER'),
            eq(s.ledger.entityId, current.row.driverId),
            inArray(s.ledger.txnType, [
              TxnType.DRIVER_SALARY,
              TxnType.UNLOCK_REVERSAL,
              TxnType.ADJUSTMENT,
            ]),
          ))
          .limit(1);
        if ((postedSalary?.count ?? 0) > 0) {
          const currentNetPayable = Number(postedSalary.netPayable);
          if (currentNetPayable !== current.repair.legacyDriverSalary) {
            throw new Error(
              `Trip ${current.row.id} driver ledger net is ${currentNetPayable}, expected ` +
              `${current.repair.legacyDriverSalary}; aborting to avoid a duplicate adjustment.`,
            );
          }
          await LedgerService.postEntry(tx, {
            txnType: TxnType.ADJUSTMENT,
            txnId: current.row.id,
            receiptId: `legacy-trip-salary:${current.row.id}`,
            entityType: 'DRIVER',
            entityId: current.row.driverId,
            debit: current.repair.salaryDelta < 0 ? -current.repair.salaryDelta : 0,
            credit: current.repair.salaryDelta > 0 ? current.repair.salaryDelta : 0,
            note: `Điều chỉnh lương chuyến ${current.row.tripCode ?? current.row.id}: áp dụng định mức 26 ngày`,
          });
        }
      }

      await tx.insert(s.auditLogs).values({
        actorName: 'repair-legacy-trip-salaries',
        message: `Điều chỉnh lương chuyến ${current.row.tripCode ?? current.row.id} theo định mức 26 ngày`,
        entityType: 'TRIP',
        entityId: current.row.id,
        payload: {
          event: 'TRIP_DRIVER_SALARY_REPAIRED',
          before: current.repair.legacyDriverSalary,
          after: current.repair.correctedDriverSalary,
          delta: current.repair.salaryDelta,
          oldDivisor: current.repair.legacyDivisor,
          newDivisor: 26,
        },
      });
    }
  });

  console.log(`Applied ${candidates.length} salary repair(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
