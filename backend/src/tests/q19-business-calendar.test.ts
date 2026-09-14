import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  addCalendarDays,
  calendarDaysOverdue,
  isBusinessDay,
  resolveBusinessDate,
  resolvePaymentDueDate,
} from '../services/business-calendar.service';
import { client, db } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { and, eq, sql } from 'drizzle-orm';
import { getTripArStatus } from '../services/ar-status.service';
import { getCustomerOverdueAmount } from '../services/receivable-reminder.service';
import { LedgerService } from '../services/ledger.service';
import { getDocument, saveDocument } from '../services/billing-document.service';
import { Role } from '@tingting/shared';
import { createAdjustment } from '../services/financial.service';
import { autoApplyGovernanceAction } from '../services/adjustment-governance.service';

after(async () => {
  await client.end();
});

describe('Q19 business calendar', () => {
  it('keeps an ordinary weekday unchanged', () => {
    assert.deepEqual(resolveBusinessDate('2026-07-27', 'NEXT_BUSINESS_DAY'), {
      originalDate: '2026-07-27',
      processingDate: '2026-07-27',
      adjusted: false,
      policy: 'NEXT_BUSINESS_DAY',
    });
  });

  it('rolls a weekend due date to the next weekday', () => {
    const result = resolveBusinessDate('2026-08-01', 'NEXT_BUSINESS_DAY');
    assert.equal(result.originalDate, '2026-08-01');
    assert.equal(result.processingDate, '2026-08-03');
    assert.equal(result.adjusted, true);
  });

  it('skips configured holidays after a weekend', () => {
    const result = resolveBusinessDate('2026-08-01', 'NEXT_BUSINESS_DAY', [
      { calendarDate: '2026-08-03', isWorkingDay: false },
    ]);
    assert.equal(result.processingDate, '2026-08-04');
  });

  it('supports a configured make-up working weekend', () => {
    const overrides = new Map([['2026-08-01', true]]);
    assert.equal(isBusinessDay('2026-08-01', overrides), true);
    assert.equal(
      resolveBusinessDate('2026-08-01', 'NEXT_BUSINESS_DAY', [
        { calendarDate: '2026-08-01', isWorkingDay: true },
      ]).processingDate,
      '2026-08-01',
    );
  });

  it('honors the contract calendar-day override', () => {
    const result = resolveBusinessDate('2026-08-02', 'CALENDAR_DAY', [
      { calendarDate: '2026-08-02', isWorkingDay: false },
    ]);
    assert.equal(result.processingDate, '2026-08-02');
    assert.equal(result.adjusted, false);
  });

  it('uses date-only UTC arithmetic across month boundaries', () => {
    assert.equal(addCalendarDays('2026-01-31', 1), '2026-02-01');
    assert.equal(addCalendarDays('2024-02-28', 1), '2024-02-29');
  });

  it('counts overdue days from the adjusted processing date', () => {
    assert.equal(calendarDaysOverdue('2026-08-03', new Date('2026-08-05T17:00:00Z')), 2);
    assert.equal(calendarDaysOverdue('2026-08-03', new Date('2026-08-03T23:59:00Z')), 0);
  });

  it('rejects malformed and impossible dates', () => {
    assert.throws(() => resolveBusinessDate('2026-02-30', 'NEXT_BUSINESS_DAY'));
    assert.throws(() => resolveBusinessDate('27/07/2026', 'NEXT_BUSINESS_DAY'));
  });

  it('loads configured calendar exceptions from the database authority', async () => {
    let holiday = '2098-01-01';
    while (new Date(`${holiday}T00:00:00.000Z`).getUTCDay() !== 1) {
      holiday = addCalendarDays(holiday, 1);
    }
    const nextDay = addCalendarDays(holiday, 1);

    await db.delete(s.businessCalendarDays)
      .where(eq(s.businessCalendarDays.calendarDate, holiday));
    let customerId: number | null = null;
    let routeId: number | null = null;
    let cargoTypeId: number | null = null;
    let tripId: number | null = null;
    let documentId: number | null = null;
    const actorIds: number[] = [];
    try {
      await db.insert(s.businessCalendarDays).values({
        calendarDate: holiday,
        name: 'Q19 test holiday',
        isWorkingDay: false,
      });

      const result = await resolvePaymentDueDate(holiday, 'NEXT_BUSINESS_DAY');
      assert.equal(result.originalDate, holiday);
      assert.equal(result.processingDate, nextDay);
      assert.equal(result.adjusted, true);

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const actors = await db.insert(s.users).values([
        {
          username: `q19-maker-${suffix}`.slice(0, 100),
          passwordHash: 'x',
          role: Role.ACCOUNTANT,
        },
        {
          username: `q19-checker-${suffix}`.slice(0, 100),
          passwordHash: 'x',
          role: Role.MANAGER,
        },
        {
          username: `q19-approver-${suffix}`.slice(0, 100),
          passwordHash: 'x',
          role: Role.ADMIN,
        },
      ]).returning({ id: s.users.id });
      actorIds.push(...actors.map((actor) => actor.id));
      const [customer] = await db.insert(s.customers)
        .values({ name: `Q19 customer ${suffix}`, paymentTermDays: 0 })
        .returning({ id: s.customers.id });
      customerId = customer.id;
      const [route] = await db.insert(s.routes)
        .values({ name: `Q19 route ${suffix}` })
        .returning({ id: s.routes.id });
      routeId = route.id;
      const [cargoType] = await db.insert(s.cargoTypes)
        .values({ name: `Q19 cargo ${suffix}` })
        .returning({ id: s.cargoTypes.id });
      cargoTypeId = cargoType.id;
      const trip = await insertTripComposite(db, {
        tripCode: `Q19-${suffix}`.slice(0, 50),
        customerId,
        routeId,
        cargoTypeId,
        status: 'COMPLETED',
        departureDate: holiday,
        carrierType: 'OWN',
      });
      tripId = trip.id;
      await db.transaction(async (tx) => {
        await LedgerService.postTripCompletion(tx, {
          id: tripId!,
          customerId: customerId!,
          driverId: null,
          tripCode: `Q19-${suffix}`.slice(0, 50),
          departureDate: holiday,
          revenue: '100',
          driverSalary: null,
          carrierType: 'OWN',
        });
      });
      const document = await saveDocument({
        type: 'DEBIT_NOTE',
        entityType: 'CUSTOMER',
        entityId: customerId,
        entityName: `Q19 customer ${suffix}`,
        rangeFrom: holiday,
        rangeTo: holiday,
        lines: [],
      }, null);
      documentId = document.id;
      assert.equal(document.originalDueDate, holiday);
      assert.equal(document.processingDueDate, nextDay);

      // Historical output must not change when the live contract/calendar is
      // edited after the obligation was posted.
      await db.update(s.customers)
        .set({ paymentDatePolicy: 'CALENDAR_DAY', paymentTermDays: 60 })
        .where(eq(s.customers.id, customerId));
      await db.delete(s.businessCalendarDays)
        .where(eq(s.businessCalendarDays.calendarDate, holiday));

      const arStatus = await getTripArStatus(tripId, 0);
      assert.equal(arStatus.originalDueDate, holiday);
      assert.equal(arStatus.processingDueDate, nextDay);
      const historicalDocument = await getDocument(documentId);
      assert.equal(historicalDocument.originalDueDate, holiday);
      assert.equal(historicalDocument.processingDueDate, nextDay);
      const [adjustmentSource] = await db.select({ version: s.trips.version })
        .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
      // KP-149/MC-4: createAdjustment self-applies in-request — wrapping it
      // in another autoApplyGovernanceAction double-applies the version bump
      // and trips the outer apply's stale guard.
      assert.ok(tripId != null);
      const adjustedTripId = tripId!;
      await createAdjustment({
        tripId: adjustedTripId,
        amount: 25,
        note: 'Q19 tăng công nợ',
        signedAgreementRef: `Q19-${suffix}`,
        makerId: actorIds[0]!,
        makerRole: Role.ACCOUNTANT,
        expectedTripVersion: adjustmentSource.version,
      });
      const [adjustment] = await db.select().from(s.ledger).where(and(
        eq(s.ledger.txnType, 'ADJUSTMENT'),
        eq(s.ledger.txnId, adjustedTripId),
      )).limit(1);
      assert.equal(adjustment.originalDueDate, holiday);
      assert.equal(adjustment.processingDueDate, nextDay);

      const onAdjustedDueDate = await getCustomerOverdueAmount(
        customerId,
        0,
        'NEXT_BUSINESS_DAY',
        new Date(`${nextDay}T12:00:00.000Z`),
      );
      assert.equal(onAdjustedDueDate, 0);

      const dayAfterAdjustedDueDate = await getCustomerOverdueAmount(
        customerId,
        0,
        'NEXT_BUSINESS_DAY',
        new Date(`${addCalendarDays(nextDay, 1)}T12:00:00.000Z`),
      );
      assert.equal(dayAfterAdjustedDueDate, 125);
    } finally {
      if (documentId != null) {
        await db.delete(s.billingDocumentLines)
          .where(eq(s.billingDocumentLines.documentId, documentId));
        await db.delete(s.billingDocuments)
          .where(eq(s.billingDocuments.id, documentId));
      }
      if (tripId != null) {
        await db.delete(s.ledger).where(and(
          eq(s.ledger.entityType, 'CUSTOMER'),
          eq(s.ledger.txnId, tripId),
        ));
        await db.delete(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, tripId));
        await db.delete(s.tripCarrierInfo).where(eq(s.tripCarrierInfo.tripId, tripId));
        await db.delete(s.trips).where(eq(s.trips.id, tripId));
      }
      if (cargoTypeId != null) {
        await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoTypeId));
      }
      if (routeId != null) {
        await db.delete(s.routes).where(eq(s.routes.id, routeId));
      }
      if (customerId != null) {
        await db.delete(s.customers).where(eq(s.customers.id, customerId));
      }
      if (actorIds.length > 0) {
        await db.delete(s.users).where(
          sql`${s.users.id} in (${sql.join(actorIds.map((id) => sql`${id}`), sql`, `)})`,
        );
      }
      await db.delete(s.businessCalendarDays)
        .where(eq(s.businessCalendarDays.calendarDate, holiday));
    }
  });
});
