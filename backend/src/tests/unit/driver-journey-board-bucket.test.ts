// SIL-822 — an ops-started trip (ops "Phát lệnh" flips CREATED →
// IN_TRANSIT without the driver's ORDER_RECEIVED milestone) is
// PHYSICALLY RUNNING: its truck is busy-blocked and the completion
// flow must be reachable. Bucketing it as NEW hid the only card the
// driver could complete — a stale ops-started trip stranded driver
// nhvuong's truck 15E-019.80 from 21 Sep 2026 (b_d.Phạm Trung Kiên
// report 13 Nov: "tài khoản đang chạy chuyển nhưng không có đơn nào
// để đánh dấu hoàn thành"). IN_TRANSIT must always present RUNNING;
// the missing acknowledgment is display nuance, never a bucket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketForStatus } from '../../services/driver-journey-board.service.js';

test('SIL-822: ops-started IN_TRANSIT trip (no ORDER_RECEIVED) buckets as RUNNING', () => {
  assert.equal(bucketForStatus('IN_TRANSIT', false), 'RUNNING');
});

test('acknowledged IN_TRANSIT trip stays RUNNING', () => {
  assert.equal(bucketForStatus('IN_TRANSIT', true), 'RUNNING');
});

test('CREATED stays NEW regardless of acknowledgment artifacts', () => {
  assert.equal(bucketForStatus('CREATED', false), 'NEW');
  assert.equal(bucketForStatus('CREATED', true), 'NEW');
});

test('terminal statuses stay HISTORY', () => {
  assert.equal(bucketForStatus('COMPLETED', false), 'HISTORY');
  assert.equal(bucketForStatus('CANCELED', true), 'HISTORY');
});
