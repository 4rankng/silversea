/**
 * Card 261022093846 (Zalo khách 22/10) — lotLiftDropPoints: the two operating
 * points of a containerless LCL lot resolve from the LOT's own intake data
 * (kho CFS site + nhà máy), never from the per-container port pair the lot
 * cannot own. Direction rule mirrors the one frontend display rule
 * (`resolveLiftDropPoints`, user directive 2026-10-17): IMPORT đóng tại kho,
 * trả tại nhà máy; EXPORT reverses. The stored free-text pair backs up a half
 * whose catalog site was never picked; a lot with nothing stored answers
 * null/null so the workboard prints the explicit "—" pattern, never an
 * invented value (DRI-04: no silent fallback).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { lotLiftDropPoints } from '../../services/cus-shipment-workspace-reads.service';

const base = {
  tradeDirection: 'IMPORT' as const,
  warehouseSiteName: 'Kho CFS Long Biên',
  factoryName: 'Nhà máy ASKEY',
  pickupLocation: 'Bãi tự nhập',
  deliveryLocation: 'Kho khách tự trả',
};

describe('lotLiftDropPoints (card 261022093846)', () => {
  test('IMPORT: đóng tại kho (CFS/cảng), trả tại nhà máy', () => {
    assert.deepEqual(lotLiftDropPoints(base), {
      lift: 'Kho CFS Long Biên',
      drop: 'Nhà máy ASKEY',
    });
  });

  test('EXPORT: swapped — đóng tại nhà máy, trả tại kho', () => {
    assert.deepEqual(lotLiftDropPoints({ ...base, tradeDirection: 'EXPORT' }), {
      lift: 'Nhà máy ASKEY',
      drop: 'Kho CFS Long Biên',
    });
  });

  test('catalog site wins over the stored free text on its half', () => {
    assert.deepEqual(lotLiftDropPoints({ ...base, pickupLocation: 'Bãi đệm cũ' }), {
      lift: 'Kho CFS Long Biên',
      drop: 'Nhà máy ASKEY',
    });
  });

  test('an unpicked half falls back to its stored free text (lift side)', () => {
    assert.deepEqual(lotLiftDropPoints({ ...base, warehouseSiteName: null }), {
      lift: 'Bãi tự nhập',
      drop: 'Nhà máy ASKEY',
    });
    assert.deepEqual(
      lotLiftDropPoints({ ...base, tradeDirection: 'EXPORT', factoryName: null }),
      { lift: 'Bãi tự nhập', drop: 'Kho CFS Long Biên' },
    );
  });

  test('an unpicked half falls back to its stored free text (drop side)', () => {
    assert.deepEqual(lotLiftDropPoints({ ...base, factoryName: null }), {
      lift: 'Kho CFS Long Biên',
      drop: 'Kho khách tự trả',
    });
    assert.deepEqual(
      lotLiftDropPoints({ ...base, tradeDirection: 'EXPORT', warehouseSiteName: null }),
      { lift: 'Nhà máy ASKEY', drop: 'Kho khách tự trả' },
    );
  });

  test('unknown direction reads as the IMPORT branch, not a guess', () => {
    assert.deepEqual(lotLiftDropPoints({ ...base, tradeDirection: null }), {
      lift: 'Kho CFS Long Biên',
      drop: 'Nhà máy ASKEY',
    });
  });

  test('a lot with nothing stored answers null/null — no invented point', () => {
    assert.deepEqual(lotLiftDropPoints({
      tradeDirection: 'IMPORT',
      warehouseSiteName: null,
      factoryName: null,
      pickupLocation: null,
      deliveryLocation: null,
    }), { lift: null, drop: null });
  });
});
