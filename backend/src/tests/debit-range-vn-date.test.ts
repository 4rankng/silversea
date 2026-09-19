// The debit-note period convention (card 20260919_18): business days are
// VN-local calendar days. The [min,max] range stamps the VN calendar day of
// the selection's delivery dates — derived via the VN date component, never
// via toISOString on a zoned instant (an UTC-evening stamp would shift a VN
// morning back a day). These pins prove the boundary behavior is
// TZ-independent: the same instant produces the same VN day under both the
// UTC and the Asia/Ho_Chi_Minh process clocks.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { vnCalendarDay } from '../services/shipment-cost-lock.service';
import { disconnectRedis } from '../lib/redis';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// 2026-09-19T18:30:00Z is 2026-09-20 01:30 VN time: the UTC date says the
// 19th, the VN calendar says the 20th. The convention must say the 20th.
const EVENING_BOUNDARY = new Date('2026-09-19T18:30:00Z');
// 2026-09-19T16:59:00Z is 2026-09-19 23:59 VN — still the 19th in VN.
const VN_LAST_MINUTE = new Date('2026-09-19T16:59:00Z');

function spawnDay(tz: string): string {
  const child = spawnSync('npx', ['tsx', '--input-type=module', '-e',
    `const { vnCalendarDay } = await import('./src/services/shipment-cost-lock.service.ts');
     const b = new Date('2026-09-19T18:30:00Z');
     console.log(vnCalendarDay(b));`], {
    cwd: backendRoot, encoding: 'utf8', timeout: 90000,
    env: { ...process.env, TZ: tz, DATABASE_URL: 'postgres://postgres:postgres@localhost:5441/silversea', REDIS_URL: 'redis://localhost:6391' },
  });
  assert.equal(r_status(child), 0, `child must run under ${tz}`);
  return child.stdout.trim().split('\n').filter(Boolean).pop() ?? '';
}

function r_status(r: { status: number | null }): number {
  return r.status ?? 1;
}

before(async () => {});

after(async () => {
  await disconnectRedis();
});

describe('debit range VN calendar day', () => {
  test('evening boundary: VN day governs, not the UTC date', () => {
    assert.equal(vnCalendarDay(EVENING_BOUNDARY), '2026-09-20', 'VN 01:30 is the next calendar day');
    assert.equal(vnCalendarDay(VN_LAST_MINUTE), '2026-09-19', 'VN 23:59 is still that VN day');
  });

  test('the same instant reads the same VN day under TZ=UTC and TZ=Asia/Ho_Chi_Minh', () => {
    const utc = spawnDay('UTC');
    const vn = spawnDay('Asia/Ho_Chi_Minh');
    assert.equal(utc, '2026-09-20', `TZ=UTC process: ${utc}`);
    assert.equal(vn, '2026-09-20', `TZ=Asia/Ho_Chi_Minh process: ${vn}`);
  });
});
