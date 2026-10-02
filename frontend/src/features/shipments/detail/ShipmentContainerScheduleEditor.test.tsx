import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentCusContainerFlatRow } from '@tingting/shared';
import { ScheduleEditorBody } from './ShipmentContainerScheduleEditor';

const baseRow = (overrides: Partial<ShipmentCusContainerFlatRow> = {}) => ({
  ordinal: 1,
  containerNumber: 'MSKU1234567',
  direction: 'IMPORT',
  ...overrides,
}) as ShipmentCusContainerFlatRow;

const baseProps = (overrides: Record<string, unknown> = {}) => ({
  row: baseRow(),
  appointmentDate: '2026-09-10',
  scheduleTime: '08:00',
  saving: false,
  canEdit: true,
  onAppointmentDateChange: vi.fn(),
  onScheduleTimeChange: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
});

describe('ScheduleEditorBody', () => {
  it('uses the Vietnam business day for every quick date across a device midnight', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-16T16:30:00Z'));
    try {
      const props = baseProps({ appointmentDate: '', scheduleTime: '' });
      render(<ScheduleEditorBody {...props} />);
      for (const [label, day] of [['Hôm nay', '16'], ['Ngày mai', '17'], ['Ngày kia', '18']]) {
        fireEvent.click(screen.getByRole('button', { name: label }));
        expect(props.onAppointmentDateChange).toHaveBeenLastCalledWith(`2026-09-${day}`);
      }
      fireEvent.click(screen.getByRole('button', { name: '13:30' }));
      expect(props.onAppointmentDateChange).toHaveBeenLastCalledWith('2026-09-16');
    } finally { vi.useRealTimers(); }
  });
  it('renders the editor header without a calendar icon', () => {
    const props = baseProps();
    const { container } = render(<ScheduleEditorBody {...props} />);
    // The header icon crowded the narrow cell tray; the user asked for it gone.
    expect(container.querySelector('.shipment-container-ledger__schedule-title svg')).toBeNull();
    expect(screen.getByText('Chỉnh sửa lịch trình')).toBeTruthy();
  });

  it('renders giờ before ngày with locale-independent 24h text entry', () => {
    const props = baseProps();
    const { container } = render(<ScheduleEditorBody {...props} />);

    // Thứ tự trường khớp định dạng cột bảng "20:45 8/9/26": giờ trước, ngày sau.
    const grid = container.querySelector('.shipment-container-ledger__editor-grid--schedule')!;
    const labels = Array.from(grid.querySelectorAll('label'));
    expect(labels.map((label) => label.textContent)).toEqual(['Giờ trả hàng', 'Ngày trả hàng']);

    const timeInput = grid.querySelector('input[type="text"][placeholder="HH:mm"]')!;
    const dateInput = grid.querySelector('input[data-date-input]')!;
    // DOM order: time input precedes the date input.
    expect(timeInput.compareDocumentPosition(dateInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Explicit 24h text entry avoids AM/PM; the buffered date field shows
    // DD/MM/YYYY as three digit segments.
    expect(timeInput.getAttribute('placeholder')).toBe('HH:mm');
    expect((timeInput as HTMLInputElement).value).toBe('08:00');
    expect(dateInput.getAttribute('placeholder')).toBe('DD');
    expect((dateInput as HTMLInputElement).value).toBe('10');
    const dateGroup = dateInput.closest('[data-seg-part="date"]')!;
    expect((dateGroup.querySelector('input[data-seg="mm2"]') as HTMLInputElement).value).toBe('09');
    expect((dateGroup.querySelector('input[data-seg="yyyy"]') as HTMLInputElement).value).toBe('2026');
  });

  it('uses đóng-hàng labels for EXPORT rows', () => {
    const props = baseProps({ row: baseRow({ direction: 'EXPORT' }) });
    const { container } = render(<ScheduleEditorBody {...props} />);

    const grid = container.querySelector('.shipment-container-ledger__editor-grid--schedule')!;
    const labels = Array.from(grid.querySelectorAll('label'));
    expect(labels.map((label) => label.textContent)).toEqual(['Giờ đóng hàng', 'Ngày đóng hàng']);
  });

  it('defaults the schedule time when a quick-day pill is tapped without a time', () => {
    const props = baseProps({ scheduleTime: '' });
    render(<ScheduleEditorBody {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ngày mai' }));
    expect(props.onAppointmentDateChange).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(props.onScheduleTimeChange).toHaveBeenCalledWith('08:00');
  });

  it('defaults the appointment date when a common-hour pill is tapped without a date', () => {
    const props = baseProps({ appointmentDate: '' });
    render(<ScheduleEditorBody {...props} />);

    fireEvent.click(screen.getByRole('button', { name: '13:30' }));
    expect(props.onScheduleTimeChange).toHaveBeenCalledWith('13:30');
    expect(props.onAppointmentDateChange).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('offers the lot transport date on non-FCL rows and reports complete-date changes', () => {
    const onTransportDateChange = vi.fn();
    const props = baseProps({
      cargoMode: 'LCL',
      transportDate: '2026-09-14',
      canEditTransport: true,
      onTransportDateChange,
    });
    const { container } = render(<ScheduleEditorBody {...props} />);

    // Appointment date + the lot transport date — the transport input is the
    // second buffered date field, under its own section.
    const dateInputs = Array.from(container.querySelectorAll('input[data-date-input]'));
    expect(dateInputs).toHaveLength(2);
    const transport = dateInputs[1];
    const transportGroup = transport.closest('[data-seg-part="date"]')!;
    const segValue = (key: string) => (transportGroup.querySelector(`input[data-seg="${key}"]`) as HTMLInputElement).value;
    expect((transport as HTMLInputElement).value).toBe('14');
    expect(segValue('mm2')).toBe('09');
    expect(segValue('yyyy')).toBe('2026');
    expect(screen.getByText('Ngày vận chuyển')).toBeTruthy();
    // The buffered field emits ISO only for complete DD/MM/YYYY entries (the
    // DD slot distributes a pasted full date across the segments).
    fireEvent.change(transport, { target: { value: '20/09/2026' } });
    expect(onTransportDateChange).toHaveBeenCalledWith('2026-09-20');
  });

  it('renders no lot transport date on FCL rows — it derives from the appointments', () => {
    const props = baseProps({ cargoMode: 'FCL' });
    const { container } = render(<ScheduleEditorBody {...props} />);

    expect(container.querySelectorAll('input[data-date-input]')).toHaveLength(1);
    expect(screen.queryByText('Ngày vận chuyển')).toBeNull();
  });

  it('disables the lot transport date while saving or when the shipment schedule is read-only', () => {
    const props = baseProps({ cargoMode: 'LCL', canEditTransport: false });
    const { container, rerender } = render(<ScheduleEditorBody {...props} />);
    expect((container.querySelectorAll('input[data-date-input]')[1] as HTMLInputElement).disabled).toBe(true);

    rerender(<ScheduleEditorBody {...baseProps({ cargoMode: 'LCL', canEditTransport: true, saving: true })} />);
    expect((container.querySelectorAll('input[data-date-input]')[1] as HTMLInputElement).disabled).toBe(true);
  });

  it('accepts arbitrary 24h minutes and selects from the shared time panel', async () => {
    const props = baseProps();
    render(<ScheduleEditorBody {...props} />);
    const timeField = screen.getByLabelText('Giờ trả hàng');
    fireEvent.change(timeField, { target: { value: '20:46' } });
    expect(props.onScheduleTimeChange).toHaveBeenCalledWith('20:46');

    // The shared panel opens on click and carries the driver-facing listboxes.
    fireEvent.click(timeField);
    const panel = screen.getByRole('dialog', { name: 'Chọn giờ (24h) — Giờ trả hàng' });
    const minuteList = within(panel).getByRole('listbox', { name: 'Phút 00–59' });
    fireEvent.click(minuteList.querySelector('[role=option]')!);
    // Picking a minute keeps the panel open — only Xong (or dismissal) closes.
    expect(screen.getByRole('dialog', { name: 'Chọn giờ (24h) — Giờ trả hàng' })).toBeInTheDocument();
    expect(props.onScheduleTimeChange).toHaveBeenCalledWith('08:00');

    // Xong is the explicit close.
    fireEvent.click(within(panel).getByRole('button', { name: 'Xong' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Giờ trả hàng')).toHaveFocus();

    // Reopen from the keyboard and dismiss with Escape.
    fireEvent.keyDown(screen.getByLabelText('Giờ trả hàng'), { key: 'ArrowDown', altKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText('Giờ trả hàng'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Giờ trả hàng')).toHaveFocus();
  });

  it.each([{ saving: true }, { canEdit: false }])('disables every scheduling shortcut when input is unavailable: %o', (state) => {
    render(<ScheduleEditorBody {...baseProps(state)} />);
    expect(screen.getByRole('button', { name: 'Ngày mai' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '13:30' })).toBeDisabled();
    expect(screen.getByLabelText('Giờ trả hàng')).toBeDisabled();
  });

});
