/**
 * Wave 2 M3.3 — email service tests.
 *
 * Tests the sendEmail + retryEmail flow against the real DB (dev mode:
 * no DB-backed Resend key → console-log fallback). Verifies customer_email_logs
 * entries are created with the correct status.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { sendEmail, retryEmail, getMaxEmailRetries } from '../services/email.service';
import {
  EMAIL_SETTING_KEYS,
  invalidateEmailSettings,
  saveEmailSettings,
} from '../services/email-settings.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdLogIds: number[] = [];
const createdCustomerIds: number[] = [];
let originalResendKeyValue: string | undefined;

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `Email customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

before(async () => {
  const [row] = await db
    .select({ value: s.appSettings.value })
    .from(s.appSettings)
    .where(eq(s.appSettings.key, EMAIL_SETTING_KEYS.resendApiKey))
    .limit(1);
  originalResendKeyValue = row?.value;
  await saveEmailSettings({ clearResendApiKey: true });
});

after(async () => {
  try {
    if (createdLogIds.length > 0) {
      await db.delete(s.customerEmailLogs).where(inArray(s.customerEmailLogs.id, createdLogIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
    await db.delete(s.appSettings).where(eq(s.appSettings.key, EMAIL_SETTING_KEYS.resendApiKey));
    if (originalResendKeyValue !== undefined) {
      await db.insert(s.appSettings).values({
        key: EMAIL_SETTING_KEYS.resendApiKey,
        value: originalResendKeyValue,
      });
    }
    invalidateEmailSettings();
  } catch (err) {
    console.warn('[email-service.test] cleanup partial:', (err as Error).message);
  } finally {
    // Close the postgres pool so the Node test process exits cleanly.
    // The driver keeps idle connections open, which otherwise hangs the
    // runner between files under `tsx --test`. Mirrors the pattern in
    // carrier-payment-ledger.test.ts and other DB-integration suites.
    await client.end({ timeout: 1 });
  }
});

describe('M3.3 — sendEmail (dev mode)', () => {
  test('creates a SENT log entry in dev mode when no Resend key is configured', async () => {
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

  test('uses a newly saved DB key on the next send without restart', async () => {
    const customer = await mkCustomer();
    const originalFetch = globalThis.fetch;
    let authorization = '';
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return new Response(JSON.stringify({ id: 'resend-test-message' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      await saveEmailSettings({ resendApiKey: 're_runtime_test' });
      const result = await sendEmail({
        customerId: customer.id,
        to: 'runtime@example.com',
        subject: 'Runtime key',
        html: '<p>Runtime</p>',
      });
      createdLogIds.push(result.logId);

      assert.equal(result.ok, true);
      assert.equal(result.providerMessageId, 'resend-test-message');
      assert.equal(authorization, 'Bearer re_runtime_test');
    } finally {
      globalThis.fetch = originalFetch;
      await saveEmailSettings({ clearResendApiKey: true });
    }
  });

  test('records an honest failure in production when the DB key is missing', async () => {
    const customer = await mkCustomer();
    const originalNodeEnv = config.nodeEnv;
    config.nodeEnv = 'production';
    try {
      const result = await sendEmail({
        customerId: customer.id,
        to: 'missing-key@example.com',
        subject: 'Missing key',
        html: '<p>Missing</p>',
      });
      createdLogIds.push(result.logId);

      assert.equal(result.ok, false);
      assert.match(result.error ?? '', /chưa được cấu hình/);
      const [log] = await db.select().from(s.customerEmailLogs)
        .where(eq(s.customerEmailLogs.id, result.logId));
      assert.equal(log.status, 'FAILED');
      assert.match(log.errorMessage ?? '', /chưa được cấu hình/);
    } finally {
      config.nodeEnv = originalNodeEnv;
    }
  });

  test('marks the log FAILED when the provider call times out', async () => {
    const customer = await mkCustomer();
    const originalFetch = globalThis.fetch;
    const originalTimeout = process.env.EMAIL_PROVIDER_TIMEOUT_MS;
    process.env.EMAIL_PROVIDER_TIMEOUT_MS = '5';
    globalThis.fetch = (((_url: string | URL | Request, init?: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (!signal) return;
      if (signal.aborted) {
        rejectAbort();
        return;
      }
      signal.addEventListener('abort', rejectAbort, { once: true });
    })) as unknown) as typeof fetch;

    try {
      await saveEmailSettings({ resendApiKey: 're_timeout_test' });
      const result = await sendEmail({
        customerId: customer.id,
        to: 'timeout@example.com',
        subject: 'Timeout test',
        html: '<p>Timeout</p>',
      });
      createdLogIds.push(result.logId);

      assert.equal(result.ok, false);
      assert.match(result.error ?? '', /timeout/i);
      const [log] = await db.select().from(s.customerEmailLogs)
        .where(eq(s.customerEmailLogs.id, result.logId));
      assert.equal(log.status, 'FAILED');
      assert.match(log.errorMessage ?? '', /timeout/i);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalTimeout === undefined) {
        delete process.env.EMAIL_PROVIDER_TIMEOUT_MS;
      } else {
        process.env.EMAIL_PROVIDER_TIMEOUT_MS = originalTimeout;
      }
      await saveEmailSettings({ clearResendApiKey: true });
    }
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

  test('configured-provider retry returns the log to FAILED when body reconstruction is unavailable', async () => {
    const customer = await mkCustomer();
    const [log] = await db.insert(s.customerEmailLogs).values({
      customerId: customer.id,
      subject: 'Provider retry',
      recipientEmail: 'provider-retry@example.com',
      status: 'FAILED',
      retryCount: 0,
      errorMessage: 'Initial failure',
    }).returning();
    createdLogIds.push(log.id);

    await saveEmailSettings({ resendApiKey: 're_retry_test' });
    try {
      const result = await retryEmail(log.id);
      assert.equal(result.ok, false);
      assert.match(result.error ?? '', /original email body/);

      const [updated] = await db.select().from(s.customerEmailLogs)
        .where(eq(s.customerEmailLogs.id, log.id));
      assert.equal(updated.status, 'FAILED');
      assert.equal(updated.retryCount, 1);
      assert.match(updated.errorMessage ?? '', /original email body/);
    } finally {
      await saveEmailSettings({ clearResendApiKey: true });
    }
  });

  test('settings read failure returns the retry log to FAILED', async () => {
    const customer = await mkCustomer();
    const [log] = await db.insert(s.customerEmailLogs).values({
      customerId: customer.id,
      subject: 'Corrupt settings retry',
      recipientEmail: 'corrupt-settings@example.com',
      status: 'FAILED',
      retryCount: 0,
      errorMessage: 'Initial failure',
    }).returning();
    createdLogIds.push(log.id);

    await db.insert(s.appSettings).values({
      key: EMAIL_SETTING_KEYS.resendApiKey,
      value: 'enc:v1:corrupt',
    });
    invalidateEmailSettings();

    try {
      const result = await retryEmail(log.id, {
        html: '<p>Nội dung thư gốc để kiểm tra lỗi cấu hình</p>',
      });
      assert.equal(result.ok, false);
      assert.match(result.error ?? '', /Không thể đọc cấu hình gửi email/);

      const [updated] = await db.select().from(s.customerEmailLogs)
        .where(eq(s.customerEmailLogs.id, log.id));
      assert.equal(updated.status, 'FAILED');
      assert.equal(updated.retryCount, 1);
      assert.match(updated.errorMessage ?? '', /Không thể đọc cấu hình gửi email/);
    } finally {
      await saveEmailSettings({ clearResendApiKey: true });
    }
  });

  test('allows only one concurrent retry caller to reach the provider', async () => {
    const customer = await mkCustomer();
    const [log] = await db.insert(s.customerEmailLogs).values({
      customerId: customer.id,
      subject: 'Concurrent retry',
      recipientEmail: 'concurrent-retry@example.com',
      status: 'FAILED',
      retryCount: 0,
      errorMessage: 'Initial failure',
    }).returning();
    createdLogIds.push(log.id);

    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return new Response(JSON.stringify({ id: `resend-race-${fetchCount}` }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await saveEmailSettings({ resendApiKey: 're_retry_race' });
    try {
      const [first, second] = await Promise.all([
        retryEmail(log.id, { html: '<p>Concurrent body</p>' }),
        retryEmail(log.id, { html: '<p>Concurrent body</p>' }),
      ]);

      assert.equal(fetchCount, 1, 'only one provider request should be issued');
      assert.equal(first.ok || second.ok, true, 'one caller should complete the retry');
      assert.equal(first.ok && second.ok, false, 'the second caller must not deliver again');
      assert.match(
        [first.error, second.error].filter((value): value is string => Boolean(value)).join(' '),
        /Retry claim expired/,
      );

      const [updated] = await db.select().from(s.customerEmailLogs)
        .where(eq(s.customerEmailLogs.id, log.id));
      assert.equal(updated.status, 'SENT');
      assert.equal(updated.retryCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
      await saveEmailSettings({ clearResendApiKey: true });
    }
  });
});

describe('M3.3 — getMaxEmailRetries', () => {
  test('returns a positive integer', () => {
    const max = getMaxEmailRetries();
    assert.ok(max > 0, 'max retries is positive');
    assert.equal(typeof max, 'number');
  });
});
