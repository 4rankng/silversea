// Ticket 18/11 Task 3.4 (SIL-859) — the CUS→Theo dõi hoàn cược auto-sync laws,
// pinned db-free where the service is pure (or takes an Executor stub):
// - recordDepositFromIntake validates the projected tiền cược (integer VN)
//   BEFORE any database access; a tracker row is created once per shipment
//   (idempotent re-entry), with trimmed names and Ngày cược = the VN calendar
//   day; a 0₫ projection still lands the row (KT fills the real amount later);
// - isCvOverdue anchors on Ngày cược (fallback createdAt), flips past the 7th
//   VN calendar day, and never flags rows with a CV date or already settled.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CV_OVERDUE_DAYS,
  isCvOverdue,
  recordDepositFromIntake,
  type CvOverdueRow,
} from '../../services/deposit-refund-tracker.service';
import type { Database } from '../../db';

interface TrackerCalls {
  inserted: Array<Record<string, string>>;
  updated: Array<Record<string, string>>;
}

/** recordDepositFromIntake takes the pool-or-tx handle; the stub mirrors just
 *  the select/insert/update chain the function uses (same seam style as
 *  advisory-lock.test.ts's capturingExecutor — one named boundary cast). */
function trackerConn(rows: Array<Record<string, unknown>>, calls: TrackerCalls): Database {
  const stub = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rows,
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, string>) => ({
        returning: async () => {
          calls.inserted.push(values);
          return [{ id: 1, depositAmount: values.depositAmount }];
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, string>) => ({
        where: () => {
          calls.updated.push(values);
          return Promise.resolve();
        },
      }),
    }),
  };
  return stub as unknown as typeof db;
}

const BASE_INPUT = {
  shipmentId: 193,
  customerName: '  KH A  ',
  carrierName: '  Nhà xe B  ',
  billNumber: '  BL-777 ',
  expectedAmount: 500_000,
};

describe('recordDepositFromIntake — SIL-859 intake laws', () => {
  test('invalid projected amount rejects BEFORE touching the database', async () => {
    const poison = {
      select: () => { throw new Error('must not be reached'); },
    } as unknown as Database;
    for (const bad of [-1, 1000.5, Number.NaN]) {
      await assert.rejects(
        recordDepositFromIntake({ ...BASE_INPUT, expectedAmount: bad }, poison),
        (error: { status?: number; message?: string }) => {
          assert.equal(error.status, 400);
          assert.match(error.message ?? '', /Tiền cược dự kiến không hợp lệ/);
          return true;
        },
      );
    }
  });

  test('existing tracker row → no-op (idempotent re-entry)', async () => {
    const calls: TrackerCalls = { inserted: [], updated: [] };
    await recordDepositFromIntake(BASE_INPUT, trackerConn([{ id: 9 }], calls));
    assert.equal(calls.inserted.length, 0);
  });

  test('new row trims identities, stamps Ngày cược = VN calendar day, stores integer amount', async () => {
    const calls: TrackerCalls = { inserted: [], updated: [] };
    await recordDepositFromIntake(BASE_INPUT, trackerConn([], calls));
    const inserted = calls.inserted[0]!;
    assert.equal(inserted.shipmentId, 193);
    assert.equal(inserted.billNumber, 'BL-777');
    assert.equal(inserted.customerName, 'KH A');
    assert.equal(inserted.carrierName, 'Nhà xe B');
    assert.equal(inserted.depositAmount, '500000');
    assert.match(inserted.depositDate, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('a 0₫ projection still lands the row (KT fills the real amount later)', async () => {
    const calls: TrackerCalls = { inserted: [], updated: [] };
    await recordDepositFromIntake({ ...BASE_INPUT, expectedAmount: 0 }, trackerConn([], calls));
    assert.equal(calls.inserted[0]!.depositAmount, '0');
    assert.equal(calls.updated.length, 1, 'the 0₫ normalization update runs');
  });

  test('string amounts coerce to integers (the intake wire sends strings)', async () => {
    const calls: TrackerCalls = { inserted: [], updated: [] };
    await recordDepositFromIntake({ ...BASE_INPUT, expectedAmount: '350000' }, trackerConn([], calls));
    assert.equal(calls.inserted[0]!.depositAmount, '350000');
  });
});

describe('isCvOverdue — the banner count law (card 20260923_14)', () => {
  const day = (offsetDays: number, now = new Date('2026-11-19T04:00:00.000Z')): string => {
    const d = new Date(now.getTime() + 7 * 3_600_000 - offsetDays * 86_400_000);
    return d.toISOString().slice(0, 10);
  };
  const row = (overrides: Partial<CvOverdueRow> = {}): CvOverdueRow => ({
    status: 'CHUA_HOAN_CUOC',
    cvSubmittedDate: null,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    depositDate: null,
    ...overrides,
  });

  test(`overdue only past day ${CV_OVERDUE_DAYS}: 8 days flags, 7 does not`, () => {
    assert.equal(isCvOverdue(row({ depositDate: day(8) }), new Date('2026-11-19T04:00:00.000Z')), true);
    assert.equal(isCvOverdue(row({ depositDate: day(7) }), new Date('2026-11-19T04:00:00.000Z')), false);
  });

  test('rows without Ngày cược anchor on createdAt (legacy rows)', () => {
    // createdAt 2026-11-01 VN-day → 2026-11-19 is 18 days later.
    assert.equal(isCvOverdue(row(), new Date('2026-11-19T04:00:00.000Z')), true);
  });

  test('a CV date or a settled row never flags', () => {
    assert.equal(isCvOverdue(row({ cvSubmittedDate: day(30) }), new Date('2026-11-19T04:00:00.000Z')), false);
    assert.equal(isCvOverdue(row({ status: 'DA_HOAN_CUOC', depositDate: day(30) }), new Date('2026-11-19T04:00:00.000Z')), false);
  });
});
