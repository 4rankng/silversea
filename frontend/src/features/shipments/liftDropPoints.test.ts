import { describe, expect, it } from 'vitest';
import { resolveLiftDropPoints } from './liftDropPoints';

/**
 * FB-105 §3 (card 171026115800) — the ONE lift/drop rule shared by the create
 * form payload, Kế hoạch Tổng quát, Kế hoạch Chi tiết Xe and the lot detail.
 * Pins the direction swap for LCL and the never-swap guarantee for FCL.
 */
describe('resolveLiftDropPoints', () => {
  it('gives an LCL Nhập khẩu lot Kho = Nâng and Nhà máy = Hạ', () => {
    expect(resolveLiftDropPoints({
      cargoMode: 'LCL',
      tradeDirection: 'IMPORT',
      warehouseName: 'Kho lấy hàng (CFS)',
      factoryName: 'Nhà máy A',
    })).toEqual({ lift: 'Kho lấy hàng (CFS)', drop: 'Nhà máy A' });
  });

  it('swaps the two sides for an LCL Xuất khẩu lot (Nhà máy = Nâng, Kho = Hạ)', () => {
    expect(resolveLiftDropPoints({
      cargoMode: 'LCL',
      tradeDirection: 'EXPORT',
      warehouseName: 'Kho trả hàng (CFS)',
      factoryName: 'Nhà máy A',
    })).toEqual({ lift: 'Nhà máy A', drop: 'Kho trả hàng (CFS)' });
  });

  it('backs each half up with the stored free-text point when its site was never picked', () => {
    // The fallbacks are per-half, not per-site: the payload builder writes the
    // typed names direction-aware (pickup_location = lift half), so the typed
    // Kho backs up the lift of a Nhập lot and the typed Nhà máy the lift of a
    // Xuất lot.
    expect(resolveLiftDropPoints({
      cargoMode: 'LCL',
      tradeDirection: 'IMPORT',
      warehouseName: null,
      factoryName: 'Nhà máy A',
      liftFallback: 'Kho CFS gõ tay',
      dropFallback: 'Nhà máy gõ tay',
    })).toEqual({ lift: 'Kho CFS gõ tay', drop: 'Nhà máy A' });
    expect(resolveLiftDropPoints({
      cargoMode: 'LCL',
      tradeDirection: 'EXPORT',
      warehouseName: 'Kho trả hàng (CFS)',
      factoryName: null,
      liftFallback: 'Nhà máy gõ tay',
      dropFallback: 'Kho CFS gõ tay',
    })).toEqual({ lift: 'Nhà máy gõ tay', drop: 'Kho trả hàng (CFS)' });
  });

  it('reads an unknown direction like Nhập and reports null only when nothing is known', () => {
    expect(resolveLiftDropPoints({
      cargoMode: 'LCL',
      tradeDirection: null,
      warehouseName: 'Kho lấy hàng (CFS)',
      factoryName: 'Nhà máy A',
    })).toEqual({ lift: 'Kho lấy hàng (CFS)', drop: 'Nhà máy A' });
    expect(resolveLiftDropPoints({ cargoMode: 'LCL', tradeDirection: 'IMPORT' }))
      .toEqual({ lift: null, drop: null });
  });

  it('keeps the FCL container port pair as-is — never swapped, never LCL-mapped', () => {
    expect(resolveLiftDropPoints({
      cargoMode: 'FCL',
      tradeDirection: 'EXPORT',
      warehouseName: 'Kho trả hàng (CFS)',
      factoryName: 'Nhà máy A',
      containerLiftNames: ['Cảng A', 'Cảng A', null],
      containerDropNames: ['Cảng B'],
    })).toEqual({ lift: 'Cảng A', drop: 'Cảng B' });
  });

  it('joins distinct FCL port names in first-seen order and falls back per half', () => {
    expect(resolveLiftDropPoints({
      cargoMode: 'FCL',
      containerLiftNames: ['Cảng A', 'Cảng B', 'Cảng A'],
      containerDropNames: [null, '  '],
      dropFallback: 'Cảng hạ gõ tay',
    })).toEqual({ lift: 'Cảng A · Cảng B', drop: 'Cảng hạ gõ tay' });
  });
});
