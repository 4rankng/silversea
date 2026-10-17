import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listOperationalSites: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
  listOperationalSites,
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

function chipText(): string {
  return document.querySelector('.csc-topline__progress')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

// Card 171026113510 (QA1-007 verify-fail lần 2): the real complaint was that,
// after the three identity fields, the chip read "Bắt buộc: 3/3" and no
// "Cần bổ sung" panel appeared anywhere — the panel was fed by the issue list
// that only a submit attempt fills. Both must now describe the whole form
// before the operator ever clicks "Tạo lô hàng".
describe('shipment create required progress (chip + missing-info panel)', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    listOperationalSites.mockReset();
    listOperationalSites.mockResolvedValue([
      { id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' },
    ]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('keeps the whole-form denominator and names the six remaining items before any submit', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    // Empty FCL catalog lot: 3 identity + 6 container-row fields.
    await waitFor(() => expect(chipText()).toBe('Bắt buộc: 0/9'));

    fireEvent.click(screen.getByRole('combobox', { name: 'Khách hàng' }));
    fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
    fireEvent.click(document.getElementById('shipment-trade-direction')!);
    fireEvent.click(await screen.findByRole('option', { name: 'Nhập khẩu' }));
    const bill = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.change(bill, { target: { value: 'BL-171026113510' } });

    // The repro state: three identity fields filled, six still enforced.
    await waitFor(() => expect(chipText()).toBe('Bắt buộc: 3/9'));
    expect(await screen.findByText('Cần bổ sung 6 thông tin')).toBeTruthy();
    const panel = document.querySelector('.csc-validation-summary')!.textContent ?? '';
    expect(panel).toContain('Container 1: chọn loại container.');
    expect(panel).toContain('Container 1: chọn nhà máy.');
    expect(panel).toContain('Container 1: chọn tuyến đường.');
    expect(panel).toContain('Container 1: chọn cảng nâng.');
    expect(panel).toContain('Container 1: chọn cảng hạ.');
    expect(panel).toContain('Container 1: chọn ngày giờ đóng/trả.');
    // The three identity fields are done — they must not be listed as missing.
    expect(panel).not.toContain('Chọn khách hàng.');
    expect(panel).not.toContain('Chọn hình thức');
  });

  it('lowers the denominator when Lệnh chạy ngoài waives the catalog fields, and mode switches recompute it', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    await waitFor(() => expect(chipText()).toBe('Bắt buộc: 0/9'));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Lệnh chạy ngoài' }));
    // Factory/route/ports are waived per row: 3 identity + type + schedule.
    await waitFor(() => expect(chipText()).toBe('Bắt buộc: 0/5'));

    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
    // LCL ad-hoc: route + warehouse stay waived, its four cargo/schedule
    // fields replace the container row.
    await waitFor(() => expect(chipText()).toBe('Bắt buộc: 0/7'));
    expect(screen.queryByText('Chuyển loại hàng?')).toBeNull();
  });
});
