import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const getPhoiPhieuReport = vi.hoisted(() => vi.fn());
vi.mock('../../api/phoiPhieuClient', () => ({ getPhoiPhieuReport }));

import type { PhoiPhieuReportRow } from '../../api/phoiPhieuClient';
import { PhoiPhieuReportTable } from './PhoiPhieuControlPage.reports';

const row = { party: 'KH Alpha', tienNang: 1000, tienHa: 2000, psKhac: 0, tongPhaiThuTra: 3000, daThuTra: 1000, conLai: 2000, ghiChu: '', soLuong: 1, phaiThu: 1000, phaiTra: 0, partyShortName: null, partyId: null, partyKind: null, isOwnFleet: false };

async function table(kind: 'THU' | 'TRA') {
  getPhoiPhieuReport.mockResolvedValue({ rows: [row], grand: undefined });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PhoiPhieuReportTable kind={kind} dateFrom="2026-09-01" dateTo="2026-09-30" />
    </QueryClientProvider>,
  );
  await screen.findAllByRole('columnheader', { name: 'Tổng' });
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

  it('TRA tables (Xe nhà + Vendor, CR-011 split): PHẢI TRẢ group spans Tổng / Đã trả / Còn phải trả in BOTH tables', async () => {
    await table('TRA');
    // The split renders two tables — every contract holds in each of them.
    for (const group of screen.getAllByRole('columnheader', { name: 'Phải trả' })) {
      expect(group).toHaveAttribute('colspan', '3');
    }
    for (const stt of screen.getAllByRole('columnheader', { name: 'STT' })) {
      expect(stt).toHaveAttribute('rowspan', '2');
    }
    expect(screen.getAllByRole('columnheader', { name: 'Đã trả' }).length).toBe(2);
    expect(screen.getAllByRole('columnheader', { name: 'Còn phải trả' }).length).toBe(2);
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

// Card 374 — the two summary tables are the spec's "bảng con tổng hợp thu/trả":
// a settled party (Còn phải thu/trả = 0) hides BY DEFAULT and the toggle is the
// way back. Only an exact 0 hides — an overpaid party (negative remaining, the
// overpay annotation) never hides. TỔNG CỘNG stays the server grand over ALL
// rows (hidden included) so the table still reconciles with công nợ; hiding is
// presentation only.
describe('báo cáo thu/trả ẩn dòng còn 0 (card 374)', () => {
  const settled = { ...row, party: 'KH Trả hết', tongPhaiThuTra: 3000, daThuTra: 3000, conLai: 0 };
  const overpaid = { ...row, party: 'KH Trả trước', tongPhaiThuTra: 3000, daThuTra: 3500, conLai: -500 };
  const grandAll = { party: 'TỔNG CỘNG', tienNang: 3000, tienHa: 6000, psKhac: 0, tongPhaiThuTra: 9000, daThuTra: 5500, conLai: 3500, ghiChu: null, soLuong: 3, phaiThu: 5500, phaiTra: 0, partyShortName: null, partyId: null, partyKind: null, isOwnFleet: false };

  async function renderReport(rows: PhoiPhieuReportRow[], grand: PhoiPhieuReportRow | undefined) {
    getPhoiPhieuReport.mockReset().mockResolvedValue({ rows, grand });
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PhoiPhieuReportTable kind="THU" dateFrom="2026-09-01" dateTo="2026-09-30" />
      </QueryClientProvider>,
    );
  }

  it('hides zero-remaining rows by default, keeps positive and negative rows, and keeps TỔNG CỘNG over ALL rows', async () => {
    await renderReport([row, settled, overpaid], grandAll);
    await screen.findByText('KH Alpha');

    expect(screen.queryByText('KH Trả hết')).toBeNull();
    expect(screen.getByText('KH Alpha')).toBeInTheDocument();
    expect(screen.getByText('KH Trả trước')).toBeInTheDocument();

    // The toggle names exactly what it hides, so the count stays honest.
    expect(screen.getByRole('button', { name: 'Hiện các dòng còn phải thu = 0 đã ẩn (1)' })).toBeInTheDocument();

    // The grand row must include the HIDDEN row: server totals unchanged.
    const totalRow = screen.getByRole('row', { name: /TỔNG CỘNG/ });
    expect(totalRow.textContent).toContain('3.500');
  });

  it('toggle reveals the hidden zero rows and hides them again, with aria-pressed tracking state', async () => {
    await renderReport([row, settled], undefined);
    await screen.findByText('KH Alpha');
    expect(screen.queryByText('KH Trả hết')).toBeNull();

    const toggle = screen.getByRole('button', { name: 'Hiện các dòng còn phải thu = 0 đã ẩn (1)' });
    expect(toggle.tagName).toBe('BUTTON');
    toggle.focus();
    expect(toggle).toHaveFocus();

    fireEvent.click(toggle);
    expect(await screen.findByText('KH Trả hết')).toBeInTheDocument();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Ẩn các dòng còn phải thu = 0' })).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByText('KH Trả hết')).toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('an overpaid (negative remaining) row never hides, and the toggle disables with nothing hidden', async () => {
    await renderReport([overpaid], undefined);
    await screen.findByText('KH Trả trước');

    expect(screen.getByText('KH Trả trước')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Hiện các dòng còn phải thu = 0 đã ẩn (0)' });
    expect(toggle).toBeDisabled();
    expect(toggle.getAttribute('title')).toContain('Không có dòng còn phải thu = 0');
  });

  it('re-queries when the shared period changes, so the report follows the page filter', async () => {
    getPhoiPhieuReport.mockReset().mockResolvedValue({ rows: [row], grand: undefined });
    const view = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PhoiPhieuReportTable kind="THU" dateFrom="2026-09-01" dateTo="2026-09-30" />
      </QueryClientProvider>,
    );
    await screen.findByText('KH Alpha');

    getPhoiPhieuReport.mockResolvedValue({ rows: [{ ...row, party: 'KH Beta' }], grand: undefined });
    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PhoiPhieuReportTable kind="THU" dateFrom="2029-01-01" dateTo="2029-01-31" />
      </QueryClientProvider>,
    );
    await screen.findByText('KH Beta');
    expect(getPhoiPhieuReport).toHaveBeenLastCalledWith('THU', { dateFrom: '2029-01-01', dateTo: '2029-01-31', scope: undefined });
  });
});

// CR-011 §10.10.1 — the TRA report splits into two independent tables: the
// internal fleet ('XE NHÀ — SILVER SEA', em-dash label as the BE emits it)
// versus every vendor — 'Thiếu nhà xe' included. Separate totals per table.
describe('báo cáo TRA tách bảng Xe nhà vs Vendor (CR-011)', () => {
  const xeNha = { ...row, party: 'XE NHÀ — SILVER SEA', isOwnFleet: true, tienNang: 5000, tongPhaiThuTra: 5000, conLai: 5000 };
  const vendor = { ...row, party: 'Gaya Container Lines', tienNang: 7000, tongPhaiThuTra: 7000, conLai: 7000 };
  const missing = { ...row, party: 'Thiếu nhà xe', tienNang: 9000, tongPhaiThuTra: 9000, conLai: 9000 };

  async function renderTra(rows: PhoiPhieuReportRow[]) {
    getPhoiPhieuReport.mockReset().mockResolvedValue({ rows, grand: undefined });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PhoiPhieuReportTable kind="TRA" dateFrom="2026-11-01" dateTo="2026-11-30" />
      </QueryClientProvider>,
    );
    await screen.findByText('XE NHÀ — SILVER SEA');
  }

  it('renders two captioned tables, each holding only its own rows', async () => {
    await renderTra([xeNha, vendor, missing]);
    const internal = screen.getByText('Bảng 1 — Xe nhà (Silver Sea)').closest('table')!;
    expect(within(internal).getByText('XE NHÀ — SILVER SEA')).toBeInTheDocument();
    expect(within(internal).queryByText('Gaya Container Lines')).not.toBeInTheDocument();
    // CR-011: 'Thiếu nhà xe' is a VENDOR row — it must never join the fleet.
    expect(within(internal).queryByText('Thiếu nhà xe')).not.toBeInTheDocument();
    const external = screen.getByText('Bảng 2 — Nhà xe ngoài (Vendor)').closest('table')!;
    expect(within(external).getByText('Gaya Container Lines')).toBeInTheDocument();
    expect(within(external).getByText('Thiếu nhà xe')).toBeInTheDocument();
    expect(within(external).queryByText('XE NHÀ — SILVER SEA')).not.toBeInTheDocument();
  });

  it('totals each table separately — fleet and vendor never mix money', async () => {
    await renderTra([xeNha, vendor, missing]);
    const internal = screen.getByText('Bảng 1 — Xe nhà (Silver Sea)').closest('table')!;
    expect(within(internal).getByText('TỔNG CỘNG XE NHÀ')).toBeInTheDocument();
    expect(within(internal).getAllByText(/5\.000/).length).toBeGreaterThan(0);
    const external = screen.getByText('Bảng 2 — Nhà xe ngoài (Vendor)').closest('table')!;
    expect(within(external).getByText('TỔNG CỘNG VENDOR')).toBeInTheDocument();
    // 7.000 + 9.000 — the vendor total must NOT include the fleet's 5.000.
    expect(within(external).getAllByText(/16\.000/).length).toBeGreaterThan(0);
  });

  it('SIL-1015 — the split follows the wire isOwnFleet fact, never the party string', async () => {
    // The flag decides: a fleet row under ANY name joins Bảng 1, and the
    // 'XE NHÀ — SILVER SEA' STRING on a vendor-flagged row joins Bảng 2.
    // (The fleet row's name is kept distinct from the table's own heading.)
    const flagFleet = { ...row, party: 'Nội bộ 15C-167.31', isOwnFleet: true, tienNang: 4000, tongPhaiThuTra: 4000, conLai: 4000 };
    const nameImposter = { ...row, party: 'XE NHÀ — SILVER SEA', isOwnFleet: false, tienNang: 6000, tongPhaiThuTra: 6000, conLai: 6000 };
    await renderTra([flagFleet, nameImposter]);
    const internal = screen.getByText('Bảng 1 — Xe nhà (Silver Sea)').closest('table')!;
    expect(within(internal).getByText('Nội bộ 15C-167.31')).toBeInTheDocument();
    expect(within(internal).queryByText('XE NHÀ — SILVER SEA')).not.toBeInTheDocument();
    const external = screen.getByText('Bảng 2 — Nhà xe ngoài (Vendor)').closest('table')!;
    expect(within(external).getByText('XE NHÀ — SILVER SEA')).toBeInTheDocument();
    expect(within(external).queryByText('Nội bộ 15C-167.31')).not.toBeInTheDocument();
  });
});
