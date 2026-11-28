// SIL-1245 (KB §2.3.1 giai đoạn 0) — "Lô chưa có container đã chuyển sang
// Sẵn sàng điều xe khi lưu lỗi số container": the edit save flipped READY on
// the ROOT save (SIL-642 derives the lot's closing date from the staged
// container rows) while the CONTAINERS save then 400'd on a bad check digit —
// a ready 0-container lot. The flip gate: a FCL lot with zero saved rows is
// stage 0 ("chưa đủ dữ liệu") and stays PENDING_DATE; LCL keeps its
// container-free readiness. Pure seam behavior + service wiring source pin
// (SIL-177 guard-pin precedent).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { editSaveBecomesReady } from '../../services/shipment-status-transitions.service';

const here = dirname(fileURLToPath(import.meta.url));
const updateSource = readFileSync(join(here, '..', '..', 'services', 'shipment-update.service.ts'), 'utf8');

const dated = { canonicalStatus: 'PENDING_DATE', cargoMode: 'FCL', hasUndatedContainer: false, hasDispatchDate: true };

describe('editSaveBecomesReady — lô thiếu container ở giai đoạn 0', () => {
  it('FCL 0 container + có ngày: KHÔNG ready (repro lô 1611)', () => {
    assert.equal(editSaveBecomesReady({ ...dated, containerCount: 0 }), false);
  });

  it('FCL đủ container đã có ngày: ready như cũ', () => {
    assert.equal(editSaveBecomesReady({ ...dated, containerCount: 1 }), true);
    assert.equal(editSaveBecomesReady({ ...dated, containerCount: 3 }), true);
  });

  it('FCL còn container thiếu ngày: không ready (luật cũ giữ nguyên)', () => {
    assert.equal(editSaveBecomesReady({ ...dated, containerCount: 2, hasUndatedContainer: true }), false);
  });

  it('LCL không có container rows vẫn ready được (hàng lẻ)', () => {
    assert.equal(editSaveBecomesReady({ ...dated, cargoMode: 'LCL', containerCount: 0 }), true);
    assert.equal(editSaveBecomesReady({ ...dated, cargoMode: null, containerCount: 0 }), true);
  });

  it('không có ngày vận chuyển hoặc lô đã rời PENDING_DATE: không flip', () => {
    assert.equal(editSaveBecomesReady({ ...dated, containerCount: 1, hasDispatchDate: false }), false);
    assert.equal(editSaveBecomesReady({ ...dated, containerCount: 1, canonicalStatus: 'READY_FOR_DISPATCH' }), false);
    assert.equal(editSaveBecomesReady({ ...dated, containerCount: 1, canonicalStatus: 'DISPATCHED' }), false);
  });
});

test('wiring: lot edit save đọc chung gate (không tự tính lại)', () => {
  assert.ok(updateSource.includes('const becomesReady = editSaveBecomesReady({'),
    'shipment-update.service must route its flip through the shared gate');
});
