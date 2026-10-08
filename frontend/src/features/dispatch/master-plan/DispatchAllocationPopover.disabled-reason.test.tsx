/**
 * Card 20261008_1 sweep — the DispatchAllocationPopover dialog buttons used to
 * disable silently ("Hủy" froze during a save, "Lưu phân bổ" went dark on
 * validation errors with only the notice list saying why). They now ride the
 * aria-described + aria-disabled pattern (components/shared/DisabledActionTip,
 * landed by card 081026093510).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ShipmentListItem } from '../../../api/shipmentClient';

import { DispatchAllocationPopover } from './DispatchAllocationPopover';
import { DispatchAllocationDaySection } from './DispatchAllocationDaySection';

vi.mock('../../../api/tripClient', () => ({
  tripClient: {
    getBootstrap: vi.fn().mockResolvedValue({
      externalCarriers: [
        { id: 77, name: 'HÀ AN', isActive: true },
        { id: 88, name: 'Nam Phong', isActive: true },
      ],
    }),
  },
}));

vi.mock('../../../api/shipmentClient', () => ({
  saveShipmentCarrierAllocations: vi.fn(),
  getCusShipmentWorkspaceDetail: vi.fn().mockResolvedValue(null),
}));

import { saveShipmentCarrierAllocations } from '../../../api/shipmentClient';
import { tripClient } from '../../../api/tripClient';

const bootstrap = {
  externalCarriers: [
    { id: 77, name: 'HÀ AN', isActive: true },
    { id: 88, name: 'Nam Phong', isActive: true },
  ],
};

const shipment = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  id: 1,
  shipmentCode: 'SS-000100',
  version: 4,
  customerName: 'Công ty ABC',
  blNumber: 'BL-2026-001',
  bookingRef: null,
  containerCount20: 2,
  containerCount40: 2,
  containerTypeSummary: '2 x 40HC + 2 x 20DC',
  totalCargoWeightKg: null,
  allocationStatus: 'NOT_ALLOCATED',
  carrierAllocationSummary: [],
  ...overrides,
} as ShipmentListItem);

function reasonOf(button: HTMLElement): string {
  const reasonId = button.getAttribute('aria-describedby');
  expect(reasonId).toBeTruthy();
  return document.getElementById(reasonId!)?.textContent ?? '';
}

beforeEach(() => {
  vi.mocked(saveShipmentCarrierAllocations).mockReset();
  vi.mocked(tripClient.getBootstrap).mockReset();
  vi.mocked(tripClient.getBootstrap).mockResolvedValue(bootstrap as never);
});

describe('DispatchAllocationPopover disabled reasons (card 20261008_1 sweep)', () => {
  it('save explains the specific validation error and stays inert', async () => {
    render(<DispatchAllocationPopover shipment={shipment()} onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByLabelText(/Nhà xe dòng 1/);

    // 3x20' against a 2x20' demand — the exact over-allocation error text
    // is the reason, not a generic "hợp lệ" shrug.
    fireEvent.change(screen.getByLabelText("Số container 20' dòng 1"), { target: { value: '3' } });

    const save = screen.getByRole('button', { name: 'Lưu phân bổ' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).not.toBeDisabled();
    expect(reasonOf(save)).toBe("Container 20' vượt số lượng: gán 3/2.");
    fireEvent.click(save);
    expect(saveShipmentCarrierAllocations).not.toHaveBeenCalled();
  });

  it('while a save is in flight both dialog buttons explain their busy disable', async () => {
    // Executor form on purpose: Promise.withResolvers is outside this
    // project's TS lib (TS2550).
    let resolveSave: (value: unknown) => void = () => {};
    vi.mocked(saveShipmentCarrierAllocations).mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }) as never);
    render(<DispatchAllocationPopover shipment={shipment()} onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByLabelText(/Nhà xe dòng 1/);

    fireEvent.change(screen.getByLabelText("Số container 20' dòng 1"), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText("Số container 40' dòng 1"), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân bổ' }));
    await waitFor(() => expect(saveShipmentCarrierAllocations).toHaveBeenCalledTimes(1));

    const cancel = screen.getByRole('button', { name: 'Hủy' });
    expect(cancel).toHaveAttribute('aria-disabled', 'true');
    expect(cancel).not.toBeDisabled();
    expect(reasonOf(cancel)).toBe('Đang lưu phân bổ — chưa hủy được.');
    // The guard keeps the dialog up mid-save.
    fireEvent.click(cancel);

    const save = screen.getByRole('button', { name: 'Đang lưu…' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).not.toBeDisabled();
    expect(reasonOf(save)).toBe('Đang lưu phân bổ…');

    resolveSave({ shipment: { id: 1, version: 5 }, assignments: [] });
  });

  it('with a valid allocation both actions are armed and save fires', async () => {
    vi.mocked(saveShipmentCarrierAllocations).mockResolvedValue({
      shipment: { id: 1, version: 5 },
      assignments: [],
    } as never);
    const onSaved = vi.fn();
    render(<DispatchAllocationPopover shipment={shipment()} onClose={vi.fn()} onSaved={onSaved} />);
    await screen.findByLabelText(/Nhà xe dòng 1/);

    fireEvent.change(screen.getByLabelText("Số container 20' dòng 1"), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText("Số container 40' dòng 1"), { target: { value: '2' } });

    const cancel = screen.getByRole('button', { name: 'Hủy' });
    const save = screen.getByRole('button', { name: 'Lưu phân bổ' });
    expect(cancel).not.toHaveAttribute('aria-disabled');
    expect(cancel).not.toHaveAttribute('aria-describedby');
    expect(save).not.toHaveAttribute('aria-disabled');
    expect(save).not.toHaveAttribute('aria-describedby');

    fireEvent.click(save);
    await waitFor(() => expect(saveShipmentCarrierAllocations).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('per-day add explains its disable (loading / no free option) and arms when an option is free', () => {
    const onAddRow = vi.fn();
    const day = {
      dateKey: '2026-10-10',
      dateLabel: '10/10/2026',
      factoryName: null,
      demand: { count20: 1, count40: 0 },
      rows: [],
    } as never;
    const validation = {
      assigned20: 0, assigned40: 0, remaining20: 1, remaining40: 0,
      isOver: false, isComplete: false, state: 'partial', rowIssues: [], errors: [],
    } as never;
    const noop = vi.fn();
    const base = { day, dayIndex: 0, isMultiDay: false, validation, globalRowOffset: 0, onUpdateRow: noop, onAddRow, onRemoveRow: noop };

    const view = render(<DispatchAllocationDaySection {...base} options={[]} optionsLoading />);
    const loading = screen.getByRole('button', { name: /Thêm nhà xe/ });
    expect(loading).toHaveAttribute('aria-disabled', 'true');
    expect(reasonOf(loading)).toContain('Đang tải');

    view.rerender(<DispatchAllocationDaySection {...base} options={[{ key: 'x', isActive: false } as never]} optionsLoading={false} />);
    const exhausted = screen.getByRole('button', { name: /Thêm nhà xe/ });
    expect(exhausted).toHaveAttribute('aria-disabled', 'true');
    expect(reasonOf(exhausted)).toContain('Đã gán hết');

    view.rerender(<DispatchAllocationDaySection {...base} options={[{ key: 'x', isActive: true } as never]} optionsLoading={false} />);
    const armed = screen.getByRole('button', { name: /Thêm nhà xe/ });
    expect(armed).not.toHaveAttribute('aria-disabled');
    fireEvent.click(armed);
    expect(onAddRow).toHaveBeenCalledWith(0);
  });
});
