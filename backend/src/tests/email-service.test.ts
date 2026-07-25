/**
 * Wave 2 M3.3 — email service tests.
 *
 * Tests the sendEmail + retryEmail flow against the real DB (dev mode:
    no RESEND_API_KEY → console-log fallback). Verifies customer_email_logs
 * entries are created with the correct status.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { sendEmail, retryEmail, getMaxEmailRetries } from '../services/email.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdLogIds: number[] = [];
const createdCustomerIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `Email customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

after(async () => {
  try {
    if (createdLogIds.length > 0) {
      await db.delete(s.customerEmailLogs).where(inArray(s.customerEmailLogs.id, createdLogIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
  } catch (err) {
    console.warn('[email-service.test] cleanup partial:', (err as Error).message);
  }
});

describe('M3.3 — sendEmail (dev mode)', () => {
  test('creates a SENT log entry in dev mode (no RESEND_API_KEY)', async () => {
    const customer = await mkCustomer();
    const result = await sendEmail({
      customerId: customer.id,
      to: 'test@example.com',
      subject: 'Test email',
      html: '<p>Hello</p>',
      sentBy: 1,
    });
    createdLogIds.push(result.logId);

    assert.ok(result.ok, 'send succeeded');
    assert.ok(result.logId, 'log id returned');

    const [log] = await db.select().from(s.customerEmailLogs)
      .where(eq(s.customerEmailLogs.id, result.logId));
    assert.equal(log.status, 'SENT');
    assert.equal(log.subject, 'Test email');
    assert.equal(log.recipientEmail, 'test@example.com');
    assert.equal(log.customerId, customer.id);
    assert.equal(log.retryCount, 0);
  });

  test('stores optional shipmentId and billingDocumentId as null when not provided', async () => {
    const customer = await mkCustomer();
    const result = await sendEmail({
      customerId: customer.id,
      to: 'test2@example.com',
      subject: 'No links',
      html: '<p>Test</p>',
    });
    createdLogIds.push(result.logId);

    const [log] = await db.select().from(s.customerEmailLogs)
      .where(eq(s.customerEmailLogs.id, result.logId));
    assert.equal(log.shipmentId, null);
    assert.equal(log.billingDocumentId, null);
  });
});

describe('M3.3 — retryEmail', () => {
  test('retries a SENT email → returns ok:true (no-op)', async () => {
    const customer = await mkCustomer();
    const sendResult = await sendEmail({
      customerId: customer.id,
      to: 'retry-sent@example.com',
      subject: 'Already sent',
      html: '<p>Test</p>',
    });
    createdLogIds.push(sendResult.logId);

    const retryResult = await retryEmail(sendResult.logId);
    assert.ok(retryResult.ok);
  });

  test('max retries exceeded → returns ok:false', async () => {
    const customer = await mkCustomer();
    // Manually create a FAILED log with max retries already used.
    const [log] = await db.insert(s.customerEmailLogs).values({
      customerId: customer.id,
      subject: 'Max retries',
      recipientEmail: 'max@example.com',
      status: 'FAILED',
      retryCount: getMaxEmailRetries(),
      errorMessage: 'Previous failures',
    }).returning();
    createdLogIds.push(log.id);

    const result = await retryEmail(log.id);
    assert.ok(!result.ok);
    assert.match(result.error!, /Max retries/);
  });

  test('404 on missing log id', async () => {
    await assert.rejects(
      () => retryEmail(99_999_999),
      (err: unknown) => err instanceof Error && /not found/i.test(err.message),
    );
  });
});

describe('M3.3 — getMaxEmailRetries', () => {
  test('returns a positive integer', () => {
    const max = getMaxEmailRetries();
    assert.ok(max > 0, 'max retries is positive');
    assert.equal(typeof max, 'number');
  });
});
