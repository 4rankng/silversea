import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ShipmentCusBucket,
  ShipmentDocumentCustody,
  type ShipmentCusWorkspaceListItem,
} from '@tingting/shared';

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: { get: apiGet, post: apiPost },
  ApiError: class ApiError extends Error {},
}));

import ShipmentsPage from './ShipmentsPage';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');

const row: ShipmentCusWorkspaceListItem = {
  id: 1,
  version: 3,
  bucket: ShipmentCusBucket.PENDING_LOCK,
  bucketLabel: 'Chờ khóa',
  customerName: 'Công ty Silver Sea',
  factoryName: 'Nhà máy Hải Phòng',
  billOrBookNumber: 'BILL-12345',
  declarationNumber: 'TK-54321',
  shippingLineName: 'Maersk',
  routeName: 'Hải Phòng → Hà Nội',
  isCombined: false,
  direction: 'IMPORT' as const,
  containerSummary: '2x40HC',
  weightKg: '25000',
  volumeCbm: '52.5',
  transportDate: '2026-08-12',
  note: 'Giao buổi sáng',
  finance: {
    customerInvoiceTotal: '12000000',
    customerNoInvoiceTotal: '1500000',
    totalCost: '14000000',
    isLoss: true,
    hasPendingRecovery: true,
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
    status: 'CONFIRMED' as const,
    billingDocumentId: 44,
    confirmationId: 71,
    checksum: 'checksum-71',
    confirmedAt: '2026-08-12T01:30:00.000Z',
    confirmedByName: 'Kế toán',
  },
  activeLock: null,
  action: {
    kind: 'LOCK' as const,
    label: 'Khóa lô',
    enabled: true,
    disabledReason: null,
  },
};

const zeroComponent = {
  amount: '0',
  invoiceNumber: null,
  repairRecoveryPending: false,
  available: true,
};

const detail = {
  summary: row,
  containers: [{
    id: 10,
    ordinal: 1,
    containerNumber: 'MSKU1234567',
    containerTypeId: 2,
    containerTypeLabel: '40HC',
    carrierType: 'EXTERNAL' as const,
    externalCarrierId: 8,
    externalCarrierVehicleId: 18,
    carrierName: 'Nhà xe An Phát',
    plateNumber: '15C-123.45',
    liftSiteId: 31,
    liftSite: 'Cảng Đình Vũ',
    dropoffSiteId: 32,
    dropoffSite: 'Bãi Tân Vũ',
    closeOrReturnAt: '2026-08-12T02:30:00.000Z',
    outboundCharges: {
      transport: { ...zeroComponent, amount: '5000000' },
      handling: { ...zeroComponent, amount: '700000' },
      incidental: zeroComponent,
      total: '5700000',
      available: true,
    },
    inboundCharges: {
      transport: { ...zeroComponent, amount: '3600000' },
      handling: { ...zeroComponent, amount: '500000' },
      incidental: zeroComponent,
      total: '4100000',
      available: true,
    },
    passThroughChargesGrouped: {
      csht: zeroComponent,
      lift: { ...zeroComponent, amount: '350000', invoiceNumber: 'HD-001' },
      dropoff: zeroComponent,
      other: { ...zeroComponent, amount: '900000', repairRecoveryPending: true },
      total: '1250000',
      available: true,
    },
    passThroughCharges: [],
    recoveryFacts: [],
    repairRecoveryPending: true,
    permissions: {
      carrierEditable: true,
      plateEditable: true,
      containerTypeEditable: true,
      liftSiteEditable: true,
      dropoffSiteEditable: true,
      closeOrReturnTimeEditable: true,
      outboundEditable: true,
      inboundEditable: true,
      passThroughEditable: false,
    },
    shipmentVersion: 3,
    factVersion: 1,
    relatedTripVersion: 2,
  }],
  selectors: {
    containerTypes: [{ id: 2, code: '40HC', name: 'Container 40HC', label: '40HC · Container 40HC' }],
    operationalSites: [
      { id: 31, siteType: 'WAREHOUSE' as const, code: 'DV', name: 'Cảng Đình Vũ', label: 'DV · Cảng Đình Vũ' },
      { id: 32, siteType: 'WAREHOUSE' as const, code: 'TV', name: 'Bãi Tân Vũ', label: 'TV · Bãi Tân Vũ' },
    ],
    externalCarriers: [{ id: 8, name: 'Nhà xe An Phát', shortName: 'An Phát', label: 'Nhà xe An Phát' }],
    carrierVehicles: [{ id: 18, carrierId: 8, licensePlate: '15C-123.45', label: '15C-123.45' }],
  },
  dataState: {
    hasExplicitDocumentCustody: true,
    hasExplicitRecoveryFacts: true,
    hasAuthoritativeChargeBreakdown: true,
  },
};

function listResponse(items = [row]) {
  return { page: 1, limit: 20, total: items.length, totalPages: items.length ? 1 : 0, items };
}

function renderPage(path = '/shipments') {
  return render(<MemoryRouter initialEntries={[path]}><ShipmentsPage /></MemoryRouter>);
}

function masterRow(): HTMLTableRowElement {
  const element = document.querySelector('tr.cus-master-row');
  if (!(element instanceof HTMLTableRowElement)) throw new Error('shipment master row not rendered');
  return element;
}

function masterRowToggle(): HTMLButtonElement {
  const element = document.querySelector('button.cus-row-toggle');
  if (!(element instanceof HTMLButtonElement)) throw new Error('shipment row toggle not rendered');
  return element;
}

describe('ShipmentsPage — CUS closeout workspace', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1' ? Promise.resolve(detail) : Promise.resolve(listResponse())
    ));
    apiPost.mockResolvedValue({ replayed: false });
  });

  it('renders the active CUS tab and disabled combined-invoice placeholder', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Quản lý lô hàng' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Tất cả lô hàng/ }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByRole('tab', { name: 'Hóa đơn kết hợp' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText('4-5 ký tự cuối Bill/Book hoặc tờ khai').getAttribute('inputmode')).toBe('text');
  });

  it('rejects invalid suffixes locally and sends the exact mixed-case alphanumeric suffix', async () => {
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    const input = screen.getByLabelText('4-5 ký tự cuối Bill/Book hoặc tờ khai');

    fireEvent.change(input, { target: { value: 'A12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
    expect(screen.getByRole('alert').textContent).toContain('Nhập đúng 4-5 ký tự chữ hoặc số');

    fireEvent.change(input, { target: { value: 'AB$1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
    expect(screen.getByRole('alert').textContent).toContain('Nhập đúng 4-5 ký tự chữ hoặc số');

    fireEvent.change(input, { target: { value: 'ABC123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
    expect(screen.getByRole('alert').textContent).toContain('Nhập đúng 4-5 ký tự chữ hoặc số');

    fireEvent.change(input, { target: { value: 'aB12C' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('searchSuffix=aB12C')));
  });

  it('shows grouped master evidence, full currency, and non-color-only risk signals', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    const surface = within(table);
    expect(surface.getByText('Tài chính')).toBeTruthy();
    expect(surface.getByText('Có hóa đơn')).toBeTruthy();
    expect(surface.getByText('Không hóa đơn')).toBeTruthy();
    expect(surface.getByText('Tổng chi')).toBeTruthy();
    expect(surface.getByText('12.000.000')).toBeTruthy();
    expect(surface.getByText('14.000.000')).toBeTruthy();
    expect(surface.getByText('Loại hàng')).toBeTruthy();
    expect(surface.getByText('Nhập')).toBeTruthy();
    expect(surface.queryByText('Nhập · Đơn lẻ')).toBeNull();
    expect(surface.getAllByText('Lỗ')).toHaveLength(2);
    expect(surface.getByText('Còn tiền treo')).toBeTruthy();
    expect(surface.getByText(/Đã xác nhận:/)).toBeTruthy();
    expect((surface.getByRole('button', { name: 'Khóa lô' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(surface.getByLabelText('Trạng thái phơi phiếu của Công ty Silver Sea'));
    expect(masterRowToggle().getAttribute('aria-expanded')).toBe('false');
    expect(apiGet).not.toHaveBeenCalledWith('/shipments/cus-workspace/1');

    const mobileList = document.querySelector('.cus-mobile-list');
    expect(mobileList).not.toBeNull();
    const mobileSurface = within(mobileList as HTMLElement);
    expect(mobileSurface.getByText('Loại hàng')).toBeTruthy();
    expect(mobileSurface.getByText('Nhập')).toBeTruthy();
    expect(mobileSurface.queryByText('Nhập · Đơn lẻ')).toBeNull();
  });

  it('offers independently persisted optional ledger columns', async () => {
    window.localStorage.removeItem('silversea:cus-shipments:columns:v2');
    renderPage();
    await screen.findByRole('table');

    // Radix opens a dropdown from either pointer interaction or its keyboard
    // contract. Using ArrowDown keeps this assertion independent of jsdom's
    // incomplete PointerEvent implementation.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cột hiển thị' }), { key: 'ArrowDown' });
    const containerColumn = await screen.findByRole('menuitemcheckbox', { name: 'Container & lịch' });
    const recordsColumn = screen.getByRole('menuitemcheckbox', { name: 'Hồ sơ & xác nhận' });
    expect(containerColumn.getAttribute('data-state')).toBe('checked');
    expect(recordsColumn.getAttribute('data-state')).toBe('checked');

    fireEvent.click(containerColumn);
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('silversea:cus-shipments:columns:v2') ?? '{}')).toEqual({
      wide: ['records'],
      compact: ['records'],
    }));
  });

  it('keeps the current column choice when browser storage is unavailable', async () => {
    const setItem = window.localStorage.setItem;
    window.localStorage.setItem = vi.fn(() => { throw new Error('Storage unavailable'); });
    renderPage();
    await screen.findByRole('table');

    fireEvent.keyDown(screen.getByRole('button', { name: 'Cột hiển thị' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Container & lịch' }));
    await waitFor(() => expect(screen.queryByRole('columnheader', { name: 'Container & lịch' })).toBeNull());

    window.localStorage.setItem = setItem;
  });

  it('renders the drawer custody control in card composition', async () => {
    class CardLayoutObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 759 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    }
    const originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = CardLayoutObserver as unknown as typeof ResizeObserver;

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mở chi tiết lô hàng của Công ty Silver Sea' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('combobox', { name: /Trạng thái phơi phiếu/ })).toBeTruthy();

    window.ResizeObserver = originalResizeObserver;
  });

  it('opens the mobile card by clicking the card itself instead of a separate CTA', async () => {
    class CardLayoutObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 759 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    }
    const originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = CardLayoutObserver as unknown as typeof ResizeObserver;

    renderPage();
    const referenceButton = await screen.findByRole('button', { name: 'Mở chi tiết lô hàng của Công ty Silver Sea' });
    const card = referenceButton.closest('article');
    expect(card).not.toBeNull();
    fireEvent.click(card as HTMLElement);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xem chi tiết' })).toBeNull();
    expect(card?.getAttribute('role')).toBeNull();

    window.ResizeObserver = originalResizeObserver;
  });

  it('states unavailable financial confirmation honestly instead of presenting it as pending', async () => {
    apiGet.mockResolvedValueOnce(listResponse([{
      ...row,
      debitNote: {
        ...row.debitNote,
        billingDocumentId: null,
      },
      accountingConfirmation: {
        status: 'UNAVAILABLE' as const,
        billingDocumentId: null,
        confirmationId: null,
        checksum: null,
        confirmedAt: null,
        confirmedByName: null,
      },
    }]));

    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Chưa đủ dữ liệu xác nhận')).toBeTruthy();
    expect(within(table).queryByText('Chờ xác nhận')).toBeNull();
  });

  it('shows the reason for a disabled consequential action without relying on a tooltip', async () => {
    apiGet.mockResolvedValueOnce(listResponse([{
      ...row,
      action: {
        kind: 'LOCK' as const,
        label: 'Khóa lô',
        enabled: false,
        disabledReason: 'Xác nhận Kế toán đã hết hiệu lực.',
      },
    }]));

    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Xác nhận Kế toán đã hết hiệu lực.')).toBeTruthy();
    expect((within(table).getByRole('button', { name: 'Khóa lô' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('loads container detail lazily and renders all three grouped charge sections', async () => {
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    expect(apiGet).not.toHaveBeenCalledWith('/shipments/cus-workspace/1');

    const rowElement = masterRow();
    const rowToggle = masterRowToggle();
    expect(rowToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(within(rowElement).getByText('Nhà máy Hải Phòng'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/1'));
    expect(rowToggle.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByText('MSKU1234567')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Cước đầu ra' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Cước đầu vào' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Phí chi hộ' })).toBeTruthy();
    expect(screen.getAllByText('Chưa thu hồi sửa chữa').length).toBeGreaterThan(0);

    fireEvent.click(rowToggle);
    expect(rowToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(rowToggle);
    expect(rowToggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('saves only the server-permitted container fields with optimistic versions', async () => {
    apiPost.mockResolvedValueOnce({
      line: {
        ...detail.containers[0],
        plateNumber: '15C-999.99',
        shipmentVersion: 4,
        factVersion: 2,
      },
    });
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRow());

    const plate = await screen.findByLabelText('Biển số xe');
    fireEvent.change(plate, { target: { value: '15C-999.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu container' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/shipments/cus-workspace/1/containers/10',
      expect.objectContaining({
        expectedShipmentVersion: 3,
        expectedFactVersion: 1,
        plateNumber: '15C-999.99',
      }),
      expect.any(Object),
    ));
  });

  it('creates a new external carrier through the container workflow', async () => {
    apiPost.mockResolvedValueOnce({
      line: {
        ...detail.containers[0],
        carrierName: 'Nhà xe Tân Cảng',
        plateNumber: '51D-888.99',
        shipmentVersion: 4,
      },
    });
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRow());

    fireEvent.click(await screen.findByRole('button', { name: 'Nhập nhà xe mới' }));
    fireEvent.change(screen.getByLabelText('Tên nhà xe mới'), { target: { value: 'Nhà xe Tân Cảng' } });
    fireEvent.change(screen.getByLabelText('Biển số xe'), { target: { value: '51D-888.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu container' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/shipments/cus-workspace/1/containers/10',
      expect.objectContaining({
        expectedShipmentVersion: 3,
        expectedFactVersion: 1,
        carrierType: 'EXTERNAL',
        newExternalCarrier: {
          name: 'Nhà xe Tân Cảng',
          plateNumber: '51D-888.99',
        },
      }),
      expect.any(Object),
    ));
    const payload = apiPost.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.externalCarrierId).toBeUndefined();
    expect(payload.externalCarrierVehicleId).toBeUndefined();
    expect(payload.plateNumber).toBeUndefined();
  });

  it('renders locked container detail without active inputs or save controls', async () => {
    const lockedRow: ShipmentCusWorkspaceListItem = {
      ...row,
      bucket: ShipmentCusBucket.LOCKED,
      bucketLabel: 'Đã khóa',
      activeLock: {
        id: 91,
        billingDocumentId: 44,
        activatedAt: '2026-08-12T02:00:00.000Z',
        activatedByName: 'CUS',
        reason: 'Đã chốt lô',
      },
      action: { kind: 'REQUEST_REOPEN', label: 'Đề nghị điều chỉnh', enabled: true, disabledReason: null },
    };
    const lockedDetail = {
      ...detail,
      summary: lockedRow,
      containers: detail.containers.map((line) => ({
        ...line,
        permissions: Object.fromEntries(Object.keys(line.permissions).map((key) => [key, false])) as typeof line.permissions,
      })),
    };
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1' ? Promise.resolve(lockedDetail) : Promise.resolve(listResponse([lockedRow]))
    ));

    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRow());
    expect(await screen.findByText('15C-123.45')).toBeTruthy();
    expect(screen.queryByLabelText('Biển số xe')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lưu container' })).toBeNull();
  });

  it('confirms the consequential lock action and closes the dialog after success', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: 'Khóa lô' }));
    expect(masterRowToggle().getAttribute('aria-expanded')).toBe('false');
    expect(apiGet).not.toHaveBeenCalledWith('/shipments/cus-workspace/1');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/chế độ chỉ đọc/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Khóa lô' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/shipments/cus-workspace/1/lock',
      expect.objectContaining({ expectedVersion: 3 }),
      expect.any(Object),
    ));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('reuses the same idempotency key for a retried lock action and rotates after success', async () => {
    const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
    apiPost.mockRejectedValueOnce(new Error('Mất kết nối'));

    renderPage();
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: 'Khóa lô' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Khóa lô' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const firstKey = (apiPost.mock.calls[0]?.[2] as { headers?: Record<string, string> } | undefined)?.headers?.['Idempotency-Key'];
    expect(firstKey).toBe('00000000-0000-4000-8000-000000000001');
    expect(screen.getByText('Mất kết nối')).toBeTruthy();

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Khóa lô' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    const secondKey = (apiPost.mock.calls[1]?.[2] as { headers?: Record<string, string> } | undefined)?.headers?.['Idempotency-Key'];
    expect(secondKey).toBe(firstKey);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(within(await screen.findByRole('table')).getByRole('button', { name: 'Khóa lô' }));
    const secondDialog = await screen.findByRole('dialog');
    fireEvent.click(within(secondDialog).getByRole('button', { name: 'Khóa lô' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(3));
    const thirdKey = (apiPost.mock.calls[2]?.[2] as { headers?: Record<string, string> } | undefined)?.headers?.['Idempotency-Key'];
    expect(thirdKey).toBe('00000000-0000-4000-8000-000000000002');
    expect(thirdKey).not.toBe(firstKey);
    expect(randomUUID).toHaveBeenCalledTimes(2);
    randomUUID.mockRestore();
  });

  it('uses a page-scrolling wrapping ledger and container-aware card mode', () => {
    expect(css).toMatch(/\.cus-master-scroll\s*\{[^}]*overflow-x:\s*clip;/);
    expect(css).not.toMatch(/\.cus-master-scroll\s*\{[^}]*max-height:/);
    expect(css).not.toMatch(/\.cus-master-scroll\s*\{[^}]*overflow-y:\s*auto;/);
    expect(css).toMatch(/\.cus-master-table\s*\{[\s\S]*?width:\s*0;[\s\S]*?min-width:\s*100%;[\s\S]*?table-layout:\s*fixed;/);
    expect(css).toMatch(/\.cus-cell-stack\s*\{[\s\S]*?display:\s*grid;/);
    expect(css).toMatch(/\.cus-cell-stack dt\s*\{[\s\S]*?font-size:\s*11px;/);
    expect(css).toMatch(/\.cus-cell-stack dd\s*\{[\s\S]*?font-size:\s*var\(--fs-sm\);/);
    expect(css).not.toMatch(/\.cus-master-table\s*\{[\s\S]*?min-width:\s*2300px;/);
    expect(css).toMatch(/\.cus-workspace\[data-layout='cards'\] \.cus-master-scroll\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/\.cus-workspace\[data-layout='cards'\] \.cus-mobile-list\s*\{[\s\S]*?display:\s*grid;/);
    expect(css).toMatch(/\.cus-workspace\[data-layout='cards'\] \.cus-mobile-card--interactive\s*\{\s*cursor:\s*pointer;/);
    expect(css).toMatch(/\.cus-workspace\[data-layout='cards'\] \.cus-mobile-card__reference:focus-visible\s*\{/);
    expect(css).toMatch(/\.cus-workspace\[data-layout='cards'\] \.cus-toolbar\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/padding:\s*16px 0 max\(16px, env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-page\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;/);
    expect(css).not.toMatch(/cus-master-table__col-expand|cus-expand-button|cus-mobile-card__open/);
  });
});
