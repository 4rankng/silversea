// SIL-544 (id 611) — the CUS "Gộp xe thu khách" check-time same-customer gate
// on Chi phí - Quyết toán (spec 23/10 §4.2): ticking a lot of ANOTHER customer
// is refused AT the tick — the row never joins the floating selection bar and
// the error names the refused lot and its customer — never only at the merge
// popup (the dialog gate + server 400 stay as the later authorities).
//
// Mirrors ShipmentDebitPage.lcl-merge.test.tsx's mock plane; the assertions
// here pin the tick-time refusal, not the merge send. The phone case pins the
// same refusal through ShipmentDebitRecords (both surfaces feed ONE selectLot).
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
  // The page asks two queries: the phone band and print. Only the phone band
  // follows the flag; print stays false so `phone && !print` holds.
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
  // AFTER the spread so an explicit `customerId: null` survives (the helper's
  // `?? 1` default is only for the undefined case).
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

/** SIL-538 — flip the filter-strip [Gộp hàng] mode ON, then pick by the row's
 *  select-alias click. */
const pickLot = (label: string) => {
  const toggle = screen.queryByRole('button', { name: 'Gộp hàng', pressed: false });
  if (toggle) fireEvent.click(toggle);
  fireEvent.click(screen.getAllByText(label)[0].closest('tr')!);
};

describe('SIL-544 — tick-time same-customer gate', () => {
  it('tích lô khác khách → lỗi ngay khi tích, nêu rõ lô + khách; dòng KHÔNG vào thanh chọn nổi', async () => {
    listSummary.mockResolvedValue({
      items: [
        lclRow(),
        lclRow({ shipmentId: 102, code: 'SHP-26-0002', billOrBookNumber: 'BL-2', customerName: 'KH B', customerId: 2 }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-1');

    pickLot('BL-1');
    expect(screen.getByText(/Đang chọn 1 lô/)).toBeTruthy();

    // The refused tick: through the row's checkbox (the AC's literal "tích").
    const box = screen.getByRole('checkbox', { name: 'Chọn lô BL-2' }) as HTMLInputElement;
    fireEvent.click(box);

    // The error names the refused lot AND its customer (AC 1).
    expect(await screen.findByText(/Lô BL-2 thuộc khách hàng KH B/)).toBeTruthy();
    expect(screen.getByText(/Chỉ gộp được các lô của cùng một khách hàng/)).toBeTruthy();
    // The row never joined the selection (the bar still counts one lot).
    expect(screen.getByText(/Đang chọn 1 lô/)).toBeTruthy();
    expect(box.checked).toBe(false);
  });

  it('các lô cùng khách → tích bình thường, thanh chọn nổi đủ N lô', async () => {
    listSummary.mockResolvedValue({
      items: [
        lclRow(),
        lclRow({ shipmentId: 103, code: 'SHP-26-0003', billOrBookNumber: 'BL-3', customerId: 1 }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-1');

    pickLot('BL-1');
    pickLot('BL-3');
    await waitFor(() => {
      expect(screen.getByText(/Đang chọn 2 lô/)).toBeTruthy();
    });
  });

  it('lô chưa xác định khách hàng → chặn với lỗi riêng (BE law: null khách = xung đột)', async () => {
    listSummary.mockResolvedValue({
      items: [
        lclRow(),
        lclRow({ shipmentId: 104, code: 'SHP-26-0004', billOrBookNumber: 'BL-4', customerName: null, customerId: null }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-1');

    pickLot('BL-1');
    const box = screen.getByRole('checkbox', { name: 'Chọn lô BL-4' });
    fireEvent.click(box);

    expect(await screen.findByText(/Lô BL-4 chưa xác định khách hàng/)).toBeTruthy();
    expect(screen.getByText(/Đang chọn 1 lô/)).toBeTruthy();
  });

  it('bản ghi điện thoại cùng trang cũng bị chặn (cùng một selectLot)', async () => {
    phoneFlag.value = true;
    listSummary.mockResolvedValue({
      items: [
        lclRow(),
        lclRow({ shipmentId: 102, code: 'SHP-26-0002', billOrBookNumber: 'BL-2', customerName: 'KH B', customerId: 2 }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-1');

    // Phone records have no <tr> — the mode toggle and the records' own
    // checkboxes drive the same selectLot.
    fireEvent.click(screen.getByRole('button', { name: 'Gộp hàng', pressed: false }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn BL-1' }));
    expect(screen.getByTestId('shipment-debit-totals-mobile')).toBeTruthy();

    // The records' own tick — LedgerGroupedList's per-row checkbox.
    const refused = screen.getByRole('checkbox', { name: 'Chọn BL-2' }) as HTMLInputElement;
    fireEvent.click(refused);

    expect(await screen.findByText(/Lô BL-2 thuộc khách hàng KH B/)).toBeTruthy();
    expect(screen.getByText(/Đang chọn 1 lô/)).toBeTruthy();
    expect(refused.checked).toBe(false);
  });
});
