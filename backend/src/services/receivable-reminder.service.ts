/**
 * Wave 3 M5.7 — Receivable reminder scheduler job.
 *
 * Periodically reminds customers (via email) and records distinct in-app
 * evidence for internal follow-up. Delivery uses the persisted
 * customer_email_logs retry model; failed sends are retried at 15m / 2h / 24h
 * and terminal failures alert the existing customer-service-adjacent role set.
 *
 * Routing:
 *   - Wave-0 scheduler  → fires `runReceivableReminders` on a cron tick
 *   - Wave-2 email svc  → `sendEmail`/`retryEmail` persist `customer_email_logs`
 *   - Wave-2 notif svc  → internal evidence + terminal escalation
 *
 * Accepted rules (Q04/Q05):
 *   - Schedule: T-3, due date, T+3 (based on persisted processingDueDate)
 *   - Window  : only create new reminders during 08:00-17:30 on working days
 *   - Roll    : if a reminder day lands on weekend/holiday, send at 09:00 on
 *               the next configured working day
 *   - Cap     : one customer summary per business date
 *   - Stop    : suppress paid / disputed / suspended customers
 *   - Retry   : failed email retries after 15m, 2h, 24h; then alert CLERK +
 *               finance for manual handling
 */
import { db } from '../db';
import * as s from '../db/schema';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { NotificationType, FINANCIAL_ROLES, Role } from '@tingting/shared';
import {
  deliverEmailLog,
  getEmailProviderTimeoutMs,
  getMaxEmailRetries,
  retryEmail,
} from './email.service';
import { emitNotificationAndWait } from './notification.service';
import logger from '../lib/logger';
import {
  addCalendarDays,
  resolveBusinessDate,
  type BusinessCalendarOverride,
  type PaymentDatePolicy,
} from './business-calendar.service';
import { getCustomerReceivableSnapshots } from './customer-receivable-authority.service';

/** Subject prefix used for dedupe — every reminder email starts with this. */
export const REMINDER_SUBJECT_PREFIX = '[Nhắc nhở công nợ]';

/** Reminder polling cron — every 15 minutes; business-hour gating happens in code. */
export const REMINDER_CRON = '*/15 * * * *';
export const REMINDER_RETRY_CRON = '*/15 * * * *';

const REMINDER_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const REMINDER_WINDOW_START_HOUR = 8;
const REMINDER_ROLLED_WINDOW_START_HOUR = 9;
const REMINDER_WINDOW_END_HOUR = 17;
const REMINDER_WINDOW_END_MINUTE = 30;
const REMINDER_CALENDAR_LOOKBACK_DAYS = 32;
const REMINDER_RETRY_BATCH_LIMIT = 200;
const REMINDER_RETRY_STALE_GRACE_MS = 5_000;
// The product language calls this team "CUS". This repository models that
// operational customer-service/documentation team as CLERK, so terminal
// delivery failures must reach CLERK as well as the finance fallback owners.
const REMINDER_TERMINAL_ESCALATION_ROLES = [Role.CUS, Role.ADMIN, Role.ACCOUNTANT] as const;
const REMINDER_PORTAL_FALLBACK_PENDING_MARKER = '[REMINDER_PORTAL_FALLBACK_PENDING]';
const REMINDER_OCCURRENCE_MARKER_PREFIX = '\u2063';
const REMINDER_OCCURRENCE_MARKER_SEPARATOR = '\u200D';
const REMINDER_OCCURRENCE_MARKER_ZERO = '\u200B';
const REMINDER_OCCURRENCE_MARKER_ONE = '\u200C';
const REMINDER_OCCURRENCE_MARKER_SUFFIX = '\u2064';
const REMINDER_RETRY_DELAYS_MS = [
  15 * 60 * 1000,
  2 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;
type UserRoleValue = (typeof s.users.role.enumValues)[number];
type NotificationTypeValue = (typeof s.notifications.type.enumValues)[number];

interface ReminderStageConfig {
  key: string;
  label: string;
  offsetDays: number;
}

const REMINDER_FIXED_STAGES: readonly ReminderStageConfig[] = [
  { key: 'T_MINUS_3', label: 'T-3', offsetDays: -3 },
  { key: 'DUE_DATE', label: 'Đến hạn', offsetDays: 0 },
  { key: 'T_PLUS_3', label: 'T+3', offsetDays: 3 },
] as const;
const REMINDER_POST_DUE_REPEAT_START_DAYS = 10;
const REMINDER_POST_DUE_REPEAT_INTERVAL_DAYS = 7;

export interface ReminderRunStats {
  processed: number;   // every active customer considered
  reminded: number;    // email actually sent
  skipped: number;     // did not qualify (paid / suspended / disputed / not-overdue / no-email)
  deduped: number;     // already reminded today
  failed: number;      // send threw
}

export interface ReminderRetryStats {
  scanned: number;
  retried: number;
  suppressed: number;
  escalated: number;
  failed: number;
}

interface OutstandingObligation {
  customerId: number;
  txnId: number;
  obligationKey: string;
  outstanding: number;
  processingDueDate: string | null;
  entityType: 'TRIP' | 'BILLING_DOCUMENT' | 'SERVICE_FEE' | 'DEBT_OFFSET';
}

interface ReminderItem {
  stage: ReminderStageConfig;
  txnId: number;
  obligationKey: string;
  processingDueDate: string;
  scheduledDate: string;
  outstanding: number;
  rolled: boolean;
}

interface ReminderSummary {
  referenceDate: string;
  recipientEmail: string | null;
  subject: string;
  html: string;
  items: ReminderItem[];
  totalOutstanding: number;
  earliestSendHour: number;
  portalUserIds: number[];
}

interface ReminderCustomer {
  id: number;
  name: string;
  status: string | null;
  contactInfo: string | null;
}

/**
 * Backwards-compatible helper for callers/tests that need to know whether the
 * customer currently has any rejected debit note. Reminder suppression itself
 * is obligation-scoped inside `buildReminderSummary`.
 */
export async function isCustomerDisputed(customerId: number): Promise<boolean> {
  const [row] = await db.select({ id: s.billingDocuments.id })
    .from(s.billingDocuments)
    .where(and(
      eq(s.billingDocuments.entityType, 'CUSTOMER'),
      eq(s.billingDocuments.entityId, customerId),
      eq(s.billingDocuments.type, 'DEBIT_NOTE'),
      eq(s.billingDocuments.debitNoteStatus, 'REJECTED'),
      isNull(s.billingDocuments.deletedAt),
    ))
    .limit(1);
  return row != null;
}

/**
 * Has this customer already been sent or queued a reminder for a business date?
 * Dedupe key: subject LIKE 'prefix%' AND the Vietnam-local created date equals
 * the supplied business date. A raw timestamptz::date comparison is wrong
 * during the UTC/Vietnam midnight offset and can send the same reminder twice.
 */
export async function alreadyRemindedToday(
  customerId: number,
  businessDate: string = getBusinessClock(new Date()).date,
): Promise<boolean> {
  const [row] = await db.select({
    n: sql<string>`count(*)`,
  })
    .from(s.customerEmailLogs)
    .where(and(
      eq(s.customerEmailLogs.customerId, customerId),
      sql`${s.customerEmailLogs.subject} LIKE ${REMINDER_SUBJECT_PREFIX + '%'}`,
      sql`(${s.customerEmailLogs.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = ${businessDate}::date`,
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
export async function getCustomerOverdueAmount(
  customerId: number,
  termDays: number = 30,
  paymentDatePolicy: PaymentDatePolicy = 'NEXT_BUSINESS_DAY',
  now: Date = new Date(),
): Promise<number> {
  // Compatibility parameters are intentionally ignored: each obligation owns the
  // immutable term/policy snapshot captured when it was posted.
  void termDays;
  void paymentDatePolicy;
  const obligations = (await loadOutstandingObligations([customerId])).get(customerId) ?? [];

  let overdueAmount = 0;
  const today = getBusinessClock(now).date;
  for (const obligation of obligations) {
    const outstanding = Math.max(0, obligation.outstanding);
    if (outstanding <= 0) continue;
    if (obligation.processingDueDate && obligation.processingDueDate < today) {
      overdueAmount += outstanding;
    }
  }
  return overdueAmount;
}

/**
 * Run one reminder cycle. Iterates every ACTIVE customer, applies the
 * accepted schedule, and sends at most one customer summary per business date.
 */
export async function runReceivableReminders(now: Date = new Date()): Promise<ReminderRunStats> {
  const stats: ReminderRunStats = { processed: 0, reminded: 0, skipped: 0, deduped: 0, failed: 0 };
  const clock = getBusinessClock(now);
  if (!isInsideReminderWindow(clock)) {
    logger.info({ now: now.toISOString(), businessDate: clock.date }, 'receivable-reminder: outside delivery window');
    return stats;
  }

  const calendarOverrides = await loadCalendarOverrides(
    addCalendarDays(clock.date, -REMINDER_CALENDAR_LOOKBACK_DAYS),
    clock.date,
  );
  if (!isWorkingDay(clock.date, calendarOverrides)) {
    logger.info({ businessDate: clock.date }, 'receivable-reminder: non-working day');
    return stats;
  }

  const customers = await db.select({
    id: s.customers.id,
    name: s.customers.name,
    status: s.customers.status,
    contactInfo: s.customers.contactInfo,
  })
    .from(s.customers)
    .where(and(
      eq(s.customers.status, 'ACTIVE'),
      isNull(s.customers.deletedAt),
    ));

  const customerIds = customers.map((customer) => customer.id);
  const obligationsByCustomer = await loadOutstandingObligations(customerIds);
  const rawItemsByCustomer = new Map<number, ReminderItem[]>();
  const candidateObligations: OutstandingObligation[] = [];
  const candidateCustomers = new Map<number, ReminderCustomer>();

  for (const c of customers) {
    stats.processed += 1;
    const obligations = obligationsByCustomer.get(c.id) ?? [];
    const outstanding = obligations.reduce((sum, obligation) => sum + Math.max(0, obligation.outstanding), 0);
    if (outstanding <= 0) {
      stats.skipped += 1;
      continue;
    }

    const items = obligations.flatMap((obligation) => matchReminderStages(obligation, clock.date, calendarOverrides));
    if (items.length === 0) {
      stats.skipped += 1;
      continue;
    }

    rawItemsByCustomer.set(c.id, items);
    candidateCustomers.set(c.id, c);
    candidateObligations.push(...obligations);
  }

  const disputedKeys = await loadDisputedObligationKeys(candidateObligations);
  const portalUserIdsByCustomer = await loadCustomerPortalUserIdsForCustomers([...candidateCustomers.keys()]);

  for (const [customerId, customer] of candidateCustomers) {
    try {
      const reminderSummary = buildReminderSummary(
        customer,
        clock.date,
        rawItemsByCustomer.get(customerId)?.filter((item) => !disputedKeys.has(item.obligationKey)) ?? [],
        portalUserIdsByCustomer.get(customerId) ?? [],
      );
      if (!reminderSummary) {
        stats.skipped += 1;
        continue;
      }
      if (clock.hour < reminderSummary.earliestSendHour) {
        logger.info(
          { customerId, businessDate: clock.date, earliestSendHour: reminderSummary.earliestSendHour },
          'receivable-reminder: waiting for allowed rolled-send hour',
        );
        continue;
      }

      const claimedLog = await claimReminderEmailLog(
        customerId,
        clock.date,
        reminderSummary.subject,
        reminderSummary.recipientEmail,
      );
      if (claimedLog == null) {
        stats.deduped += 1;
        continue;
      }

      if (!reminderSummary.recipientEmail) {
        await markReminderLogFailedNoEmail(claimedLog.id);
        stats.skipped += 1;
        await emitReminderSideEffects(
          claimedLog.id,
          reminderSummary,
          customer,
          'Không có email liên hệ; cần xử lý thủ công.',
        );
        continue;
      }

      const result = await deliverEmailLog(claimedLog.id, {
        to: reminderSummary.recipientEmail,
        subject: reminderSummary.subject,
        html: reminderSummary.html,
        leaseToken: claimedLog.leaseToken,
      });

      if (result.ok) {
        stats.reminded += 1;
        await emitReminderSideEffects(
          claimedLog.id,
          reminderSummary,
          customer,
          'Email đã được tạo gửi. Bản ghi này chỉ là lưu vết nội bộ, không thay thế bằng chứng nhà cung cấp email.',
        );
      } else {
        stats.failed += 1;
        await emitReminderSideEffects(
          claimedLog.id,
          reminderSummary,
          customer,
          'Email lỗi; hệ thống sẽ gửi lại sau 15 phút, 2 giờ và 24 giờ.',
        );
        logger.warn(
          { customerId, err: result.error },
          'receivable-reminder: email send failed',
        );
      }
    } catch (err) {
      stats.failed += 1;
      logger.warn({ customerId, err: (err as Error).message }, 'receivable-reminder: customer processing failed');
    }
  }

  logger.info(stats, 'receivable-reminder: run complete');
  return stats;
}

/**
 * Retry FAILED receivable reminder emails according to the accepted cadence.
 */
export async function runReceivableReminderRetries(
  now: Date = new Date(),
): Promise<ReminderRetryStats> {
  const stats: ReminderRetryStats = {
    scanned: 0,
    retried: 0,
    suppressed: 0,
    escalated: 0,
    failed: 0,
  };
  const maxRetries = getMaxEmailRetries();
  const stalePendingCutoff = new Date(
    now.getTime() - getEmailProviderTimeoutMs() - REMINDER_RETRY_STALE_GRACE_MS,
  );
  const failedLogs = await db.select({
    id: s.customerEmailLogs.id,
    customerId: s.customerEmailLogs.customerId,
    subject: s.customerEmailLogs.subject,
    recipientEmail: s.customerEmailLogs.recipientEmail,
    status: s.customerEmailLogs.status,
    retryCount: s.customerEmailLogs.retryCount,
    errorMessage: s.customerEmailLogs.errorMessage,
    createdAt: s.customerEmailLogs.createdAt,
    updatedAt: s.customerEmailLogs.updatedAt,
  })
    .from(s.customerEmailLogs)
    .where(and(
      sql`${s.customerEmailLogs.subject} LIKE ${REMINDER_SUBJECT_PREFIX + '%'}`,
      or(
        and(
          eq(s.customerEmailLogs.status, 'FAILED'),
          sql`${s.customerEmailLogs.retryCount} < ${maxRetries}`,
        ),
        and(
          eq(s.customerEmailLogs.status, 'PENDING'),
          lte(s.customerEmailLogs.updatedAt, stalePendingCutoff),
          sql`${s.customerEmailLogs.retryCount} < ${maxRetries}`,
        ),
        and(
          eq(s.customerEmailLogs.status, 'SENT'),
          sql`${s.customerEmailLogs.errorMessage} LIKE ${'%' + REMINDER_PORTAL_FALLBACK_PENDING_MARKER + '%'}`,
        ),
      ),
    ))
    .orderBy(asc(s.customerEmailLogs.updatedAt))
    .limit(REMINDER_RETRY_BATCH_LIMIT);

  const customersById = await loadReminderCustomersByIds([...new Set(failedLogs.map((log) => log.customerId))]);
  const obligationsByCustomer = await loadOutstandingObligations([...customersById.keys()]);
  const candidateObligations = [...obligationsByCustomer.values()].flat();
  const disputedKeys = await loadDisputedObligationKeys(candidateObligations);
  const portalUserIdsByCustomer = await loadCustomerPortalUserIdsForCustomers([...customersById.keys()]);
  const referenceDates = failedLogs.map((log) => getBusinessClock(log.createdAt).date);
  const calendarOverrides = referenceDates.length === 0
    ? []
    : await loadCalendarOverrides(
      referenceDates.reduce(
        (minDate, date) => {
          const candidate = addCalendarDays(date, -REMINDER_CALENDAR_LOOKBACK_DAYS);
          return candidate < minDate ? candidate : minDate;
        },
        addCalendarDays(referenceDates[0]!, -REMINDER_CALENDAR_LOOKBACK_DAYS),
      ),
      referenceDates.reduce((maxDate, date) => (date > maxDate ? date : maxDate), referenceDates[0]!),
    );

  for (const log of failedLogs) {
    stats.scanned += 1;
    const needsEmailRetry = log.status !== 'SENT';
    const retryDelayMs = REMINDER_RETRY_DELAYS_MS[log.retryCount];
    if (needsEmailRetry && (retryDelayMs == null || log.updatedAt.getTime() + retryDelayMs > now.getTime())) {
      continue;
    }

    const customer = customersById.get(log.customerId) ?? null;
    if (!customer || customer.status !== 'ACTIVE') {
      await suppressRetry(log.id, 'Khách hàng đã bị khóa hoặc không còn tồn tại', maxRetries);
      stats.suppressed += 1;
      continue;
    }

    const obligations = obligationsByCustomer.get(customer.id) ?? [];
    const outstanding = obligations.reduce((sum, obligation) => sum + Math.max(0, obligation.outstanding), 0);
    if (outstanding <= 0) {
      await suppressRetry(log.id, 'Đã thanh toán đủ', maxRetries);
      stats.suppressed += 1;
      continue;
    }

    const referenceDate = getBusinessClock(log.createdAt).date;
    const reminderSummary = buildReminderSummary(
      customer,
      referenceDate,
      obligations
        .flatMap((obligation) => matchReminderStages(obligation, referenceDate, calendarOverrides))
        .filter((item) => !disputedKeys.has(item.obligationKey)),
      portalUserIdsByCustomer.get(customer.id) ?? [],
    );
    if (!reminderSummary) {
      await suppressRetry(log.id, 'Không còn khoản đủ điều kiện trong chu kỳ nhắc gốc', maxRetries);
      stats.suppressed += 1;
      continue;
    }

    const portalFallbackRepaired = await repairReminderPortalFallback(log.id, reminderSummary, customer);
    if (!portalFallbackRepaired) {
      stats.failed += 1;
      continue;
    }
    if (!needsEmailRetry) continue;

    if (log.status === 'PENDING') {
      const reclaimed = await reclaimStalePendingReminderLog(log.id, stalePendingCutoff);
      if (!reclaimed) continue;
    }

    if (!reminderSummary.recipientEmail && !log.recipientEmail) {
      await suppressRetry(log.id, 'Không có email liên hệ để gửi lại', maxRetries);
      stats.suppressed += 1;
      continue;
    }

    const result = await retryEmail(log.id, {
      to: reminderSummary.recipientEmail ?? log.recipientEmail,
      subject: reminderSummary.subject,
      html: reminderSummary.html,
    });
    if (!result.ok && result.error === 'Retry claim expired') {
      continue;
    }

    if (result.ok) {
      stats.retried += 1;
      continue;
    }

    stats.failed += 1;
    if (log.retryCount + 1 >= maxRetries) {
      await emitTerminalFailureAlert(
        customer.id,
        customer.name,
        log.id,
        result.error ?? 'Unknown error',
      );
      stats.escalated += 1;
    }
  }

  logger.info(stats, 'receivable-reminder: retry run complete');
  return stats;
}

async function emitReminderEvidence(
  customerId: number,
  customerName: string,
  referenceDate: string,
  items: readonly ReminderItem[],
  deliveryStatus: string,
): Promise<void> {
  await emitNotificationAndWait({
    type: NotificationType.OVERDUE_PAYMENT,
    title: 'Nhắc công nợ khách hàng',
    message: `Khách hàng ${customerName} có lịch nhắc ${describeStages(items)} cho ngày ${referenceDate}. ${deliveryStatus}`,
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
function buildReminderHtml(
  customerName: string,
  referenceDate: string,
  items: readonly ReminderItem[],
  totalOutstanding: number,
): string {
  const rows = summarizeItems(items)
    .map((entry) => `<li><strong>${escapeHtml(entry.stageLabel)}</strong>: ${entry.count} khoản, tổng <strong>${formatCurrency(entry.total)}</strong>, hạn thanh toán ${escapeHtml(entry.dueDates.join(', '))}</li>`)
    .join('');

  return `
    <p>Kính chào <strong>${escapeHtml(customerName)}</strong>,</p>
    <p>Hệ thống ghi nhận lịch nhắc công nợ ngày <strong>${escapeHtml(referenceDate)}</strong>
       cho các khoản sau:</p>
    <ul>${rows}</ul>
    <p>Tổng công nợ đang liên quan đến đợt nhắc này là
       <strong>${formatCurrency(totalOutstanding)}</strong>.</p>
    <p>Vui lòng thanh toán hoặc phản hồi lại bộ phận kế toán nếu cần đối chiếu thêm.</p>
    <p>Trân trọng,<br/>Bộ phận kế toán</p>
  `;
}

function buildReminderSummary(
  customer: ReminderCustomer,
  referenceDate: string,
  items: readonly ReminderItem[],
  portalUserIds: readonly number[],
): ReminderSummary | null {
  const sortedItems = [...items].sort((a, b) => (
    a.stage.offsetDays - b.stage.offsetDays
    || a.processingDueDate.localeCompare(b.processingDueDate)
    || a.txnId - b.txnId
  ));
  if (sortedItems.length === 0) return null;

  const totalOutstanding = uniqueOutstandingTotal(sortedItems);
  const subject = `${REMINDER_SUBJECT_PREFIX} ${describeStages(sortedItems)} ${customer.name} — ${formatCurrency(totalOutstanding)}`;
  return {
    referenceDate,
    recipientEmail: extractEmail(customer.contactInfo),
    subject,
    html: buildReminderHtml(customer.name, referenceDate, sortedItems, totalOutstanding),
    items: sortedItems,
    totalOutstanding,
    earliestSendHour: sortedItems.some((item) => item.rolled)
      ? REMINDER_ROLLED_WINDOW_START_HOUR
      : REMINDER_WINDOW_START_HOUR,
    portalUserIds: [...new Set(portalUserIds)],
  };
}

async function loadOutstandingObligations(customerIds: readonly number[]): Promise<Map<number, OutstandingObligation[]>> {
  const obligationsByCustomer = new Map<number, OutstandingObligation[]>();
  if (customerIds.length === 0) return obligationsByCustomer;

  const snapshots = await getCustomerReceivableSnapshots([...customerIds]);
  for (const [customerId, snapshot] of snapshots.entries()) {
    const obligations = snapshot.obligations
      .filter((obligation) => obligation.outstanding > 0 && obligation.processingDueDate != null)
      .map((obligation) => ({
        customerId,
        txnId: obligation.authorityId,
        obligationKey: obligationKeyFor(
          obligation.authorityType === 'OTHER' ? 'SERVICE_FEE' : obligation.authorityType,
          customerId,
          obligation.authorityId,
        ),
        outstanding: obligation.outstanding,
        processingDueDate: obligation.processingDueDate,
        entityType: obligation.authorityType === 'OTHER'
          ? 'SERVICE_FEE'
          : obligation.authorityType,
      }));
    if (obligations.length > 0) {
      obligationsByCustomer.set(customerId, obligations);
    }
  }

  return obligationsByCustomer;
}

function matchReminderStages(
  obligation: OutstandingObligation,
  referenceDate: string,
  calendarOverrides: readonly BusinessCalendarOverride[],
): ReminderItem[] {
  if (!obligation.processingDueDate) return [];
  const matches: ReminderItem[] = [];
  for (const stage of buildReminderStages(obligation.processingDueDate, referenceDate)) {
    const resolution = resolveBusinessDate(
      addCalendarDays(obligation.processingDueDate, stage.offsetDays),
      'NEXT_BUSINESS_DAY',
      calendarOverrides,
    );
    const scheduledDate = resolution.processingDate;
    if (scheduledDate === referenceDate) {
      matches.push({
        stage,
        txnId: obligation.txnId,
        obligationKey: obligation.obligationKey,
        processingDueDate: obligation.processingDueDate,
        scheduledDate,
        outstanding: obligation.outstanding,
        rolled: resolution.adjusted,
      });
    }
  }
  return matches;
}

async function loadCalendarOverrides(
  fromDate: string,
  toDate: string,
): Promise<BusinessCalendarOverride[]> {
  return db.select({
    calendarDate: s.businessCalendarDays.calendarDate,
    isWorkingDay: s.businessCalendarDays.isWorkingDay,
  })
    .from(s.businessCalendarDays)
    .where(and(
      gte(s.businessCalendarDays.calendarDate, fromDate),
      lte(s.businessCalendarDays.calendarDate, toDate),
    ))
    .orderBy(asc(s.businessCalendarDays.calendarDate));
}

async function loadReminderCustomersByIds(customerIds: readonly number[]): Promise<Map<number, ReminderCustomer>> {
  const customersById = new Map<number, ReminderCustomer>();
  if (customerIds.length === 0) return customersById;

  const customers = await db.select({
    id: s.customers.id,
    name: s.customers.name,
    status: s.customers.status,
    contactInfo: s.customers.contactInfo,
  })
    .from(s.customers)
    .where(and(
      inArray(s.customers.id, [...customerIds]),
      isNull(s.customers.deletedAt),
    ));
  for (const customer of customers) customersById.set(customer.id, customer);
  return customersById;
}

async function loadDisputedObligationKeys(
  obligations: readonly OutstandingObligation[],
): Promise<Set<string>> {
  const disputedKeys = new Set<string>();
  const tripObligations = obligations.filter((obligation) => obligation.entityType === 'TRIP');
  const docObligations = obligations.filter((obligation) => obligation.entityType === 'BILLING_DOCUMENT');

  if (docObligations.length > 0) {
    const rejectedDocs = await db.select({
      id: s.billingDocuments.id,
      customerId: s.billingDocuments.entityId,
    })
      .from(s.billingDocuments)
      .where(and(
        eq(s.billingDocuments.entityType, 'CUSTOMER'),
        eq(s.billingDocuments.type, 'DEBIT_NOTE'),
        eq(s.billingDocuments.debitNoteStatus, 'REJECTED'),
        isNull(s.billingDocuments.deletedAt),
        inArray(s.billingDocuments.id, [...new Set(docObligations.map((obligation) => obligation.txnId))]),
      ));
    for (const doc of rejectedDocs) {
      disputedKeys.add(obligationKeyFor('BILLING_DOCUMENT', doc.customerId, doc.id));
    }
  }

  if (tripObligations.length > 0) {
    const rejectedTripLines = await db.select({
      tripId: s.billingDocumentLines.sourceId,
      customerId: s.billingDocuments.entityId,
    })
      .from(s.billingDocumentLines)
      .innerJoin(s.billingDocuments, eq(s.billingDocumentLines.documentId, s.billingDocuments.id))
      .where(and(
        eq(s.billingDocumentLines.sourceType, 'TRIP'),
        eq(s.billingDocuments.entityType, 'CUSTOMER'),
        eq(s.billingDocuments.type, 'DEBIT_NOTE'),
        eq(s.billingDocuments.debitNoteStatus, 'REJECTED'),
        isNull(s.billingDocuments.deletedAt),
        inArray(
          s.billingDocumentLines.sourceId,
          [...new Set(tripObligations.map((obligation) => obligation.txnId))],
        ),
      ));
    for (const line of rejectedTripLines) {
      if (line.tripId != null) {
        disputedKeys.add(obligationKeyFor('TRIP', line.customerId, line.tripId));
      }
    }
  }

  return disputedKeys;
}

function getBusinessClock(now: Date): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REMINDER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    hour: Number(value('hour')),
    minute: Number(value('minute')),
  };
}

function isInsideReminderWindow(clock: { hour: number; minute: number }): boolean {
  if (clock.hour < REMINDER_WINDOW_START_HOUR || clock.hour > REMINDER_WINDOW_END_HOUR) return false;
  if (clock.hour === REMINDER_WINDOW_END_HOUR && clock.minute > REMINDER_WINDOW_END_MINUTE) return false;
  return true;
}

function isWorkingDay(
  date: string,
  overrides: readonly BusinessCalendarOverride[],
): boolean {
  const override = overrides.find((entry) => entry.calendarDate === date);
  if (override) return override.isWorkingDay;
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function describeStages(items: readonly ReminderItem[]): string {
  return [...new Set(items.map((item) => item.stage.label))].join(' / ');
}

function uniqueOutstandingTotal(items: readonly ReminderItem[]): number {
  const totals = new Map<string, number>();
  for (const item of items) {
    if (!totals.has(item.obligationKey)) {
      totals.set(item.obligationKey, item.outstanding);
    }
  }
  return [...totals.values()].reduce((sum, amount) => sum + amount, 0);
}

function obligationKeyFor(
  entityType: OutstandingObligation['entityType'],
  customerId: number,
  txnId: number,
): string {
  return `${entityType}:${customerId}:${txnId}`;
}

function summarizeItems(items: readonly ReminderItem[]): Array<{
  stageLabel: string;
  count: number;
  total: number;
  dueDates: string[];
}> {
  const grouped = new Map<string, {
    outstanding: number;
    dueDates: Set<string>;
    stages: ReminderStageConfig[];
  }>();
  for (const item of items) {
    const current = grouped.get(item.obligationKey) ?? {
      outstanding: item.outstanding,
      dueDates: new Set<string>(),
      stages: [],
    };
    if (!current.stages.some((stage) => stage.key === item.stage.key)) {
      current.stages.push(item.stage);
    }
    current.dueDates.add(item.processingDueDate);
    grouped.set(item.obligationKey, current);
  }

  return [...grouped.values()]
    .sort((a, b) => (
      Math.min(...a.stages.map((stage) => stage.offsetDays))
      - Math.min(...b.stages.map((stage) => stage.offsetDays))
      || [...a.dueDates][0]!.localeCompare([...b.dueDates][0]!)
    ))
    .map((entry) => ({
      stageLabel: [...entry.stages]
        .sort((a, b) => a.offsetDays - b.offsetDays)
        .map((stage) => stage.label)
        .join(' / '),
      count: 1,
      total: entry.outstanding,
      dueDates: [...entry.dueDates].sort(),
    }));
}

function formatCurrency(amount: number): string {
  return `${amount.toLocaleString('vi-VN')} ₫`;
}

async function suppressRetry(logId: number, reason: string, maxRetries: number): Promise<void> {
  await db.update(s.customerEmailLogs)
    .set({
      status: 'FAILED',
      retryCount: maxRetries,
      errorMessage: `Suppressed: ${reason}`,
      providerMessageId: null,
      updatedAt: new Date(),
    })
    .where(eq(s.customerEmailLogs.id, logId));
}

async function reclaimStalePendingReminderLog(logId: number, stalePendingCutoff: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const lockKey = `receivable-reminder:retry:${logId}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const [log] = await tx.select({
      status: s.customerEmailLogs.status,
      retryCount: s.customerEmailLogs.retryCount,
      updatedAt: s.customerEmailLogs.updatedAt,
      errorMessage: s.customerEmailLogs.errorMessage,
    })
      .from(s.customerEmailLogs)
      .where(eq(s.customerEmailLogs.id, logId))
      .limit(1);
    if (!log || log.status !== 'PENDING' || log.retryCount >= getMaxEmailRetries()) return false;
    if (log.updatedAt.getTime() > stalePendingCutoff.getTime()) return false;

    const updated = await tx.update(s.customerEmailLogs)
      .set({
        status: 'FAILED',
        errorMessage: reminderPortalFallbackErrorMessage(
          'Resend API timeout; hệ thống chuyển sang retry scheduler.',
          hasPendingReminderPortalFallback(log.errorMessage),
        ),
        providerMessageId: null,
        updatedAt: log.updatedAt,
      })
      .where(and(
        eq(s.customerEmailLogs.id, logId),
        eq(s.customerEmailLogs.status, 'PENDING'),
        lte(s.customerEmailLogs.updatedAt, stalePendingCutoff),
      ))
      .returning({ id: s.customerEmailLogs.id });
    return updated.length > 0;
  });
}

async function emitTerminalFailureAlert(
  customerId: number,
  customerName: string,
  logId: number,
  errorMessage: string,
): Promise<void> {
  const targetUserIds = await loadUserIdsForRoles(REMINDER_TERMINAL_ESCALATION_ROLES);
  if (targetUserIds.length === 0) return;
  const message = `Email công nợ của khách hàng ${customerName} đã gửi lại không thành công 3 lần. Bộ phận chứng từ và kế toán cần xử lý thủ công. Lỗi cuối: ${errorMessage}`;
  await insertNotificationsOnce({
    lockKey: `receivable-reminder:terminal:${logId}`,
    title: 'Email nhắc công nợ thất bại',
    message,
    type: NotificationType.SYSTEM_ANNOUNCEMENT,
    customerId,
    targetUserIds,
    businessDate: getBusinessClock(new Date()).date,
    existingMessageToken: `email-log:${logId}`,
  });
}

async function emitCustomerPortalFallback(
  logId: number,
  reminderSummary: ReminderSummary,
  customer: ReminderCustomer,
): Promise<void> {
  if (reminderSummary.portalUserIds.length === 0) return;
  const occurrenceToken = `reminder-log:${logId}`;
  const existingMessageToken = encodeReminderOccurrenceToken(occurrenceToken);

  const inserted = await insertNotificationsOnce({
    lockKey: `receivable-reminder:portal:${occurrenceToken}`,
    title: 'Nhắc thanh toán công nợ',
    message: `${reminderPortalFallbackMessage(reminderSummary)}${existingMessageToken}`,
    type: NotificationType.OVERDUE_PAYMENT,
    customerId: customer.id,
    targetUserIds: reminderSummary.portalUserIds,
    businessDate: reminderSummary.referenceDate,
    dedupeAcrossDates: true,
    existingMessageToken,
  });
  logger.info(
    { customerId: customer.id, recipientCount: inserted, businessDate: reminderSummary.referenceDate },
    'receivable-reminder: customer portal fallback emitted',
  );
}

async function loadCustomerPortalUserIdsForCustomers(
  customerIds: readonly number[],
): Promise<Map<number, number[]>> {
  const portalUserIdsByCustomer = new Map<number, number[]>();
  if (customerIds.length === 0) return portalUserIdsByCustomer;

  const wantedCustomerIds = [...new Set(customerIds)];
  const rows = await db.select({
    userId: s.users.id,
    directCustomerId: s.users.customerId,
    linkedCustomerId: s.userCustomerLinks.customerId,
  })
    .from(s.users)
    .leftJoin(s.userCustomerLinks, and(
      eq(s.userCustomerLinks.userId, s.users.id),
    ))
    .where(and(
      eq(s.users.role, 'CUSTOMER'),
      eq(s.users.status, 'ACTIVE'),
      isNull(s.users.deletedAt),
      or(
        inArray(s.users.customerId, wantedCustomerIds),
        inArray(s.userCustomerLinks.customerId, wantedCustomerIds),
      ),
    ));
  for (const row of rows) {
    for (const customerId of [row.directCustomerId, row.linkedCustomerId]) {
      if (customerId == null || !wantedCustomerIds.includes(customerId)) continue;
      const userIds = portalUserIdsByCustomer.get(customerId) ?? [];
      if (!userIds.includes(row.userId)) userIds.push(row.userId);
      portalUserIdsByCustomer.set(customerId, userIds);
    }
  }
  return portalUserIdsByCustomer;
}

async function claimReminderEmailLog(
  customerId: number,
  businessDate: string,
  subject: string,
  recipientEmail: string | null,
): Promise<{ id: number; leaseToken: string } | null> {
  return db.transaction(async (tx) => {
    const lockKey = `receivable-reminder:email:${customerId}:${businessDate}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const [existing] = await tx.select({ id: s.customerEmailLogs.id })
      .from(s.customerEmailLogs)
      .where(and(
        eq(s.customerEmailLogs.customerId, customerId),
        sql`${s.customerEmailLogs.subject} LIKE ${REMINDER_SUBJECT_PREFIX + '%'}`,
        sql`(${s.customerEmailLogs.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = ${businessDate}::date`,
      ))
      .limit(1);
    if (existing) return null;

    const leaseToken = reminderAttemptLeaseToken(customerId, businessDate);
    const [log] = await tx.insert(s.customerEmailLogs).values({
      customerId,
      subject,
      recipientEmail,
      status: 'PENDING',
      providerMessageId: leaseToken,
      retryCount: 0,
    }).returning({ id: s.customerEmailLogs.id });
    return { id: log.id, leaseToken };
  });
}

async function markReminderLogFailedNoEmail(logId: number): Promise<void> {
  await db.update(s.customerEmailLogs)
    .set({
      status: 'FAILED',
      errorMessage: 'Không có email liên hệ',
      providerMessageId: null,
      retryCount: getMaxEmailRetries(),
      updatedAt: new Date(),
    })
    .where(eq(s.customerEmailLogs.id, logId));
}

async function emitReminderSideEffects(
  logId: number,
  reminderSummary: ReminderSummary,
  customer: ReminderCustomer,
  deliveryStatus: string,
): Promise<void> {
  const sideEffects = await Promise.allSettled([
    emitReminderEvidence(
      customer.id,
      customer.name,
      reminderSummary.referenceDate,
      reminderSummary.items,
      deliveryStatus,
    ),
    ensureReminderPortalFallback(logId, reminderSummary, customer),
  ]);
  logSettledSideEffectFailures(sideEffects, customer.id);
}

async function ensureReminderPortalFallback(
  logId: number,
  reminderSummary: ReminderSummary,
  customer: ReminderCustomer,
): Promise<void> {
  if (reminderSummary.portalUserIds.length === 0) return;
  await markReminderPortalFallbackPending(logId);
  await emitCustomerPortalFallback(logId, reminderSummary, customer);
  await clearReminderPortalFallbackPending(logId);
}

async function repairReminderPortalFallback(
  logId: number,
  reminderSummary: ReminderSummary,
  customer: ReminderCustomer,
): Promise<boolean> {
  try {
    await ensureReminderPortalFallback(logId, reminderSummary, customer);
    return true;
  } catch (err) {
    logger.warn(
      { customerId: customer.id, channel: 'customer-portal', err: err instanceof Error ? err.message : String(err) },
      'receivable-reminder: side effect failed',
    );
    return false;
  }
}

async function markReminderPortalFallbackPending(logId: number): Promise<void> {
  const [log] = await db.select({ errorMessage: s.customerEmailLogs.errorMessage })
    .from(s.customerEmailLogs)
    .where(eq(s.customerEmailLogs.id, logId))
    .limit(1);
  if (!log) return;
  await db.update(s.customerEmailLogs)
    .set({
      errorMessage: reminderPortalFallbackErrorMessage(log.errorMessage, true),
      updatedAt: new Date(),
    })
    .where(eq(s.customerEmailLogs.id, logId));
}

async function clearReminderPortalFallbackPending(logId: number): Promise<void> {
  const [log] = await db.select({ errorMessage: s.customerEmailLogs.errorMessage })
    .from(s.customerEmailLogs)
    .where(eq(s.customerEmailLogs.id, logId))
    .limit(1);
  if (!log || !hasPendingReminderPortalFallback(log.errorMessage)) return;
  await db.update(s.customerEmailLogs)
    .set({
      errorMessage: reminderPortalFallbackErrorMessage(log.errorMessage, false),
      updatedAt: new Date(),
    })
    .where(eq(s.customerEmailLogs.id, logId));
}

function logSettledSideEffectFailures(
  sideEffects: readonly PromiseSettledResult<unknown>[],
  customerId: number,
): void {
  const labels = ['internal-evidence', 'customer-portal'];
  sideEffects.forEach((effect, index) => {
    if (effect.status === 'fulfilled') return;
    logger.warn(
      { customerId, channel: labels[index], err: effect.reason instanceof Error ? effect.reason.message : String(effect.reason) },
      'receivable-reminder: side effect failed',
    );
  });
}

function reminderAttemptLeaseToken(customerId: number, businessDate: string): string {
  return `reminder:${customerId}:${businessDate}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function hasPendingReminderPortalFallback(errorMessage: string | null): boolean {
  return errorMessage?.includes(REMINDER_PORTAL_FALLBACK_PENDING_MARKER) ?? false;
}

function reminderPortalFallbackErrorMessage(
  errorMessage: string | null,
  shouldMarkPending: boolean,
): string | null {
  const baseMessage = errorMessage
    ?.replace(REMINDER_PORTAL_FALLBACK_PENDING_MARKER, '')
    .trim()
    ?? '';
  if (!shouldMarkPending) {
    return baseMessage.length > 0 ? baseMessage : null;
  }
  return [baseMessage, REMINDER_PORTAL_FALLBACK_PENDING_MARKER].filter(Boolean).join(' ');
}

function isDebtOffsetAdjustmentRow(note: string | null, txnId: number): boolean {
  if (!note) return false;
  return note === 'Đối trừ công nợ khách hàng và nhà cung cấp'
    || note === 'Hoàn tác đối trừ công nợ khách hàng và nhà cung cấp'
    || note === `Đối trừ công nợ #${txnId}`
    || note === `Hoàn tác đối trừ công nợ #${txnId}`;
}

function isServiceFeeAdjustmentRow(note: string | null): boolean {
  return note?.startsWith('Điều chỉnh phí chi hộ chuyến') ?? false;
}

function reminderPortalFallbackMessage(reminderSummary: ReminderSummary): string {
  return `Quý khách có lịch nhắc ${describeStages(reminderSummary.items)} vào ngày ${reminderSummary.referenceDate}. Vui lòng kiểm tra công nợ và liên hệ bộ phận kế toán nếu cần đối chiếu.`;
}

function encodeReminderOccurrenceToken(token: string): string {
  const bits = [...token].map((character) => (
    character.charCodeAt(0)
      .toString(2)
      .padStart(8, '0')
      .replaceAll('0', REMINDER_OCCURRENCE_MARKER_ZERO)
      .replaceAll('1', REMINDER_OCCURRENCE_MARKER_ONE)
  ));
  return [
    REMINDER_OCCURRENCE_MARKER_PREFIX,
    bits.join(REMINDER_OCCURRENCE_MARKER_SEPARATOR),
    REMINDER_OCCURRENCE_MARKER_SUFFIX,
  ].join('');
}

function normalizeUserRoles(input: readonly Role[]): UserRoleValue[] {
  const normalized: UserRoleValue[] = [];
  const seen = new Set<UserRoleValue>();
  for (const raw of input) {
    const value = (() => {
      switch (raw.trim().toUpperCase()) {
        case 'ADMIN':
          return 'ADMIN';
        case 'MANAGER':
          return 'MANAGER';
        case 'ACCOUNTANT':
          return 'ACCOUNTANT';
        case 'DRIVER':
          return 'DRIVER';
        case 'OPS':
          return 'OPS';
        case 'CUSTOMER':
          return 'CUSTOMER';
        case 'CUS':
          return 'CUS';
        case 'DISPATCHER':
          return 'DISPATCHER';
        default:
          return null;
      }
    })();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function normalizeNotificationType(input: NotificationType | string): NotificationTypeValue {
  switch (input.trim().toUpperCase()) {
    case 'TRIP_CREATED':
      return 'TRIP_CREATED';
    case 'TRIP_DISPATCHED':
      return 'TRIP_DISPATCHED';
    case 'TRIP_IN_TRANSIT':
      return 'TRIP_IN_TRANSIT';
    case 'TRIP_COMPLETED':
      return 'TRIP_COMPLETED';
    case 'TRIP_CANCELED':
      return 'TRIP_CANCELED';
    case 'PAYMENT_RECEIVED':
      return 'PAYMENT_RECEIVED';
    case 'PENALTY_CREATED':
      return 'PENALTY_CREATED';
    case 'PENALTY_CANCELED':
      return 'PENALTY_CANCELED';
    case 'OVERDUE_PAYMENT':
      return 'OVERDUE_PAYMENT';
    case 'SALARY_PERIOD_CLOSING':
      return 'SALARY_PERIOD_CLOSING';
    case 'SYSTEM_ANNOUNCEMENT':
      return 'SYSTEM_ANNOUNCEMENT';
    case 'ADVANCE_SETTLEMENT_APPROVED':
      return 'ADVANCE_SETTLEMENT_APPROVED';
    case 'SHIPMENT_HANDOFF':
      return 'SHIPMENT_HANDOFF';
    default:
      throw new Error(`Unsupported notification type: ${input}`);
  }
}

async function loadUserIdsForRoles(roles: readonly Role[]): Promise<number[]> {
  const normalizedRoles = normalizeUserRoles(roles);
  if (normalizedRoles.length === 0) return [];
  const rows = await db.select({ id: s.users.id })
    .from(s.users)
    .where(and(
      inArray(s.users.role, normalizedRoles),
      eq(s.users.status, 'ACTIVE'),
      isNull(s.users.deletedAt),
    ));
  return rows.map((row) => row.id);
}

async function insertNotificationsOnce(input: {
  lockKey: string;
  title: string;
  message: string;
  type: NotificationType;
  customerId: number;
  targetUserIds: readonly number[];
  businessDate: string;
  dedupeAcrossDates?: boolean;
  existingMessageToken?: string;
}): Promise<number> {
  if (input.targetUserIds.length === 0) return 0;
  const notificationType = normalizeNotificationType(input.type);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.lockKey}, 0))`);
    const conditions = [
      eq(s.notifications.relatedEntityType, 'customers'),
      eq(s.notifications.relatedEntityId, input.customerId),
      eq(s.notifications.title, input.title),
      inArray(s.notifications.userId, [...input.targetUserIds]),
    ];
    if (!input.dedupeAcrossDates) {
      conditions.push(
        sql`(${s.notifications.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = ${input.businessDate}::date`,
      );
    }
    if (input.existingMessageToken) {
      conditions.push(sql`${s.notifications.message} LIKE ${'%' + input.existingMessageToken + '%'}`);
    }
    const existingRows = await tx.select({ userId: s.notifications.userId })
      .from(s.notifications)
      .where(and(...conditions));
    const existingUserIds = new Set(existingRows.map((row) => row.userId));
    const missingUserIds = input.targetUserIds.filter((userId) => !existingUserIds.has(userId));
    if (missingUserIds.length === 0) return 0;

    await tx.insert(s.notifications).values(missingUserIds.map((userId) => ({
      userId,
      type: notificationType,
      title: input.title,
      message: input.message,
      relatedEntityType: 'customers',
      relatedEntityId: input.customerId,
      isRead: false,
    })));
    return missingUserIds.length;
  });
}

function buildReminderStages(
  processingDueDate: string,
  referenceDate: string,
): ReminderStageConfig[] {
  const stages = [...REMINDER_FIXED_STAGES];
  for (
    let offsetDays = REMINDER_POST_DUE_REPEAT_START_DAYS;
    addCalendarDays(processingDueDate, offsetDays) <= referenceDate;
    offsetDays += REMINDER_POST_DUE_REPEAT_INTERVAL_DAYS
  ) {
    stages.push({
      key: `T_PLUS_${offsetDays}`,
      label: `T+${offsetDays}`,
      offsetDays,
    });
  }
  return stages;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
