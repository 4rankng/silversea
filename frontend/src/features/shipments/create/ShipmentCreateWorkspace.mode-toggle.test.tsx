import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap } = vi.hoisted(() => ({ getBootstrap: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));

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

describe('shipment create cargo-mode toggle data scope', () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('mode switch keeps identity fields and wipes only mode-scoped cargo data', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    // Identity inputs: direction + bill must SURVIVE the toggle (a8's browser
    // suspicion was that customer/direction/bill/route vanish — the state
    // machine spreads ...current over identity and never resets them).
    fireEvent.click(document.getElementById('shipment-trade-direction')!);
    fireEvent.click(await screen.findByRole('option', { name: 'Nhập khẩu' }));
    const bill = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.change(bill, { target: { value: 'BL-SWEEP-001' } });
    expect(bill.value).toBe('BL-SWEEP-001');

    // Mode data: a complete container appointment so the toggle asks for
    // confirmation (the appointment is the only editor input mounted before
    // a cell gains focus in the spreadsheet grid).
    const timeInput = document.querySelector<HTMLInputElement>('input[id$="-customer-appointment-time"]')!;
    fireEvent.change(timeInput, { target: { value: '09:00' } });
    const dateInput = document.querySelector<HTMLInputElement>('input[id$="-customer-appointment-date"]')!;
    fireEvent.change(dateInput, { target: { value: '20/09/2026' } });

    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));

    // The destructive move is gated: the confirm modal names the cargo scope.
    const confirm = await screen.findByRole('button', { name: 'Chuyển và xóa dữ liệu' });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(document.getElementById('shipment-trade-direction')?.textContent).toContain('Nhập khẩu');
      expect(document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input')?.value).toBe('BL-SWEEP-001');
    });
    // Container rows were reset (mode-scoped, per the modal copy).
    await waitFor(() => {
      const resetTime = document.querySelector<HTMLInputElement>('input[id$="-customer-appointment-time"]');
      expect(resetTime?.value ?? '').toBe('');
    });
  });

  it('pristine toggle applies silently without the confirm modal', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));

    // No mode data anywhere → no confirmation gate, and identity stays put.
    expect(screen.queryByRole('button', { name: 'Chuyển và xóa dữ liệu' })).toBeNull();
    await waitFor(() => {
      expect((document.getElementById('shipment-trade-direction') as HTMLSelectElement).value).toBe('');
    });
  });
});
