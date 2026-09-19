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

function appointmentValue(index: number) {
  const row = document.querySelectorAll('.csc-container-row')[index];
  if (!row) return { date: '', time: '' };
  const hh = row.querySelector<HTMLInputElement>('input[data-seg="hh"]')?.value ?? '';
  const mm = row.querySelector<HTMLInputElement>('input[data-seg="mm"]')?.value ?? '';
  const dd = row.querySelector<HTMLInputElement>('input[data-seg="dd"]')?.value ?? '';
  const mm2 = row.querySelector<HTMLInputElement>('input[data-seg="mm2"]')?.value ?? '';
  const yyyy = row.querySelector<HTMLInputElement>('input[data-seg="yyyy"]')?.value ?? '';
  const time = hh || mm ? (hh && mm ? `${hh}:${mm}` : `${hh}:`) : '';
  const date = dd || mm2 || yyyy ? [dd, mm2, yyyy].filter(Boolean).join('/') : '';
  return { date, time };
}

function fillAppointment(index: number, date: string, time: string) {
  const { date: dateInput, time: timeInput } = appointmentInputs(index);
  if (date) fireEvent.change(dateInput, { target: { value: date } });
  if (time) fireEvent.change(timeInput, { target: { value: time } });
}

function copyButton() {
  return screen.queryByRole('button', { name: /Copy ngày giờ đóng trả/ });
}

describe('shipment create bulk appointment copy', { timeout: 20000 }, () => {
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
      const dates = [0, 1, 2].map((i) => appointmentValue(i).date);
      expect(dates).toEqual(['20/09/2026', '20/09/2026', '20/09/2026']);
    });
    [0, 1, 2].forEach((i) => expect(appointmentValue(i).time).toBe('09:00'));
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
    await waitFor(() => expect(appointmentValue(3).date).toBe('20/09/2026'));
    expect(appointmentValue(4).time).toBe('09:00');
    expect(appointmentValue(1).date).toBe('21/09/2026');
    expect(appointmentValue(1).time).toBe('11:30');
    expect(appointmentValue(2).date).toBe(date);
    expect(appointmentValue(2).time).toBe(time);
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
    expect(dateInput.closest('td')?.querySelector('.csc-container-row__copy, button[aria-label*="Copy"]')).toBeNull();
  });
});
