/**
 * Card 081026093510 — /dispatch "Xuất file Excel" is DATA-DRIVEN (lead ruling
 * 2026-10-08): enabled whenever the dispatcher's current filtered view holds
 * >= 1 row and exports those rows; at 0 rows it disables WITH the reachable
 * "Không có dữ liệu để xuất" explanation.
 *
 * Pattern pinned here: aria-described + aria-disabled — never the `disabled`
 * attribute, which would take the button out of the tab order and kill its
 * mouse events (the exact silence this card fixes). The reason is wired via
 * aria-describedby (focus / assistive tech) and a tooltip bubble revealed on
 * wrapper hover AND focus-within (sighted pointer + keyboard users).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';
import type { ShipmentListItem } from '../api/shipmentClient';
import type * as ShipmentClientModule from '../api/shipmentClient';
import type * as DispatchMasterPlanModule from '../features/dispatch/master-plan/useDispatchMasterPlan';

const { listShipments, downloadCSV, toast, plan } = vi.hoisted(() => ({
  listShipments: vi.fn(),
  downloadCSV: vi.fn(),
  toast: vi.fn(),
  plan: {
    items: [] as ShipmentListItem[],
    total: 0,
    loading: false,
    error: null as string | null,
    refetch: vi.fn(),
  },
}));

vi.mock('../api/shipmentClient', async (importOriginal) => ({
  ...(await importOriginal<typeof ShipmentClientModule>()),
  listShipments,
}));

vi.mock('../lib/csv', () => ({ downloadCSV }));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast, dismiss: vi.fn() }),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: 'ADMIN' } }),
}));

vi.mock('../api/configClient', () => ({
  configClient: { getDispatchZones: vi.fn(async () => ({ items: [] })) },
}));

vi.mock('../features/dispatch/master-plan/useDispatchMasterPlan', async (importOriginal) => ({
  ...(await importOriginal<typeof DispatchMasterPlanModule>()),
  useDispatchMasterPlan: () => ({
    filters: {
      q: '', tradeDirection: '', allocationStatus: '',
      deliveryDateFrom: '', deliveryDateTo: '', portIds: [], carrierKeys: [],
    },
    updateFilters: vi.fn(),
    page: 1,
    setPage: vi.fn(),
    items: plan.items,
    total: plan.total,
    totalPages: 1,
    loading: plan.loading,
    error: plan.error,
    refetch: plan.refetch,
    replaceItem: vi.fn(),
    pageSize: 20,
    dispatchSummary: null,
    presence: null,
  }),
}));

import MasterPlanPage from './MasterPlanPage';

const row = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  id: 1,
  shipmentCode: 'SS-000100',
  customerName: 'Công ty ABC',
  routeName: 'LH — Biên Hòa',
  factoryName: 'Nhà máy XYZ',
  blNumber: 'BL-2026-001',
  bookingRef: null,
  shippingLineName: 'Maersk',
  tradeDirection: 'IMPORT',
  expectedDeliveryDate: '2026-08-20',
  containerCount20: 1,
  containerCount40: 2,
  containerTypeSummary: '2 x 40HC + 1 x 20DC',
  totalCargoWeightKg: 41000,
  allocationStatus: 'NOT_ALLOCATED',
  status: ShipmentStatus.READY_FOR_DISPATCH,
  carrierAllocationSummary: [],
  appointmentGroups: [],
  containerPortGroups: [],
  ...overrides,
} as ShipmentListItem);

function mount() {
  return render(<MemoryRouter><MasterPlanPage /></MemoryRouter>);
}

beforeEach(() => {
  plan.items = [];
  plan.total = 0;
  plan.loading = false;
  plan.error = null;
  plan.refetch.mockReset();
  listShipments.mockReset();
  downloadCSV.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
});

describe('dispatch export button — data-driven enable (card 081026093510)', () => {
  it('with >= 1 row in the filtered view it is enabled and exports those rows', async () => {
    plan.items = [row()];
    plan.total = 1;
    listShipments.mockResolvedValue({ items: [row()], totalPages: 1, total: 1 });
    mount();

    const button = screen.getByRole('button', { name: 'Xuất file Excel' });
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    await waitFor(() => expect(downloadCSV).toHaveBeenCalledTimes(1));
    const [filename, headers, rows] = downloadCSV.mock.calls[0];
    expect(filename).toMatch(/^ke-hoach-tong-quat-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(headers).toEqual([
      'Thời gian & lịch trình',
      'Khách hàng & nhà máy',
      'Tuyến đường & hãng tàu',
      'Cảng nâng',
      'Cảng hạ',
      'Tổng quan hàng hóa',
      'Phân bổ nhà xe',
      'Ghi chú',
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toContain('Công ty ABC');
    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      kind: 'success',
      message: 'Đã xuất 1 lô hàng ra tệp Excel.',
    }));
  });

  it('with 0 rows it is disabled AND explains there is nothing to export', () => {
    plan.items = [];
    plan.total = 0;
    mount();

    const button = screen.getByRole('button', { name: 'Xuất file Excel' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // Never the `disabled` attribute: hover + keyboard focus must reach the
    // control for the explanation to be revealable at all.
    expect(button).not.toBeDisabled();

    const reasonId = button.getAttribute('aria-describedby');
    expect(reasonId).toBeTruthy();
    expect(document.getElementById(reasonId!)?.textContent).toBe('Không có dữ liệu để xuất');
    // The tooltip bubble the wrapper reveals on hover/focus carries the same text.
    const bubbles = Array.from(document.querySelectorAll('.disabled-action-tip__bubble'));
    expect(bubbles.some((bubble) => bubble.textContent === 'Không có dữ liệu để xuất')).toBe(true);

    fireEvent.click(button);
    expect(listShipments).not.toHaveBeenCalled();
    expect(downloadCSV).not.toHaveBeenCalled();
  });

  it('reveals the explanation on hover AND keyboard focus (both CSS paths)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/shared/DisabledActionTip.css'), 'utf8');
    // Hidden until the wrapper is hovered or its action takes focus…
    expect(css).toMatch(/\.disabled-action-tip__bubble\s*{[^}]*display:\s*none/);
    expect(css).toMatch(/\.disabled-action-tip:hover\s+\.disabled-action-tip__bubble/);
    expect(css).toMatch(/\.disabled-action-tip:focus-within\s+\.disabled-action-tip__bubble/);
  });

  it('while the view is loading it explains the wait instead of claiming no data', () => {
    plan.loading = true;
    plan.total = 1;
    plan.items = [row()];
    mount();

    const button = screen.getByRole('button', { name: 'Xuất file Excel' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    const reasonId = button.getAttribute('aria-describedby');
    expect(document.getElementById(reasonId!)?.textContent).toBe('Đang tải dữ liệu…');
    fireEvent.click(button);
    expect(downloadCSV).not.toHaveBeenCalled();
  });

  it('shows the busy label while exporting and blocks re-entry', async () => {
    plan.items = [row()];
    plan.total = 1;
    listShipments.mockResolvedValue({ items: [row()], totalPages: 1, total: 1 });
    let release: () => void = () => {};
    downloadCSV.mockImplementationOnce(() => new Promise<void>((resolvePromise) => { release = resolvePromise; }));
    mount();

    fireEvent.click(screen.getByRole('button', { name: 'Xuất file Excel' }));
    const busy = await screen.findByRole('button', { name: 'Đang xuất…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(busy);
    expect(downloadCSV).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Xuất file Excel' })).toBeTruthy());
  });

  it('surfaces an export failure as the FB-053 error toast', async () => {
    plan.items = [row()];
    plan.total = 1;
    listShipments.mockResolvedValue({ items: [row()], totalPages: 1, total: 1 });
    downloadCSV.mockRejectedValueOnce(new Error('boom'));
    mount();

    fireEvent.click(screen.getByRole('button', { name: 'Xuất file Excel' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      kind: 'error',
      message: 'Chưa xuất được tệp Excel — vui lòng thử lại.',
    }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Xuất file Excel' })).toBeTruthy());
  });
});

describe('same-screen sweep — silent disables now explain themselves', () => {
  it('the error-banner retry explains its busy disable', () => {
    plan.error = 'Không thể tải danh sách lô hàng. Vui lòng thử lại.';
    plan.loading = true;
    mount();

    const retry = screen.getByRole('button', { name: 'Thử lại' });
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(retry).not.toBeDisabled();
    const reasonId = retry.getAttribute('aria-describedby');
    expect(document.getElementById(reasonId!)?.textContent).toBe('Đang tải dữ liệu…');
    fireEvent.click(retry);
    expect(plan.refetch).not.toHaveBeenCalled();
  });

  it('the retry stays actionable once loading settles', () => {
    plan.error = 'Không thể tải danh sách lô hàng. Vui lòng thử lại.';
    plan.loading = false;
    mount();

    const retry = screen.getByRole('button', { name: 'Thử lại' });
    expect(retry).not.toHaveAttribute('aria-disabled');
    fireEvent.click(retry);
    expect(plan.refetch).toHaveBeenCalledTimes(1);
  });
});
