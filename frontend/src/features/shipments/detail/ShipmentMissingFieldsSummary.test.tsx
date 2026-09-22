import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentCusContainerFlatRow, ShipmentCusMissingField } from '@tingting/shared';
import { ShipmentMissingFieldsSummary } from './ShipmentMissingFieldsSummary';

const row = { id: 31, ordinal: 2, containerNumber: 'MSKU1234567' } as ShipmentCusContainerFlatRow;

const FIELDS: ShipmentCusMissingField[] = [
  { code: 'CONTAINER_NUMBER', label: 'Số container' },
  { code: 'DECLARATION', label: 'Tờ khai' },
  { code: 'BKS', label: 'Biển số xe' },
];

function renderSummary(overrides: Partial<Parameters<typeof ShipmentMissingFieldsSummary>[0]> = {}) {
  const onStartEdit = vi.fn();
  render(
    <ShipmentMissingFieldsSummary
      row={row}
      missingFields={FIELDS}
      editableModes={{ documents: true, container: true, route: true, schedule: true, vehicle: true }}
      editLocked={false}
      onStartEdit={onStartEdit}
      {...overrides}
    />,
  );
  return { onStartEdit };
}

function expand() {
  fireEvent.click(screen.getByRole('button', { name: /^Thiếu 3 thông tin/ }));
}

describe('ShipmentMissingFieldsSummary', () => {
  it('collapses to one count line — no field labels render until expanded', () => {
    renderSummary();
    const toggle = screen.getByRole('button', { name: /^Thiếu 3 thông tin/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Số container')).toBeNull();
    expect(screen.queryByText('Tờ khai')).toBeNull();
    expect(screen.queryByText('Biển số xe')).toBeNull();
  });

  it('expands to every missing field; the count equals the rendered list', () => {
    renderSummary();
    expand();
    const toggle = screen.getByRole('button', { name: /^Thiếu 3 thông tin/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // aria-controls points at the rendered list's id.
    const list = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(list).toBeTruthy();
    // Mapped fields render as actionable buttons (native role preserved) —
    // 2 buttons + the 1 non-actionable external item.
    expect(list!.querySelectorAll('.shipment-container-ledger__missing-fields-item')).toHaveLength(3);
    expect(list!.querySelectorAll('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Số container' })).toBeTruthy();
    expect(screen.getByText('Tờ khai')).toBeTruthy();
  });

  it('pressing a mapped field opens the inline editor that owns it', () => {
    const { onStartEdit } = renderSummary();
    expand();
    const containerField = screen.getByRole('button', { name: 'Số container' });
    fireEvent.click(containerField);
    expect(onStartEdit).toHaveBeenCalledTimes(1);
    expect(onStartEdit).toHaveBeenCalledWith(row, 'container', 'shipment-detail-missing-CONTAINER_NUMBER-31');
    // The trigger id IS the button's id — focus restoration after the editor
    // closes looks the trigger up by id, so it must land back here.
    expect(document.getElementById('shipment-detail-missing-CONTAINER_NUMBER-31')).toBe(containerField);
    fireEvent.click(screen.getByRole('button', { name: 'Biển số xe' }));
    expect(onStartEdit).toHaveBeenLastCalledWith(row, 'vehicle', 'shipment-detail-missing-BKS-31');
  });

  it('renders DECLARATION as a plain item — its editor is the controlled document flow, not the ledger', () => {
    const { onStartEdit } = renderSummary();
    expand();
    const declaration = screen.getByText('Tờ khai');
    expect(declaration.tagName).toBe('SPAN');
    expect(declaration.getAttribute('title')).toBe('Tờ khai dùng luồng chứng từ có kiểm soát riêng');
    fireEvent.click(declaration);
    expect(onStartEdit).not.toHaveBeenCalled();
  });

  it('disables a destination button when its cell is read-only', () => {
    const { onStartEdit } = renderSummary({
      editableModes: { documents: true, container: false, route: true, schedule: true, vehicle: true },
    });
    expand();
    const containerField = screen.getByRole('button', { name: 'Số container' });
    expect(containerField).toBeDisabled();
    fireEvent.click(containerField);
    expect(onStartEdit).not.toHaveBeenCalled();
    // Other destinations stay actionable.
    expect(screen.getByRole('button', { name: 'Biển số xe' })).toBeEnabled();
  });

  it('locks every destination while an inline edit is open', () => {
    renderSummary({ editLocked: true });
    expand();
    expect(screen.getByRole('button', { name: 'Số container' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Biển số xe' })).toBeDisabled();
  });

  it('names the missing field when there is exactly one (card 20260922_24)', () => {
    renderSummary({ missingFields: [{ code: 'TRANSPORT_DATE', label: 'Ngày vận chuyển' }] });
    // A bare "Thiếu dữ liệu" contradicted rows that were otherwise complete and
    // never said what was missing; the single-field case must name it.
    expect(screen.getByRole('button', { name: /^Thiếu Ngày vận chuyển/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Thiếu dữ liệu/ })).toBeNull();
  });

  it('toggles closed again — the row returns to the compact single line', () => {
    renderSummary();
    expand();
    fireEvent.click(screen.getByRole('button', { name: /^Thiếu 3 thông tin/ }));
    expect(screen.queryByText('Số container')).toBeNull();
    expect(screen.getByRole('button', { name: /^Thiếu 3 thông tin/ }).getAttribute('aria-expanded')).toBe('false');
  });
});
