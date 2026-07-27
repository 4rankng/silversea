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
import { eq } from 'drizzle-orm';
import { getEmailSettings } from './email-settings.service';

const RESEND_API_URL = 'https://api.resend.com/emails';
const MAX_RETRIES = 3;

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

/**
 * Send an email via Resend (or console-log in dev mode). Always creates a
 * customer_email_logs entry recording the attempt.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // 1. Create the log entry with PENDING status.
  const [log] = await db.insert(s.customerEmailLogs).values({
    customerId: input.customerId,
    shipmentId: input.shipmentId ?? null,
    billingDocumentId: input.billingDocumentId ?? null,
    subject: input.subject,
    recipientEmail: input.to,
    status: 'PENDING',
    retryCount: 0,
    sentBy: input.sentBy ?? null,
  }).returning();

  // 2. Attempt to send.
  try {
    const { resendApiKey } = await getEmailSettings();
    if (!resendApiKey) {
      if (config.nodeEnv === 'production') {
        throw new Error('Resend API key chưa được cấu hình');
      }

      console.log(`[email:dev] To: ${input.to} | Subject: ${input.subject}`);
      await db.update(s.customerEmailLogs)
        .set({ status: 'SENT', updatedAt: new Date() })
        .where(eq(s.customerEmailLogs.id, log.id));
      return { ok: true, logId: log.id };
    }

    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${config.emailFromName} <${config.emailFromAddress}>`,
        to: input.to,
        subject: input.subject,
        html: input.html,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Resend API ${response.status}: ${errorText}`);
    }

    const data = await response.json() as { id?: string };
    const providerMessageId = data.id ?? null;

    await db.update(s.customerEmailLogs)
      .set({ status: 'SENT', providerMessageId, updatedAt: new Date() })
      .where(eq(s.customerEmailLogs.id, log.id));

    return { ok: true, logId: log.id, providerMessageId: providerMessageId ?? undefined };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    await db.update(s.customerEmailLogs)
      .set({ status: 'FAILED', errorMessage, updatedAt: new Date() })
      .where(eq(s.customerEmailLogs.id, log.id));
    return { ok: false, logId: log.id, error: errorMessage };
  }
}

/**
 * Retry a FAILED email. Called by the scheduler's retry job. Increments
 * retryCount; gives up when retryCount >= MAX_RETRIES (the log stays FAILED
 * for manual inspection).
 */
export async function retryEmail(logId: number): Promise<SendEmailResult> {
  const [log] = await db.select().from(s.customerEmailLogs)
    .where(eq(s.customerEmailLogs.id, logId))
    .limit(1);
  if (!log) throw new Error('Email log not found');
  if (log.status === 'SENT') return { ok: true, logId };
  if (log.retryCount >= MAX_RETRIES) {
    return { ok: false, logId, error: 'Max retries exceeded' };
  }

  // Increment retry count.
  await db.update(s.customerEmailLogs)
    .set({ retryCount: log.retryCount + 1, status: 'PENDING', errorMessage: null, updatedAt: new Date() })
    .where(eq(s.customerEmailLogs.id, logId));

  // Re-send. We don't have the HTML body stored (only the subject), so
  // this retry path is best-effort — the caller should provide the body
  // via a template lookup. For now, send a generic notification.
  let resendApiKey: string;
  try {
    ({ resendApiKey } = await getEmailSettings());
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown settings error';
    const error = `Không thể đọc cấu hình gửi email: ${detail}`;
    await db.update(s.customerEmailLogs)
      .set({ status: 'FAILED', errorMessage: error, updatedAt: new Date() })
      .where(eq(s.customerEmailLogs.id, logId));
    return { ok: false, logId, error };
  }
  if (!resendApiKey && config.nodeEnv !== 'production') {
    console.log(`[email:dev-retry] To: ${log.recipientEmail} | Subject: ${log.subject}`);
    await db.update(s.customerEmailLogs)
      .set({ status: 'SENT', updatedAt: new Date() })
      .where(eq(s.customerEmailLogs.id, logId));
    return { ok: true, logId };
  }

  if (!resendApiKey) {
    const error = 'Resend API key chưa được cấu hình';
    await db.update(s.customerEmailLogs)
      .set({ status: 'FAILED', errorMessage: error, updatedAt: new Date() })
      .where(eq(s.customerEmailLogs.id, logId));
    return { ok: false, logId, error };
  }

  // The original body is not stored on the log, so a provider retry cannot be
  // reconstructed yet. Keep the row honestly FAILED rather than leaving the
  // attempt stuck in PENDING after incrementing retryCount.
  const error = 'Retry requires the original email body';
  await db.update(s.customerEmailLogs)
    .set({ status: 'FAILED', errorMessage: error, updatedAt: new Date() })
    .where(eq(s.customerEmailLogs.id, logId));
  return { ok: false, logId, error };
}

/**
 * Get the MAX_RETRIES constant for scheduler registration.
 */
export function getMaxEmailRetries(): number {
  return MAX_RETRIES;
}
