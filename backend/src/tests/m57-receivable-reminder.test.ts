/**
 * Wave 3 M5.7 — receivable reminder job tests.
 *
 * Verifies: skip rules (paid / suspended / not-overdue / disputed),
 * per-day dedupe, email + in-app emission, fault isolation across
 * customers, and the email-extraction helper.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { config } from '../config';

import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import {
  runReceivableReminderRetries,
  runReceivableReminders,
  isCustomerDisputed,
  alreadyRemindedToday,
  extractEmail,
  REMINDER_SUBJECT_PREFIX,
} from '../services/receivable-reminder.service';
import { initNotificationService } from '../services/notification.service';
import { upsertPartnerFromTaxCode } from '../services/legal-partner.service';
import {
  EMAIL_SETTING_KEYS,
  invalidateEmailSettings,
  saveEmailSettings,
} from '../services/email-settings.service';
import { addCalendarDays } from '../services/business-calendar.service';
import { Role } from '@tingting/shared';
import { createAdjustment } from '../services/financial.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdLedgerIds: number[] = [];
const createdEmailLogIds: number[] = [];
const createdNotifIds: number[] = [];
const createdUserIds: number[] = [];
const createdBillingDocumentIds: number[] = [];
const createdBillingLineIds: number[] = [];
const createdDebtOffsetIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdCalendarDates = new Set<string>();
let originalResendKeyValue: string | undefined;

function businessDateNow(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function atVnTime(date: string, hour: number, minute = 0): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute, 0, 0));
}

function findWeekday(startDate: string, weekday: number): string {
  let candidate = startDate;
  while (new Date(`${candidate}T00:00:00.000Z`).getUTCDay() !== weekday) {
    candidate = addCalendarDays(candidate, 1);
  }
  return candidate;
}

async function mkUser(
  role: 'ADMIN' | 'MANAGER' | 'ACCOUNTANT' | 'CUS' | 'CUSTOMER',
  opts: { customerId?: number | null; status?: 'ACTIVE' | 'INACTIVE' } = {},
) {
  const [u] = await db.insert(s.users).values({
    username: `m57-${role}-${suffix}-${createdUserIds.length}`,
    passwordHash: 'x',
    role,
    status: opts.status ?? 'ACTIVE',
    customerId: opts.customerId ?? null,
  }).returning();
  createdUserIds.push(u.id);
  return u;
}

async function mkCalendarDay(calendarDate: string, isWorkingDay: boolean, name = 'M57 holiday') {
  const [existing] = await db.select({ id: s.businessCalendarDays.id, name: s.businessCalendarDays.name })
    .from(s.businessCalendarDays)
    .where(eq(s.businessCalendarDays.calendarDate, calendarDate))
    .limit(1);
  if (existing && !String(existing.name ?? '').startsWith('M57')) {
    throw new Error(`Refusing to replace non-test business calendar day ${calendarDate}`);
  }
  if (existing) {
    await db.update(s.businessCalendarDays)
      .set({ isWorkingDay, name })
      .where(eq(s.businessCalendarDays.id, existing.id));
  } else {
    await db.insert(s.businessCalendarDays)
      .values({ calendarDate, isWorkingDay, name });
  }
  createdCalendarDates.add(calendarDate);
}

async function mkCustomer(opts: { status?: 'ACTIVE' | 'LOCKED'; contactInfo?: string } = {}) {
  const [c] = await db.insert(s.customers).values({
    name: `M57 customer ${suffix}-${createdCustomerIds.length}`,
    status: opts.status ?? 'ACTIVE',
    contactInfo: opts.contactInfo ?? `email: m57-${suffix}-${createdCustomerIds.length}@example.com`,
  }).returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkRoute() {
  const [r] = await db.insert(s.routes).values({ name: `M57 route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(r.id);
  return r;
}

async function mkCargo() {
  const [c] = await db.insert(s.cargoTypes).values({ name: `M57 cargo ${suffix}-${createdCargoTypeIds.length}` }).returning();
  createdCargoTypeIds.push(c.id);
  return c;
}

async function mkSupplier() {
  const [supplier] = await db.insert(s.suppliers).values({
    name: `M57 supplier ${suffix}-${createdSupplierIds.length}`,
  }).returning();
  createdSupplierIds.push(supplier.id);
  return supplier;
}

/** departureDate in past (YYYY-MM-DD) so trip is overdue by default. */
async function mkOverdueTrip(
  customerId: number,
  routeId: number,
  cargoTypeId: number,
  departureDate = '2025-01-01',
  forcedId?: number,
) {
  const t = await insertTripComposite(db, {
    ...(forcedId == null ? {} : { id: forcedId }),
    tripCode: `M57-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId, routeId, cargoTypeId,
    status: 'COMPLETED', departureDate, carrierType: 'OWN',
  });
  createdTripIds.push(t.id);
  return t;
}

async function mkRevenue(
  customerId: number,
  tripId: number,
  amount: number,
  dueDate = '2025-01-31',
) {
  const [e] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER' as const,
    entityId: customerId,
    txnType: 'TRIP_REVENUE' as const,
    txnId: tripId,
    debit: String(amount),
    credit: '0',
    balance: String(amount),
    note: null,
    originalDueDate: dueDate,
    processingDueDate: dueDate,
    paymentTermDaysApplied: 30,
    paymentDatePolicyApplied: 'NEXT_BUSINESS_DAY',
  }).returning();
  createdLedgerIds.push(e.id);
  return e;
}

async function mkRejectedDebitNoteForTrip(
  customerId: number,
  tripId: number,
  amount: number,
  documentDate = '2026-07-01',
) {
  const [document] = await db.insert(s.billingDocuments).values({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customerId,
    entityName: `M57 disputed ${suffix}`,
    rangeFrom: documentDate,
    rangeTo: documentDate,
    totalInclVat: String(amount),
    debitNoteStatus: 'REJECTED',
    ledgerAdjustmentAmount: '0',
  }).returning();
  createdBillingDocumentIds.push(document.id);

  const [line] = await db.insert(s.billingDocumentLines).values({
    documentId: document.id,
    sourceType: 'TRIP',
    sourceId: tripId,
    lineType: 'FREIGHT',
    typeLabel: 'Cước',
    unit: 'chuyến',
    description: `M57 disputed trip ${tripId}`,
    baseAmount: String(amount),
    amountOverride: String(amount),
  }).returning();
  createdBillingLineIds.push(line.id);
  return { document, line };
}

async function mkRejectedDebitNoteAdjustment(
  customerId: number,
  amount: number,
  dueDate: string,
  forcedDocumentId?: number,
) {
  const [document] = await db.insert(s.billingDocuments).values({
    ...(forcedDocumentId == null ? {} : { id: forcedDocumentId }),
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customerId,
    entityName: `M57 colliding doc ${suffix}`,
    rangeFrom: dueDate,
    rangeTo: dueDate,
    totalInclVat: String(amount),
    debitNoteStatus: 'REJECTED',
    ledgerAdjustmentAmount: String(amount),
    originalDueDate: dueDate,
    processingDueDate: dueDate,
  }).returning();
  createdBillingDocumentIds.push(document.id);

  const [entry] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER' as const,
    entityId: customerId,
    txnType: 'ADJUSTMENT' as const,
    txnId: document.id,
    debit: String(amount),
    credit: '0',
    balance: String(amount),
    note: `M57 rejected debit note #${document.id}`,
    receiptId: `GBN:${document.id}`,
    originalDueDate: dueDate,
    processingDueDate: dueDate,
    paymentTermDaysApplied: 0,
    paymentDatePolicyApplied: 'NEXT_BUSINESS_DAY',
  }).returning();
  createdLedgerIds.push(entry.id);

  return { document, entry };
}

async function mkTripArAdjustment(
  customerId: number,
  tripId: number,
  amount: number,
  dueDate: string,
) {
  const maker = await mkUser('ACCOUNTANT');
  await mkUser('MANAGER');
  await mkUser('ADMIN');
  const [trip] = await db.select({ version: s.trips.version })
    .from(s.trips)
    .where(and(eq(s.trips.id, tripId), eq(s.trips.customerId, customerId)))
    .limit(1);
  assert.ok(trip);
  // KP-149/MC-4: createAdjustment self-applies in-request — wrapping it in
  // another autoApplyGovernanceAction double-applies the version bump and
  // trips the outer apply's stale guard.
  const approved = await createAdjustment({
    tripId,
    amount,
    note: `M57 trip AR adjustment ${tripId}`,
    signedAgreementRef: `M57-${suffix}-${tripId}`,
    makerId: maker.id,
    makerRole: Role.ACCOUNTANT,
    expectedTripVersion: trip.version,
  });
  assert.ok(approved.ledgerEntryId != null);
  const [entry] = await db.select().from(s.ledger)
    .where(eq(s.ledger.id, approved.ledgerEntryId))
    .limit(1);
  assert.ok(entry);
  assert.equal(entry.processingDueDate, dueDate);
  createdLedgerIds.push(entry.id);
  return entry;
}

async function mkDebtOffsetCustomerAdjustment(
  customerId: number,
  offsetId: number,
  amount: number,
) {
  const supplier = await mkSupplier();
  const partnerId = await upsertPartnerFromTaxCode(`M57${String(offsetId).padStart(6, '0')}`);
  assert.ok(partnerId != null, 'test partner must be created');
  const [offset] = await db.insert(s.debtOffsets).values({
    id: offsetId,
    customerId,
    supplierId: supplier.id,
    partnerId,
    amount: String(Math.abs(amount)),
    offsetDate: businessDateNow(),
    currency: 'VND',
    minutesReference: `BB-M57-${offsetId}`,
    note: `M57 offset ${offsetId}`,
    approvalStatus: 'APPROVED',
    createdBy: 1,
  }).returning();
  createdDebtOffsetIds.push(offset.id);

  const [entry] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER' as const,
    entityId: customerId,
    txnType: 'ADJUSTMENT' as const,
    txnId: offset.id,
    debit: amount > 0 ? String(amount) : '0',
    credit: amount < 0 ? String(Math.abs(amount)) : '0',
    balance: String(amount),
    note: `Đối trừ công nợ #${offset.id}`,
  }).returning();
  createdLedgerIds.push(entry.id);

  return { offset, entry };
}

async function mkReminderEmailLog(customerId: number) {
  const [e] = await db.insert(s.customerEmailLogs).values({
    customerId,
    subject: `${REMINDER_SUBJECT_PREFIX} prior reminder`,
    recipientEmail: `m57-${suffix}@example.com`,
    status: 'SENT',
    retryCount: 0,
  }).returning();
  createdEmailLogIds.push(e.id);
  return e;
}

async function fetchTodayEmailLogForCustomer(customerId: number) {
  return db.select().from(s.customerEmailLogs)
    .where(and(
      eq(s.customerEmailLogs.customerId, customerId),
      sql`${s.customerEmailLogs.subject} LIKE ${REMINDER_SUBJECT_PREFIX + '%'}`,
      sql`(${s.customerEmailLogs.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = ${businessDateNow()}::date`,
    ));
}

async function fetchTodayReminderNotifications(
  customerId: number,
  title?: string,
  userId?: number,
) {
  const conditions = [
    eq(s.notifications.relatedEntityType, 'customers'),
    eq(s.notifications.relatedEntityId, customerId),
  ];
  if (title) {
    conditions.push(eq(s.notifications.title, title));
  }
  if (userId) {
    conditions.push(eq(s.notifications.userId, userId));
  }
  const rows = await db.select().from(s.notifications).where(and(...conditions));
  for (const row of rows) if (!createdNotifIds.includes(row.id)) createdNotifIds.push(row.id);
  return rows;
}

// Notification service needs its event listener initialized once per process.
before(async () => {
  initNotificationService();
  // Positive reminder scenarios are intentionally about delivery/dedupe, not
  // the wall-clock weekday. Mark the current test date as working so the suite
  // stays deterministic when CI runs on a weekend; the dedicated weekend case
  // below uses a different Saturday with no override.
  await mkCalendarDay(businessDateNow(), true, 'M57 current test working day');
  const [row] = await db
    .select({ value: s.appSettings.value })
    .from(s.appSettings)
    .where(eq(s.appSettings.key, EMAIL_SETTING_KEYS.resendApiKey))
    .limit(1);
  originalResendKeyValue = row?.value;
  await saveEmailSettings({ clearResendApiKey: true });
});

after(async () => {
  const custPattern = `M57 %${suffix}%`;
  const tripCodePattern = `M57-${suffix}%`;
  const rcptPattern = `m57-${suffix}%@example.com`;
  const userPattern = `m57-%-${suffix}-%`;
  try {
    if (createdNotifIds.length > 0) await db.delete(s.notifications).where(inArray(s.notifications.id, createdNotifIds));
    if (createdCustomerIds.length > 0) {
      await db.delete(s.notifications).where(and(
        eq(s.notifications.relatedEntityType, 'customers'),
        inArray(s.notifications.relatedEntityId, createdCustomerIds),
      ));
    }
    if (createdEmailLogIds.length > 0) await db.delete(s.customerEmailLogs).where(inArray(s.customerEmailLogs.id, createdEmailLogIds));
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customerEmailLogs).where(inArray(s.customerEmailLogs.customerId, createdCustomerIds));
    }
    await db.delete(s.customerEmailLogs).where(sql`${s.customerEmailLogs.recipientEmail} LIKE ${rcptPattern}`);
    if (createdBillingLineIds.length > 0) {
      await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.id, createdBillingLineIds));
    }
    if (createdBillingDocumentIds.length > 0) {
      await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, createdBillingDocumentIds));
    }
    if (createdDebtOffsetIds.length > 0) {
      await db.delete(s.debtOffsets).where(inArray(s.debtOffsets.id, createdDebtOffsetIds));
    }
    if (createdSupplierIds.length > 0) {
      await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
    }
    if (createdLedgerIds.length > 0) await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    if (createdCustomerIds.length > 0) {
      await db.delete(s.ledger).where(and(
        eq(s.ledger.entityType, 'CUSTOMER'),
        inArray(s.ledger.entityId, createdCustomerIds),
      ));
    }
    if (createdCalendarDates.size > 0) {
      await db.delete(s.businessCalendarDays).where(inArray(s.businessCalendarDays.calendarDate, [...createdCalendarDates]));
    }
    await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, db.select({ id: s.trips.id }).from(s.trips).where(sql`${s.trips.tripCode} LIKE ${tripCodePattern}`)));
    await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, db.select({ id: s.trips.id }).from(s.trips).where(sql`${s.trips.tripCode} LIKE ${tripCodePattern}`)));
    await db.delete(s.trips).where(sql`${s.trips.tripCode} LIKE ${tripCodePattern}`);
    await db.delete(s.cargoTypes).where(sql`${s.cargoTypes.name} LIKE ${custPattern}`);
    await db.delete(s.routes).where(sql`${s.routes.name} LIKE ${custPattern}`);
    await db.delete(s.customers).where(sql`${s.customers.name} LIKE ${custPattern}`);
    if (createdUserIds.length > 0) {
      await db.delete(s.notifications).where(inArray(s.notifications.userId, createdUserIds));
    }
    await db.delete(s.users).where(sql`${s.users.username} LIKE ${userPattern}`);
    await db.delete(s.appSettings).where(eq(s.appSettings.key, EMAIL_SETTING_KEYS.resendApiKey));
    if (originalResendKeyValue !== undefined) {
      await db.insert(s.appSettings).values({
        key: EMAIL_SETTING_KEYS.resendApiKey,
        value: originalResendKeyValue,
      });
    }
    invalidateEmailSettings();
  } catch (err) { console.warn('[m57] cleanup:', (err as Error).message); }
  await client.end();
});

describe('M5.7 — extractEmail', () => {
  test('extracts a valid email from contactInfo', () => {
    assert.equal(extractEmail('Phone: 0901 234 567; Email: ket.toan@example.vn'), 'ket.toan@example.vn');
  });
  test('returns null when no email present', () => {
    assert.equal(extractEmail('Phone: 0901 234 567'), null);
    assert.equal(extractEmail(null), null);
  });
});

describe('M5.7 — isCustomerDisputed', () => {
  test('returns true when customer has a rejected debit note', async () => {
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 500_000);
    await mkRejectedDebitNoteForTrip(c.id, t.id, 500_000);
    assert.equal(await isCustomerDisputed(c.id), true);
  });
  test('returns false when customer has only trip-level activity', async () => {
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 1_000_000);
    assert.equal(await isCustomerDisputed(c.id), false);
  });
});

describe('M5.7 — alreadyRemindedToday', () => {
  test('returns false without prior reminder', async () => {
    const c = await mkCustomer();
    assert.equal(await alreadyRemindedToday(c.id), false);
  });
  test('returns true after a reminder email log is created today', async () => {
    const c = await mkCustomer();
    await mkReminderEmailLog(c.id);
    assert.equal(await alreadyRemindedToday(c.id), true);
  });
});

describe('M5.7 — runReceivableReminders', () => {
  const todayBusinessDate = businessDateNow();
  const runAtBusinessMorning = atVnTime(todayBusinessDate, 9);

  test('does not send at 07:59 and sends at the inclusive 08:00 boundary', async () => {
    const c = await mkCustomer();
    const customerUser = await mkUser('CUSTOMER', { customerId: c.id });
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 1_100_000, todayBusinessDate);

    await runReceivableReminders(atVnTime(todayBusinessDate, 7, 59));
    assert.equal((await fetchTodayEmailLogForCustomer(c.id)).length, 0);
    assert.equal(
      (await fetchTodayReminderNotifications(c.id, 'Nhắc thanh toán công nợ', customerUser.id)).length,
      0,
    );

    await runReceivableReminders(atVnTime(todayBusinessDate, 8, 0));
    assert.equal((await fetchTodayEmailLogForCustomer(c.id)).length, 1);
    assert.equal(
      (await fetchTodayReminderNotifications(c.id, 'Nhắc thanh toán công nợ', customerUser.id)).length,
      1,
    );
  });

  test('sends at the inclusive 17:30 boundary', async () => {
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 1_200_000, todayBusinessDate);

    await runReceivableReminders(atVnTime(todayBusinessDate, 17, 30));

    assert.equal((await fetchTodayEmailLogForCustomer(c.id)).length, 1);
  });

  test('does not send at 17:31 after the delivery window closes', async () => {
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 1_300_000, todayBusinessDate);

    await runReceivableReminders(atVnTime(todayBusinessDate, 17, 31));

    assert.equal((await fetchTodayEmailLogForCustomer(c.id)).length, 0);
  });

  test('does not send on an ordinary weekend without a calendar override', async () => {
    const saturday = findWeekday(addCalendarDays(todayBusinessDate, 1), 6);
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id, saturday);
    await mkRevenue(c.id, t.id, 1_400_000, saturday);

    await runReceivableReminders(atVnTime(saturday, 9));

    assert.equal((await fetchTodayEmailLogForCustomer(c.id)).length, 0);
  });

  test('concurrent runs create exactly one customer email and one customer notification', async () => {
    const c = await mkCustomer();
    const customerUser = await mkUser('CUSTOMER', { customerId: c.id });
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 1_500_000, todayBusinessDate);

    await Promise.all([
      runReceivableReminders(runAtBusinessMorning),
      runReceivableReminders(runAtBusinessMorning),
    ]);

    assert.equal(
      (await fetchTodayEmailLogForCustomer(c.id)).length,
      1,
      'advisory claim permits exactly one customer email log',
    );
    assert.equal(
      (await fetchTodayReminderNotifications(c.id, 'Nhắc thanh toán công nợ', customerUser.id)).length,
      1,
      'the winning run emits exactly one customer notification',
    );
  });

  test('skips LOCKED (suspended) customer', async () => {
    const c = await mkCustomer({ status: 'LOCKED' });
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 5_000_000, todayBusinessDate);

    const stats = await runReceivableReminders(runAtBusinessMorning);
    // The customer should NOT have been reminded (status filter).
    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 0);
    // Sanity: skipped was incremented at least once this run.
    assert.ok(stats.skipped >= 1);
  });

  test('skips customer with no outstanding AR (paid)', async () => {
    const c = await mkCustomer();
    // No revenue → no outstanding.
    const r = await mkRoute(); const cg = await mkCargo();
    await mkOverdueTrip(c.id, r.id, cg.id);

    await runReceivableReminders(runAtBusinessMorning);
    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 0);
  });

  test('skips customer whose debt is not overdue yet', async () => {
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    // Departure today → not overdue (due = today + 30 days).
    const t = await mkOverdueTrip(c.id, r.id, cg.id, todayBusinessDate);
    await mkRevenue(c.id, t.id, 5_000_000, addCalendarDays(todayBusinessDate, 7));

    await runReceivableReminders(runAtBusinessMorning);
    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 0);
  });

  test('suppresses only the disputed obligation tied to a rejected debit note', async () => {
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const disputedTrip = await mkOverdueTrip(c.id, r.id, cg.id);
    const openTrip = await mkOverdueTrip(c.id, r.id, cg.id, addCalendarDays(todayBusinessDate, -1));
    await mkRevenue(c.id, disputedTrip.id, 5_000_000, todayBusinessDate);
    await mkRevenue(c.id, openTrip.id, 3_000_000, todayBusinessDate);
    await mkRejectedDebitNoteForTrip(c.id, disputedTrip.id, 5_000_000, todayBusinessDate);

    await runReceivableReminders(runAtBusinessMorning);
    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 1);
    assert.match(emails[0].subject, /Đến hạn/);
    assert.match(emails[0].subject, /3\.000\.000|3,000,000/);
  });

  test('keeps trip adjustments separate from debt offsets and rejected debit notes when numeric ids collide', async () => {
    const collidingId = 910_001 + createdTripIds.length;
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const trip = await mkOverdueTrip(c.id, r.id, cg.id, todayBusinessDate, collidingId);
    await mkRevenue(c.id, trip.id, 3_000_000, todayBusinessDate);
    await mkTripArAdjustment(c.id, trip.id, 1_000_000, todayBusinessDate);
    await mkDebtOffsetCustomerAdjustment(c.id, trip.id, -750_000);
    await mkRejectedDebitNoteAdjustment(c.id, 2_000_000, todayBusinessDate, trip.id);

    await runReceivableReminders(runAtBusinessMorning);
    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 1);
    assert.match(emails[0].subject, /4\.000\.000|4,000,000/);
    assert.doesNotMatch(emails[0].subject, /2\.000\.000|2,000,000/);
    assert.doesNotMatch(emails[0].subject, /3\.250\.000|3,250,000/);
    assert.doesNotMatch(emails[0].subject, /6\.000\.000|6,000,000/);
  });

  test('sends one summary email + one internal evidence notification for an eligible customer-day', async () => {
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t1 = await mkOverdueTrip(c.id, r.id, cg.id);
    const t2 = await mkOverdueTrip(c.id, r.id, cg.id, addCalendarDays(todayBusinessDate, -1));
    await mkRevenue(c.id, t1.id, 7_500_000, todayBusinessDate);
    await mkRevenue(c.id, t2.id, 2_500_000, todayBusinessDate);

    await runReceivableReminders(runAtBusinessMorning);

    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 1);
    assert.ok(emails[0].subject.startsWith(REMINDER_SUBJECT_PREFIX));
    assert.equal(emails[0].status, 'SENT');
    assert.match(emails[0].subject, /Đến hạn/);

    // One internal evidence notification targeted to internal users.
    const notifs = await fetchTodayReminderNotifications(c.id, 'Nhắc công nợ khách hàng');
    assert.ok(notifs.length > 0, 'at least one internal evidence notification emitted');
    assert.ok(notifs.every((row) => row.type === 'OVERDUE_PAYMENT'));
  });

  test('no duplicate in cycle: second run same day does not re-send', async () => {
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 3_000_000, todayBusinessDate);

    const first = await runReceivableReminders(runAtBusinessMorning);
    const second = await runReceivableReminders(runAtBusinessMorning);

    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 1, 'only one reminder email per day');
    // Second run saw the customer and deduped.
    assert.ok(second.deduped >= 1);
    assert.ok(first.reminded >= 1);
  });

  test('customer with no email still gets customer-scoped fallback and internal evidence', async () => {
    const c = await mkCustomer({ contactInfo: 'Phone only: 0901 123 456' });
    const customerUser = await mkUser('CUSTOMER', { customerId: c.id });
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 4_000_000, todayBusinessDate);

    await runReceivableReminders(runAtBusinessMorning);
    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 1, 'missing recipient is still logged once for dedupe/audit');
    assert.equal(emails[0].status, 'FAILED');
    const notifs = await fetchTodayReminderNotifications(c.id, 'Nhắc công nợ khách hàng');
    assert.ok(notifs.length > 0, 'finance receives internal evidence');
    const customerNotifs = await fetchTodayReminderNotifications(c.id, 'Nhắc thanh toán công nợ', customerUser.id);
    assert.equal(customerNotifs.length, 1, 'customer fallback still exists without email');

    await runReceivableReminders(runAtBusinessMorning);
    const rerunEmails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(rerunEmails.length, 1, 'second run same day stays deduped');
  });

  test('rolls a weekend due-date reminder to the next configured working day', async () => {
    const saturdayDueDate = findWeekday(addCalendarDays(todayBusinessDate, 14), 6);
    const mondayHoliday = addCalendarDays(saturdayDueDate, 2);
    const tuesdayRunDate = addCalendarDays(mondayHoliday, 1);
    await mkCalendarDay(mondayHoliday, false, 'M57 holiday');

    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id, saturdayDueDate);
    await mkRevenue(c.id, t.id, 6_000_000, saturdayDueDate);

    const beforeRoll = await runReceivableReminders(atVnTime(mondayHoliday, 9));
    assert.equal(beforeRoll.reminded, 0);

    await runReceivableReminders(atVnTime(tuesdayRunDate, 9));
    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 1);
    assert.match(emails[0].subject, /Đến hạn/);
  });

  test('holds a rolled reminder until 09:00 on the resolved working day', async () => {
    const saturdayDueDate = findWeekday(addCalendarDays(todayBusinessDate, 21), 6);
    const mondayHoliday = addCalendarDays(saturdayDueDate, 2);
    const tuesdayRunDate = addCalendarDays(mondayHoliday, 1);
    await mkCalendarDay(mondayHoliday, false, 'M57 delayed holiday');

    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id, saturdayDueDate);
    await mkRevenue(c.id, t.id, 6_500_000, saturdayDueDate);

    await runReceivableReminders(atVnTime(tuesdayRunDate, 8, 59));
    const beforeNineEmails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(beforeNineEmails.length, 0);

    await runReceivableReminders(atVnTime(tuesdayRunDate, 9, 0));
    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 1);
    assert.match(emails[0].subject, /Đến hạn/);
  });

  test('continues recurring reminders every 7 days after T+3', async () => {
    const recurringDueDate = addCalendarDays(todayBusinessDate, -10);

    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id, recurringDueDate);
    await mkRevenue(c.id, t.id, 7_250_000, recurringDueDate);

    await runReceivableReminders(runAtBusinessMorning);
    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 1);
    assert.match(emails[0].subject, /T\+10/);
  });

  test('dedupes outstanding total when rolled due-date and T+3 stages collide on one working day', async () => {
    const saturdayDueDate = findWeekday(addCalendarDays(todayBusinessDate, 12), 6);
    const monday = addCalendarDays(saturdayDueDate, 2);
    const tuesday = addCalendarDays(saturdayDueDate, 3);
    const wednesday = addCalendarDays(saturdayDueDate, 4);
    const thursday = addCalendarDays(saturdayDueDate, 5);
    const friday = addCalendarDays(saturdayDueDate, 6);
    await mkCalendarDay(monday, false, 'M57 collision holiday 1');
    await mkCalendarDay(tuesday, false, 'M57 collision holiday 2');
    await mkCalendarDay(wednesday, false, 'M57 collision holiday 3');
    await mkCalendarDay(thursday, false, 'M57 collision holiday 4');

    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id, saturdayDueDate);
    await mkRevenue(c.id, t.id, 6_000_000, saturdayDueDate);

    await runReceivableReminders(atVnTime(friday, 9));
    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 1);
    assert.match(emails[0].subject, /Đến hạn/);
    assert.match(emails[0].subject, /T\+3/);
    assert.match(emails[0].subject, /6\.000\.000|6,000,000/);
    assert.doesNotMatch(emails[0].subject, /12\.000\.000|12,000,000/);
  });

  test('emits customer fallback even when the provider send fails', async () => {
    const c = await mkCustomer();
    const customerUser = await mkUser('CUSTOMER', { customerId: c.id });
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 5_500_000, todayBusinessDate);

    const originalNodeEnv = config.nodeEnv;
    config.nodeEnv = 'production';
    try {
      const stats = await runReceivableReminders(runAtBusinessMorning);
      assert.equal(stats.failed, 1);
      const customerNotifs = await fetchTodayReminderNotifications(c.id, 'Nhắc thanh toán công nợ', customerUser.id);
      assert.equal(customerNotifs.length, 1);
    } finally {
      config.nodeEnv = originalNodeEnv;
    }
  });

  test('emits customer-scoped in-app fallback only to linked ACTIVE CUSTOMER users', async () => {
    const c = await mkCustomer();
    const otherCustomer = await mkCustomer();
    const customerUser = await mkUser('CUSTOMER', { customerId: c.id });
    const unrelatedCustomerUser = await mkUser('CUSTOMER', { customerId: otherCustomer.id });
    await mkUser('CUSTOMER', { customerId: c.id, status: 'INACTIVE' });

    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 9_000_000, todayBusinessDate);

    await runReceivableReminders(runAtBusinessMorning);

    const linkedUserNotifs = await fetchTodayReminderNotifications(c.id, 'Nhắc thanh toán công nợ', customerUser.id);
    assert.equal(linkedUserNotifs.length, 1);
    assert.ok(linkedUserNotifs.every((row) => row.type === 'OVERDUE_PAYMENT'));

    const unrelatedUserNotifs = await fetchTodayReminderNotifications(c.id, 'Nhắc thanh toán công nợ', unrelatedCustomerUser.id);
    assert.equal(unrelatedUserNotifs.length, 0);
  });
});

describe('M5.7 — retry delivery', () => {
  const todayBusinessDate = businessDateNow();
  const runAtBusinessMorning = atVnTime(todayBusinessDate, 9);

  test('retries at 15m / 2h / 24h and alerts CUS plus finance after terminal failure', async () => {
    const admin = await mkUser('ADMIN');
    const accountant = await mkUser('ACCOUNTANT');
    const clerk = await mkUser('CUS');
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 8_000_000, todayBusinessDate);

    const originalNodeEnv = config.nodeEnv;
    config.nodeEnv = 'production';
    try {
      const initial = await runReceivableReminders(runAtBusinessMorning);
      assert.equal(initial.failed, 1);

      let [log] = await fetchTodayEmailLogForCustomer(c.id);
      assert.equal(log.status, 'FAILED');
      assert.equal(log.retryCount, 0);

      await runReceivableReminders(runAtBusinessMorning);
      const dedupedLogs = await fetchTodayEmailLogForCustomer(c.id);
      assert.equal(dedupedLogs.length, 1, 'failed initial reminder still dedupes the customer-day');

      await db.update(s.customerEmailLogs)
        .set({ updatedAt: new Date(Date.now() - 15 * 60 * 1000 - 1_000) })
        .where(eq(s.customerEmailLogs.id, log.id));
      const retry1 = await runReceivableReminderRetries(new Date());
      assert.equal(retry1.retried, 0);
      assert.equal(retry1.failed, 1);

      [log] = await fetchTodayEmailLogForCustomer(c.id);
      assert.equal(log.retryCount, 1);

      await db.update(s.customerEmailLogs)
        .set({ updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000 - 1_000) })
        .where(eq(s.customerEmailLogs.id, log.id));
      const retry2 = await runReceivableReminderRetries(new Date());
      assert.equal(retry2.failed, 1);

      [log] = await fetchTodayEmailLogForCustomer(c.id);
      assert.equal(log.retryCount, 2);

      await db.update(s.customerEmailLogs)
        .set({ updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000 - 1_000) })
        .where(eq(s.customerEmailLogs.id, log.id));
      const retry3 = await runReceivableReminderRetries(new Date());
      assert.equal(retry3.failed, 1);
      assert.equal(retry3.escalated, 1);

      [log] = await fetchTodayEmailLogForCustomer(c.id);
      assert.equal(log.retryCount, 3);
      const adminAlerts = await fetchTodayReminderNotifications(c.id, 'Email nhắc công nợ thất bại', admin.id);
      const accountantAlerts = await fetchTodayReminderNotifications(c.id, 'Email nhắc công nợ thất bại', accountant.id);
      const clerkAlerts = await fetchTodayReminderNotifications(c.id, 'Email nhắc công nợ thất bại', clerk.id);
      assert.equal(adminAlerts.length, 1);
      assert.equal(accountantAlerts.length, 1);
      assert.equal(clerkAlerts.length, 1);
    } finally {
      config.nodeEnv = originalNodeEnv;
    }
  });

  test('suppresses a pending retry after the customer is fully paid', async () => {
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 5_000_000, todayBusinessDate);

    const originalNodeEnv = config.nodeEnv;
    config.nodeEnv = 'production';
    try {
      await runReceivableReminders(runAtBusinessMorning);
      const [log] = await fetchTodayEmailLogForCustomer(c.id);
      await db.insert(s.ledger).values({
        entityType: 'CUSTOMER' as const,
        entityId: c.id,
        txnType: 'PAYMENT_RECEIVED' as const,
        txnId: t.id,
        debit: '0',
        credit: '5000000',
        balance: '0',
        note: 'M57 settled before retry',
      }).returning().then((rows) => { createdLedgerIds.push(rows[0].id); });
      await db.update(s.customerEmailLogs)
        .set({ updatedAt: new Date(Date.now() - 15 * 60 * 1000 - 1_000) })
        .where(eq(s.customerEmailLogs.id, log.id));

      const retry = await runReceivableReminderRetries(new Date());
      assert.equal(retry.suppressed, 1);

      const [updated] = await fetchTodayEmailLogForCustomer(c.id);
      assert.equal(updated.retryCount, 3);
      assert.match(updated.errorMessage ?? '', /Suppressed: Đã thanh toán đủ/);
    } finally {
      config.nodeEnv = originalNodeEnv;
    }
  });

  test('creates customer fallback when a retry later succeeds', async () => {
    const c = await mkCustomer();
    const customerUser = await mkUser('CUSTOMER', { customerId: c.id });
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 5_100_000, todayBusinessDate);

    const originalNodeEnv = config.nodeEnv;
    config.nodeEnv = 'production';
    try {
      await runReceivableReminders(runAtBusinessMorning);
      const [log] = await fetchTodayEmailLogForCustomer(c.id);
      await db.delete(s.notifications).where(and(
        eq(s.notifications.relatedEntityType, 'customers'),
        eq(s.notifications.relatedEntityId, c.id),
        eq(s.notifications.title, 'Nhắc thanh toán công nợ'),
      ));

      config.nodeEnv = 'development';
      await db.update(s.customerEmailLogs)
        .set({ updatedAt: new Date(Date.now() - 15 * 60 * 1000 - 1_000) })
        .where(eq(s.customerEmailLogs.id, log.id));

      const retry = await runReceivableReminderRetries(new Date());
      assert.equal(retry.retried, 1);

      const customerNotifs = await fetchTodayReminderNotifications(c.id, 'Nhắc thanh toán công nợ', customerUser.id);
      assert.equal(customerNotifs.length, 1);
    } finally {
      config.nodeEnv = originalNodeEnv;
    }
  });

  test('replays a cross-day fallback-repair crash without duplicating the customer notification', async () => {
    const c = await mkCustomer();
    const customerUser = await mkUser('CUSTOMER', { customerId: c.id });
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 5_600_000, todayBusinessDate);

    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ id: `m57-fallback-${fetchCount}` }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const mutableDb = db as unknown as {
      transaction: typeof db.transaction;
      update: typeof db.update;
    };
    const originalTransaction = db.transaction.bind(db);
    const originalUpdate = db.update.bind(db);
    let failPortalInsertOnce = true;
    let failPortalMarkerClearOnce = true;
    mutableDb.transaction = (async (callback, configArg) => originalTransaction(async (tx) => {
      const proxiedTx = new Proxy(tx as object, {
        get(target, property, receiver) {
          if (property === 'insert') {
            return (table: unknown) => {
              if (table === s.notifications && failPortalInsertOnce) {
                failPortalInsertOnce = false;
                throw new Error('forced portal notification failure');
              }
              return Reflect.get(target, property, receiver).call(target, table);
            };
          }
          return Reflect.get(target, property, receiver);
        },
      }) as Parameters<typeof callback>[0];
      return callback(proxiedTx);
    }, configArg)) as typeof db.transaction;

    await saveEmailSettings({ resendApiKey: 're_fallback_repair' });
    try {
      await runReceivableReminders(runAtBusinessMorning);
    } finally {
      mutableDb.transaction = originalTransaction;
    }

    const [sentLog] = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(sentLog.status, 'SENT');
    assert.equal(sentLog.retryCount, 0);
    assert.match(sentLog.errorMessage ?? '', /\[REMINDER_PORTAL_FALLBACK_PENDING\]/);
    const customerNotifsBeforeRepair = await fetchTodayReminderNotifications(c.id, 'Nhắc thanh toán công nợ', customerUser.id);
    assert.equal(customerNotifsBeforeRepair.length, 0);

    mutableDb.update = ((table: Parameters<typeof db.update>[0]) => {
      const builder = originalUpdate(table);
      const originalSet = builder.set.bind(builder);
      builder.set = ((values: Record<string, unknown>) => {
        if (
          table === s.customerEmailLogs
          && failPortalMarkerClearOnce
          && values.errorMessage === null
        ) {
          failPortalMarkerClearOnce = false;
          throw new Error('forced portal marker clear failure');
        }
        return originalSet(values as never);
      }) as typeof builder.set;
      return builder;
    }) as typeof db.update;

    try {
      await runReceivableReminderRetries(atVnTime(addCalendarDays(todayBusinessDate, 1), 9));
    } finally {
      mutableDb.update = originalUpdate;
      globalThis.fetch = originalFetch;
      await saveEmailSettings({ clearResendApiKey: true });
    }

    const afterCrashNotifs = await fetchTodayReminderNotifications(c.id, 'Nhắc thanh toán công nợ', customerUser.id);
    assert.equal(afterCrashNotifs.length, 1, 'late repair inserts the notification before crashing');
    const [stillPendingLog] = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(stillPendingLog.status, 'SENT');
    assert.equal(stillPendingLog.retryCount, 0);
    assert.equal(stillPendingLog.providerMessageId, sentLog.providerMessageId);
    assert.match(stillPendingLog.errorMessage ?? '', /\[REMINDER_PORTAL_FALLBACK_PENDING\]/);

    const changedTrip = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, changedTrip.id, 1_400_000, todayBusinessDate);

    await runReceivableReminderRetries(atVnTime(addCalendarDays(todayBusinessDate, 2), 9));

    const [repairedLog] = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(repairedLog.status, 'SENT');
    assert.equal(repairedLog.retryCount, 0);
    assert.equal(repairedLog.providerMessageId, sentLog.providerMessageId, 'repair-only flow must not re-send email');
    assert.equal(repairedLog.errorMessage, null);
    const repairedNotifs = await fetchTodayReminderNotifications(c.id, 'Nhắc thanh toán công nợ', customerUser.id);
    assert.equal(
      repairedNotifs.length,
      1,
      'immutable email-log occurrence identity prevents a duplicate after obligation state changes',
    );
  });

  test('reclaims stale PENDING reminder logs into the retry flow', async () => {
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 4_800_000, todayBusinessDate);

    const staleTimestamp = new Date(Date.now() - 16 * 60 * 1000);
    const [log] = await db.insert(s.customerEmailLogs).values({
      customerId: c.id,
      subject: `${REMINDER_SUBJECT_PREFIX} Đến hạn ${c.name} — 4.800.000 ₫`,
      recipientEmail: `m57-${suffix}-stale@example.com`,
      status: 'PENDING',
      retryCount: 0,
      createdAt: staleTimestamp,
      updatedAt: staleTimestamp,
    }).returning();
    createdEmailLogIds.push(log.id);

    const retry = await runReceivableReminderRetries(new Date());
    assert.equal(retry.retried, 1);

    const [updated] = await db.select().from(s.customerEmailLogs)
      .where(eq(s.customerEmailLogs.id, log.id));
    assert.equal(updated.status, 'SENT');
  });

  test('limits retry scanning to 200 logs and batches business-calendar loading once per run', async () => {
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 4_900_000, todayBusinessDate);

    const readyAt = new Date(Date.now() - 16 * 60 * 1000);
    for (let index = 0; index < 205; index += 1) {
      const [log] = await db.insert(s.customerEmailLogs).values({
        customerId: c.id,
        subject: `${REMINDER_SUBJECT_PREFIX} Batch ${index}`,
        recipientEmail: `m57-${suffix}-batch-${index}@example.com`,
        status: 'FAILED',
        retryCount: 0,
        createdAt: atVnTime(todayBusinessDate, index % 2 === 0 ? 9 : 10),
        updatedAt: readyAt,
      }).returning();
      createdEmailLogIds.push(log.id);
    }

    // Test-only builder patch to count business-calendar queries during the retry run.
    const mutableDb = db as unknown as { select: typeof db.select };
    const originalSelect = db.select.bind(db);
    let calendarQueryCount = 0;
    mutableDb.select = ((...args: Parameters<typeof db.select>) => {
      const builder = originalSelect(...args);
      const originalFrom = builder.from.bind(builder);
      builder.from = ((table: unknown) => {
        if (table === s.businessCalendarDays) {
          calendarQueryCount += 1;
        }
        return originalFrom(table as never);
      }) as typeof builder.from;
      return builder;
    }) as typeof db.select;

    try {
      const retry = await runReceivableReminderRetries(new Date());
      assert.equal(retry.scanned, 200);
      assert.equal(retry.retried, 200);
      assert.equal(calendarQueryCount, 1);
    } finally {
      mutableDb.select = originalSelect;
    }

    const [pendingCount] = await db.select({ total: sql<string>`count(*)` })
      .from(s.customerEmailLogs)
      .where(and(
        eq(s.customerEmailLogs.customerId, c.id),
        eq(s.customerEmailLogs.status, 'FAILED'),
      ));
    assert.equal(Number(pendingCount.total), 5);
  });
});
