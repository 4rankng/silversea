import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/phoiPhieuClient', () => ({
  listPhoiPhieuRows: vi.fn(),
  listPhoiPhieuStk: vi.fn(),
  listPhoiPhieuTruckAssignments: vi.fn(),
  getPhoiPhieuReport: vi.fn(),
}));

import PhoiPhieuControlPage from './PhoiPhieuControlPage';
import * as client from '../../api/phoiPhieuClient';

function renderPage() {
  vi.mocked(client.listPhoiPhieuRows).mockResolvedValue({ items: [] });
  vi.mocked(client.listPhoiPhieuStk).mockResolvedValue({ items: [] });
  vi.mocked(client.listPhoiPhieuTruckAssignments).mockResolvedValue({ assignments: [], unassignedTrucks: [], accountants: [] });
  vi.mocked(client.getPhoiPhieuReport).mockResolvedValue({ rows: [], grand: { party: '', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: '', soLuong: 0, phaiThu: 0, phaiTra: 0 } });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PhoiPhieuControlPage />
    </QueryClientProvider>,
  );
}

// Card 20260925_46 (date placeholder unification): /accounting/phoi-phieu was
// the last page driving native <input type=date> (browser-locale 'dd/mm/yyyy')
// while every other audited page ships the shared segmented DD/MM/YYYY field.
// Contract: the page uses ONLY the shared segmented date field.
describe('PhoiPhieuControlPage date filter control contract', () => {
  it('renders the shared segmented date field, never a native date input', async () => {
    const { container } = renderPage();
    await screen.findByText('Từ ngày');
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(container.querySelectorAll('[data-date-input]').length).toBe(2);
  });

  // Card 20260927_152: the filter region is the ONE shared strip. The search
  // slot, the shared from/to pair and the voucher action are the bar's own
  // items; the four secondary criteria render inline while the strip still fits
  // two rows (jsdom measures no width, so `inline` is the mode under test).
  it('renders the shared strip with the search slot and the Lập phiếu action', async () => {
    const { container } = renderPage();
    await screen.findByText('Từ ngày');
    const bar = container.querySelector('.list-filter-bar') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(container.querySelector('.date-range-fields')).toBeTruthy();
    expect(within(bar).getByLabelText('Tìm kiếm')).toHaveAttribute('placeholder', 'Mã chuyến, container, khách');
    expect(within(bar).getByRole('button', { name: /Lập phiếu/ })).toBeTruthy();
  });

  it('keeps the four secondary criteria and their Vietnamese labels reachable', async () => {
    const { container } = renderPage();
    await screen.findByText('Từ ngày');
    const bar = container.querySelector('.list-filter-bar') as HTMLElement;
    for (const label of ['Trạng thái', 'Sắp xếp', 'Loại phiếu', 'Số tài khoản quỹ (STK)']) {
      expect(within(bar).getByText(label)).toBeTruthy();
    }
  });
});