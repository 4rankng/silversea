import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it('renders giờ before ngày with locale-independent 24h text entry', () => {
    const props = baseProps();
    const { container } = render(<ScheduleEditorBody {...props} />);

    // Thứ tự trường khớp định dạng cột bảng "20:45 8/9/26": giờ trước, ngày sau.
    const labels = Array.from(
      container.querySelectorAll('.shipment-container-ledger__editor-grid--schedule label > span:first-child'),
    );
    expect(labels.map((label) => label.textContent)).toEqual(['Giờ trả hàng', 'Ngày trả hàng']);

    const grid = container.querySelector('.shipment-container-ledger__editor-grid--schedule')!;
    const timeInput = grid.querySelector('input[type="text"]')!;
    const dateInput = grid.querySelector('input[type="date"]')!;
    // DOM order: time input precedes the date input.
    expect(timeInput.compareDocumentPosition(dateInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Native time fields ignore lang on some browsers; explicit text avoids AM/PM.
    expect(timeInput.getAttribute('placeholder')).toBe('HH:mm');
    expect((timeInput as HTMLInputElement).value).toBe('08:00');
    expect(dateInput.getAttribute('lang')).toBe('en-GB');
  });

  it('uses đóng-hàng labels for EXPORT rows', () => {
    const props = baseProps({ row: baseRow({ direction: 'EXPORT' }) });
    const { container } = render(<ScheduleEditorBody {...props} />);

    const labels = Array.from(
      container.querySelectorAll('.shipment-container-ledger__editor-grid--schedule label > span:first-child'),
    );
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
    // second date field, under its own section.
    const dateInputs = Array.from(container.querySelectorAll('input[type="date"]'));
    expect(dateInputs).toHaveLength(2);
    const transport = dateInputs[1];
    expect((transport as HTMLInputElement).value).toBe('2026-09-14');
    expect(screen.getByText('Ngày vận chuyển')).toBeTruthy();
    fireEvent.change(transport, { target: { value: '2026-09-20' } });
    expect(onTransportDateChange).toHaveBeenCalledWith('2026-09-20');
  });

  it('renders no lot transport date on FCL rows — it derives from the appointments', () => {
    const props = baseProps({ cargoMode: 'FCL' });
    const { container } = render(<ScheduleEditorBody {...props} />);

    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(1);
    expect(screen.queryByText('Ngày vận chuyển')).toBeNull();
  });

  it('disables the lot transport date while saving or when the shipment schedule is read-only', () => {
    const props = baseProps({ cargoMode: 'LCL', canEditTransport: false });
    const { container, rerender } = render(<ScheduleEditorBody {...props} />);
    expect((container.querySelectorAll('input[type="date"]')[1] as HTMLInputElement).disabled).toBe(true);

    rerender(<ScheduleEditorBody {...baseProps({ cargoMode: 'LCL', canEditTransport: true, saving: true })} />);
    expect((container.querySelectorAll('input[type="date"]')[1] as HTMLInputElement).disabled).toBe(true);
  });
  it('accepts arbitrary 24h minutes and selects from the shared time panel', async () => {
    const props = baseProps();
    render(<ScheduleEditorBody {...props} />);
    fireEvent.change(screen.getByLabelText('Giờ trả hàng'), { target: { value: '20:46' } });
    expect(props.onScheduleTimeChange).toHaveBeenCalledWith('20:46');
    fireEvent.click(screen.getByLabelText('Giờ trả hàng'));
    const minutePanel = screen.getByRole('listbox', { name: 'Phút 00–59' });
    fireEvent.click(minutePanel.querySelector('[role=option]')!);
    expect(props.onScheduleTimeChange).toHaveBeenCalledWith('08:00');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Giờ trả hàng')).toHaveFocus();
    fireEvent.keyDown(screen.getByLabelText('Giờ trả hàng'), { key: 'ArrowDown', altKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Giờ trả hàng')).toHaveFocus();
  });

  it.each([{ saving: true }, { canEdit: false }])('disables every scheduling shortcut when input is unavailable: %o', (state) => {
    render(<ScheduleEditorBody {...baseProps(state)} />);
    expect(screen.getByRole('button', { name: 'Ngày mai' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '13:30' })).toBeDisabled();
    expect(screen.getByLabelText('Giờ trả hàng')).toBeDisabled();
  });

});
