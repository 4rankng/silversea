import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const getPhoiPhieuReport = vi.hoisted(() => vi.fn());
vi.mock('../../api/phoiPhieuClient', () => ({ getPhoiPhieuReport }));

import { PhoiPhieuReportTable } from './PhoiPhieuControlPage.reports';

const row = { party: 'KH Alpha', tienNang: 1000, tienHa: 2000, psKhac: 0, tongPhaiThuTra: 3000, daThuTra: 1000, conLai: 2000, ghiChu: '' };

async function table(kind: 'THU' | 'TRA') {
  getPhoiPhieuReport.mockResolvedValue({ rows: [row], grand: undefined });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PhoiPhieuReportTable kind={kind} dateFrom="2026-09-01" dateTo="2026-09-30" />
    </QueryClientProvider>,
  );
  await screen.findByRole('columnheader', { name: 'Tổng' });
}

// Card 20260924_1 (image11, HIGH) — the Báo cáo tháng header crammed "thu|trả"
// variants into single cells; the fixed-layout .tt-table then painted the
// nowrap headers across neighbours, so column boundaries were illegible.
// Contract: one kind per table, a tier-1 group spanning three tier-2
// sub-columns, and no cell that mixes the two directions with "|" or "/".
describe('báo cáo tháng multi-tier header (card 20260924_1, image11)', () => {
  it('THU table: PHẢI THU group spans Tổng / Đã thu / Còn phải thu — no mixed "thu|trả" cell', async () => {
    await table('THU');
    expect(screen.getByRole('columnheader', { name: 'Phải thu' })).toHaveAttribute('colspan', '3');
    expect(screen.getByRole('columnheader', { name: 'STT' })).toHaveAttribute('rowspan', '2');
    expect(screen.getByRole('columnheader', { name: 'Đã thu' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Còn phải thu' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').some((th) => /[|/]/.test(th.textContent ?? ''))).toBe(false);
  });

  it('TRA table: PHẢI TRẢ group spans Tổng / Đã trả / Còn phải trả — no mixed "thu|trả" cell', async () => {
    await table('TRA');
    expect(screen.getByRole('columnheader', { name: 'Phải trả' })).toHaveAttribute('colspan', '3');
    expect(screen.getByRole('columnheader', { name: 'STT' })).toHaveAttribute('rowspan', '2');
    expect(screen.getByRole('columnheader', { name: 'Đã trả' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Còn phải trả' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').some((th) => /[|/]/.test(th.textContent ?? ''))).toBe(false);
  });
});
