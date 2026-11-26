// SIL-1095 (KB §1.4.3, K1.13) — the five-lane lot status summary law. Pure
// derivation, no db / app boot (BE unit-only law, 2026-10-19 ruling): each
// lane derives from its own facts, the five lanes never merge into one
// state, and the KB wording is the vocabulary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHIPMENT_DOCUMENT_SET_STATUS_LABELS,
  SHIPMENT_LOT_STATUS_LABELS,
  ShipmentDocumentSetStatus,
  ShipmentLotStatus,
  TripPodStatus,
} from '@tingting/shared';
import {
  buildLotStatusSummary,
  type LotStatusFacts,
} from '../../services/shipment-status-summary-law';

const facts = (over: Partial<LotStatusFacts> = {}): LotStatusFacts => ({
  cost: { total: 0, unconfirmed: 0, vouchered: 0 },
  documents: { documentSet: { status: ShipmentDocumentSetStatus.COMPLETE, missingDocuments: [] }, podStatuses: [], phoiRows: [] },
  transport: { liveTrips: 0, completedTrips: 0 },
  payment: { obligations: [], asOfDate: '2026-11-26' },
  period: { roundPeriodKey: null, roundLockStatus: null, sourceLocks: [] },
  ...over,
});

describe('SIL-1095 — buildLotStatusSummary: năm trạng thái tách biệt', () => {
  it('trả đủ 5 dòng theo đúng thứ tự + nhãn KB §1.4.3, không gộp', () => {
    const summary = buildLotStatusSummary(facts());
    assert.deepEqual(summary.entries.map((entry) => entry.status), [
      ShipmentLotStatus.GHI_NHAN_CHI_PHI,
      ShipmentLotStatus.THIEU_CHUNG_TU,
      ShipmentLotStatus.HOAN_THANH_VAN_CHUYEN,
      ShipmentLotStatus.DA_THANH_TOAN,
      ShipmentLotStatus.DA_KHOA_KY,
    ]);
    assert.deepEqual(summary.entries.map((entry) => entry.label), [
      'Ghi nhận chi phí',
      'Thiếu chứng từ',
      'Hoàn thành vận chuyển',
      'Đã thanh toán',
      'Đã khóa kỳ',
    ]);
    for (const entry of summary.entries) {
      assert.equal(entry.label, SHIPMENT_LOT_STATUS_LABELS[entry.status]);
    }
  });

  it('(1) Ghi nhận chi phí — chưa có / chưa xác nhận / đã xác nhận', () => {
    const empty = buildLotStatusSummary(facts()).entries[0];
    assert.equal(empty.state, 'Chưa có khoản chi');
    assert.equal(empty.tone, 'neutral');

    const pending = buildLotStatusSummary(facts({ cost: { total: 5, unconfirmed: 2, vouchered: 1 } })).entries[0];
    assert.equal(pending.state, 'Chưa xác nhận');
    assert.equal(pending.detail, '2/5 khoản chi');
    assert.equal(pending.tone, 'warn');

    const done = buildLotStatusSummary(facts({ cost: { total: 2, unconfirmed: 0, vouchered: 2 } })).entries[0];
    assert.equal(done.state, 'Đã xác nhận');
    assert.equal(done.detail, 'Đã lập 2/2 phiếu quyết toán');
    assert.equal(done.tone, 'ok');
  });

  it('(2) Thiếu chứng từ — đọc Lớp 2 + Lớp 1 + Lớp 3, nêu tên tài liệu thiếu', () => {
    const done = buildLotStatusSummary(facts()).entries[1];
    assert.equal(done.state, 'Đã đủ');
    assert.equal(done.tone, 'ok');

    const missing = buildLotStatusSummary(facts({
      documents: {
        documentSet: { status: ShipmentDocumentSetStatus.MISSING, missingDocuments: ['Vận đơn', 'Phiếu giao'] },
        podStatuses: [TripPodStatus.SUBMITTED],
        phoiRows: [{ phoiTakenDate: null }],
      },
    })).entries[1];
    assert.equal(missing.state, SHIPMENT_DOCUMENT_SET_STATUS_LABELS[ShipmentDocumentSetStatus.MISSING]);
    assert.equal(missing.tone, 'warn');
    assert.match(missing.detail ?? '', /Thiếu: Vận đơn, Phiếu giao/);
    assert.match(missing.detail ?? '', /e-POD: Chờ khách xác nhận/);
    assert.match(missing.detail ?? '', /Phơi: Chưa nhận phơi 1\/1/);

    const nameless = buildLotStatusSummary(facts({
      documents: {
        documentSet: { status: ShipmentDocumentSetStatus.MISSING, missingDocuments: [] },
        podStatuses: [],
        phoiRows: [],
      },
    })).entries[1];
    assert.match(nameless.detail ?? '', /Chưa ghi nhận danh mục/);

    // Lớp 2 đủ nhưng Lớp 3 chưa → dòng KHÔNG được xanh 'Đã đủ' (không gộp,
    // không im lặng): state lõi theo fact còn thiếu, detail chỉ từng lớp.
    const phoiOpen = buildLotStatusSummary(facts({
      documents: {
        documentSet: { status: ShipmentDocumentSetStatus.COMPLETE, missingDocuments: [] },
        podStatuses: [TripPodStatus.ACCEPTED],
        phoiRows: [{ phoiTakenDate: null }],
      },
    })).entries[1];
    assert.equal(phoiOpen.state, 'Còn thiếu');
    assert.match(phoiOpen.detail ?? '', /Hồ sơ gốc: Đã đủ/);
    assert.match(phoiOpen.detail ?? '', /Phơi: Chưa nhận phơi 1\/1/);
    assert.equal(phoiOpen.tone, 'warn');
  });

  it('(3) Hoàn thành vận chuyển — derive từ trạng thái chuyến', () => {
    const none = buildLotStatusSummary(facts()).entries[2];
    assert.equal(none.state, 'Chưa có chuyến vận chuyển');
    assert.equal(none.tone, 'neutral');

    const running = buildLotStatusSummary(facts({ transport: { liveTrips: 2, completedTrips: 1 } })).entries[2];
    assert.equal(running.state, 'Đang vận chuyển');
    assert.equal(running.detail, '1/2 chuyến hoàn thành');
    assert.equal(running.tone, 'neutral');

    const done = buildLotStatusSummary(facts({ transport: { liveTrips: 2, completedTrips: 2 } })).entries[2];
    assert.equal(done.state, 'Hoàn thành');
    assert.equal(done.tone, 'ok');
  });

  it('(4) Đã thanh toán — derive từ công nợ (đã trả đủ / còn nợ / quá hạn)', () => {
    const none = buildLotStatusSummary(facts()).entries[3];
    assert.equal(none.state, 'Chưa phát sinh công nợ');
    assert.equal(none.tone, 'neutral');

    const paid = buildLotStatusSummary(facts({
      payment: { obligations: [{ outstanding: 0, effectiveDueDate: '2026-12-01' }], asOfDate: '2026-11-26' },
    })).entries[3];
    assert.equal(paid.state, 'Đã thanh toán');
    assert.equal(paid.tone, 'ok');

    const open = buildLotStatusSummary(facts({
      payment: { obligations: [{ outstanding: 1500000, effectiveDueDate: '2026-12-01' }], asOfDate: '2026-11-26' },
    })).entries[3];
    assert.equal(open.state, 'Chưa thanh toán');
    assert.equal(open.detail, 'Còn nợ 1.500.000 ₫');
    assert.equal(open.tone, 'warn');

    const overdue = buildLotStatusSummary(facts({
      payment: { obligations: [{ outstanding: 1500000, effectiveDueDate: '2026-11-25' }], asOfDate: '2026-11-26' },
    })).entries[3];
    assert.equal(overdue.state, 'Nợ quá hạn');
    assert.equal(overdue.detail, 'Còn nợ 1.500.000 ₫');
    assert.equal(overdue.tone, 'danger');
  });

  it('(5) Đã khóa kỳ — đọc kỳ khóa kế toán, không hiển thị khóa lô', () => {
    const none = buildLotStatusSummary(facts()).entries[4];
    assert.equal(none.state, 'Chưa vào kỳ nào');
    assert.equal(none.tone, 'neutral');

    const inRound = buildLotStatusSummary(facts({
      period: { roundPeriodKey: '2026-10', roundLockStatus: null, sourceLocks: [] },
    })).entries[4];
    assert.equal(inRound.state, 'Đã vào kỳ 2026-10 — chưa khóa');
    assert.equal(inRound.tone, 'neutral');

    const locked = buildLotStatusSummary(facts({
      period: { roundPeriodKey: '2026-10', roundLockStatus: 'CLOSED', sourceLocks: [] },
    })).entries[4];
    assert.equal(locked.state, 'Đã khóa kỳ 2026-10');
    assert.equal(locked.tone, 'ok');

    // Legacy: Debit Note phát hành trước dòng chốt — khóa qua
    // billing_document_source_period_locks, vẫn là 'Đã khóa kỳ X'.
    const sourceLocked = buildLotStatusSummary(facts({
      period: {
        roundPeriodKey: null,
        roundLockStatus: null,
        sourceLocks: [{ periodKey: '2026-09', status: 'CLOSED' }, { periodKey: '2026-10', status: 'CLOSED' }],
      },
    })).entries[4];
    assert.equal(sourceLocked.state, 'Đã khóa kỳ 2026-10');
    assert.equal(sourceLocked.tone, 'ok');

    const reopened = buildLotStatusSummary(facts({
      period: { roundPeriodKey: '2026-10', roundLockStatus: 'REOPENED', sourceLocks: [] },
    })).entries[4];
    assert.equal(reopened.state, 'Kỳ 2026-10 đã mở lại');
    assert.equal(reopened.tone, 'warn');
  });
});
