// SIL-1133 (QA-Retest4; KB Chương 3 §3.2.4) — the LCL create form carries
// BOTH the titled "Lịch & Ghi chú" section ("rút gọn còn 1 mục": the one
// Ngày giờ đóng trả datetime) AND the optional "Mô tả hàng hóa" textarea.
// FCL renders neither — its schedule lives in the container table (SIL-611).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites, listSharedWarehouseSites } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listOperationalSites: vi.fn(), listSharedWarehouseSites: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
  listOperationalSites,
  listSharedWarehouseSites,
}));

import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/shipments/new']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentCreateWorkspace />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('SIL-1133 — LCL Lịch & Ghi chú + Mô tả hàng hóa', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('LCL renders the Lịch & Ghi chú section with the single datetime and the Mô tả hàng hóa textarea', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));

    // The titled section exists, holds exactly the one schedule field, and
    // no note boxes (KB: "rút gọn còn 1 mục").
    const section = await waitFor(() => {
      const el = document.querySelector('#shipment-section-schedule');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(section.querySelector('h2')?.textContent).toContain('Lịch & Ghi chú');
    expect(section.querySelector('[data-field-id="shipment-lcl-closing-at"]')).toBeTruthy();
    expect(section.querySelectorAll('[data-field-id]').length).toBe(1);
    expect(section.textContent).not.toContain('Ghi chú cho khách hàng');

    // The description textarea is optional — present, no required mark.
    const description = screen.getByLabelText('Mô tả hàng hóa') as HTMLTextAreaElement;
    expect(description.tagName).toBe('TEXTAREA');
    expect((description.closest('[data-field-id="shipment-cargo-description"]') as HTMLElement).textContent ?? '').not.toContain('*');
    fireEvent.change(description, { target: { value: 'Hàng dễ vỡ' } });
    expect((screen.getByLabelText('Mô tả hàng hóa') as HTMLTextAreaElement).value).toBe('Hàng dễ vỡ');
  });

  it('FCL renders neither the Lịch & Ghi chú section nor the Mô tả hàng hóa textarea', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    expect(document.querySelector('#shipment-section-schedule')).toBeNull();
    expect(screen.queryByLabelText('Mô tả hàng hóa')).toBeNull();
    expect(screen.queryByText('Lịch & Ghi chú')).toBeNull();
    // …and the LCL field never leaks into the FCL Thông tin hàng section.
    expect(document.querySelector('[data-field-id="shipment-cargo-description"]')).toBeNull();
  });
});
