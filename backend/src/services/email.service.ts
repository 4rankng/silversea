// Email Service — Wave 2 M3.3.
//
// Sends transactional emails to customers (debit-note sent, delivery
// confirmation, milestone notifications). Uses Resend as the primary
// provider. The API key is managed in ADMIN application settings and resolved
// at send time; development/test falls back to console logging when unset.
//
// Every email is logged in customer_email_logs with its status (PENDING →
// SENT / FAILED) and provider message ID. The Wave-0 scheduler's retry job
// (future wiring) will query FAILED entries with retryCount < MAX_RETRIES
// and re-attempt delivery.

import { db } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { and, eq, sql } from 'drizzle-orm';
import { getEmailSettings } from './email-settings.service';

const RESEND_API_URL = 'https://api.resend.com/emails';
const MAX_RETRIES = 3;
const DEFAULT_EMAIL_PROVIDER_TIMEOUT_MS = 15_000;
type EmailLogStatus = (typeof s.customerEmailLogs.status.enumValues)[number];
const DEFAULT_EMAIL_LOG_STATUS: EmailLogStatus = 'PENDING';

export interface SendEmailInput {
  customerId: number;
  shipmentId?: number | null;
  billingDocumentId?: number | null;
  to: string;
  subject: string;
  html: string;
  sentBy?: number | null;
}

export interface SendEmailResult {
  ok: boolean;
  logId: number;
  providerMessageId?: string;
  error?: string;
}

export interface RetryEmailOptions {
  to?: string | null;
  subject?: string;
  html?: string;
  leaseToken?: string;
  alreadyClaimed?: boolean;
}

export interface CreateEmailLogInput {
  customerId: number;
  shipmentId?: number | null;
  billingDocumentId?: number | null;
  subject: string;
  recipientEmail?: string | null;
  status?: (typeof s.customerEmailLogs.status.enumValues)[number];
  errorMessage?: string | null;
  retryCount?: number;
  sentBy?: number | null;
}

export interface DeliverEmailLogInput {
  to: string;
  subject: string;
  html: string;
  leaseToken?: string;
}

function normalizeEmailLogStatus(input: unknown): EmailLogStatus | null {
  if (typeof input !== 'string') return null;
  switch (input.trim().toUpperCase()) {
    case 'PENDING':
      return 'PENDING';
    case 'SENT':
      return 'SENT';
    case 'FAILED':
      return 'FAILED';
    case 'OPENED':
      return 'OPENED';
    default:
      return null;
  }
}

export function getEmailProviderTimeoutMs(): number {
  const raw = Number(process.env.EMAIL_PROVIDER_TIMEOUT_MS ?? '');
  return Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_EMAIL_PROVIDER_TIMEOUT_MS;
}

/**
 * Send an email via Resend (or console-log in dev mode). Always creates a
 * customer_email_logs entry recording the attempt.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const logId = await createEmailLog({
    customerId: input.customerId,
    shipmentId: input.shipmentId ?? null,
    billingDocumentId: input.billingDocumentId ?? null,
    subject: input.subject,
    recipientEmail: input.to,
    status: 'PENDING',
    retryCount: 0,
    sentBy: input.sentBy ?? null,
  });

  // 2. Attempt to send.
  return deliverEmailLog(logId, {
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
}

export async function createEmailLog(input: CreateEmailLogInput): Promise<number> {
  const status = normalizeEmailLogStatus(input.status) ?? DEFAULT_EMAIL_LOG_STATUS;
  const [log] = await db.insert(s.customerEmailLogs).values({
    customerId: input.customerId,
    shipmentId: input.shipmentId ?? null,
    billingDocumentId: input.billingDocumentId ?? null,
    subject: input.subject,
    recipientEmail: input.recipientEmail ?? null,
    status,
    errorMessage: input.errorMessage ?? null,
    retryCount: input.retryCount ?? 0,
    sentBy: input.sentBy ?? null,
  }).returning();
  return log.id;
}

export async function deliverEmailLog(
  logId: number,
  input: DeliverEmailLogInput,
): Promise<SendEmailResult> {
  return deliverLoggedEmail(logId, input.to, input.subject, input.html, false, input.leaseToken);
}

/**
 * Retry a FAILED email. Called by the scheduler's retry job. Increments
 * retryCount; gives up when retryCount >= MAX_RETRIES (the log stays FAILED
 * for manual inspection).
 */
export async function retryEmail(
  logId: number,
  options: RetryEmailOptions = {},
): Promise<SendEmailResult> {
  const claim = options.alreadyClaimed
    ? await loadExistingRetryClaim(logId, options.leaseToken)
    : await claimRetryEmailAttempt(logId);
  if (!claim) {
    const [current] = await db.select({
      status: s.customerEmailLogs.status,
      retryCount: s.customerEmailLogs.retryCount,
    })
      .from(s.customerEmailLogs)
      .where(eq(s.customerEmailLogs.id, logId))
      .limit(1);
    if (current?.status === 'FAILED' && current.retryCount >= MAX_RETRIES) {
      return { ok: false, logId, error: 'Max retries exceeded' };
    }
    return { ok: false, logId, error: 'Retry claim expired' };
  }
  if (claim.status === 'SENT') return { ok: true, logId };
  if (claim.retryCount > MAX_RETRIES) {
    return { ok: false, logId, error: 'Max retries exceeded' };
  }

  const subject = options.subject ?? claim.subject;
  const recipientEmail = options.to ?? claim.recipientEmail ?? null;
  const html = options.html;

  await db.update(s.customerEmailLogs)
    .set({
      subject,
      recipientEmail,
      updatedAt: new Date(),
    })
    .where(and(
      eq(s.customerEmailLogs.id, logId),
      eq(s.customerEmailLogs.status, 'PENDING'),
      eq(s.customerEmailLogs.providerMessageId, claim.leaseToken),
    ));

  if (!recipientEmail) {
    const error = 'Retry requires a recipient email';
    await markLoggedEmailFailed(logId, error, claim.leaseToken);
    return { ok: false, logId, error };
  }

  if (!html) {
    const error = 'Retry requires the original email body';
    await markLoggedEmailFailed(logId, error, claim.leaseToken);
    return { ok: false, logId, error };
  }

  return deliverLoggedEmail(logId, recipientEmail, subject, html, true, claim.leaseToken);
}

/**
 * Get the MAX_RETRIES constant for scheduler registration.
 */
export function getMaxEmailRetries(): number {
  return MAX_RETRIES;
}

async function deliverLoggedEmail(
  logId: number,
  to: string,
  subject: string,
  html: string,
  isRetry = false,
  leaseToken?: string,
): Promise<SendEmailResult> {
  try {
    let resendApiKey: string;
    try {
      ({ resendApiKey } = await getEmailSettings());
    } catch {
      throw new Error('Không thể đọc cấu hình gửi email');
    }
    if (!resendApiKey) {
      if (config.nodeEnv === 'production') {
        throw new Error('Resend API key chưa được cấu hình');
      }

      console.log(`[email:${isRetry ? 'dev-retry' : 'dev'}] To: ${to} | Subject: ${subject}`);
      const updated = await markLoggedEmailSent(logId, null, leaseToken);
      if (!updated) return { ok: false, logId, error: 'Retry claim expired' };
      return { ok: true, logId };
    }

    const response = await fetchResendWithTimeout(resendApiKey, { to, subject, html });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Resend API ${response.status}: ${errorText}`);
    }

    const data = await response.json() as { id?: string };
    const providerMessageId = data.id ?? null;

    const updated = await markLoggedEmailSent(logId, providerMessageId, leaseToken);
    if (!updated) return { ok: false, logId, error: 'Retry claim expired' };

    return { ok: true, logId, providerMessageId: providerMessageId ?? undefined };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    await markLoggedEmailFailed(logId, errorMessage, leaseToken);
    return { ok: false, logId, error: errorMessage };
  }
}

async function markLoggedEmailFailed(
  logId: number,
  errorMessage: string,
  leaseToken?: string,
): Promise<void> {
  const conditions = [eq(s.customerEmailLogs.id, logId)];
  if (leaseToken) {
    conditions.push(eq(s.customerEmailLogs.status, 'PENDING'));
    conditions.push(eq(s.customerEmailLogs.providerMessageId, leaseToken));
  }
  await db.update(s.customerEmailLogs)
    .set({ status: 'FAILED', errorMessage, providerMessageId: null, updatedAt: new Date() })
    .where(and(...conditions));
}

async function markLoggedEmailSent(
  logId: number,
  providerMessageId: string | null,
  leaseToken?: string,
): Promise<boolean> {
  const conditions = [eq(s.customerEmailLogs.id, logId)];
  if (leaseToken) {
    conditions.push(eq(s.customerEmailLogs.status, 'PENDING'));
    conditions.push(eq(s.customerEmailLogs.providerMessageId, leaseToken));
  }
  const updated = await db.update(s.customerEmailLogs)
    .set({ status: 'SENT', providerMessageId, updatedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: s.customerEmailLogs.id });
  return updated.length > 0;
}

async function claimRetryEmailAttempt(logId: number): Promise<{
  subject: string;
  recipientEmail: string | null;
  retryCount: number;
  leaseToken: string;
  status: 'PENDING';
} | {
  status: 'SENT';
} | null> {
  return db.transaction(async (tx) => {
    const lockKey = `customer-email-log:retry:${logId}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const [log] = await tx.select().from(s.customerEmailLogs)
      .where(eq(s.customerEmailLogs.id, logId))
      .limit(1);
    if (!log) throw new Error('Email log not found');
    if (log.status === 'SENT') return { status: 'SENT' as const };
    if (log.status !== 'FAILED') return null;
    if (log.retryCount >= MAX_RETRIES) {
      return null;
    }

    const leaseToken = `retry:${logId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const [claimed] = await tx.update(s.customerEmailLogs)
      .set({
        retryCount: log.retryCount + 1,
        status: 'PENDING',
        providerMessageId: leaseToken,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(s.customerEmailLogs.id, logId),
        eq(s.customerEmailLogs.status, 'FAILED'),
        eq(s.customerEmailLogs.retryCount, log.retryCount),
      ))
      .returning({
        subject: s.customerEmailLogs.subject,
        recipientEmail: s.customerEmailLogs.recipientEmail,
        retryCount: s.customerEmailLogs.retryCount,
      });
    if (!claimed) return null;
    return {
      subject: claimed.subject,
      recipientEmail: claimed.recipientEmail,
      retryCount: claimed.retryCount,
      leaseToken,
      status: 'PENDING' as const,
    };
  });
}

async function loadExistingRetryClaim(
  logId: number,
  leaseToken?: string,
): Promise<{
  subject: string;
  recipientEmail: string | null;
  retryCount: number;
  leaseToken: string;
  status: 'PENDING';
} | null> {
  if (!leaseToken) return null;
  const [log] = await db.select().from(s.customerEmailLogs)
    .where(and(
      eq(s.customerEmailLogs.id, logId),
      eq(s.customerEmailLogs.status, 'PENDING'),
      eq(s.customerEmailLogs.providerMessageId, leaseToken),
    ))
    .limit(1);
  if (!log) return null;
  return {
    subject: log.subject,
    recipientEmail: log.recipientEmail ?? null,
    retryCount: log.retryCount,
    leaseToken,
    status: 'PENDING',
  };
}

async function fetchResendWithTimeout(
  resendApiKey: string,
  input: DeliverEmailLogInput,
): Promise<Response> {
  const timeoutMs = getEmailProviderTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        from: `${config.emailFromName} <${config.emailFromAddress}>`,
        to: input.to,
        subject: input.subject,
        html: input.html,
      }),
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Resend API timeout sau ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
