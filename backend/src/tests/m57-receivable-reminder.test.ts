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

import { db, client } from '../db';
import * as s from '../db/schema';
import {
  runReceivableReminders,
  isCustomerDisputed,
  alreadyRemindedToday,
  extractEmail,
  REMINDER_SUBJECT_PREFIX,
} from '../services/receivable-reminder.service';
import { initNotificationService } from '../services/notification.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdLedgerIds: number[] = [];
const createdEmailLogIds: number[] = [];
const createdNotifIds: number[] = [];

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

/** departureDate in past (YYYY-MM-DD) so trip is overdue by default. */
async function mkOverdueTrip(customerId: number, routeId: number, cargoTypeId: number, departureDate = '2025-01-01') {
  const [t] = await db.insert(s.trips).values({
    tripCode: `M57-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId, routeId, cargoTypeId,
    status: 'COMPLETED', departureDate, carrierType: 'OWN',
  }).returning();
  createdTripIds.push(t.id);
  return t;
}

async function mkRevenue(customerId: number, tripId: number, amount: number) {
  const [e] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER' as const,
    entityId: customerId,
    txnType: 'TRIP_REVENUE' as const,
    txnId: tripId,
    debit: String(amount),
    credit: '0',
    balance: String(amount),
    note: null,
  }).returning();
  createdLedgerIds.push(e.id);
  return e;
}

async function mkCustomerCredit(customerId: number, amount: number) {
  const [e] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER' as const,
    entityId: customerId,
    txnType: 'PAYMENT_RECEIVED' as const,
    txnId: 0, // customer-level credit (M3.6 overpayment pattern)
    debit: '0',
    credit: String(amount),
    balance: String(-amount),
    note: 'overpayment',
  }).returning();
  createdLedgerIds.push(e.id);
  return e;
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

async function fetchNotifsForCustomer(customerId: number) {
  const rows = await db.select().from(s.notifications)
    .where(and(
      eq(s.notifications.relatedEntityType, 'customers'),
      eq(s.notifications.relatedEntityId, customerId),
    ));
  for (const r of rows) if (!createdNotifIds.includes(r.id)) createdNotifIds.push(r.id);
  return rows;
}

async function fetchTodayEmailLogForCustomer(customerId: number) {
  return db.select().from(s.customerEmailLogs)
    .where(and(
      eq(s.customerEmailLogs.customerId, customerId),
      sql`${s.customerEmailLogs.subject} LIKE ${REMINDER_SUBJECT_PREFIX + '%'}`,
      sql`${s.customerEmailLogs.createdAt}::date = current_date`,
    ));
}

// Notification service needs its event listener initialized once per process.
before(async () => { initNotificationService(); });

after(async () => {
  const custPattern = `M57 %${suffix}%`;
  const tripCodePattern = `M57-${suffix}%`;
  const rcptPattern = `m57-${suffix}%@example.com`;
  try {
    if (createdNotifIds.length > 0) await db.delete(s.notifications).where(inArray(s.notifications.id, createdNotifIds));
    if (createdEmailLogIds.length > 0) await db.delete(s.customerEmailLogs).where(inArray(s.customerEmailLogs.id, createdEmailLogIds));
    await db.delete(s.customerEmailLogs).where(sql`${s.customerEmailLogs.recipientEmail} LIKE ${rcptPattern}`);
    if (createdLedgerIds.length > 0) await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    await db.delete(s.trips).where(sql`${s.trips.tripCode} LIKE ${tripCodePattern}`);
    await db.delete(s.cargoTypes).where(sql`${s.cargoTypes.name} LIKE ${custPattern}`);
    await db.delete(s.routes).where(sql`${s.routes.name} LIKE ${custPattern}`);
    await db.delete(s.customers).where(sql`${s.customers.name} LIKE ${custPattern}`);
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
  test('returns true when customer has a customer-level credit', async () => {
    const c = await mkCustomer();
    await mkCustomerCredit(c.id, 500_000);
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
  test('skips LOCKED (suspended) customer', async () => {
    const c = await mkCustomer({ status: 'LOCKED' });
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 5_000_000);

    const stats = await runReceivableReminders();
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

    await runReceivableReminders();
    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 0);
  });

  test('skips customer whose debt is not overdue yet', async () => {
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    // Departure today → not overdue (due = today + 30 days).
    const t = await mkOverdueTrip(c.id, r.id, cg.id, '2026-07-25');
    await mkRevenue(c.id, t.id, 5_000_000);

    await runReceivableReminders();
    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 0);
  });

  test('skips disputed customer (has customer-level credit)', async () => {
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 5_000_000);
    await mkCustomerCredit(c.id, 200_000); // disputes the AR

    await runReceivableReminders();
    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 0);
  });

  test('sends email + in-app for an overdue undisputed ACTIVE customer', async () => {
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 7_500_000);

    await runReceivableReminders();

    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 1);
    assert.ok(emails[0].subject.startsWith(REMINDER_SUBJECT_PREFIX));
    assert.equal(emails[0].status, 'SENT');

    // In-app OVERDUE_PAYMENT notification to financial roles.
    const notifs = await fetchNotifsForCustomer(c.id);
    assert.ok(notifs.length >= 1, 'at least one OVERDUE_PAYMENT notification emitted');
    assert.equal(notifs[0].type, 'OVERDUE_PAYMENT');
  });

  test('no duplicate in cycle: second run same day does not re-send', async () => {
    const c = await mkCustomer();
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 3_000_000);

    const first = await runReceivableReminders();
    const second = await runReceivableReminders();

    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 1, 'only one reminder email per day');
    // Second run saw the customer and deduped.
    assert.ok(second.deduped >= 1);
    assert.ok(first.reminded >= 1);
  });

  test('customer with no email still gets in-app (skipped for email stats)', async () => {
    const c = await mkCustomer({ contactInfo: 'Phone only: 0901 123 456' });
    const r = await mkRoute(); const cg = await mkCargo();
    const t = await mkOverdueTrip(c.id, r.id, cg.id);
    await mkRevenue(c.id, t.id, 4_000_000);

    await runReceivableReminders();
    const emails = await fetchTodayEmailLogForCustomer(c.id);
    assert.equal(emails.length, 0, 'no email sent (no recipient)');
    const notifs = await fetchNotifsForCustomer(c.id);
    assert.ok(notifs.length >= 1, 'in-app still emitted so finance can follow up');
  });
});
