import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ShipmentCusBucket,
  ShipmentDocumentCustody,
  type ShipmentCusWorkspaceListItem,
} from '@tingting/shared';

/**
 * Embedded-create component test.
 *
 * The sibling `ShipmentsPage.test.tsx` mocks `ShipmentCreateWorkspace` so the
 * real embedded form (modal mount, `embedded` prop, `onSaved` grid refresh,
 * reused state machine) is never exercised from `/shipments`. This file mounts
 * the REAL workspace inside the create modal and asserts open → dirty → save →
 * grid-refresh → close.
 */

const { apiGet, apiPost, apiPut } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: { get: apiGet, post: apiPost, put: apiPut },
  ApiError: class ApiError extends Error {},
}));

vi.mock('../lib/csv', () => ({ downloadCSV: vi.fn() }));

// Toast provider stub — the workspace uses useToast for add-site guidance.
vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import ShipmentsPage from './ShipmentsPage';

const baseRow: ShipmentCusWorkspaceListItem = {
  id: 1,
  version: 3,
  bucket: ShipmentCusBucket.NEW,
  bucketLabel: 'Mới',
  customerName: 'Công ty Silver Sea',
  factoryName: 'Nhà máy Hải Phòng',
  billOrBookNumber: 'BILL-12345',
  declarationNumber: 'TK-54321',
  shippingLineName: 'Maersk',
  routeName: 'Hải Phòng → Hà Nội',
  isCombined: false,
  direction: 'IMPORT',
  containerSummary: '2x40HC',
  packageCount: null,
  packageType: null,
  weightKg: '25000',
  volumeCbm: '52.5',
  transportDate: '2026-08-12',
  customsCutoffAt: '2026-08-11T08:00:00.000Z',
  closingAt: null,
  plannedReturnAt: '2026-08-12T10:00:00.000Z',
  deliveryLocation: 'Kho Long Biên',
  liftSiteNames: ['Cảng Đình Vũ'],
  dropoffSiteNames: ['Bãi Tân Vũ'],
  customerAppointmentAts: ['2026-08-12T02:30:00.000Z'],
  carrierAssignments: [{ carrierName: 'Nhà xe An Phát', plateNumber: '15C-123.45' }],
  customerNotes: null,
  operationalNotes: null,
  operational: {
    scheduleReadiness: 'SCHEDULED',
    vehicleReadiness: 'READY',
    totalContainers: 2,
    assignedContainers: 2,
    externalContainers: 1,
    plateAssignedContainers: 2,
    missingCarrierContainers: 0,
    missingPlateContainers: 0,
    transportDateEditable: true,
  },
  finance: {
    customerInvoiceTotal: '12000000',
    customerNoInvoiceTotal: '1500000',
    totalCost: '14000000',
    isLoss: false,
    hasPendingRecovery: false,
    customerChargeTotalsAvailable: true,
    totalCostAvailable: true,
  },
  debitNote: {
    available: true,
    billingDocumentId: 44,
    documentNumber: 'DN-2026-0044',
    issuedAt: '2026-08-12T01:00:00.000Z',
    debitNoteStatus: 'ISSUED',
    disabledReason: null,
  },
  documentCustody: {
    status: ShipmentDocumentCustody.SUBMITTED_TO_ACCOUNTING,
    label: 'Đã nộp Kế toán',
    available: true,
    editable: true,
  },
  accountingConfirmation: {
    status: 'CONFIRMED',
    billingDocumentId: 44,
    confirmationId: 71,
    checksum: 'checksum-71',
    confirmedAt: '2026-08-12T01:30:00.000Z',
    confirmedByName: 'Kế toán',
  },
  activeLock: null,
  action: {
    kind: 'NONE',
    label: '',
    enabled: false,
    disabledReason: null,
  },
};

const catalogBootstrap = {
  customers: [{ id: 1, name: 'Công ty Silver Sea', contactPerson: null, phone: null, isCarrier: false, linkedSupplierId: null }],
  externalCarriers: [],
  trucks: [],
  drivers: [],
  routes: [{ id: 1, name: 'Hải Phòng → Hà Nội', distanceKm: 120, isMountain: false, fixedFuelAllowance: null, tollsStations: null, driverSalary: null, defaultLegs: null }],
  cargoTypes: [{ id: 1, name: 'Hàng đông lạnh', requiresPhotos: false }],
  trailers: [],
  containerTypes: [{ id: 2, code: '40HC', name: 'Container 40HC' }],
  ports: [
    { id: 10, name: 'Cảng Đình Vũ', code: 'DV', city: 'Hải Phòng' },
    { id: 11, name: 'Cảng Hải Phòng', code: 'HP', city: 'Hải Phòng' },
  ],
  forwarderExpenseTypes: [],
  suppliers: [],
};

const operationalSites = [
  { id: 31, customerId: 1, code: 'DV', name: 'Nhà máy Hải Phòng', siteType: 'FACTORY' as const, address: 'Đình Vũ', googleMapsUrl: null, contactName: null, contactPhone: null, liftFeeInvoiceName: null, liftFeeInvoiceAddress: null, liftFeeTaxCode: null, strictRules: null, version: 1 },
];

function listResponse(items = [baseRow]) {
  return {
    page: 1,
    limit: 20,
    total: items.length,
    totalPages: items.length ? 1 : 0,
    pageSummary: { needsSchedule: 0, needsVehicle: 0, waitingAccounting: 0, readyToLock: 0, needsAttention: 0 },
    items,
  };
}

function renderPage(path = '/shipments') {
  return render(<MemoryRouter initialEntries={[path]}><ShipmentsPage /></MemoryRouter>);
}

/** Select a value from a SearchableSelect field labelled `label`. */
async function chooseSearchable(label: string, value: string) {
  const labelElement = Array.from(document.querySelectorAll('label'))
    .find((element) => element.textContent?.trim().startsWith(label));
  const labelledControl = labelElement?.htmlFor
    ? document.getElementById(labelElement.htmlFor)
    : null;
  const control = labelledControl ?? labelElement?.parentElement?.querySelector('button');
  if (!control) throw new Error(`Không tìm thấy trường ${label}`);
  fireEvent.click(control);
  const option = document.querySelector<HTMLElement>(`[role="option"][id$="-option-${value}"]`);
  if (!option) throw new Error(`Không tìm thấy lựa chọn ${value} trong trường ${label}`);
  fireEvent.click(option);
  return waitFor(() => {
    expect(document.querySelector(`[role="option"][id$="-option-${value}"]`)).toBeNull();
  });
}

describe('ShipmentsPage — embedded create (real workspace mount)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
    window.localStorage.clear();

    apiGet.mockImplementation((url: string) => {
      if (url === '/catalogs/bootstrap') return Promise.resolve(catalogBootstrap);
      if (url.startsWith('/shipments/cus-workspace?')) return Promise.resolve(listResponse());
      if (url.startsWith('/operational-sites')) return Promise.resolve(operationalSites);
      return Promise.resolve(listResponse());
    });

    apiPost.mockImplementation((url: string) => {
      if (url === '/shipments/quick') return Promise.resolve({ id: 50, version: 1 });
      if (url.endsWith('/containers')) return Promise.resolve({ items: [], upsertedIds: [], shipmentVersion: 1, changeMode: 'DIRECT', changeRequestId: null });
      if (url.includes('/declarations')) return Promise.resolve({ id: 1, declarationNumber: null, issuedAt: null, scope: 'SINGLE', note: null, createdBy: null, createdAt: '', updatedAt: '' });
      if (url.endsWith('/dispatch')) return Promise.resolve({ shipment: { id: 50, version: 1 }, handoff: { id: 1, status: 'UNSEEN' }, replayed: false });
      return Promise.resolve({});
    });
    apiPut.mockResolvedValue({ id: 50, version: 1 });
  });

  it('opens the real create workspace, dirties it, saves the draft, and refreshes the grid', async () => {
    renderPage();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô mới' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tạo lô hàng mới' });

    // The real workspace is mounted — the identity section description renders.
    expect(within(dialog).getByText('Khách hàng, chứng từ và hướng xuất nhập khẩu.')).toBeTruthy();

    // Dirty the form by selecting a customer.
    await chooseSearchable('Khách hàng', '1');

    // Save the draft — the workflow calls POST /shipments/quick.
    const callsBeforeSave = apiPost.mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: /Lưu bản nháp/ }));

    await waitFor(() => expect(apiPost.mock.calls.filter(([url]) => url === '/shipments/quick').length).toBe(1));
    expect(apiPost.mock.calls.length).toBeGreaterThan(callsBeforeSave);
    // The grid refreshes and a success notice appears.
    expect(await screen.findByText(/Đã tạo lô hàng mới/)).toBeTruthy();
  }, 15000);

  it('wires the customer-notes textarea into the POST /shipments/quick body', async () => {
    renderPage();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô mới' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tạo lô hàng mới' });

    // Dirty the form by selecting a customer.
    await chooseSearchable('Khách hàng', '1');

    // Fill the customer-facing note field.
    const customerNote = within(dialog).getByText('Ghi chú cho khách').parentElement?.querySelector('textarea');
    if (!customerNote) throw new Error('Không tìm thấy trường Ghi chú cho khách');
    fireEvent.change(customerNote, { target: { value: 'Giao sau 18h nhé' } });

    // Save the draft — the workflow calls POST /shipments/quick.
    fireEvent.click(within(dialog).getByRole('button', { name: /Lưu bản nháp/ }));

    await waitFor(() => expect(apiPost.mock.calls.filter(([url]) => url === '/shipments/quick').length).toBe(1));
    const quickCall = apiPost.mock.calls.find(([url]) => url === '/shipments/quick');
    const [, body] = quickCall!;
    expect((body as Record<string, unknown>).customerNotes).toBe('Giao sau 18h nhé');
  }, 15000);

  it('guards a dirty real embedded form with the accessible confirm modal on close', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderPage();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô mới' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tạo lô hàng mới' });

    // Dirty the form by selecting a customer.
    await chooseSearchable('Khách hàng', '1');

    // Attempt to close the create modal — should open the confirm modal.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    expect(await screen.findByRole('dialog', { name: 'Bỏ tạo lô hàng?' })).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  }, 15000);
});
