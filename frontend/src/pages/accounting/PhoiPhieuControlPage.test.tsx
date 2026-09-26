import { render, screen } from '@testing-library/react';
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
  vi.mocked(client.getPhoiPhieuReport).mockResolvedValue({ rows: [], grand: { party: '', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: '' } });
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
});