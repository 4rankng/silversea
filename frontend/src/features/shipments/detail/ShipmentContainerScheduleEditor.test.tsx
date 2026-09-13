import { fireEvent, render, screen } from '@testing-library/react';
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
  it('renders giờ before ngày with 24h locale pinned to en-GB', () => {
    const props = baseProps();
    const { container } = render(<ScheduleEditorBody {...props} />);

    // Thứ tự trường khớp định dạng cột bảng "20:45 8/9/26": giờ trước, ngày sau.
    const labels = Array.from(
      container.querySelectorAll('.shipment-container-ledger__editor-grid--schedule label span'),
    );
    expect(labels.map((label) => label.textContent)).toEqual(['Giờ trả hàng', 'Ngày trả hàng']);

    const grid = container.querySelector('.shipment-container-ledger__editor-grid--schedule')!;
    const timeInput = grid.querySelector('input[type="time"]')!;
    const dateInput = grid.querySelector('input[type="date"]')!;
    // DOM order: time input precedes the date input.
    expect(timeInput.compareDocumentPosition(dateInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // ép input hiển thị 24h + dd/mm/yyyy bất kể locale trình duyệt (AM/PM)
    expect(timeInput.getAttribute('lang')).toBe('en-GB');
    expect(dateInput.getAttribute('lang')).toBe('en-GB');
  });

  it('uses đóng-hàng labels for EXPORT rows', () => {
    const props = baseProps({ row: baseRow({ direction: 'EXPORT' }) });
    const { container } = render(<ScheduleEditorBody {...props} />);

    const labels = Array.from(
      container.querySelectorAll('.shipment-container-ledger__editor-grid--schedule label span'),
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
});
