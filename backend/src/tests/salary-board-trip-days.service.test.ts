import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  boardTripDayMapFromRows,
  countBoardMergedDayStatuses,
  mergeBoardTripDaysIntoWorkDays,
  monthBucketsInRange,
  type CompletedTripLabel,
  type LegacyWorkDayRow,
} from '../services/salary-board-trip-days.service';

function boardRow(overrides: Partial<{ symbol: string | null; workDate: string; tripAdjustment: number | null }> = {}) {
  return { symbol: 'Đ', workDate: '2026-11-02', tripAdjustment: null as number | null, ...overrides };
}

function workDay(overrides: Partial<LegacyWorkDayRow> = {}): LegacyWorkDayRow {
  return {
    id: 1,
    driverId: 7,
    date: '2026-11-02',
    status: 'STANDBY',
    tripId: null,
    note: null,
    ...overrides,
  };
}

describe('SIL-849 board trip days — monthBucketsInRange', () => {
  test('calendar month is one bucket', () => {
    assert.deepEqual(monthBucketsInRange('2026-11-01', '2026-11-30'), [{ year: 2026, month: 11 }]);
  });

  test('a custom period crossing months reads every month it touches', () => {
    assert.deepEqual(
      monthBucketsInRange('2026-10-26', '2026-11-25'),
      [{ year: 2026, month: 10 }, { year: 2026, month: 11 }],
    );
  });

  test('year boundary rolls over', () => {
    assert.deepEqual(
      monthBucketsInRange('2026-12-20', '2027-01-10'),
      [{ year: 2026, month: 12 }, { year: 2027, month: 1 }],
    );
  });
});

describe('SIL-849 board trip days — boardTripDayMapFromRows', () => {
  test('Đ/K count one trip day, Q counts one cell with two trips', () => {
    const map = boardTripDayMapFromRows([
      boardRow({ symbol: 'Đ', workDate: '2026-11-01' }), // Sunday trip still a trip day
      boardRow({ symbol: 'K', workDate: '2026-11-02' }),
      boardRow({ symbol: 'Q', workDate: '2026-11-03' }),
    ]);
    assert.deepEqual(
      [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      [['2026-11-01', 1], ['2026-11-02', 1], ['2026-11-03', 2]],
    );
  });

  test('L/N/P and empty cells carry no trip day', () => {
    const map = boardTripDayMapFromRows([
      boardRow({ symbol: 'L', workDate: '2026-11-04' }),
      boardRow({ symbol: 'N', workDate: '2026-11-05' }),
      boardRow({ symbol: 'P', workDate: '2026-11-06' }),
      boardRow({ symbol: null, workDate: '2026-11-07' }),
    ]);
    assert.equal(map.size, 0);
  });

  test("the accountant's signed adjustment applies like the salary math", () => {
    // Đ − 1 chuyến → 0 trips: not a trip day. Q − 1 → 1 trip: still a day.
    const map = boardTripDayMapFromRows([
      boardRow({ symbol: 'Đ', workDate: '2026-11-09', tripAdjustment: -1 }),
      boardRow({ symbol: 'Q', workDate: '2026-11-10', tripAdjustment: -1 }),
    ]);
    assert.deepEqual([...map.entries()], [['2026-11-10', 1]]);
  });
});

describe('SIL-849 board trip days — mergeBoardTripDaysIntoWorkDays', () => {
  const labels = new Map<string, CompletedTripLabel>([
    ['2026-11-01', { tripId: 101, tripCode: 'BL-1', routeName: 'KCN Đồng Văn' }],
    ['2026-11-17', { tripId: 102, tripCode: 'R3K-J2', routeName: 'KCN Quế Võ' }],
  ]);
  const board = new Map<string, number>([['2026-11-01', 1]]);

  test('board trip day is TRIP_DAY with the completed trip label', () => {
    const merged = mergeBoardTripDaysIntoWorkDays([], board, labels, 7);
    assert.deepEqual(merged, [{
      id: 0,
      driverId: 7,
      date: '2026-11-01',
      status: 'TRIP_DAY',
      tripId: 101,
      note: null,
    }]);
  });

  test('Sunday board trip day stays a trip day (Long: Đ on 1/11)', () => {
    assert.equal(mergeBoardTripDaysIntoWorkDays([], board, new Map(), 7)[0].status, 'TRIP_DAY');
  });

  test('board wins over a manual row; id and note survive', () => {
    const merged = mergeBoardTripDaysIntoWorkDays(
      [workDay({ id: 55, date: '2026-11-01', status: 'STANDBY', note: 'đèn báo' })],
      board,
      labels,
      7,
    );
    assert.deepEqual(merged, [{
      id: 55, driverId: 7, date: '2026-11-01', status: 'TRIP_DAY', tripId: 101, note: 'đèn báo',
    }]);
  });

  test('unconfirmed legacy TRIP_DAY demotes: weekday → STANDBY, Sunday → WEEKLY_OFF, trip link cleared', () => {
    const merged = mergeBoardTripDaysIntoWorkDays(
      [
        // Hiếu's orphaned multi-day run + reassigned lot the board never confirmed
        workDay({ id: 2, date: '2026-11-03', status: 'TRIP_DAY', tripId: 9, note: 'chưa có Bill' }),
        workDay({ id: 3, date: '2026-11-17', status: 'TRIP_DAY', tripId: 8 }), // Tuesday
        workDay({ id: 4, date: '2026-11-08', status: 'TRIP_DAY', tripId: 5 }), // Sunday, not on board
        workDay({ id: 6, date: '2026-11-05', status: 'PERSONAL_LEAVE' }), // manual leave untouched
      ],
      board,
      labels,
      7,
    );
    const byDate = new Map(merged.map(row => [row.date, row]));
    assert.equal(byDate.get('2026-11-03')?.status, 'STANDBY');
    assert.equal(byDate.get('2026-11-03')?.tripId, null);
    assert.equal(byDate.get('2026-11-03')?.note, 'chưa có Bill');
    assert.equal(byDate.get('2026-11-17')?.status, 'STANDBY');
    assert.equal(byDate.get('2026-11-08')?.status, 'WEEKLY_OFF');
    assert.equal(byDate.get('2026-11-01')?.status, 'TRIP_DAY'); // board-confirmed Sunday trip stays
    assert.equal(byDate.get('2026-11-05')?.status, 'PERSONAL_LEAVE');
    assert.deepEqual(merged.map(row => row.date), ['2026-11-01', '2026-11-03', '2026-11-05', '2026-11-08', '2026-11-17']);
  });

  test('manual PERSONAL_LEAVE on a board trip day is overridden by the board', () => {
    const merged = mergeBoardTripDaysIntoWorkDays(
      [workDay({ id: 9, date: '2026-11-01', status: 'PERSONAL_LEAVE', note: 'nghỉ' })],
      board,
      labels,
      7,
    );
    assert.deepEqual(merged, [{
      id: 9, driverId: 7, date: '2026-11-01', status: 'TRIP_DAY', tripId: 101, note: 'nghỉ',
    }]);
  });

  test('board day without a completed trip is still a trip day, label-less', () => {
    // MANUAL board cell the trips do not evidence yet — the split counts it,
    // the cell paints green without a code, deterministically.
    const merged = mergeBoardTripDaysIntoWorkDays([], board, new Map(), 7);
    assert.deepEqual(merged, [{
      id: 0, driverId: 7, date: '2026-11-01', status: 'TRIP_DAY', tripId: null, note: null,
    }]);
  });
});

describe('SIL-849 round 2 — countBoardMergedDayStatuses (standby/weeklyOff recompute)', () => {
  // Nov 2026: 30 days, Sundays = 1, 8, 15, 22, 29.

  test('Long: board Sunday trip overrides the WEEKLY_OFF row; defaults fill the rest (24/5)', () => {
    // Legacy rows before the board merged: 1/11 was painted 'Nghỉ tuần'
    // (weeklyOffDays snapshot 6 = 1 + manual 4/11 + Sunday defaults), the
    // board now confirms Đ on 1/11 so the record must recount from the merge.
    const workDays = [
      workDay({ id: 1, driverId: 40, date: '2026-11-01', status: 'WEEKLY_OFF' }),
      workDay({ id: 2, driverId: 40, date: '2026-11-04', status: 'WEEKLY_OFF' }),
    ];
    const board = new Map([['2026-11-01', 1]]);
    const counts = countBoardMergedDayStatuses(
      '2026-11-01',
      '2026-11-30',
      mergeBoardTripDaysIntoWorkDays(workDays, board, new Map(), 40),
    );
    assert.deepEqual(counts, { tripDays: 1, standbyDays: 24, weeklyOffDays: 5 });
  });

  test('Hiếu: orphan legacy TRIP_DAY rows demote to Sunday defaults; Q cell = one trip day (25/4)', () => {
    // Legacy rows: departure→arrival sync painted 1, 8, 15 TRIP_DAY
    // (weeklyOffDays snapshot 2 = 22 + 29 only); the board confirms only the
    // 15/11 Q cell (2 trips on one day), so 1/11 + 8/11 demote to their
    // Sunday default and the record must recount 4 weekly-off days.
    const workDays = [
      workDay({ id: 1, driverId: 15, date: '2026-11-01', status: 'TRIP_DAY', tripId: 5 }),
      workDay({ id: 2, driverId: 15, date: '2026-11-08', status: 'TRIP_DAY', tripId: 5 }),
      workDay({ id: 3, driverId: 15, date: '2026-11-15', status: 'TRIP_DAY', tripId: 8 }),
      workDay({ id: 4, driverId: 15, date: '2026-11-22', status: 'WEEKLY_OFF' }),
      workDay({ id: 5, driverId: 15, date: '2026-11-29', status: 'WEEKLY_OFF' }),
    ];
    const board = boardTripDayMapFromRows([boardRow({ symbol: 'Q', workDate: '2026-11-15' })]);
    assert.equal(board.get('2026-11-15'), 2); // Q weights 2 trips, still 1 trip DAY
    const counts = countBoardMergedDayStatuses(
      '2026-11-01',
      '2026-11-30',
      mergeBoardTripDaysIntoWorkDays(workDays, board, new Map(), 15),
    );
    assert.deepEqual(counts, { tripDays: 1, standbyDays: 25, weeklyOffDays: 4 });
  });

  test('no board and no rows: the whole period takes its attendance defaults', () => {
    assert.deepEqual(
      countBoardMergedDayStatuses('2026-11-01', '2026-11-30', []),
      { tripDays: 0, standbyDays: 25, weeklyOffDays: 5 },
    );
  });
});
