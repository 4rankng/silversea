import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listOperationalSites: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
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

function addContainer() {
  fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
}

function appointmentInputs(index: number) {
  const dates = [...document.querySelectorAll<HTMLInputElement>('input[id$="-customer-appointment-date"]')];
  const times = [...document.querySelectorAll<HTMLInputElement>('input[id$="-customer-appointment-time"]')];
  return { date: dates[index]!, time: times[index]! };
}

function fillAppointment(index: number, date: string, time: string) {
  const { date: dateInput, time: timeInput } = appointmentInputs(index);
  fireEvent.change(dateInput, { target: { value: date } });
  fireEvent.change(timeInput, { target: { value: time } });
}

function copyButton() {
  return screen.queryByRole('button', { name: /Copy ngày giờ đóng trả/ });
}

describe('shipment create bulk appointment copy', () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
    listOperationalSites.mockReset();
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
  });

  it('offers hover-copy on the scheduled row while >= 2 rows still lack a schedule', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    // Three rows: the initial row plus two added rows (added BEFORE any
    // appointment exists, so the clones stay empty).
    addContainer();
    addContainer();
    fillAppointment(0, '20/09/2026', '09:00');

    // Only the scheduled row carries the affordance.
    expect(copyButton()).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Copy ngày giờ đóng trả/ })).toHaveLength(1);
  });

  it('copy fills every empty appointment and never touches set rows', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    addContainer();
    fillAppointment(0, '20/09/2026', '09:00');

    fireEvent.click(copyButton()!);

    await waitFor(() => {
      const dates = [0, 1, 2].map((i) => appointmentInputs(i).date.value);
      expect(dates).toEqual(['20/09/2026', '20/09/2026', '20/09/2026']);
    });
    [0, 1, 2].forEach((i) => expect(appointmentInputs(i).time.value).toBe('09:00'));
    expect(await screen.findByText(/Đã copy ngày giờ đóng trả sang 2 container chưa có lịch/)).toBeTruthy();
  });

  it('hides the copy affordance with fewer than two empties', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    // One row, nothing scheduled: nothing to copy from or to.
    expect(copyButton()).toBeNull();

    // One scheduled + one empty = exactly one empty row → still hidden
    // (spec: MORE THAN one empty container).
    addContainer();
    fillAppointment(0, '20/09/2026', '09:00');
    expect(copyButton()).toBeNull();
  });

  it.each([
    ['partial time', '', '14:'],
    ['partial date', '20/09', ''],
  ])('preserves a %s draft and counts only truly empty destinations', async (_label, date, time) => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    addContainer();
    addContainer();
    addContainer();
    fillAppointment(0, '20/09/2026', '09:00');
    fillAppointment(1, '21/09/2026', '11:30');
    fillAppointment(2, date, time);
    fireEvent.click(screen.getAllByRole('button', { name: /Copy ngày giờ đóng trả/ })[0]!);
    await waitFor(() => expect(appointmentInputs(3).date.value).toBe('20/09/2026'));
    expect(appointmentInputs(4).time.value).toBe('09:00');
    expect(appointmentInputs(1).date.value).toBe('21/09/2026');
    expect(appointmentInputs(1).time.value).toBe('11:30');
    expect(appointmentInputs(2).date.value).toBe(date);
    expect(appointmentInputs(2).time.value).toBe(time);
    expect(await screen.findByText(/Đã copy ngày giờ đóng trả sang 2 container chưa có lịch/)).toBeInTheDocument();
    expect(copyButton()).toBeNull();
  });

  // User ruling 2026-09-18: the affordance lives in the STT cell as an icon
  // button; it must never sit ON the appointment controls it fills.
  it('renders the copy affordance inside the row index cell, not over the appointment', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    addContainer();
    fillAppointment(0, '20/09/2026', '09:00');

    const button = copyButton()!;
    const row = button.closest('tr')!;
    expect(button.closest('th.csc-container-row__index')).not.toBeNull();
    expect(button.textContent?.trim()).toBe('');
    const dateInput = row.querySelector('input[id$="-customer-appointment-date"]')!;
    expect(dateInput.closest('td')?.querySelector('button')).toBeNull();
  });
});
