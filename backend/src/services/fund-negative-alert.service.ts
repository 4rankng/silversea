/**
 * Card 051026231511 (SPEC 5.10 §A item 3) — the quick fund notice in the bell.
 *
 * The bell already carries the receivable-overdue reminder (M5.7
 * `receivable-reminder.service.ts`): a scheduler job that reads a money
 * authority, decides whether a condition holds, and emits one in-app
 * notification per business date to FINANCIAL_ROLES. The fund alert is the
 * same pipeline with a different authority and a different condition — there
 * is deliberately no second notification path.
 *
 * Condition (the contract's single definition):
 *   `getMoneyAlertsSummary().fundNegative` — Quỹ tiền mặt < 0 AND Quỹ công ty
 *   < 0, all four sign directions pinned by `tests/money-alerts.test.ts`.
 *   The bell reads that boolean and those two balances rather than computing a
 *   second definition, so it can never disagree with the overview's "Quỹ âm"
 *   alert strip or its fund quick-notice — one condition, two surfaces.
 *
 * Both funds are covered by construction: the condition requires each one to be
 * negative, and the message quotes both balances.
 *
 * Dedupe: one notification per Vietnam business date, checked against the
 * notifications table itself. A `timestamptz::date` comparison is wrong across
 * the UTC/Vietnam midnight offset, so the date is projected in Vietnam time
 * exactly like `alreadyRemindedToday`.
 *
 * Read-only apart from the notification row it owns. Drizzle only; the two
 * balances arrive already rounded by the money-alerts authority.
 */
import { and, eq, sql } from 'drizzle-orm';

import { FINANCIAL_ROLES, NotificationType } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { formatVND } from '../lib/format';
import logger from '../lib/logger';
import { emitNotificationAndWait } from './notification.service';
import { getMoneyAlertsSummary } from './money-alerts.service';
import { resolveVietnamAsOfCutoff } from './customer-receivable-authority.service';

/** Alerting cadence — every 15 minutes, like the receivable reminder. */
export const FUND_NEGATIVE_ALERT_CRON = '*/15 * * * *';

export const FUND_NEGATIVE_ALERT_TITLE = 'Quỹ âm';

export interface FundAlertRunStats {
  /** Fund snapshots read (1 when the run got that far). */
  scanned: number;
  /** 1 when a notification was emitted, else 0. */
  alerted: number;
  /** Not negative, or already alerted for this business date. */
  skipped: number;
  failed: number;
}

/**
 * The single sentence both surfaces agree on: the overview strip's wording plus
 * the two balances, so the bell and the strip cannot drift apart.
 */
export function fundNegativeAlertMessage(funds: { tm: number; company: number }): string {
  return `Cả hai quỹ đều âm — cần bổ sung dòng tiền ngay. `
    + `Quỹ TM ${formatVND(funds.tm, true)} · Quỹ công ty ${formatVND(funds.company, true)}`;
}

/** Has a fund alert already gone out on this Vietnam business date? */
async function alreadyAlertedToday(businessDate: string): Promise<boolean> {
  const [row] = await db.select({ n: sql<string>`count(*)` })
    .from(s.notifications)
    .where(and(
      eq(s.notifications.type, 'FUND_NEGATIVE'),
      sql`(${s.notifications.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = ${businessDate}::date`,
    ));
  return Number(row?.n ?? 0) > 0;
}

/**
 * One alert cycle. Reads the money-alerts authority once and emits at most one
 * notification per Vietnam business date when both funds are negative.
 */
export async function runFundNegativeAlerts(now: Date = new Date()): Promise<FundAlertRunStats> {
  const stats: FundAlertRunStats = { scanned: 0, alerted: 0, skipped: 0, failed: 0 };
  const businessDate = resolveVietnamAsOfCutoff(undefined, now).businessDate;

  try {
    // No asOfDate: this is the live position, not an end-of-day snapshot, and
    // `computeFundBalances` (which owns `fundNegative`) ignores the cutoff
    // anyway. The business date comes from the same Vietnam clock the authority
    // would use, so the dedupe key and the read agree.
    const summary = await getMoneyAlertsSummary();
    stats.scanned = 1;

    if (!summary.fundNegative) {
      stats.skipped = 1;
      logger.debug({ businessDate }, 'fund-alert: both funds positive, nothing to report');
      return stats;
    }
    if (await alreadyAlertedToday(businessDate)) {
      stats.skipped = 1;
      logger.debug({ businessDate }, 'fund-alert: already alerted for this business date');
      return stats;
    }

    await emitNotificationAndWait({
      type: NotificationType.FUND_NEGATIVE,
      title: FUND_NEGATIVE_ALERT_TITLE,
      message: fundNegativeAlertMessage(summary.funds),
      relatedEntityType: 'funds',
      targetRoles: [...FINANCIAL_ROLES] as string[],
    });
    stats.alerted = 1;
    logger.info({ businessDate, funds: summary.funds }, 'fund-alert: emitted');
  } catch (err) {
    stats.failed = 1;
    logger.warn({ businessDate, err: (err as Error).message }, 'fund-alert: run failed');
  }

  return stats;
}