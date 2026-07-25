// Email Service — Wave 2 M3.3.
//
// Sends transactional emails to customers (debit-note sent, delivery
// confirmation, milestone notifications). Uses Resend as the primary
// provider; when no API key is configured, falls back to console logging
// (dev mode) so the flow is testable without a real provider.
//
// Every email is logged in customer_email_logs with its status (PENDING →
// SENT / FAILED) and provider message ID. The Wave-0 scheduler's retry job
// (future wiring) will query FAILED entries with retryCount < MAX_RETRIES
// and re-attempt delivery.

import { db } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { eq } from 'drizzle-orm';

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
    if (!config.resendApiKey) {
      // Dev mode: console-log instead of calling the API.
      console.log(`[email:dev] To: ${input.to} | Subject: ${input.subject}`);
      await db.update(s.customerEmailLogs)
        .set({ status: 'SENT', updatedAt: new Date() })
        .where(eq(s.customerEmailLogs.id, log.id));
      return { ok: true, logId: log.id };
    }

    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.resendApiKey}`,
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
  if (!config.resendApiKey) {
    console.log(`[email:dev-retry] To: ${log.recipientEmail} | Subject: ${log.subject}`);
    await db.update(s.customerEmailLogs)
      .set({ status: 'SENT', updatedAt: new Date() })
      .where(eq(s.customerEmailLogs.id, logId));
    return { ok: true, logId };
  }

  // With a real provider, we'd reconstruct the body from a template.
  // This is a placeholder for the template lookup that future items will fill.
  return { ok: false, logId, error: 'Retry requires template body (not yet implemented)' };
}

/**
 * Get the MAX_RETRIES constant for scheduler registration.
 */
export function getMaxEmailRetries(): number {
  return MAX_RETRIES;
}
