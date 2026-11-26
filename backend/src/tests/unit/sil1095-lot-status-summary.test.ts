// SIL-1095 (KB §1.4.3, K1.13) — the pure five-lane lot status law, pinned
// against the QA repro: lô 167 showed NO status area at all, and the bundle
// had zero hits for 'Hoàn thành vận chuyển' / 'Đã khóa kỳ'. Every lane
// derives from existing facts only; the five lanes are never merged.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ShipmentDocumentSetStatus,
  ShipmentLotStatus,
  TripPodStatus,
} from '@tingting/shared';
import { buildLotStatusSummary, type LotStatusFacts } from '../../services/shipment-status-summary-law';

const baseFacts = (): LotStatusFacts => ({
  cost: { total: 0, unconfirmed: 0, vouchered: 0 },
  documents: {
    documentSet: { status: ShipmentDocumentSetStatus.MISSING, missingDocuments: [] },
    podStatuses: [],
    phoiRows: [],
  },
  transport: { liveTrips: 0, completedTrips: 0 },
  payment: { obligations: [], asOfDate: '2026-11-26' },
  period: { roundPeriodKey: null, roundLockStatus: null, sourceLocks: [] },
});

function laneOf(facts: LotStatusFacts, status: ShipmentLotStatus) {
  const summary = buildLotStatusSummary(facts);
  return summary.entries.find((entry) => entry.status === status);
}

test('K1.13: the summary is ALWAYS five lanes, in KB order, never merged', () => {
  const summary = buildLotStatusSummary(baseFacts());
  assert.deepEqual(
    summary.entries.map((entry) => entry.status),
    [
      ShipmentLotStatus.GHI_NHAN_CHI_PHI,
      ShipmentLotStatus.THIEU_CHUNG_TU,
      ShipmentLotStatus.HOAN_THANH_VAN_CHUYEN,
      ShipmentLotStatus.DA_THANH_TOAN,
      ShipmentLotStatus.DA_KHOA_KY,
    ],
  );
  assert.deepEqual(
    summary.entries.map((entry) => entry.label),
    ['Ghi nhận chi phí', 'Thiếu chứng từ', 'Hoàn thành vận chuyển', 'Đã thanh toán', 'Đã khóa kỳ'],
  );
});

test('K1.13: lot 167 regression — an empty-facts lot still carries all five entries with a defined state', () => {
  const summary = buildLotStatusSummary(baseFacts());
  for (const entry of summary.entries) {
    assert.ok(entry.state.trim().length > 0, `lane ${entry.status} must render a state, never vanish`);
  }
});

test('lane 1 (Ghi nhận chi phí) — unconfirmed cost rows warn with the fraction', () => {
  const entry = laneOf(baseFacts(), ShipmentLotStatus.GHI_NHAN_CHI_PHI);
  assert.equal(entry?.state, 'Chưa có khoản chi');

  const facts = baseFacts();
  facts.cost = { total: 4, unconfirmed: 2, vouchered: 1 };
  const warn = laneOf(facts, ShipmentLotStatus.GHI_NHAN_CHI_PHI);
  assert.equal(warn?.state, 'Chưa xác nhận');
  assert.equal(warn?.tone, 'warn');
  assert.ok((warn?.detail ?? '').includes('2/4'));

  facts.cost = { total: 4, unconfirmed: 0, vouchered: 4 };
  const ok = laneOf(facts, ShipmentLotStatus.GHI_NHAN_CHI_PHI);
  assert.equal(ok?.state, 'Đã xác nhận');
  assert.equal(ok?.tone, 'ok');
});

test('lane 2 (Thiếu chứng từ) — names the missing documents (Lớp 2) + e-POD + phơi', () => {
  const facts = baseFacts();
  facts.documents = {
    documentSet: { status: ShipmentDocumentSetStatus.MISSING, missingDocuments: ['Bill gốc', 'Hợp đồng'] },
    podStatuses: [TripPodStatus.PENDING_CUSTOMER, null],
    phoiRows: [{ phoiTakenDate: null }, { phoiTakenDate: '2026-11-20' }],
  };
  const entry = laneOf(facts, ShipmentLotStatus.THIEU_CHUNG_TU);
  assert.equal(entry?.state, 'Còn thiếu');
  assert.equal(entry?.tone, 'warn');
  assert.match(entry?.detail ?? '', /Bill gốc, Hợp đồng/);
  assert.match(entry?.detail ?? '', /e-POD/);
  assert.match(entry?.detail ?? '', /Chưa nhận phơi 1\/2/);

  facts.documents = {
    documentSet: { status: ShipmentDocumentSetStatus.COMPLETE, missingDocuments: [] },
    podStatuses: [TripPodStatus.ACCEPTED],
    phoiRows: [{ phoiTakenDate: '2026-11-20' }],
  };
  const ok = laneOf(facts, ShipmentLotStatus.THIEU_CHUNG_TU);
  assert.equal(ok?.state, 'Đã đủ');
  assert.equal(ok?.tone, 'ok');
});

test('lane 3 (Hoàn thành vận chuyển) — derives from trip completion counts', () => {
  const facts = baseFacts();
  let entry = laneOf(facts, ShipmentLotStatus.HOAN_THANH_VAN_CHUYEN);
  assert.equal(entry?.state, 'Chưa có chuyến vận chuyển');

  facts.transport = { liveTrips: 3, completedTrips: 1 };
  entry = laneOf(facts, ShipmentLotStatus.HOAN_THANH_VAN_CHUYEN);
  assert.equal(entry?.state, 'Đang vận chuyển');
  assert.match(entry?.detail ?? '', /1\/3/);

  facts.transport = { liveTrips: 3, completedTrips: 3 };
  entry = laneOf(facts, ShipmentLotStatus.HOAN_THANH_VAN_CHUYEN);
  assert.equal(entry?.state, 'Hoàn thành');
  assert.equal(entry?.tone, 'ok');
});

test('lane 4 (Đã thanh toán) — paid / unpaid / overdue from receivable obligations', () => {
  const facts = baseFacts();
  let entry = laneOf(facts, ShipmentLotStatus.DA_THANH_TOAN);
  assert.equal(entry?.state, 'Chưa phát sinh công nợ');

  facts.payment.obligations = [{ outstanding: 0, effectiveDueDate: '2026-11-01' }];
  entry = laneOf(facts, ShipmentLotStatus.DA_THANH_TOAN);
  assert.equal(entry?.state, 'Đã thanh toán');
  assert.equal(entry?.tone, 'ok');

  facts.payment.obligations = [{ outstanding: 1200000, effectiveDueDate: '2026-12-15' }];
  entry = laneOf(facts, ShipmentLotStatus.DA_THANH_TOAN);
  assert.equal(entry?.state, 'Chưa thanh toán');
  assert.equal(entry?.tone, 'warn');
  assert.match(entry?.detail ?? '', /1\.200\.000/);

  facts.payment.obligations = [{ outstanding: 1200000, effectiveDueDate: '2026-11-01' }];
  entry = laneOf(facts, ShipmentLotStatus.DA_THANH_TOAN);
  assert.equal(entry?.state, 'Nợ quá hạn');
  assert.equal(entry?.tone, 'danger');
});

test('lane 5 (Đã khóa kỳ) — period lock law, never the lot cost lock', () => {
  const facts = baseFacts();
  let entry = laneOf(facts, ShipmentLotStatus.DA_KHOA_KY);
  assert.equal(entry?.state, 'Chưa vào kỳ nào');

  facts.period = { roundPeriodKey: '2026-11', roundLockStatus: null, sourceLocks: [] };
  entry = laneOf(facts, ShipmentLotStatus.DA_KHOA_KY);
  assert.equal(entry?.state, 'Đã vào kỳ 2026-11 — chưa khóa');

  facts.period = { roundPeriodKey: '2026-11', roundLockStatus: 'CLOSED', sourceLocks: [] };
  entry = laneOf(facts, ShipmentLotStatus.DA_KHOA_KY);
  assert.equal(entry?.state, 'Đã khóa kỳ 2026-11');
  assert.equal(entry?.tone, 'ok');

  facts.period = { roundPeriodKey: '2026-11', roundLockStatus: 'REOPENED', sourceLocks: [] };
  entry = laneOf(facts, ShipmentLotStatus.DA_KHOA_KY);
  assert.match(entry?.state ?? '', /đã mở lại/);

  facts.period = { roundPeriodKey: null, roundLockStatus: null, sourceLocks: [{ periodKey: '2026-10', status: 'CLOSED' }] };
  entry = laneOf(facts, ShipmentLotStatus.DA_KHOA_KY);
  assert.equal(entry?.state, 'Đã khóa kỳ 2026-10');
});
