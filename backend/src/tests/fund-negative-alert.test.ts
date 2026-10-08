/**
 * Card 051026231511 (SPEC 5.10 §A item 3) — the bell's quick fund notice.
 *
 * The bell is a pure renderer of the `notifications` table, so the contract
 * lives in the producer: `runFundNegativeAlerts` must emit exactly one
 * FUND_NEGATIVE row per Vietnam business date while BOTH funds are negative,
 * and nothing at all otherwise.
 *
 * The condition is not re-derived here or in the service: it is
 * `getMoneyAlertsSummary().fundNegative`, the very boolean the accounting
 * overview's "Quỹ âm" alert strip renders. `setFundTotals` drives the shared
 * TM/COMPANY accounts to exact values (absorbing whatever else lives in the
 * shared DB) and these tests assert the notice against the same authority
 * read, so a future change that moved the two apart would fail here.
 *
 * Run: TZ=UTC npx tsx --test --test-concurrency=1 src/tests/fund-negative-alert.test.ts
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { getMoneyAlertsSummary } from '../services/money-alerts.service';
import { getTreasuryPositions } from '../services/treasury.service';
import {
  FUND_NEGATIVE_ALERT_TITLE,
  fundNegativeAlertMessage,
  runFundNegativeAlerts,
} from '../services/fund-negative-alert.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

let accountantId = 0;
let driverId = 0;
let tmAccountId = 0;
let companyAccountId = 0;

before(async () => {
  const users = await db.insert(s.users).values([
    { username: `card511-${suffix}-acct`, passwordHash: 'x', role: 'ACCOUNTANT' },
    { username: `card511-${suffix}-driver`, passwordHash: 'x', role: 'DRIVER' },
  ]).returning({ id: s.users.id, role: s.users.role });
  accountantId = users[0].id;
  driverId = users[1].id;
  track(async () => {
    await db.delete(s.notifications).where(inArray(s.notifications.userId, [accountantId, driverId]));
    await db.delete(s.users).where(inArray(s.users.id, [accountantId, driverId]));
  });

  const accounts = await db.insert(s.treasuryAccounts).values([
    {
      code: `CARD511-${suffix}-TM`, name: `card511 TM ${suffix}`,
      type: 'CASH', fundCode: 'TM', status: 'ACTIVE', openingBalance: '0',
      createdBy: accountantId, updatedBy: accountantId,
    },
    {
      code: `CARD511-${suffix}-COMPANY`, name: `card511 COMPANY ${suffix}`,
      type: 'BANK', fundCode: 'COMPANY', status: 'ACTIVE', openingBalance: '0',
      createdBy: accountantId, updatedBy: accountantId,
    },
  ]).returning({ id: s.treasuryAccounts.id });
  tmAccountId = accounts[0].id;
  companyAccountId = accounts[1].id;
  track(async () => {
    await db.delete(s.treasuryAccounts).where(inArray(s.treasuryAccounts.id, [tmAccountId, companyAccountId]));
  });
});

after(async () => {
  try {
    for (const fn of cleanup) await fn();
  } finally {
    await client.end();
    await disconnectRedis();
  }
});

/**
 * Force the WHOLE TM / COMPANY fund totals to exact values: the fixture
 * accounts absorb (wanted − everyone else). Balance math delegated to
 * getTreasuryPositions — no parallel formula in the test either. Mirrors the
 * helper in tests/money-alerts.test.ts, which pins the same authority.
 */
async function setFundTotals(tmTotal: number, companyTotal: number) {
  const accounts = await db.select({ id: s.treasuryAccounts.id, fundCode: s.treasuryAccounts.fundCode })
    .from(s.treasuryAccounts)
    .where(and(
      eq(s.treasuryAccounts.status, 'ACTIVE'),
      inArray(s.treasuryAccounts.fundCode, ['TM', 'COMPANY']),
    ));
  const others = accounts.filter((a) => a.id !== tmAccountId && a.id !== companyAccountId);
  const positions = await getTreasuryPositions(others.map((a) => a.id));
  const othersTotal = { TM: 0, COMPANY: 0 };
  for (const position of positions) {
    if (position.fundCode === 'TM') othersTotal.TM += position.bookBalance;
    else if (position.fundCode === 'COMPANY') othersTotal.COMPANY += position.bookBalance;
  }
  await db.update(s.treasuryAccounts)
    .set({ openingBalance: String(tmTotal - othersTotal.TM) })
    .where(eq(s.treasuryAccounts.id, tmAccountId));
  await db.update(s.treasuryAccounts)
    .set({ openingBalance: String(companyTotal - othersTotal.COMPANY) })
    .where(eq(s.treasuryAccounts.id, companyAccountId));
}

/**
 * Only this suite's two fixture users: the shared dev DB has many other
 * financial users, and the notice legitimately fans out to every one of them.
 */
const FIXTURE_USER_IDS = () => [accountantId, driverId];

async function fundNotifications() {
  return db.select({
    id: s.notifications.id,
    userId: s.notifications.userId,
    title: s.notifications.title,
    message: s.notifications.message,
    relatedEntityType: s.notifications.relatedEntityType,
  })
    .from(s.notifications)
    .where(and(
      eq(s.notifications.type, 'FUND_NEGATIVE'),
      inArray(s.notifications.userId, FIXTURE_USER_IDS()),
    ));
}

/**
 * Reset the service's dedupe unit: one notice per Vietnam business date, which
 * the service counts across ALL recipients. FUND_NEGATIVE is introduced by this
 * card and only this suite writes it, so clearing the whole type here cannot
 * touch anyone else's rows.
 */
async function clearFundNotifications() {
  await db.delete(s.notifications).where(eq(s.notifications.type, 'FUND_NEGATIVE'));
}

describe('fundNegativeAlertMessage', () => {
  test('quotes both balances and repeats the overview strip wording', () => {
    const message = fundNegativeAlertMessage({ tm: -1_500_000, company: -2_500_000 });
    // Same leading clause the "Quỹ âm" strip renders…
    assert.match(message, /^Cả hai quỹ đều âm — cần bổ sung dòng tiền ngay\./);
    // …then both funds, so the bell cannot under-report a single-fund problem.
    assert.match(message, /Quỹ TM -1\.500\.000 ₫/);
    assert.match(message, /Quỹ công ty -2\.500\.000 ₫/);
  });
});

describe('runFundNegativeAlerts (card 051026231511)', () => {
  test('emits one notice quoting both balances when BOTH funds are negative', async () => {
    await clearFundNotifications();
    await setFundTotals(-1_500_000, -2_500_000);

    // The very condition the overview strip reads.
    const summary = await getMoneyAlertsSummary();
    assert.equal(summary.fundNegative, true);

    const stats = await runFundNegativeAlerts();
    assert.equal(stats.alerted, 1, 'one notification emitted');
    assert.equal(stats.failed, 0);

    const rows = await fundNotifications();
    assert.equal(rows.length, 1, 'exactly one fund notice in the bell');
    assert.equal(rows[0].title, FUND_NEGATIVE_ALERT_TITLE);
    assert.equal(rows[0].relatedEntityType, 'funds');
    // FINANCIAL_ROLES audience: the accountant is told, the driver is not.
    assert.equal(rows[0].userId, accountantId);
    assert.ok(!rows.some((row) => row.userId === driverId), 'drivers are not financial roles');
    // The message carries the authority's own numbers, not a second reading.
    assert.equal(rows[0].message, fundNegativeAlertMessage(summary.funds));
    assert.match(rows[0].message, /-1\.500\.000 ₫/);
    assert.match(rows[0].message, /-2\.500\.000 ₫/);
  });

  test('does NOT notify when only ONE fund is negative', async () => {
    await clearFundNotifications();
    await setFundTotals(-1_500_000, 900_000);
    assert.equal((await getMoneyAlertsSummary()).fundNegative, false, 'spec trap: one negative fund is not "Quỹ âm"');

    const stats = await runFundNegativeAlerts();
    assert.equal(stats.alerted, 0);
    assert.equal(stats.skipped, 1);
    assert.equal((await fundNotifications()).length, 0);
  });

  test('does NOT notify when both funds are positive or zero', async () => {
    for (const [tm, company] of [[1_000_000, 2_000_000], [0, 0]] as const) {
      await clearFundNotifications();
      await setFundTotals(tm, company);
      const stats = await runFundNegativeAlerts();
      assert.equal(stats.alerted, 0, `tm=${tm} company=${company}`);
      assert.equal((await fundNotifications()).length, 0, `tm=${tm} company=${company}`);
    }
  });

  test('dedupes per Vietnam business date — a second run does not re-notify', async () => {
    await clearFundNotifications();
    await setFundTotals(-1_500_000, -2_500_000);

    const first = await runFundNegativeAlerts();
    assert.equal(first.alerted, 1);
    const second = await runFundNegativeAlerts();
    assert.equal(second.alerted, 0, 'same business date must not alert twice');
    assert.equal(second.skipped, 1);

    assert.equal((await fundNotifications()).length, 1);
  });
});

describe('the bell and the overview strip agree on "âm"', () => {
  test('the notice appears in exactly the states where the strip renders', async () => {
    // Walks the same sign matrix the overview strip is driven by and asserts
    // strip-visible ⇔ notice-emitted, one state at a time. This is the guard
    // against the two surfaces growing separate definitions.
    const cases: Array<{ name: string; tm: number; company: number; expectNotice: boolean }> = [
      { name: 'cả hai dương', tm: 1_000_000, company: 1_000_000, expectNotice: false },
      { name: 'chỉ TM âm', tm: -1_000_000, company: 1_000_000, expectNotice: false },
      { name: 'chỉ công ty âm', tm: 1_000_000, company: -1_000_000, expectNotice: false },
      { name: 'TM âm, công ty 0', tm: -1_000_000, company: 0, expectNotice: false },
      { name: 'cả hai âm', tm: -1_000_000, company: -1_000_000, expectNotice: true },
    ];

    for (const c of cases) {
      await clearFundNotifications();
      await setFundTotals(c.tm, c.company);

      // The overview strip's condition…
      const stripVisible = (await getMoneyAlertsSummary()).fundNegative;
      // …and the bell's.
      const stats = await runFundNegativeAlerts();
      const bellNotified = (await fundNotifications()).length > 0;

      assert.equal(stripVisible, c.expectNotice, `${c.name}: overview strip`);
      assert.equal(bellNotified, c.expectNotice, `${c.name}: bell notice`);
      assert.equal(stats.alerted, c.expectNotice ? 1 : 0, `${c.name}: run stats`);
    }
  });

  test('the notification row carries a Vietnam-business-date-scoped dedupe key', async () => {
    await clearFundNotifications();
    await setFundTotals(-1_000_000, -1_000_000);
    await runFundNegativeAlerts();

    // The dedupe projects createdAt in Vietnam time; assert the projection the
    // service relies on resolves to the business date the run used.
    const [row] = await db.select({ businessDate: sql<string>`(${s.notifications.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date` })
      .from(s.notifications)
      .where(and(
        eq(s.notifications.type, 'FUND_NEGATIVE'),
        inArray(s.notifications.userId, FIXTURE_USER_IDS()),
      ))
      .limit(1);
    assert.ok(row, 'a fund notice exists');
    const expected = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    assert.equal(String(row.businessDate).slice(0, 10), expected);
  });
});