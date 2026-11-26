import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShipmentLotStatusBlock } from './ShipmentLotStatusBlock';
import { ShipmentLotStatus, type ShipmentLotStatusSummary } from '@tingting/shared';

/**
 * SIL-1095 (KB §1.4.3, K1.13) — the chi tiết lô five-lane status block, fed
 * by fixtures shaped like the BE wire (the statusSummary getShipmentDetail
 * now carries). QA repro: lô 167 rendered NO status area at all, and the
 * bundle had zero hits for 'Hoàn thành vận chuyển' / 'Đã khóa kỳ'.
 */

function entry(status: ShipmentLotStatus, state: string, detail: string | null, tone: 'ok' | 'warn' | 'danger' | 'neutral') {
  return { status, label: '', state, detail, tone };
}

const summaryOf = (entries: ReturnType<typeof entry>[]): ShipmentLotStatusSummary => ({ entries });

const transportCompleted: ShipmentLotStatusSummary = summaryOf([
  entry(ShipmentLotStatus.GHI_NHAN_CHI_PHI, 'Đã xác nhận', null, 'ok'),
  entry(ShipmentLotStatus.THIEU_CHUNG_TU, 'Đã đủ', null, 'ok'),
  entry(ShipmentLotStatus.HOAN_THANH_VAN_CHUYEN, 'Hoàn thành', null, 'ok'),
  entry(ShipmentLotStatus.DA_THANH_TOAN, 'Chưa thanh toán', 'Còn nợ 2.000.000 ₫', 'warn'),
  entry(ShipmentLotStatus.DA_KHOA_KY, 'Chưa vào kỳ nào', null, 'neutral'),
]);

const lockedPeriod: ShipmentLotStatusSummary = summaryOf([
  entry(ShipmentLotStatus.GHI_NHAN_CHI_PHI, 'Đã xác nhận', null, 'ok'),
  entry(ShipmentLotStatus.THIEU_CHUNG_TU, 'Đã đủ', null, 'ok'),
  entry(ShipmentLotStatus.HOAN_THANH_VAN_CHUYEN, 'Hoàn thành', null, 'ok'),
  entry(ShipmentLotStatus.DA_THANH_TOAN, 'Đã thanh toán', null, 'ok'),
  entry(ShipmentLotStatus.DA_KHOA_KY, 'Đã khóa kỳ 2026-10', null, 'ok'),
]);

const missingDocs: ShipmentLotStatusSummary = summaryOf([
  entry(ShipmentLotStatus.GHI_NHAN_CHI_PHI, 'Chưa xác nhận', '2/4 khoản chi', 'warn'),
  entry(
    ShipmentLotStatus.THIEU_CHUNG_TU,
    'Còn thiếu',
    'Hồ sơ gốc: Còn thiếu — Thiếu: Bill gốc · e-POD: Chờ khách xác nhận · Phơi: Chưa nhận phơi 1/2',
    'warn',
  ),
  entry(ShipmentLotStatus.HOAN_THANH_VAN_CHUYEN, 'Đang vận chuyển', '1/3 chuyến hoàn thành', 'neutral'),
  entry(ShipmentLotStatus.DA_THANH_TOAN, 'Chưa phát sinh công nợ', null, 'neutral'),
  entry(ShipmentLotStatus.DA_KHOA_KY, 'Chưa vào kỳ nào', null, 'neutral'),
]);

describe('ShipmentLotStatusBlock — the five-lane chi tiết lô status block (SIL-1095)', () => {
  it('K1.13: renders all five KB labels, never merged', () => {
    render(<ShipmentLotStatusBlock statusSummary={transportCompleted} />);
    const region = screen.getByRole('region', { name: 'Trạng thái lô' });
    for (const label of ['Ghi nhận chi phí', 'Thiếu chứng từ', 'Hoàn thành vận chuyển', 'Đã thanh toán', 'Đã khóa kỳ']) {
      expect(region.textContent).toContain(label);
    }
  });

  it('a transport-completed lot shows "Hoàn thành vận chuyển: Hoàn thành"', () => {
    render(<ShipmentLotStatusBlock statusSummary={transportCompleted} />);
    expect(screen.getByText('Hoàn thành')).toBeTruthy();
  });

  it('a locked-period lot shows "Đã khóa kỳ 2026-10"', () => {
    render(<ShipmentLotStatusBlock statusSummary={lockedPeriod} />);
    expect(screen.getByText('Đã khóa kỳ 2026-10')).toBeTruthy();
  });

  it('a missing-documents lot names the owed documents', () => {
    render(<ShipmentLotStatusBlock statusSummary={missingDocs} />);
    expect(screen.getByText('Còn thiếu')).toBeTruthy();
    expect(screen.getByText(/Bill gốc/)).toBeTruthy();
  });

  it('lot 167 regression — a lot with NO statusSummary still renders the full status region (never vanishes)', () => {
    render(<ShipmentLotStatusBlock statusSummary={undefined} />);
    const region = screen.getByRole('region', { name: 'Trạng thái lô' });
    for (const label of ['Ghi nhận chi phí', 'Thiếu chứng từ', 'Hoàn thành vận chuyển', 'Đã thanh toán', 'Đã khóa kỳ']) {
      expect(region.textContent).toContain(label);
    }
    // Each lane carries a defined '—' state, never an empty row.
    expect((region.textContent.match(/—/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
