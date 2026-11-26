import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShipmentLotStatus, type ShipmentLotStatusSummary } from '@tingting/shared';
import { ShipmentLotStatusBlock } from './ShipmentLotStatusBlock';

/**
 * SIL-1095 (KB §1.4.3, K1.13) — the chi tiết lô status block: five SEPARATE
 * rows in KB order, never merged into one state; every lane always renders
 * (QA: lô 167 had no status area at all), and a lane the wire does not carry
 * reads '—' — absence is not data.
 */

const summary = (over: Partial<ShipmentLotStatusSummary> = {}): ShipmentLotStatusSummary => ({
  entries: [
    { status: ShipmentLotStatus.GHI_NHAN_CHI_PHI, label: 'Ghi nhận chi phí', state: 'Chưa xác nhận', detail: '2/5 khoản chi', tone: 'warn' },
    { status: ShipmentLotStatus.THIEU_CHUNG_TU, label: 'Thiếu chứng từ', state: 'Còn thiếu', detail: 'Hồ sơ gốc: Còn thiếu — Thiếu: Vận đơn', tone: 'warn' },
    { status: ShipmentLotStatus.HOAN_THANH_VAN_CHUYEN, label: 'Hoàn thành vận chuyển', state: 'Hoàn thành', detail: null, tone: 'ok' },
    { status: ShipmentLotStatus.DA_THANH_TOAN, label: 'Đã thanh toán', state: 'Đã thanh toán', detail: null, tone: 'ok' },
    { status: ShipmentLotStatus.DA_KHOA_KY, label: 'Đã khóa kỳ', state: 'Đã khóa kỳ 2026-10', detail: null, tone: 'ok' },
  ],
  ...over,
});

describe('ShipmentLotStatusBlock — 5 trạng thái tách biệt (SIL-1095)', () => {
  it('renders all five KB lanes in order with their label + derived state', () => {
    render(<ShipmentLotStatusBlock statusSummary={summary()} />);
    const region = screen.getByRole('region', { name: 'Trạng thái lô' });
    const labels = ['Ghi nhận chi phí', 'Thiếu chứng từ', 'Hoàn thành vận chuyển', 'Đã thanh toán', 'Đã khóa kỳ'];
    const rows = Array.from(region.querySelectorAll('.shipment-lot-status__row'));
    expect(rows).toHaveLength(5);
    rows.forEach((row, index) => {
      expect(row.querySelector('.shipment-lot-status__label')?.textContent).toBe(labels[index]);
    });
    expect(region.textContent).toContain('Chưa xác nhận');
    expect(region.textContent).toContain('2/5 khoản chi');
    expect(region.textContent).toContain('Đã khóa kỳ 2026-10');
  });

  it('never merges the lanes: no combined summary state stands in for the five rows', () => {
    render(<ShipmentLotStatusBlock statusSummary={summary()} />);
    const region = screen.getByRole('region', { name: 'Trạng thái lô' });
    // Each lane keeps its own row — the block is five answers, not one.
    expect(region.querySelectorAll('.shipment-lot-status__row')).toHaveLength(5);
  });

  it('a lane the wire does not carry reads "—" — the five rows never vanish', () => {
    render(<ShipmentLotStatusBlock />);
    const region = screen.getByRole('region', { name: 'Trạng thái lô' });
    const states = Array.from(region.querySelectorAll('.shipment-lot-status__state'));
    expect(states).toHaveLength(5);
    for (const state of states) expect(state.textContent).toBe('—');
    // Labels are still the KB wording even on a stale wire.
    expect(region.textContent).toContain('Hoàn thành vận chuyển');
    expect(region.textContent).toContain('Đã khóa kỳ');
  });

  it('renders the supporting detail line when the lane carries one', () => {
    render(<ShipmentLotStatusBlock statusSummary={summary()} />);
    const region = screen.getByRole('region', { name: 'Trạng thái lô' });
    expect(region.textContent).toContain('Hồ sơ gốc: Còn thiếu — Thiếu: Vận đơn');
  });
});
