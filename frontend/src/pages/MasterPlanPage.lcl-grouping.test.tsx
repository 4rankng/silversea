/**
 * SPEC 18/10/2026 §2.1–2.2 — Kế hoạch Tổng quát LCL multi-select:
 * every LCL row gets the leading checkbox, grouped lots are refused, the
 * sticky bar carries the "Đang chọn N lô: Tổng …" totals plus the
 * "Lô 1 giữ 100% tiền trả nhà xe" law, and "Gán xe nhóm" opens the same
 * dialog the detailed plan uses.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';
import type { ShipmentListItem } from '../api/shipmentClient';

const { toast, plan } = vi.hoisted(() => ({
  toast: vi.fn(),
  plan: { items: [] as ShipmentListItem[] },
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast, dismiss: vi.fn() }),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: 'DISPATCHER' } }),
}));

vi.mock('../api/configClient', () => ({
  configClient: { getDispatchZones: vi.fn(async () => ({ items: [] })) },
}));

vi.mock('../features/dispatch/master-plan/useDispatchMasterPlan', () => ({
  useDispatchMasterPlan: () => ({
    filters: {
      q: '', tradeDirection: '', allocationStatus: '',
      deliveryDateFrom: '', deliveryDateTo: '', portIds: [], carrierKeys: [], cargoMode: '' as const,
    },
    updateFilters: vi.fn(),
    page: 1,
    setPage: vi.fn(),
    items: plan.items,
    total: plan.items.length,
    totalPages: 1,
    loading: false,
    error: null,
    refetch: vi.fn(),
    replaceItem: vi.fn(),
    pageSize: 20,
    dispatchSummary: null,
    presence: null,
  }),
}));

// The real group dialog mounts on enable; quiet its catalog reads.
vi.mock('../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({ data: [], isLoading: false }),
  useTrucksAndDrivers: () => ({ data: { trucks: [], drivers: [] }, isLoading: false }),
}));
vi.mock('../features/dispatch/master-plan/useCarrierAllocationOptions', () => ({
  useCarrierAllocationOptions: () => ({
    options: [], empty: true, loading: false, error: false, reload: vi.fn(),
  }),
}));

import MasterPlanPage from './MasterPlanPage';

function lclItem(overrides: Partial<ShipmentListItem> = {}): ShipmentListItem {
  return {
    id: 1,
    shipmentCode: 'SS-LCL-1',
    customerName: 'Công ty Lẻ',
    routeName: 'HP — Bắc Ninh',
    factoryName: 'Nhà máy Lẻ',
    blNumber: 'BL-LCL-1',
    bookingRef: null,
    shippingLineName: null,
    tradeDirection: 'IMPORT',
    cargoMode: 'LCL',
    pickupLocation: null,
    deliveryLocation: null,
    expectedDeliveryDate: '2026-10-20',
    customsCutoffAt: null,
    operationalNotes: null,
    cargoWeightKg: '1922.00',
    cargoVolumeCbm: '4.000',
    packageCount: 5,
    packageType: 'PALLET',
    containerCount20: 0,
    containerCount40: 0,
    containerTypeSummary: null,
    totalCargoWeightKg: null,
    allocationStatus: 'NOT_ALLOCATED',
    status: ShipmentStatus.READY_FOR_DISPATCH,
    carrierAllocationSummary: [],
    appointmentGroups: [],
    containerPortGroups: [],
    ...overrides,
  } as ShipmentListItem;
}

const fclItem = (): ShipmentListItem => lclItem({
  id: 9,
  cargoMode: 'FCL',
  blNumber: 'BL-FCL-9',
  containerTypeSummary: '1 x 40DC',
  containerCount40: 1,
});

function mount() {
  return render(<MemoryRouter><MasterPlanPage /></MemoryRouter>);
}

/** Spec 23/10 (261023110000 §2) — the CHỌN column is on-demand: every
 *  grouping flow now starts by flipping the strip's toggle. */
function openMergeMode() {
  fireEvent.click(screen.getByRole('button', { name: '📦 Gộp hàng' }));
}

describe('SPEC 18/10/2026 §2.1–2.2 — master-plan LCL grouping', () => {
  beforeEach(() => {
    toast.mockReset();
    plan.items = [];
  });

  it('default hides the CHỌN column; the toggle reveals it (spec 23/10 §2)', () => {
    plan.items = [lclItem(), fclItem()];
    mount();

    // OFF: no select column, no ticks — the reading table keeps its width.
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(document.querySelector('.master-plan-grid__cell--select')).toBeNull();
    expect(document.querySelector('.master-plan-grid__select-head')).toBeNull();

    openMergeMode();
    expect(screen.getByRole('button', { name: '✕ Thoát gộp hàng' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.master-plan-grid__select-head')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Chọn lô BL-LCL-1' })).toBeTruthy();
  });

  it('gives a checkbox to a lot the Sản lượng count includes even when its payload lacks cargoMode (DOM-vs-visual regression lock)', () => {
    plan.items = [
      // The wire fact the chip counts: an active LCL fulfillment. The
      // cargoMode field itself is MISSING from the payload — the exact shape
      // that once rendered zero checkboxes on real data while every mocked
      // fixture hand-set cargoMode:'LCL' and passed.
      lclItem({ id: 3, blNumber: 'BL-FLAG-3', cargoMode: undefined, hasActiveLclShipment: true }),
      // Legacy payload: no flag yet — the gate falls back to cargoMode.
      lclItem({ id: 4, blNumber: 'BL-LEGACY-4', hasActiveLclShipment: undefined }),
    ] as ShipmentListItem[];
    mount();
    openMergeMode();

    expect(screen.getByRole('checkbox', { name: 'Chọn lô BL-FLAG-3' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Chọn lô BL-LEGACY-4' })).toBeTruthy();
  });

  it('renders the select cell on cont rows dimmed and untouchable once the mode is on (spec 23/10 §2)', () => {
    plan.items = [fclItem()];
    mount();
    openMergeMode();

    // FCL rows read the mode too — a dimmed, disabled tick so the merge
    // selection stays LCL-only (spec: "không tích nhầm hàng Cont").
    const fclTick = screen.getByRole('checkbox', { name: /BL-FCL-9 không tham gia gộp hàng/ });
    expect(fclTick).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('checkbox', { name: 'Chọn lô BL-FCL-9' })).toBeNull();
    expect(document.querySelector('.master-plan-grid__cell--select')).toBeTruthy();
    expect(document.querySelector('.master-plan-grid__select-head')).toBeTruthy();
  });

  it('offers checkboxes on LCL rows only and refuses grouped lots', () => {
    plan.items = [
      lclItem({ id: 1, blNumber: 'BL-LCL-1' }),
      lclItem({ id: 2, blNumber: 'BL-LCL-2', costGroupId: 'grp-1', costGroupOrder: 1 }),
      fclItem(),
    ];
    mount();
    openMergeMode();

    const free = screen.getByRole('checkbox', { name: 'Chọn lô BL-LCL-1' }) as HTMLInputElement;
    const grouped = screen.getByRole('checkbox', { name: 'Chọn lô BL-LCL-2' }) as HTMLInputElement;
    expect(free.disabled).toBe(false);
    expect(grouped.disabled).toBe(true);
    expect(screen.queryByRole('checkbox', { name: 'Chọn lô BL-FCL-9' })).toBeNull();
  });

  it('shows the running totals and the Lô-1 money law, then opens Gán xe nhóm', async () => {
    plan.items = [
      lclItem({ id: 1, blNumber: 'BL-LCL-1' }),
      lclItem({ id: 2, blNumber: 'BL-LCL-2', cargoWeightKg: '1000.00', cargoVolumeCbm: '2.000' }),
    ];
    mount();
    openMergeMode();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BL-LCL-1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BL-LCL-2' }));

    const totals = screen.getByText(
      (_, element) => element?.classList.contains('lcl-selection-bar__totals') ?? false,
    );
    expect(totals.textContent).toContain('Đang chọn 2 lô: Tổng');
    expect(totals.textContent).toContain('tấn');
    expect(totals.textContent).toContain('CBM');
    expect(screen.getByText(/Lô 1 giữ 100% cước trả ĐV: BL-LCL-1/)).toBeTruthy();

    const assign = screen.getByRole('button', { name: 'Gán xe nhóm' });
    expect(assign).not.toHaveAttribute('aria-disabled');
    fireEvent.click(assign);
    await waitFor(() => expect(screen.getByText('Gán xe nhóm', { selector: 'h2, h3, [role="heading"]' })).toBeTruthy());
  });
});
