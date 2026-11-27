// SIL-1145 (QA-Retest4) — below 9/9 the "Bắt buộc" chip no longer sits
// alone: a hint beside it names the missing required fields, in slot order,
// with the same labels the stars ride. At 9/9 nothing renders (no noise).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { EMPTY_SHIPMENT_CREATE_FORM, createEmptyContainer } from './shipment-create-model';
import { missingRequiredLabels } from './ShipmentCreateTopline.progress';

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

function missingHint(): string {
  return document.querySelector('.csc-topline__missing')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('SIL-1145 unit — missingRequiredLabels mirrors requiredSlots order and labels', () => {
  it('empty FCL lists all nine star labels in slot order', () => {
    const labels = missingRequiredLabels(EMPTY_SHIPMENT_CREATE_FORM, [createEmptyContainer()]);
    expect(labels).toEqual([
      'Khách hàng',
      'Hình thức xuất nhập khẩu',
      'Số Bill/Booking',
      'Container 1: Loại container',
      'Container 1: Nhà máy',
      'Container 1: Tuyến đường',
      'Container 1: Cảng nâng',
      'Container 1: Cảng hạ',
      'Container 1: Ngày giờ đóng trả',
    ]);
  });

  it('LCL names the Kho (CFS/Cảng) slot with its direction-correct star label', () => {
    const lcl = { ...EMPTY_SHIPMENT_CREATE_FORM, cargoMode: 'LCL' as const, tradeDirection: 'IMPORT' as const };
    expect(missingRequiredLabels(lcl, [])).toContain('Kho lấy hàng (CFS/Cảng)');
    expect(missingRequiredLabels({ ...lcl, tradeDirection: 'EXPORT' as const }, [])).toContain('Kho trả hàng (CFS/Cảng)');
    // Quy cách đóng gói keeps its chip-only seat (the 10th slot).
    expect(missingRequiredLabels(lcl, [])).toContain('Quy cách đóng gói');
  });

  it('a fully satisfied slot list yields no labels (9/9 renders no hint)', () => {
    const row = {
      ...createEmptyContainer(),
      containerTypeId: '3',
      operationalSiteId: '5',
      routeId: '7',
      pickupPortId: '9',
      dropoffPortId: '10',
      customerAppointmentAt: '2026-11-27T08:30',
    };
    const full = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '1',
      tradeDirection: 'IMPORT' as const,
      blNumber: 'BL-1',
    };
    expect(missingRequiredLabels(full, [row])).toEqual([]);
  });
});

describe('SIL-1145 component — the hint beside the chip at 0/9 and 8/9', { timeout: 30000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    listOperationalSites.mockResolvedValue([
      { id: 9, siteType: 'FACTORY', name: 'NM A', shortName: 'NM A' },
    ]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
      containerTypes: [{ id: 3, code: '20GP', name: '20GP' }],
      ports: [
        { id: 9, name: 'Cảng HP', code: null, city: null },
        { id: 10, name: 'Cảng Cái Mép', code: null, city: null },
      ],
    });
  });

  it('0/9: the hint enumerates every missing field beside the chip', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    await waitFor(() => {
      expect(document.querySelector('.csc-topline__progress')?.textContent).toContain('Bắt buộc: 0/9');
      expect(missingHint()).toContain('Còn thiếu:');
    });
    const hint = missingHint();
    expect(hint).toContain('Khách hàng');
    expect(hint).toContain('Hình thức xuất nhập khẩu');
    expect(hint).toContain('Số Bill/Booking');
    expect(hint).toContain('Container 1: Loại container');
    expect(hint).toContain('Container 1: Ngày giờ đóng trả');
    // The chip and the hint share the topline row.
    expect(document.querySelector('.csc-topline')!.contains(document.querySelector('.csc-topline__missing')!)).toBe(true);
  });

  it('8/9: the hint names exactly the one field still missing', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    // Identity: three seats.
    fireEvent.click(screen.getByRole('combobox', { name: 'Khách hàng' }));
    fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
    fireEvent.click(document.getElementById('shipment-trade-direction')!);
    fireEvent.click(await screen.findByRole('option', { name: 'Nhập khẩu' }));
    const bill = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.change(bill, { target: { value: 'BL-SIL1145' } });

    // Row seats: nhà máy, tuyến, cảng nâng, cảng hạ, ngày giờ đóng trả —
    // the Loại cont pick stays open, holding the meter at 8/9.
    const row = document.querySelector('.csc-container-row')!;
    const rowView = within(row as HTMLElement);
    const factoryInput = rowView.getByRole('combobox', { name: /^Nhà máy/ });
    fireEvent.focus(factoryInput);
    fireEvent.click(factoryInput);
    fireEvent.click(await screen.findByRole('option', { name: /NM A/ }));
    const routeInput = rowView.getByRole('combobox', { name: /^Tuyến đường/ });
    fireEvent.focus(routeInput);
    fireEvent.click(routeInput);
    fireEvent.click(await screen.findByRole('option', { name: /Route A/ }));
    const pickupInput = rowView.getByRole('combobox', { name: /^Cảng nâng/ });
    fireEvent.focus(pickupInput);
    fireEvent.click(pickupInput);
    fireEvent.click(await screen.findByRole('option', { name: /Cảng HP/ }));
    const dropoffInput = rowView.getByRole('combobox', { name: /^Cảng hạ/ });
    fireEvent.focus(dropoffInput);
    fireEvent.click(dropoffInput);
    fireEvent.click(await screen.findByRole('option', { name: /Cảng Cái Mép/ }));
    fireEvent.change(document.querySelector<HTMLInputElement>('input[id$="-customer-appointment-date"]')!, { target: { value: '27/11/2026' } });
    fireEvent.change(document.querySelector<HTMLInputElement>('input[id$="-customer-appointment-time"]')!, { target: { value: '08:30' } });

    await waitFor(() => {
      expect(document.querySelector('.csc-topline__progress')?.textContent).toContain('Bắt buộc: 8/9');
      expect(missingHint()).toBe('Còn thiếu: Container 1: Loại container');
    });
  });
});

