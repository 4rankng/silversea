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
  const hh = row?.querySelector<HTMLInputElement>('input[data-seg="hh"]')?.value ?? '';
  const mm = row?.querySelector<HTMLInputElement>('input[data-seg="mm"]')?.value ?? '';
  const dd = row?.querySelector<HTMLInputElement>('input[data-seg="dd"]')?.value ?? '';
  const mm2 = row?.querySelector<HTMLInputElement>('input[data-seg="mm2"]')?.value ?? '';
  const yyyy = row?.querySelector<HTMLInputElement>('input[data-seg="yyyy"]')?.value ?? '';
  return { time: `${hh}:${mm}`, date: [dd, mm2, yyyy].filter(Boolean).join('/') };
}

function fillAppointment(index: number, date: string, time: string) {
  const { date: dateInput, time: timeInput } = appointmentInputs(index);
  fireEvent.change(dateInput, { target: { value: date } });
  fireEvent.change(timeInput, { target: { value: time } });
}

/** The visible error line the appointment cell owns (one per cell). */
function appointmentCellError(): { count: number; text: string } {
  const cell = document.querySelector('[data-field-id$="-customer-appointment"]')!;
  const lines = cell.querySelectorAll('.csc-container-cell__error');
  return { count: lines.length, text: lines[0]?.textContent ?? '' };
}

/** Panel entries carrying the exact missing-schedule message. SIL-627
 *  retired the summary panel — the message now paints per-field only. */
function summaryAppointmentEntries(): Element[] {
  return [...document.querySelectorAll('.csc-validation-summary button')]
    .filter((button) => button.textContent === 'Container 1: chọn ngày giờ đóng/trả.');
}

async function fillIdentity() {
  fireEvent.click(screen.getByRole('combobox', { name: 'Khách hàng' }));
  fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
  fireEvent.click(document.getElementById('shipment-trade-direction')!);
  fireEvent.click(await screen.findByRole('option', { name: 'Nhập khẩu' }));
  const bill = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input');
    expect(el).toBeTruthy();
    return el!;
  });
  fireEvent.change(bill, { target: { value: 'BL-SIL607' } });
}

describe('SIL-607 appointment schedule error (dedupe + copy-all law)', { timeout: 20000 }, () => {
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

  // Ticket 607 symptom: the NGÀY GIỜ ĐÓNG TRẢ column painted the message
  // twice — the cell's error line plus the split-datetime host's own copy
  // (revealed by the submit-fail focus). The cell owns exactly ONE line and
  // the message appears once (SIL-627: the summary panel is retired — the
  // per-field paint is the only surface).
  it('renders the missing-schedule message exactly once per container after a failed submit', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    await fillIdentity();

    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    await waitFor(() => expect(appointmentCellError().count).toBe(1));

    expect(appointmentCellError()).toEqual({ count: 1, text: 'Container 1: chọn ngày giờ đóng/trả.' });
    expect(summaryAppointmentEntries()).toHaveLength(0);
    expect(document.querySelector('.csc-validation-summary')).toBeNull();
    // One message copy per layer: the a11y describedby target stays a single
    // node (its visible twin inside the editor is the CSS-deduped paint).
    expect(document.querySelectorAll('[data-field-id$="-customer-appointment"] .split-datetime__error')).toHaveLength(1);
  });

  // Ticket 607 report: the lot-level band already held "08:00 29/10/2026"
  // yet the per-container error still showed. The band is a clipboard source
  // only (SIL-511/513 owner law — it never writes rows), so per-container
  // stays REQUIRED; the law's fix is the single line, never a duplicate.
  it('keeps exactly one per-container line while the copy-all band alone holds a value', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    await fillIdentity();

    const bulkDate = document.querySelector<HTMLInputElement>('input[id$="-bulk-appointment-date"]')!;
    const bulkTime = document.querySelector<HTMLInputElement>('input[id$="-bulk-appointment-time"]')!;
    expect(bulkDate).toBeTruthy();
    fireEvent.change(bulkDate, { target: { value: '29/10/2026' } });
    fireEvent.change(bulkTime, { target: { value: '08:00' } });

    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    await waitFor(() => expect(appointmentCellError().count).toBe(1));

    expect(appointmentCellError()).toEqual({ count: 1, text: 'Container 1: chọn ngày giờ đóng/trả.' });
    expect(summaryAppointmentEntries()).toHaveLength(0);
  });

  // CUS-03: the copy-all path (copy-down fills every still-empty row) DOES
  // satisfy the per-container requirement — after it runs, no appointment
  // error may remain anywhere.
  it('copy-all fills the empty rows so no per-container appointment error remains', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    fillAppointment(0, '29/10/2026', '08:00');

    fireEvent.click(screen.getByRole('button', { name: /Copy giờ hẹn xuống cont trống/ }));
    await waitFor(() => expect(appointmentValue(1).date).toBe('29/10/2026'));
    expect(appointmentValue(1).time).toBe('08:00');

    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    await waitFor(() => {
      const paint = document.querySelectorAll(
        '.csc-container-cell--error, [data-uui-control][aria-invalid="true"], input[aria-invalid="true"], .csc-searchable-field--error',
      );
      expect(paint.length).toBeGreaterThan(0);
    });

    expect(screen.queryByText(/Cần bổ sung \d+ thông tin/)).toBeNull();
    expect(appointmentCellError().count).toBe(0);
  });
});
