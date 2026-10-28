// SIL-549 (id 616, spec 23/10 §2 "UX hỗ trợ") — in [📦 Gộp hàng] mode on Chi
// phí - Quyết toán the CHỌN tick lives on LÔ LẺ (LCL) rows ONLY. A FCL row
// renders no enabled checkbox (a muted dash keeps the column aligned), its
// row-click select-alias is inert, and the page's selectLot still refuses a
// programmatic FCL tick with the law named (the SIL-544 refusal pattern).
// Mirrors ShipmentDebitPage.same-customer-gate.test.tsx's mock plane.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
vi.mock('../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({ data: [], isLoading: false }),
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

const row = (over: Partial<ShipmentDebitLotRow> = {}): ShipmentDebitLotRow => ({
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

const enterMergeMode = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Gộp hàng', pressed: false }));
};

describe('SIL-549 — CHỌN chỉ trên dòng Hàng lẻ (LCL)', () => {
  it('mode gộp ON: dòng LCL có checkbox, dòng FCL không có (ô để gạch mờ, cột vẫn thẳng hàng)', async () => {
    listSummary.mockResolvedValue({
      items: [
        row({ billOrBookNumber: 'BL-LCL-1' }),
        row({ shipmentId: 202, code: 'SHP-26-0002', billOrBookNumber: 'BL-FCL-1', cargoMode: 'FCL' }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-LCL-1');

    enterMergeMode();
    expect(screen.getByRole('checkbox', { name: 'Chọn lô BL-LCL-1' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Chọn lô BL-FCL-1' })).toBeNull();
    // The FCL row's select cell carries the muted dash, keeping the 11-column
    // grid aligned.
    const fclRow = screen.getAllByText('BL-FCL-1')[0].closest('tr')!;
    expect(fclRow.querySelector('td.shipment-debit-cell--select')?.textContent).toBe('—');
  });

  it('click vào dòng FCL trong mode → không vào selection, không bar (select-alias bất động)', async () => {
    listSummary.mockResolvedValue({
      items: [
        row({ billOrBookNumber: 'BL-LCL-1' }),
        row({ shipmentId: 202, code: 'SHP-26-0002', billOrBookNumber: 'BL-FCL-1', cargoMode: 'FCL' }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-LCL-1');

    enterMergeMode();
    // The select-alias on the FCL row is inert — no bar, no toast.
    fireEvent.click(screen.getAllByText('BL-FCL-1')[0].closest('tr')!);
    expect(screen.queryByText(/Đang chọn/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    // The LCL row's alias still works — the bar counts ONE lot (the FCL one
    // can never join).
    fireEvent.click(screen.getAllByText('BL-LCL-1')[0].closest('tr')!);
    expect(await screen.findByText(/Đang chọn 1 lô/)).toBeTruthy();
  });

  it('dòng LCL vẫn tick bình thường (không hồi quy SIL-544/538)', async () => {
    listSummary.mockResolvedValue({
      items: [
        row({ billOrBookNumber: 'BL-LCL-1' }),
        row({ shipmentId: 203, code: 'SHP-26-0003', billOrBookNumber: 'BL-LCL-2' }),
        row({ shipmentId: 204, code: 'SHP-26-0004', billOrBookNumber: 'BL-FCL-1', cargoMode: 'FCL' }),
      ],
      total: 3,
    });
    renderPage();
    await screen.findAllByText('BL-LCL-1');

    enterMergeMode();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BL-LCL-1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BL-LCL-2' }));
    // Row-click alias still works for the LCL row.
    fireEvent.click(screen.getAllByText('BL-LCL-2')[0].closest('tr')!);
    fireEvent.click(screen.getAllByText('BL-LCL-2')[0].closest('tr')!);

    await waitFor(() => {
      expect(screen.getByText(/Đang chọn 2 lô/)).toBeTruthy();
    });
  });

  it('bản ghi điện thoại: card FCL không có checkbox chọn', async () => {
    phoneFlag.value = true;
    listSummary.mockResolvedValue({
      items: [
        row({ billOrBookNumber: 'BL-LCL-1' }),
        row({ shipmentId: 202, code: 'SHP-26-0002', billOrBookNumber: 'BL-FCL-1', cargoMode: 'FCL' }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-LCL-1');

    enterMergeMode();
    expect(screen.getByRole('checkbox', { name: 'Chọn BL-LCL-1' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Chọn BL-FCL-1' })).toBeNull();
  });
});
