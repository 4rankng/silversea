/**
 * F-2 (card 161026113900, owner ruling b) — the money column reflects the
 * override channel: a member's CƯỚC VẬN TẢI (AUTO) cell reads 0₫ with the
 * override reason as the spec §3.2 "chú thích nhỏ bên dưới"; a lot whose
 * freight came from the snapshot channel carries no note.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listSummary } = vi.hoisted(() => ({
  getBootstrap: vi.fn(), listSummary: vi.fn(),
}));
const { authRole } = vi.hoisted(() => ({ authRole: { value: 'CUS' } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: authRole.value } }) }));
vi.mock('../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/shipmentClient')>(),
  listShipmentDebitSummary: listSummary,
  getShipmentDebitDetail: vi.fn(),
  createDebitNoteBatch: vi.fn(),
  exportDebitNoteFile: vi.fn(),
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/shipments-debit?customer=1']} initialIndex={0}>
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
  customerId: over.customerId ?? 1,
});

beforeEach(() => {
  authRole.value = 'CUS';
  sessionStorage.clear();
  getBootstrap.mockReset();
  listSummary.mockReset();
  getBootstrap.mockResolvedValue({ customers: [{ id: 1, name: 'KH A' }], trucks: [] });
  listSummary.mockResolvedValue({ items: [], total: 0 });
});

describe('F-2 — Cước vận tải (Auto) đọc kênh ghi đè (ruling b)', () => {
  it('renders the member 0₫ with the "Ghép cước cùng Bill" marker on the money cell', async () => {
    listSummary.mockResolvedValue({
      items: [
        lclRow({
          shipmentId: 201, billOrBookNumber: 'BL-P', code: 'SHP-26-0201',
          freightAuto: 3150000, receivableTotal: 3150000,
          revGroupId: 'rev-1', revGroupOrder: 1, revGroupMemberCount: 2,
        }),
        lclRow({
          shipmentId: 202, billOrBookNumber: 'BL-M', code: 'SHP-26-0202',
          freightAuto: 0, receivableTotal: 0,
          revGroupId: 'rev-1', revGroupOrder: 2, revGroupMemberCount: 2,
          revGroupPrincipalRef: 'BL-P',
          freightOverrideReason: 'Ghép cước cùng Bill BL-P',
        }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-P');

    // Redesign 23/10: the note is a one-glyph marker on the Doanh thu cell
    // (one baseline per cell) with the full reason in its tooltip.
    const marker = screen.getByTitle('Ghép cước cùng Bill BL-P');
    expect(marker.getAttribute('aria-label')).toBe('Ghi chú cước: Ghép cước cùng Bill BL-P');
    const cell = marker.closest('td')!;
    expect(cell.getAttribute('data-col')).toBe('receivable');
    // The member's money reads the real computed 0 (đã tính, = 0).
    expect(cell.textContent).toContain('0');

    // The principal carries 100% and NO marker (the snapshot-look of the cell
    // is unchanged when the override channel set no stamp).
    const principalRow = screen.getAllByText('BL-P')[0]!.closest('tr')!;
    expect(principalRow.querySelector('.shipment-debit-money__note')).toBeNull();
    expect(principalRow.textContent).toContain('3.150.000');
  });

  it('renders no marker when the snapshot channel produced the freight', async () => {
    listSummary.mockResolvedValue({
      items: [lclRow({ shipmentId: 203, billOrBookNumber: 'BL-S', code: 'SHP-26-0203', freightAuto: 1234000, receivableTotal: 1234000 })],
      total: 1,
    });
    renderPage();
    await screen.findAllByText('BL-S');
    expect(screen.getAllByText('1.234.000').length).toBeGreaterThan(0);
    expect(document.querySelector('.shipment-debit-money__note')).toBeNull();
  });
});

// BD-01/BD-03 (card 161026204709): the phone row renderer is a separate
// surface — LedgerRecordList folds every non-primary fact into a closed
// 'Chi tiết' disclosure — so the lane law must hold there too.
const originalMedia = window.matchMedia;
/** jsdom has no viewport media engine; this is the browser API polyfill. */
function viewport(width: number) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: width <= Number(query.match(/max-width:\s*(\d+)/)?.[1] ?? 0),
    media: query, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  });
}
afterEach(() => { window.matchMedia = originalMedia; });

describe('BD-01 (161026204709) — phone card face keeps the merged 100%/0₫ lane visible', () => {
  it('renders principal lane price + member 0₫ and reason outside the Chi tiết disclosure', async () => {
    viewport(390);
    listSummary.mockResolvedValue({
      items: [
        lclRow({
          shipmentId: 201, billOrBookNumber: 'BL-P', code: 'SHP-26-0201',
          freightAuto: 3150000, receivableTotal: 3150000,
          revGroupId: 'rev-1', revGroupOrder: 1, revGroupMemberCount: 2,
        }),
        lclRow({
          shipmentId: 202, billOrBookNumber: 'BL-M', code: 'SHP-26-0202',
          freightAuto: 0, receivableTotal: 0,
          revGroupId: 'rev-1', revGroupOrder: 2, revGroupMemberCount: 2,
          revGroupPrincipalRef: 'BL-P',
          freightOverrideReason: 'Ghép cước cùng Bill BL-P',
        }),
        lclRow({ shipmentId: 203, billOrBookNumber: 'BL-S', code: 'SHP-26-0203', freightAuto: 1234000 }),
      ],
      total: 3,
    });
    renderPage();

    // Lô 1 = 100% lane price on the card face, no note.
    const principal = await screen.findByRole('article', { name: 'BL-P' });
    const principalLane = within(principal).getByText('Cước vận tải (Auto)').closest<HTMLElement>('.ledger-record__fact')!;
    expect(principalLane.closest('details')).toBeNull();
    expect(principalLane.textContent).toContain('3.150.000');

    // Member = 0₫ + the note under it — both outside the disclosure.
    const member = await screen.findByRole('article', { name: 'BL-M' });
    const memberLane = within(member).getByText('Cước vận tải (Auto)').closest<HTMLElement>('.ledger-record__fact')!;
    expect(memberLane.closest('details')).toBeNull();
    expect(memberLane.textContent).toContain('0');
    const note = within(memberLane).getByText('Ghép cước cùng Bill BL-P');
    expect(note.tagName).toBe('SMALL');

    // The disclosure still holds the sibling facts — never the lane.
    const details = within(member).getByText('Chi tiết').closest('details')!;
    expect(within(details).queryByText('Cước vận tải (Auto)')).toBeNull();
    expect(within(details).queryByText('Ghép cước cùng Bill BL-P')).toBeNull();

    // BD-03 control: a snapshot-channel row shows the money, no note.
    const snap = await screen.findByRole('article', { name: 'BL-S' });
    const snapLane = within(snap).getByText('Cước vận tải (Auto)').closest<HTMLElement>('.ledger-record__fact')!;
    expect(snapLane.closest('details')).toBeNull();
    expect(snapLane.textContent).toContain('1.234.000');
    expect(within(snap).queryByText(/Ghép cước/)).toBeNull();
  });
});
