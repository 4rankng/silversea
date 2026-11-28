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

function chipText(): string {
  return document.querySelector('.csc-topline__progress')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

// Card 171026113510 (QA1-007 verify-fail lần 2): the real complaint was that,
// after the three identity fields, the chip read "Bắt buộc: 3/3" and no
// "Cần bổ sung" panel appeared anywhere. The chip now describes the whole
// form live. SIL-627 (id 731, owner 31/10) retired the panel entirely —
// the same issue list speaks per-field (the invalid paint + field messages).
describe('shipment create required progress (chip; banner retired by SIL-627)', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    listOperationalSites.mockResolvedValue([
      { id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' },
    ]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('keeps the whole-form denominator, and the six remaining items paint per-field after create (no banner, SIL-627)', async () => {
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
    // SIL-627: the banner is retired — outstanding items never summon it.
    expect(screen.queryByText(/Cần bổ sung/)).toBeNull();
    expect(document.querySelector('.csc-validation-summary')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    // The six container messages paint per-field (the summary list is gone).
    await waitFor(() => {
      const body = document.body.textContent ?? '';
      expect(body).toContain('Container 1: chọn loại container.');
      expect(body).toContain('Container 1: chọn nhà máy.');
      expect(body).toContain('Container 1: chọn tuyến đường.');
      expect(body).toContain('Container 1: chọn cảng nâng.');
      expect(body).toContain('Container 1: chọn cảng hạ.');
      expect(body).toContain('Container 1: chọn ngày giờ đóng/trả.');
    });
  });

  it('lowers the denominator when Lệnh chạy ngoài waives the catalog fields, and mode switches recompute it', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    await waitFor(() => expect(chipText()).toBe('Bắt buộc: 0/9'));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Lệnh chạy ngoài' }));
    // SIL-965 (KB K3.23 §3.2.3): only Nhà máy + Tuyến đường chuẩn are waived —
    // the ports stay, so one row carries type + 2 ports + schedule on top of
    // the 3 identity seats.
    await waitFor(() => expect(chipText()).toBe('Bắt buộc: 0/7'));

    // The QA repro state: three identity fields filled under Lệnh chạy ngoài
    // read 3/7 (they used to read 3/5 when the ports were wrongly waived).
    fireEvent.change(screen.getByRole('combobox', { name: /^Khách hàng/ }), { target: { value: 'Khách vãng lai 8888' } });
    fireEvent.click(document.getElementById('shipment-trade-direction')!);
    fireEvent.click(await screen.findByRole('option', { name: 'Nhập khẩu' }));
    const bill = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.change(bill, { target: { value: 'QA3B-FA2-FCL' } });
    await waitFor(() => expect(chipText()).toBe('Bắt buộc: 3/7'));

    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
    // SIL-965 (KB K3.23 §3.2.3 "Lệnh chạy ngoài"): LCL ad-hoc keeps the
    // identity seats — only Nhà máy + Tuyến đường chuẩn are waived. Owner QA
    // ruling 28/11 (SIL-965/SIL-1239, KB §3.2.3 mẫu số 10): the hàng-lẻ
    // meter counts TEN seats — Kho lấy hàng and Trọng tải stay counted under
    // the chip — so the ad-hoc denominator reads 8 (FCL stays 7).
    await waitFor(() => expect(chipText()).toBe('Bắt buộc: 3/8'));
    expect(screen.queryByText('Chuyển loại hàng?')).toBeNull();
  });
});
