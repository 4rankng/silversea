// SIL-1094 (KB §3.6.5 K3.87 + §6.3 K6.32) — the Debit Note merge-note law:
// a rev-group member lot's row carries "Ghép xe cùng Bill [Số Bill Lô 1]"
// (the Lô 1 reference = Bill → booking → mã lô); Lô 1 and ungrouped lots
// keep no note (absence is not data). The frozen builder stamps the note
// onto every printed line's renderData (the GHI CHÚ column reads it).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REV_GROUP_MERGE_NOTE,
  revGroupMergeNote,
} from '../../services/rev-group-merge-note.service';
import { buildFrozenShipmentDebitLines } from '../../services/shipment-cost-lock-lines';

const PRINCIPALS = new Map([['g1', 'R39B1-LCL02']]);

describe('revGroupMergeNote — luật chú thích dòng lô ghép', () => {
  test('lô thành viên (order > 1) mang "Ghép xe cùng Bill [Số Bill Lô 1]"', () => {
    assert.equal(REV_GROUP_MERGE_NOTE, 'Ghép xe cùng Bill');
    assert.equal(
      revGroupMergeNote({ revGroupId: 'g1', revGroupOrder: 2 }, PRINCIPALS),
      'Ghép xe cùng Bill R39B1-LCL02',
    );
  });

  test('Lô 1 (order 1) và lô không ghép KHÔNG mang chú thích', () => {
    assert.equal(revGroupMergeNote({ revGroupId: 'g1', revGroupOrder: 1 }, PRINCIPALS), null);
    assert.equal(revGroupMergeNote({ revGroupId: 'g1', revGroupOrder: null }, PRINCIPALS), null);
    assert.equal(revGroupMergeNote(undefined, PRINCIPALS), null);
  });

  test('thành viên nhưng thiếu ref Lô 1 ⇒ chuỗi rỗng bị trim — không bịa số Bill', () => {
    assert.equal(
      revGroupMergeNote({ revGroupId: 'g-khac', revGroupOrder: 2 }, PRINCIPALS),
      'Ghép xe cùng Bill',
    );
  });

  test('buildFrozenShipmentDebitLines dập chú thích vào renderData.note của dòng phát hành', () => {
    const lines = buildFrozenShipmentDebitLines(
      { receivableTotal: 1_200_000, freightAuto: 1_200_000, chiHoTotal: 0 },
      'R39B1-LCL01',
      {
        billingTruckNo: '29C-111.11',
        vehicleType: 'Xe tải 5 tấn',
        note: revGroupMergeNote({ revGroupId: 'g1', revGroupOrder: 2 }, PRINCIPALS),
      },
    );
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.equal(line.renderData?.note, 'Ghép xe cùng Bill R39B1-LCL02');
      assert.equal(line.renderData?.truckPlate, '29C-111.11');
    }
  });

  test('lô không ghép: renderData.note = null (không ghi chú rỗng)', () => {
    const lines = buildFrozenShipmentDebitLines(
      { receivableTotal: 500_000, freightAuto: 500_000, chiHoTotal: 0 },
      'R39B1-FCL09',
      { billingTruckNo: null, note: revGroupMergeNote(undefined, PRINCIPALS) },
    );
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.equal(line.renderData?.note, null);
    }
  });
});
