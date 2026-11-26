// Ticket 18/11 Task 3.4 (SIL-859) — the CUS→Theo dõi hoàn cược auto-sync laws,
// pinned db-free where the service is pure (or takes an Executor stub):
// - recordDepositFromIntake validates the projected tiền cược (integer VN)
//   BEFORE any database access; a tracker row is created once per shipment
//   (idempotent re-entry), with trimmed names and Ngày cược = the VN calendar
//   day; a 0₫ projection still lands the row (KT fills the real amount later);
// - isCvOverdue anchors on Ngày cược ONLY (SIL-914: no ngày cược ⇒ the 7-day
//   clock has not started — never overdue), flips past the 7th VN calendar
//   day, and never flags rows with a CV date or already settled.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db';
import { ApiError } from '../../errors';
import {
  CV_OVERDUE_DAYS,
  depositTrackerListOrder,
  isCvOverdue,
  recordDepositFromIntake,
  updateDepositTrackerDates,
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
        (error: { statusCode?: number; message?: string }) => {
          assert.equal(error.statusCode, 400);
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

/** updateDepositTrackerDates chains select…for('update') → update…returning —
 *  a dedicated stub (same seam, two extra links). */
function datesConn(row: Record<string, unknown> | null, calls: { updated: Array<Record<string, unknown>>; audits: Array<Record<string, unknown>> }): Database {
  const stub = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            for: async () => (row ? [row] : []),
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            calls.updated.push(values);
            return [{ id: 1, ...row, ...values }];
          },
        }),
      }),
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        calls.audits.push(values);
        return [values];
      },
    }),
  };
  return stub as unknown as typeof db;
}

const KT = { userId: 7, role: 'ACCOUNTANT', fullName: 'Kế toán kho', username: 'kt-kho' } as Parameters<typeof updateDepositTrackerDates>[0];

// SIL-878 — the auto-intake row stamps Ngày cược = intake day; this law pins
// the KT correction surface: dd/mm/yy and ISO normalize to ISO, undefined
// keeps the stored day, and clearing is allowed.
describe('updateDepositTrackerDates — Ngày cược edit law (SIL-878)', () => {
  const existing = {
    id: 1, depositDate: '2026-11-21', depositAmount: '0', cvSubmittedDate: null,
    expectedRefundDate: null, note: null, category: 'CUOC_CONTAINER', status: 'CHUA_HOAN_CUOC',
  };

  test('dd/mm/yy input normalizes to ISO in the update set', async () => {
    const calls = { updated: [] as Array<Record<string, unknown>>, audits: [] as Array<Record<string, unknown>> };
    await updateDepositTrackerDates(KT, 1, { depositDate: '05/11/26' }, datesConn(existing, calls) as never);
    assert.equal(calls.updated[0]!.depositDate, '2026-11-05');
    // CR-011 §6.4 — a date-only edit does not touch the amount, so no audit.
    assert.deepEqual(calls.audits, []);
  });

  test('undefined keeps the stored day, null clears it', async () => {
    const keep = { updated: [] as Array<Record<string, unknown>>, audits: [] as Array<Record<string, unknown>> };
    await updateDepositTrackerDates(KT, 1, { depositAmount: 500000 }, datesConn(existing, keep) as never);
    assert.equal(keep.updated[0]!.depositDate, '2026-11-21', 'omitted depositDate keeps the intake stamp');
    // CR-011 §6.4 — an amount change writes the audit row in the same tx,
    // with actor_name snapshotted from the actor's display name.
    assert.deepEqual(keep.audits, [{
      userId: 7, actorName: 'Kế toán kho', message: 'DEPOSIT_TRACKER_UPDATED', entityType: 'deposit_refund_tracker', entityId: 1,
      payload: { before: '0', after: '500000' },
    }]);

    const clear = { updated: [] as Array<Record<string, unknown>>, audits: [] as Array<Record<string, unknown>> };
    await updateDepositTrackerDates(KT, 1, { depositDate: null }, datesConn(existing, clear) as never);
    assert.equal(clear.updated[0]!.depositDate, null);
    assert.deepEqual(clear.audits, []);
  });

  test('CR-011 §6.4 — no audit when the amount is unchanged', async () => {
    const funded = { ...existing, depositAmount: '500000' };
    const calls = { updated: [] as Array<Record<string, unknown>>, audits: [] as Array<Record<string, unknown>> };
    await updateDepositTrackerDates(KT, 1, { depositAmount: 500000 }, datesConn(funded, calls) as never);
    assert.equal(calls.updated[0]!.depositAmount, '500000');
    assert.deepEqual(calls.audits, []);
  });

  test('a finished (đã hoàn cược) row is locked with 409', async () => {
    const calls = { updated: [] as Array<Record<string, unknown>>, audits: [] as Array<Record<string, unknown>> };
    await assert.rejects(
      updateDepositTrackerDates(KT, 1, { depositAmount: 500000 }, datesConn({ ...existing, status: 'DA_HOAN_CUOC' }, calls) as never),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.message, 'Dòng đã hoàn cược — không thể chỉnh sửa.');
        return true;
      },
    );
    assert.deepEqual(calls.updated, []);
    assert.deepEqual(calls.audits, []);
  });

  test('a nonsense date rejects with the dd/mm/yy guidance', async () => {
    await assert.rejects(
      updateDepositTrackerDates(KT, 1, { depositDate: '11-05-2026' }, datesConn(existing, { updated: [], audits: [] }) as never),
      /Ngày phải theo mẫu dd\/mm\/yy/,
    );
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

  test('rows without Ngày cược never flag (SIL-914: the clock has no anchor)', () => {
    // createdAt 2026-11-01 VN-day is long past — but a row with no ngày cược
    // (the audit's JH202609258 case) must not be counted overdue on it.
    assert.equal(isCvOverdue(row(), new Date('2026-11-19T04:00:00.000Z')), false);
    assert.equal(isCvOverdue(row({ createdAt: new Date('2026-09-01T00:00:00.000Z') }), new Date('2026-11-19T04:00:00.000Z')), false);
  });

  test('a CV date or a settled row never flags', () => {
    assert.equal(isCvOverdue(row({ cvSubmittedDate: day(30) }), new Date('2026-11-19T04:00:00.000Z')), false);
    assert.equal(isCvOverdue(row({ status: 'DA_HOAN_CUOC', depositDate: day(30) }), new Date('2026-11-19T04:00:00.000Z')), false);
  });
});

// SIL-963 — KB K6.34 §6.4: bảng Theo dõi hoàn cược sắp mặc định = chưa hoàn
// cược lên đầu, ngày xa nhất trước, ngày gần nhất sau. "Ngày" là cột NGÀY đang
// hiển thị (ngày cược ?? ngày tạo), KHÔNG phải expectedRefundDate — khóa ngày
// cũ đẩy dòng có ngày dự kiến hoàn lên trên dòng không có (PostgreSQL ASC =
// NULLS LAST). Pin the composed ORDER BY keys so the wrong key cannot return.
describe('depositTrackerListOrder — default board order (KB K6.34 §6.4)', () => {
  /** Render a drizzle SQL key to comparable text: raw string chunks joined
   *  with the column names they interpolate. */
  function orderKeyText(key: unknown): string {
    if (!key || typeof key !== 'object' || !('queryChunks' in key)) return '';
    const chunks = Array.isArray(key.queryChunks) ? key.queryChunks : [];
    return chunks.map((chunk) => {
      if (typeof chunk === 'string') return chunk;
      if (chunk && typeof chunk === 'object') {
        if ('value' in chunk && Array.isArray(chunk.value)) return chunk.value.join('');
        if ('name' in chunk && typeof chunk.name === 'string') return chunk.name;
      }
      return '';
    }).join('');
  }

  test('chưa-hoàn-cược trước, cột NGÀY (ngày cược ?? ngày tạo) tăng dần, id gỡ hòa', () => {
    assert.equal(depositTrackerListOrder.length, 3);
    const [groupKey, dateKey, tieKey] = depositTrackerListOrder.map(orderKeyText);
    assert.ok(groupKey.includes('CHUA_HOAN_CUOC'), groupKey);
    assert.ok(dateKey.includes('coalesce'), dateKey);
    assert.ok(dateKey.includes('deposit_date'), dateKey);
    assert.ok(dateKey.includes('created_at'), dateKey);
    assert.ok(dateKey.includes('asc'), dateKey);
    // The regression itself: the NGÀY column owns the date key — a bare
    // expectedRefundDate key must never come back.
    assert.ok(!dateKey.includes('expected_refund_date'), dateKey);
    assert.ok(tieKey.includes('id'), tieKey);
  });
});
