import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites, listSharedWarehouseSites } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listOperationalSites: vi.fn(), listSharedWarehouseSites: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
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
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
  });

  // Ticket 211026125242 (CUS-03): copy-ALL — one click gives EVERY container
  // the same ngày giờ đóng trả, overwriting rows that already hold a schedule
  // (which the copy-down rule above deliberately never touches).
  it('copies the source appointment to ALL containers, overwriting set rows', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    addContainer();
    fillAppointment(0, '20/09/2026', '09:00');
    fillAppointment(1, '21/09/2026', '11:30');

    const allButton = await screen.findByRole('button', { name: /Copy giờ hẹn cho tất cả 3 cont/ });
    fireEvent.click(allButton);

    await waitFor(() => {
      const dates = [0, 1, 2].map((i) => appointmentValue(i).date);
      expect(dates).toEqual(['20/09/2026', '20/09/2026', '20/09/2026']);
    });
    [0, 1, 2].forEach((i) => expect(appointmentValue(i).time).toBe('09:00'));
    expect(await screen.findByText(/Đã copy ngày giờ đóng trả cho tất cả 3 container/)).toBeTruthy();
  });

  it('copy-ALL also replaces a partial draft row and hides with fewer than two containers', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    // Single row: nothing to spread — the button stays hidden.
    fillAppointment(0, '20/09/2026', '09:00');
    expect(screen.queryByRole('button', { name: /Copy giờ hẹn cho tất cả/ })).toBeNull();

    addContainer();
    fillAppointment(1, '20/09', '');
    const allButton = await screen.findByRole('button', { name: /Copy giờ hẹn cho tất cả 2 cont/ });
    fireEvent.click(allButton);
    await waitFor(() => expect(appointmentValue(1).date).toBe('20/09/2026'));
    expect(appointmentValue(1).time).toBe('09:00');
  });

  it('offers hover-copy on the scheduled row while other rows still lack a schedule', async () => {
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

  // Verify-fail 091026225620 (fourth "button missing" report, 09/10): the
  // hover-only row affordance sits where users don't look — every report
  // probed "Lịch & ghi chú" and the date/time dialogs. The section-level named
  // button below is the discoverable position those reports ask for
  // ("nút xuất hiện tại ít nhất một trong các vị trí đã thỏa thuận"), keeping
  // the 18/09 hover ruling intact (additive only). Same condition contract as
  // the hover affordance: a scheduled row + at least one row still empty.
  it('offers a visible section-level copy button in Lịch & ghi chú while other rows lack a schedule', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    addContainer();
    addContainer();
    // No source appointment yet → nothing to copy.
    expect(screen.queryByRole('button', { name: /Copy giờ hẹn xuống cont trống/ })).toBeNull();

    fillAppointment(0, '20/09/2026', '09:00');
    const sectionButton = await screen.findByRole('button', { name: /Copy giờ hẹn xuống cont trống/ });
    expect(sectionButton).toBeTruthy();

    fireEvent.click(sectionButton);
    await waitFor(() => expect(appointmentValue(1).date).toBe('20/09/2026'));
    expect(appointmentValue(1).time).toBe('09:00');
    expect(appointmentValue(2).date).toBe('20/09/2026');
    expect(appointmentValue(2).time).toBe('09:00');
    // The source row keeps its own value.
    expect(appointmentValue(0).date).toBe('20/09/2026');
    expect(appointmentValue(0).time).toBe('09:00');
  });

  // Card 20261010_3: the >= 2 threshold hid every copy affordance on the most
  // common lot — 2 containers, one scheduled, one empty. The contract is now
  // >= 1 empty destination (same boundary as the hover affordance and the CUS
  // ledger): copying to a single row still beats typing it by hand.
  it('shows the section-level copy button once only one empty row remains', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    fillAppointment(0, '20/09/2026', '09:00');
    const sectionButton = await screen.findByRole('button', { name: /Copy giờ hẹn xuống cont trống/ });
    fireEvent.click(sectionButton);
    await waitFor(() => expect(appointmentValue(1).date).toBe('20/09/2026'));
    expect(appointmentValue(1).time).toBe('09:00');
    expect(appointmentValue(0).date).toBe('20/09/2026');
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

  it('shows the row copy affordance with exactly one empty row, hides it with none', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    // One row, nothing scheduled: nothing to copy from or to.
    expect(copyButton()).toBeNull();

    // One scheduled + one empty → visible (card 20261010_3 lowered the old
    // >= 2 threshold; the 2-cont lot is the common case).
    addContainer();
    fillAppointment(0, '20/09/2026', '09:00');
    expect(copyButton()).toBeTruthy();
  });

  it.each([
    ['partial time', '', '14:'],
    ['partial date', '20/09', ''],
  ])('replaces a %s draft and counts every row still without a schedule', async (_label, date, time) => {
    // Case 2026-10-11-R14-03 (FB-009 round 14, owner re-report "mất hẳn")
    // amends card 20261010_3: a typed partial segment draft is incomplete
    // invalid input ('Nhập đủ giờ và ngày hợp lệ'), never a schedule — an
    // explicit copy click replaces it visibly, matching the CUS ledger's
    // 20260917_1 rule. Rows with a set appointment stay protected.
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
    // The partial draft row is a destination — it receives the source.
    await waitFor(() => expect(appointmentValue(2).date).toBe('20/09/2026'));
    expect(appointmentValue(2).time).toBe('09:00');
    expect(await screen.findByText(/Đã copy ngày giờ đóng trả sang 3 container chưa có lịch/)).toBeInTheDocument();
    expect(copyButton()).toBeNull();
  });

  it('keeps the copy affordance alive when the only other row carries a partial draft (case 2026-10-11-R14-03)', async () => {
    // Round-14 repro ("nút copy thời gian mất hẳn"): with partial drafts as
    // the only other rows the exclusion zeroed the destination count and every
    // copy affordance vanished. A row still without a valid schedule is a
    // destination, draft or not.
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    fillAppointment(0, '20/09/2026', '09:00');
    fillAppointment(1, '20/09', '');

    expect(copyButton()).toBeTruthy();
    fireEvent.click(copyButton()!);
    await waitFor(() => expect(appointmentValue(1).date).toBe('20/09/2026'));
    expect(appointmentValue(1).time).toBe('09:00');
  });

  it('bulk date control fills every row without a schedule and never overwrites set rows (case 2026-10-11-R14-02)', async () => {
    // FB-008 round-14 ("không có nhập ngày giao hàng loạt cho lô nhiều
    // container"): the copy affordance needs a source row first; this control
    // types the schedule once and applies it to every row still without one.
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    addContainer();
    fillAppointment(0, '20/09/2026', '09:00');

    const bulkDate = document.querySelector<HTMLInputElement>('input[id$="-bulk-appointment-date"]')!;
    const bulkTime = document.querySelector<HTMLInputElement>('input[id$="-bulk-appointment-time"]')!;
    expect(bulkDate).toBeTruthy();
    expect(bulkTime).toBeTruthy();
    fireEvent.change(bulkDate, { target: { value: '25/12/2026' } });
    fireEvent.change(bulkTime, { target: { value: '14:30' } });

    const applyBtn = await screen.findByRole('button', { name: /Áp dụng cho 2 container/ });
    fireEvent.click(applyBtn);
    await waitFor(() => expect(appointmentValue(1).date).toBe('25/12/2026'));
    expect(appointmentValue(1).time).toBe('14:30');
    expect(appointmentValue(2).date).toBe('25/12/2026');
    expect(appointmentValue(2).time).toBe('14:30');
    // Rows holding a schedule keep it.
    expect(appointmentValue(0).date).toBe('20/09/2026');
    expect(appointmentValue(0).time).toBe('09:00');
    expect(await screen.findByText(/Đã áp dụng ngày giờ đóng trả cho 2 container chưa có lịch/)).toBeTruthy();
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
    // 2026-09-18 ruling (copy-DOWN only): the fill-siblings glyph never sits
    // on the appointment cell. FB-009 (2026-10-14) later added the clipboard
    // copy-TIME button inside that cell's actions slot — a different
    // affordance ('Copy Giờ hẹn đóng trả'), allowed here.
    expect(dateInput.closest('td')?.querySelector('.csc-container-row__copy, button[aria-label^="Copy ngày giờ"]')).toBeNull();
  });

  // FB-009 (2026-10-14): the copy-time button — the row's giờ hẹn lands in
  // the OS clipboard and a "Đã copy giờ hẹn" toast confirms it. Independent
  // of the copy-down feature: it renders whenever the row holds a schedule,
  // so the affordance can no longer "mất hẳn" when no sibling row is empty.
  it('copies the row appointment to the clipboard with a Đã copy toast, with zero empty sibling rows', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    // Single row, scheduled: no copy-down destination exists anywhere…
    fillAppointment(0, '20/09/2026', '09:00');
    expect(copyButton()).toBeNull();
    // …yet the time itself is copyable.
    const copyTime = screen.getByRole('button', { name: 'Copy Giờ hẹn đóng trả' });
    expect(copyTime.closest('td')?.dataset.label).toBe('Ngày giờ đóng trả *');

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    fireEvent.click(copyTime);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('09:00 20/09/2026'));
    expect(await screen.findByText('Đã copy giờ hẹn 09:00 20/09/2026')).toBeInTheDocument();
  });

  it('hides the copy-time button while the row has no schedule', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    expect(screen.queryByRole('button', { name: 'Copy Giờ hẹn đóng trả' })).toBeNull();
  });

  // FB-009 (card 131026233500): "mục 'Lịch & ghi chú' … KHÔNG có nút copy
  // thời gian" — the section named by the card had no clipboard affordance at
  // all, only the copy-DOWN button that fills sibling rows. The section now
  // carries the clipboard button beside the group field, and it copies the
  // value typed there (never a sibling row's).
  it('copies the section bulk giờ hẹn to the clipboard from the Lịch & ghi chú group', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    const group = document.querySelector('[data-field-id="shipment-bulk-appointment"]')!;
    expect(group).toBeTruthy();
    // Nothing typed yet: there is no complete time to copy.
    expect(group.querySelector('button[aria-label^="Copy giờ hẹn"]')).toBeNull();

    fireEvent.change(group.querySelector<HTMLInputElement>('input[id$="-bulk-appointment-date"]')!, { target: { value: '20/09/2026' } });
    fireEvent.change(group.querySelector<HTMLInputElement>('input[id$="-bulk-appointment-time"]')!, { target: { value: '14:00' } });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy giờ hẹn đóng trả' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('14:00 20/09/2026'));
    expect(await screen.findByText('Đã copy giờ hẹn 14:00 20/09/2026')).toBeInTheDocument();
  });
});
