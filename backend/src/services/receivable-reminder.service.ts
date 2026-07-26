/**
 * Wave 3 M5.7 — Receivable reminder scheduler job.
 *
 * Periodically reminds customers (via email) and the finance team (via
 * in-app notification) about overdue AR balances.
 *
 * Routing:
 *   - Wave-0 scheduler  → fires `runReceivableReminders` on a cron tick
 *   - Wave-2 email svc  → `sendEmail` records `customer_email_logs`
 *   - Wave-2 notif svc  → `emitNotification({type: OVERDUE_PAYMENT})`
 *     targets financial roles (in-app drawer + optional push)
 *
 * Hard rules (per M5.7 spec):
 *   - Skip "paid"      : no outstanding AR
 *   - Skip "disputed"  : proxy = customer has an open customer-level
 *                        credit (PAYMENT_RECEIVED with txnId=0, the M3.6
 *                        overpayment pattern). Real dispute flag tracked
 *                        as follow-up.
 *   - Skip "suspended" : customer.status === 'LOCKED'
 *   - No duplicate in cycle : per-(customer, calendar-day) dedupe via
 *                              customer_email_logs subject-prefix match.
 *
 * The job is fault-tolerant at the per-customer level: a send failure
 * for one customer is caught + logged and does NOT abort the whole run.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { NotificationType, FINANCIAL_ROLES } from '@tingting/shared';
import { sendEmail } from './email.service';
import { emitNotification } from './notification.service';
import { getCustomerArSummary } from './ar-status.service';
import logger from '../lib/logger';

/** Subject prefix used for dedupe — every reminder email starts with this. */
export const REMINDER_SUBJECT_PREFIX = '[Nhắc nhở công nợ]';

/** Daily reminder cron — 08:00 local time, every day. */
export const REMINDER_CRON = '0 8 * * *';

export interface ReminderRunStats {
  processed: number;   // every active customer considered
  reminded: number;    // email actually sent
  skipped: number;     // did not qualify (paid / suspended / disputed / not-overdue / no-email)
  deduped: number;     // already reminded today
  failed: number;      // send threw
}

/**
 * Determine whether a customer is currently "disputed" (proxy: holds an
 * unconsumed customer-level credit — i.e. a PAYMENT_RECEIVED with
 * txnId=0 posted in the last 60 days that hasn't been offset by a
 * later debit). This is the M3.6 overpayment pattern.
 *
 * Real dispute tracking will replace this heuristic when a dispute flag
 * is added to the customer schema.
 */
export async function isCustomerDisputed(customerId: number): Promise<boolean> {
  // Sum of customer-level PAYMENT_RECEIVED credits (txnId = 0).
  const [creditRow] = await db.select({
    credit: sql<string>`coalesce(sum(${s.ledger.credit}), 0)`,
  })
    .from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, customerId),
      eq(s.ledger.txnType, 'PAYMENT_RECEIVED'),
      sql`${s.ledger.txnId} = 0`,
      gte(s.ledger.timestamp, sql`now() - interval '60 days'`),
    ));
  return Number(creditRow?.credit ?? 0) > 0;
}

/**
 * Has this customer already been sent a reminder email today?
 * Dedupe key: subject LIKE 'prefix%' AND created_at::date = today.
 */
export async function alreadyRemindedToday(customerId: number): Promise<boolean> {
  const [row] = await db.select({
    n: sql<string>`count(*)`,
  })
    .from(s.customerEmailLogs)
    .where(and(
      eq(s.customerEmailLogs.customerId, customerId),
      sql`${s.customerEmailLogs.subject} LIKE ${REMINDER_SUBJECT_PREFIX + '%'}`,
      sql`${s.customerEmailLogs.createdAt}::date = current_date`,
    ));
  return Number(row?.n ?? 0) > 0;
}

/**
 * Compute the customer's overdue amount (sum of outstanding on trips
 * whose departureDate + paymentTermDays is in the past). Returns 0 if
 * nothing is overdue.
 *
 * Mirrors getTripArStatus's overdue logic but aggregated per customer.
 * `termDays` defaults to 30 if not provided (matching M5.1's default).
 */
async function getCustomerOverdueAmount(customerId: number, termDays: number = 30): Promise<number> {
  // Trips with their per-trip outstanding + due date.
  const trips = await db.select({
    id: s.trips.id,
    departureDate: s.trips.departureDate,
  })
    .from(s.trips)
    .where(and(
      eq(s.trips.customerId, customerId),
      isNull(s.trips.deletedAt),
    ));

  let overdueAmount = 0;
  for (const t of trips) {
    const [row] = await db.select({
      outstanding: sql<string>`
        coalesce(sum(case when ${s.ledger.txnType} = 'TRIP_REVENUE' then ${s.ledger.debit} else 0 end), 0)
        - coalesce(sum(case when ${s.ledger.txnType} = 'PAYMENT_RECEIVED' then ${s.ledger.credit} else 0 end), 0)
      `,
    })
      .from(s.ledger)
      .where(and(
        eq(s.ledger.entityType, 'CUSTOMER'),
        eq(s.ledger.entityId, customerId),
        eq(s.ledger.txnId, t.id),
      ));
    const outstanding = Math.max(0, Number(row?.outstanding ?? 0));
    if (outstanding <= 0) continue;

    // Due date = departureDate + termDays. Default 30 (M5.1 convention).
    if (!t.departureDate) continue;
    const dep = new Date(t.departureDate);
    const due = new Date(dep.getTime() + termDays * 24 * 60 * 60 * 1000);
    if (due.getTime() < Date.now()) {
      overdueAmount += outstanding;
    }
  }
  return overdueAmount;
}

/**
 * Run one reminder cycle. Iterates every ACTIVE customer, applies the
 * skip rules, and sends at most one email + one in-app notification
 * per customer per calendar day.
 */
export async function runReceivableReminders(): Promise<ReminderRunStats> {
  const stats: ReminderRunStats = { processed: 0, reminded: 0, skipped: 0, deduped: 0, failed: 0 };

  const customers = await db.select({
    id: s.customers.id,
    name: s.customers.name,
    status: s.customers.status,
    contactPerson: s.customers.contactPerson,
    phone: s.customers.phone,
    contactInfo: s.customers.contactInfo,
    paymentTermDays: s.customers.paymentTermDays,
  })
    .from(s.customers)
    .where(and(
      eq(s.customers.status, 'ACTIVE'),
      isNull(s.customers.deletedAt),
    ));

  for (const c of customers) {
    stats.processed += 1;
    try {
      // Per-customer payment term (NULL → 30-day default, matching M5.1).
      const termDays = c.paymentTermDays ?? 30;
      // 1. Skip if no outstanding AR (paid).
      const summary = await getCustomerArSummary(c.id);
      if (summary.outstanding <= 0) { stats.skipped += 1; continue; }

      // 2. Skip if nothing is overdue yet.
      const overdue = await getCustomerOverdueAmount(c.id, termDays);
      if (overdue <= 0) { stats.skipped += 1; continue; }

      // 3. Skip if "disputed" (proxy: open customer-level credit).
      if (await isCustomerDisputed(c.id)) { stats.skipped += 1; continue; }

      // 4. Skip if already reminded today (no duplicate in cycle).
      if (await alreadyRemindedToday(c.id)) { stats.deduped += 1; continue; }

      // 5. Resolve a recipient email. Fall through to skip (in-app only
      //    already emitted below) when none is available — we don't
      //    fabricate an address.
      const recipientEmail = extractEmail(c.contactInfo) ?? null;
      if (!recipientEmail) {
        // No email — still emit the in-app notification so finance can
        // follow up manually. Counted as skipped for email stats.
        emitOverdueInApp(c.id, c.name, overdue);
        stats.skipped += 1;
        continue;
      }

      // 6. Send the email.
      const subject = `${REMINDER_SUBJECT_PREFIX} ${c.name} — ${overdue.toLocaleString('vi-VN')} ₫ quá hạn`;
      const html = buildReminderHtml(c.name, overdue);
      const result = await sendEmail({
        customerId: c.id,
        to: recipientEmail,
        subject,
        html,
      });

      if (result.ok) {
        stats.reminded += 1;
        // In-app notification to financial roles so the ops team can
        // follow up — separate from the customer-facing email.
        emitOverdueInApp(c.id, c.name, overdue);
      } else {
        stats.failed += 1;
        logger.warn(
          { customerId: c.id, err: result.error },
          'receivable-reminder: email send failed',
        );
      }
    } catch (err) {
      stats.failed += 1;
      logger.warn(
        { customerId: c.id, err: (err as Error).message },
        'receivable-reminder: customer processing failed',
      );
    }
  }

  logger.info(stats, 'receivable-reminder: run complete');
  return stats;
}

/**
 * Emit the in-app OVERDUE_PAYMENT notification targeted at financial
 * roles. The customer doesn't see this — it's a heads-up to the ops
 * team so they can follow up.
 */
function emitOverdueInApp(customerId: number, customerName: string, overdueAmount: number): void {
  emitNotification({
    type: NotificationType.OVERDUE_PAYMENT,
    title: 'Công nợ quá hạn',
    message: `Khách hàng ${customerName} đang có ${overdueAmount.toLocaleString('vi-VN')} ₫ quá hạn`,
    relatedEntityType: 'customers',
    relatedEntityId: customerId,
    targetRoles: [...FINANCIAL_ROLES] as string[],
  });
}

/**
 * Pull the first email-looking token out of contactInfo (which is
 * free-text). Returns null when none is found.
 *
 * We don't parse the structured `phone` column as an email — that's a
 * phone number. Customers without an email address in contactInfo get
 * the in-app-only treatment.
 */
export function extractEmail(contactInfo: string | null): string | null {
  if (!contactInfo) return null;
  const match = contactInfo.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0] : null;
}

/** Plain-Vietnamese reminder body — amounts formatted per VND locale. */
function buildReminderHtml(customerName: string, overdueAmount: number): string {
  return `
    <p>Kính chào <strong>${escapeHtml(customerName)}</strong>,</p>
    <p>Theo hồ sơ của chúng tôi, quý khách đang có khoản công nợ
       <strong>${overdueAmount.toLocaleString('vi-VN')} ₫</strong>
       đã quá hạn thanh toán.</p>
    <p>Vui lòng thanh toán trong thời gian sớm nhất hoặc liên hệ với
       bộ phận kế toán của chúng tôi để được hỗ trợ.</p>
    <p>Trân trọng,<br/>Bộ phận kế toán</p>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
