// SIL-546 (id 613) — the REV-group member's visible tag «Ghép thu cước cùng
// Lô 1» beside its 0₫ cước thu, and its lifecycle: it rides rev_group state
// (member Lô 2..N only), so it disappears when the lot leaves the group
// (tách nhóm) and never shows on Lô 1 or ungrouped rows.
//
// AC3 (the CHỌN column auto-hides once the merge completes) is pinned in
// ShipmentDebitPage.lcl-merge.test.tsx ("Finishing the merge hid the CHỌN
// column again") — not duplicated here.
//
// Mirrors ShipmentDebitPage.lcl-merge.test.tsx's mock plane.
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listSummary } = vi.hoisted(() => ({
  getBootstrap: vi.fn(), listSummary: vi.fn(),
}));
const { authRole, phoneFlag } = vi.hoisted(() => ({
  authRole: { value: 'CUS' },
  phoneFlag: { value: false },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: authRole.value } }) }));
vi.mock('../hooks/useMediaQuery', () => ({
  useMediaQuery: (query: string) => query === '(max-width: 640px)' && phoneFlag.value,
}));
vi.mock('../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/shipmentClient')>(),
  listShipmentDebitSummary: listSummary,
  getShipmentDebitDetail: vi.fn(),
}));
vi.mock('../api/shipmentDebit', () => ({
  createDebitNoteBatch: vi.fn(),
  exportDebitNoteFile: vi.fn(),
}));
vi.mock('../api/dispatchPlanningClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/dispatchPlanningClient')>(),
  mergeLclRevGroup: vi.fn(),
  unmergeLclLot: vi.fn(),
  updateLclTruck: vi.fn(),
  assignLclCostGroup: vi.fn(),
}));
const truckClasses = [
  { id: 7, code: '3.5T', name: 'Xe 3.5 tấn', isContainer: false, sortOrder: 2, deletedAt: null },
];
vi.mock('../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({ data: truckClasses, isLoading: false }),
  useTrucksAndDrivers: () => ({ data: { trucks: [], drivers: [] }, isLoading: false }),
}));

import { ToastProvider } from '../components/shared/Toast';
import { ShipmentDebitPage } from './ShipmentDebitPage';
import type { ShipmentDebitLotRow } from '../api/shipmentClient';

function renderPage(initialEntry = '/shipments-debit') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]} initialIndex={0}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentDebitPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const lclRow = (over: Partial<ShipmentDebitLotRow> = {}): ShipmentDebitLotRow => ({
  shipmentId: 101,
  code: 'SHP-26-0001',
  customerName: 'KH A',
  factoryName: null,
  factoryAddress: null,
  billOrBookNumber: 'BL-1',
  customsNumber: null,
  documentsSummary: null,
  freightAuto: null,
  chiHoTotal: null,
  receivableTotal: null,
  payableTotal: null,
  profit: null,
  lockStatus: 'OPEN',
  lockedAt: null,
  cargoMode: 'LCL',
  costGroupId: null,
  costGroupOrder: null,
  revGroupId: null,
  revGroupOrder: null,
  costGroupMemberCount: null,
  revGroupMemberCount: null,
  actualTruckNo: null,
  billingTruckNo: null,
  costVehicleClassCode: null,
  revVehicleClassCode: null,
  revGroupPrincipalRef: null,
  costGroupPrincipalRef: null,
  ...over,
  ...(over.customerId !== undefined ? { customerId: over.customerId } : { customerId: 1 }),
});

beforeEach(() => {
  authRole.value = 'CUS';
  phoneFlag.value = false;
  sessionStorage.clear();
  getBootstrap.mockReset();
  listSummary.mockReset();
  getBootstrap.mockResolvedValue({ customers: [], trucks: [] });
  listSummary.mockResolvedValue({ items: [], total: 0 });
});

describe('SIL-546 — tag "Ghép thu cước cùng Lô 1" trên lô thành viên', () => {
  it('Lô 2..N (rev member) hiện 0₫ + tag HIỂN THỊ đúng trên cell Doanh thu (desktop)', async () => {
    listSummary.mockResolvedValue({
      items: [lclRow({
        receivableTotal: 0,
        freightAuto: 0,
        revGroupId: 'rev-1',
        revGroupOrder: 2,
        revGroupMemberCount: 2,
        revGroupPrincipalRef: 'BL-9',
        freightOverrideReason: 'Ghép thu cước cùng Lô 1',
      })],
      total: 1,
    });
    renderPage();
    await screen.findAllByText('BL-1');

    // The tag is VISIBLE TEXT on the row's receivable cell (not just a
    // hover tooltip) — the spec 23/10 §4.2 ask.
    const row = screen.getAllByText('BL-1')[0].closest('tr')!;
    const tag = within(row).getByText('Ghép thu cước cùng Lô 1');
    expect(tag.classList.contains('shipment-debit-money__mergetag')).toBe(true);
    // The full F-2 reason rides the tooltip.
    expect(tag.getAttribute('title')).toBe('Ghép thu cước cùng Lô 1');
    // The 0₫ figure sits on the same cell (zero state).
    expect(within(row).getByText('0')).toBeTruthy();
  });

  it('Lô 1 (order 1) và lô chưa ghép KHÔNG có tag', async () => {
    listSummary.mockResolvedValue({
      items: [
        lclRow({ billOrBookNumber: 'BL-1', revGroupId: 'rev-1', revGroupOrder: 1, revGroupMemberCount: 2, receivableTotal: 3000000, freightOverrideReason: 'Ghép cước thu khách — Lô 1 giữ 100% cước thu nhóm (3.5T)' }),
        lclRow({ shipmentId: 102, billOrBookNumber: 'BL-2', code: 'SHP-26-0002', receivableTotal: 1200000 }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-1');

    expect(screen.queryByText('Ghép thu cước cùng Lô 1')).toBeNull();
  });

  it('AC2 — tách nhóm (rev_group_id về null) → tag biến mất', async () => {
    listSummary.mockResolvedValue({
      items: [lclRow({
        receivableTotal: null,
        revGroupId: null,
        revGroupOrder: null,
        freightOverrideReason: 'Tách khỏi nhóm ghép — chờ định giá lại',
      })],
      total: 1,
    });
    renderPage();
    await screen.findAllByText('BL-1');

    expect(screen.queryByText('Ghép thu cước cùng Lô 1')).toBeNull();
  });

  it('bản ghi điện thoại: member hiện 0₫ + tag ngay trên thẻ thu gọn', async () => {
    phoneFlag.value = true;
    listSummary.mockResolvedValue({
      items: [lclRow({
        receivableTotal: 0,
        revGroupId: 'rev-1',
        revGroupOrder: 2,
        revGroupMemberCount: 2,
        freightOverrideReason: 'Ghép thu cước cùng Lô 1',
      })],
      total: 1,
    });
    renderPage();
    await screen.findAllByText('BL-1');

    expect(screen.getByTestId('shipment-debit-totals-mobile')).toBeTruthy();
    const tag = screen.getByText('Ghép thu cước cùng Lô 1');
    expect(tag.classList.contains('shipment-debit-row__freight-note')).toBe(true);
  });

  it('tag render kèm tooltip full-reason khi BE stamp lý do dài (trip-less member note)', async () => {
    listSummary.mockResolvedValue({
      items: [lclRow({
        receivableTotal: 0,
        revGroupId: 'rev-1',
        revGroupOrder: 3,
        revGroupMemberCount: 3,
        freightOverrideReason: 'Ghép cước cùng Bill BL-7',
      })],
      total: 1,
    });
    renderPage();
    await screen.findAllByText('BL-1');

    const row = screen.getAllByText('BL-1')[0].closest('tr')!;
    const tag = within(row).getByText('Ghép thu cước cùng Lô 1');
    expect(tag.getAttribute('title')).toBe('Ghép cước cùng Bill BL-7');
  });
});
