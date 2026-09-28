import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const getPhoiPhieuReport = vi.hoisted(() => vi.fn());
vi.mock('../../api/phoiPhieuClient', () => ({ getPhoiPhieuReport }));

import { PhoiPhieuReportTable } from './PhoiPhieuControlPage.reports';

const row = { party: 'KH Alpha', tienNang: 1000, tienHa: 2000, psKhac: 0, tongPhaiThuTra: 3000, daThuTra: 1000, conLai: 2000, ghiChu: '', soLuong: 1, phaiThu: 1000, phaiTra: 0 };

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

// Card 20260928_173 AC3 — "Với khách hàng có phát sinh cả thu / trả 1 tháng …
// Ưu tiên hiển thị tổng hợp trên cùng 1 dòng: cả cước phải thu / phải trả, số
// lượng". The contract: ONE row carries both figures and the count. A subject
// that moves on one side only keeps the plain report look it had before.
describe('báo cáo tháng gộp một dòng khi phát sinh cả thu và trả (card 20260928_173 AC3)', () => {
  const both = { ...row, party: 'KH Hai chiều', soLuong: 3, phaiThu: 900000, phaiTra: 750000 };
  const one = { ...row, party: 'KH Một chiều', soLuong: 1, phaiThu: 1000, phaiTra: 0 };

  async function aggregateCell(party: string) {
    const found = screen.getByRole('row', { name: new RegExp(party) });
    return within(found).getAllByRole('cell').at(-2);
  }

  async function table() {
    getPhoiPhieuReport.mockResolvedValue({ rows: [both, one], grand: undefined });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PhoiPhieuReportTable kind="THU" dateFrom="2026-09-01" dateTo="2026-09-30" />
      </QueryClientProvider>,
    );
    // Wait for the DATA, not the header: the <thead> renders before the query
    // resolves, so the header-only wait the header tests use would let these
    // assertions run against an empty <tbody>.
    await screen.findByText('KH Một chiều');
  }

  it('renders both figures and the count on ONE row, never two', async () => {
    await table();
    const subjectRows = screen.getAllByRole('row').filter((tr) => /KH Hai chiều/.test(tr.textContent ?? ''));
    expect(subjectRows).toHaveLength(1);
    const cell = within(subjectRows[0]!).getByText(/Phải thu/);
    expect(cell.textContent).toContain('900.000');
    expect(cell.textContent).toContain('Phải trả');
    expect(cell.textContent).toContain('750.000');
    expect(cell.textContent).toContain('3');
  });

  it('leaves a one-sided subject exactly as it was — no aggregate', async () => {
    await table();
    const cell = await aggregateCell('KH Một chiều');
    expect(cell?.textContent).toBe('—');
  });

  it('both tables share the column, because they share the component', async () => {
    await table();
    expect(screen.getByRole('columnheader', { name: 'Tổng hợp' })).toBeInTheDocument();
  });
});
