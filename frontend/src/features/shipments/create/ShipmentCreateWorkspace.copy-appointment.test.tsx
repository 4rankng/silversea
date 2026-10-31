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

function fillNumber(index: number, value: string) {
  const inputs = [...screen.getAllByLabelText('Số container')] as HTMLInputElement[];
  fireEvent.change(inputs[index]!, { target: { value } });
}

function weightTriggers() {
  return [...screen.getAllByRole('button', { name: /Chỉnh sửa trọng lượng — dòng \d+/ })];
}

/** SIL-552: the weight line is a ghost trigger — open its floating editor,
 *  type, Enter commits (the shared Enter/Lưu guard) and closes the panel. */
function fillWeight(index: number, value: string) {
  fireEvent.click(weightTriggers()[index]!);
  const input = screen.getByLabelText(`Trọng lượng (kg) — dòng ${index + 1}`) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

/** Opens row `index`'s weight panel and returns the seeded input value. */
function weightValue(index: number): string {
  fireEvent.click(weightTriggers()[index]!);
  return (screen.getByLabelText(`Trọng lượng (kg) — dòng ${index + 1}`) as HTMLInputElement).value;
}

function duplicateButtons() {
  return screen.queryAllByRole('button', { name: /Nhân bản container/ });
}

describe('shipment create container copy affordances', { timeout: 20000 }, () => {
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

  // SIL-513 (owner 26/10): the STT hover copy DUPLICATES the row — a
  // full-value clone (số cont, loại, nhà máy, tuyến, cảng, kg, giờ đóng/trả)
  // inserted immediately BELOW the source row. This replaces both the old
  // STT copy-down behavior (the section chip below keeps that feature) and
  // the retired "Copy giờ hẹn cho tất cả N cont" chip.
  it('duplicate click inserts a full-value copy right below the source row', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    fillNumber(0, 'MSCU6639870');
    fillWeight(0, '24500');
    fillAppointment(0, '20/09/2026', '09:00');

    fireEvent.click(duplicateButtons()[0]!);

    await waitFor(() => expect(document.querySelectorAll('.csc-container-row')).toHaveLength(3));
    // The clone sits DIRECTLY below the source (index 1), carrying every
    // value the source held — not appended at the list's end, not emptied.
    expect((screen.getAllByLabelText('Số container') as HTMLInputElement[])[1]!.value).toBe('MSCU6639870');
    expect(appointmentValue(1).date).toBe('20/09/2026');
    expect(appointmentValue(1).time).toBe('09:00');
    expect(weightValue(1)).toBe('24500');
    // The source row keeps its place and values.
    expect((screen.getAllByLabelText('Số container') as HTMLInputElement[])[0]!.value).toBe('MSCU6639870');
    expect(appointmentValue(0).date).toBe('20/09/2026');
    // Row 2 is the untouched second container.
    expect(appointmentValue(2).date).toBe('');
    expect(await screen.findByText(/Đã nhân bản container 1/)).toBeTruthy();
  });

  it('every row owns its duplicate affordance regardless of schedule or empty siblings', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    // One bare row already offers the duplicate (no schedule needed — the
    // old copy-down gating died with SIL-513).
    expect(duplicateButtons()).toHaveLength(1);
    addContainer();
    expect(duplicateButtons()).toHaveLength(2);
  });

  // SIL-513: the retired "Copy giờ hẹn cho tất cả N cont" chip (and its
  // applyAppointmentToAll handler) must not come back — the copy affordances
  // are the STT duplicate + the copy-down button + the bulk field.
  it('retires the copy-ALL chip from the form', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    fillAppointment(0, '20/09/2026', '09:00');
    fillAppointment(1, '21/09/2026', '11:30');
    expect(screen.queryByRole('button', { name: /Copy giờ hẹn cho tất cả/ })).toBeNull();
  });

  // SIL-513: the copy icon lives ONLY in the STT cell — the appointment
  // cell's clipboard button (which rendered inside the actions slot beside
  // the row trash) is retired.
  it('renders the copy affordance in the STT cell only, never over the appointment', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    fillAppointment(0, '20/09/2026', '09:00');

    const button = duplicateButtons()[0]!;
    const row = button.closest('tr')!;
    expect(button.closest('th.csc-container-row__index')).not.toBeNull();
    // The icon button carries an accessible name, no text.
    expect(button.textContent?.trim()).toBe('');
    expect(screen.queryByRole('button', { name: 'Copy Giờ hẹn đóng trả' })).toBeNull();
    const dateInput = row.querySelector('input[id$="-customer-appointment-date"]')!;
    expect(dateInput.closest('td')?.querySelector('button')).toBeNull();
  });

  // Copy-down (FB-008/009 lineage) survives on its section-level button: a
  // scheduled source + rows still without a schedule. SIL-611 relocated the
  // button INTO the Thông tin hàng section, directly under the table it
  // fills (the "Lịch & ghi chú" band is gone).
  it('offers a visible copy-down button under the container table while other rows lack a schedule', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    addContainer();
    addContainer();
    // No source appointment yet → nothing to copy.
    expect(screen.queryByRole('button', { name: /Copy giờ hẹn xuống cont trống/ })).toBeNull();

    fillAppointment(0, '20/09/2026', '09:00');
    const sectionButton = await screen.findByRole('button', { name: /Copy giờ hẹn xuống cont trống/ });
    expect(sectionButton).toBeTruthy();
    // The button lives INSIDE the Thông tin hàng section — never a separate
    // schedule band again (SIL-611).
    expect(sectionButton.closest('#shipment-section-cargo')).toBeTruthy();

    fireEvent.click(sectionButton);
    await waitFor(() => expect(appointmentValue(1).date).toBe('20/09/2026'));
    expect(appointmentValue(1).time).toBe('09:00');
    expect(appointmentValue(2).date).toBe('20/09/2026');
    expect(appointmentValue(2).time).toBe('09:00');
    // The source row keeps its own value.
    expect(appointmentValue(0).date).toBe('20/09/2026');
    expect(appointmentValue(0).time).toBe('09:00');
  });

  it('copy-down fills every empty appointment and never touches set rows', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    addContainer();
    fillAppointment(0, '20/09/2026', '09:00');

    fireEvent.click(screen.getByRole('button', { name: /Copy giờ hẹn xuống cont trống/ }));

    await waitFor(() => {
      const dates = [0, 1, 2].map((i) => appointmentValue(i).date);
      expect(dates).toEqual(['20/09/2026', '20/09/2026', '20/09/2026']);
    });
    [0, 1, 2].forEach((i) => expect(appointmentValue(i).time).toBe('09:00'));
    expect(await screen.findByText(/Đã copy ngày giờ đóng trả sang 2 container chưa có lịch/)).toBeTruthy();
  });

  it('keeps the bulk input as a clipboard source but renders no apply chip (SIL-511)', async () => {
    // SIL-511 (owner 26/10): the 'Áp dụng cho N container' chip is retired —
    // TYPING in the bulk field still writes nothing by itself; the apply
    // paths are the copy-down button, the copy-ALL route, and (QA ruling
    // 15:10, ticket 710) the band's own Copy BUTTON — not the input.
    // Locks the removal so a merge cannot resurrect the chip or re-wire an
    // apply on every keystroke.
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

    expect(screen.queryByRole('button', { name: /Áp dụng cho \d+ container/ })).toBeNull();
    // The clipboard copy affordance survives with the complete typed value.
    expect(document.querySelector('.csc-bulk-appointment__copy')).toBeTruthy();
    // No apply path: rows without a schedule stay untouched by this input.
    [1, 2].forEach((i) => {
      expect(appointmentValue(i).date).toBe('');
      expect(appointmentValue(i).time).toBe('');
    });
  });

  // QA ruling 15:10 (retest 30/10, ticket 710) — the band Copy button is a
  // REAL apply path: clipboard-only claimed success ("Đã copy giờ hẹn…")
  // while the submit kept failing "Container N: chọn ngày giờ đóng/trả."
  // CUS-03: clicking it WRITES the shared datetime into every
  // still-unscheduled row — DOM-pin: band filled → Copy clicked → every row
  // input holds the value → submit names no appointment anywhere.
  it('band Copy writes the shared datetime into every unscheduled row and clears the submit appointment error (QA 710)', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    addContainer();

    const bulkDate = document.querySelector<HTMLInputElement>('input[id$="-bulk-appointment-date"]')!;
    const bulkTime = document.querySelector<HTMLInputElement>('input[id$="-bulk-appointment-time"]')!;
    fireEvent.change(bulkDate, { target: { value: '29/10/2026' } });
    fireEvent.change(bulkTime, { target: { value: '08:00' } });

    fireEvent.click(screen.getByRole('button', { name: /Copy giờ hẹn đóng trả/ }));

    // The write lands in every row — with or without a container number.
    await waitFor(() => {
      [0, 1, 2].forEach((i) => {
        expect(appointmentValue(i).date).toBe('29/10/2026');
        expect(appointmentValue(i).time).toBe('08:00');
      });
    });
    expect(await screen.findByText(/Đã copy ngày giờ đóng trả sang 3 container chưa có lịch/)).toBeTruthy();

    // And the per-container requirement is satisfied everywhere: the submit
    // paints other fields' errors per-field (SIL-627: no summary banner) and
    // NO appointment field carries one.
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    await waitFor(() => {
      const paint = document.querySelectorAll(
        '.csc-container-cell--error, [data-uui-control][aria-invalid="true"], input[aria-invalid="true"], .csc-searchable-field--error',
      );
      expect(paint.length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/Cần bổ sung \d+ thông tin/)).toBeNull();
    expect(document.querySelectorAll('[data-field-id$="-customer-appointment"] .csc-container-cell__error')).toHaveLength(0);
  });
});
