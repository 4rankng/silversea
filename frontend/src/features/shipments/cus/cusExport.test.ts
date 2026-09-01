import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentCusWorkspaceListItem } from '@tingting/shared';
import { collectCusWorksheetItems, exportCusWorksheet, mapCusWorksheetRow } from './cusExport';

const listCusShipmentWorkspace = vi.hoisted(() => vi.fn());
const downloadCSV = vi.hoisted(() => vi.fn());

vi.mock('../../../api/shipmentClient', () => ({ listCusShipmentWorkspace }));
vi.mock('../../../lib/csv', () => ({ downloadCSV }));

function makeItem(overrides: Record<string, unknown> = {}): ShipmentCusWorkspaceListItem {
  return {
    id: 1,
    customerName: 'Khách Hàng A',
    effectiveFactoryNames: ['Factory A', 'Factory B'],
    factoryName: null,
    routeName: 'Tuyến Q7',
    deliveryLocation: null,
    billOrBookNumber: 'BL123',
    declarationNumber: 'TK456',
    direction: 'EXPORT',
    shippingLineName: 'Hãng X',
    isCombined: false,
    cargoMode: 'FCL',
    containerSummary: '1x40HC + 1x20DC',
    weightKg: 1200,
    volumeCbm: null,
    transportDate: '2026-09-01',
    customerNotes: '  ',
    operationalNotes: 'note nội bộ',
    bucket: 'RUNNING',
    bucketLabel: 'Đang chạy',
    status: 'DISPATCHED',
    operational: {
      totalContainers: 2,
      plateAssignedContainers: 1,
      orderIssuedContainers: 1,
      scheduleReadiness: 'READY',
      vehicleReadiness: 'READY',
      missingCarrierContainers: 0,
      missingPlateContainers: 0,
      transportDateEditable: true,
    },
    finance: { isLoss: false, hasPendingRecovery: false },
    documentCustody: { status: null, available: true, editable: true },
    accountingConfirmation: { status: 'VALID' },
    action: { kind: 'NONE', enabled: true, label: '', disabledReason: null },
    appointmentGroups: [],
    ...overrides,
  } as unknown as ShipmentCusWorkspaceListItem;
}

describe('collectCusWorksheetItems', () => {
  beforeEach(() => { listCusShipmentWorkspace.mockReset(); });

  it('walks every page at the export page size until totalPages is exhausted', async () => {
    listCusShipmentWorkspace
      .mockResolvedValueOnce({ items: [makeItem({ id: 1 })], totalPages: 3 })
      .mockResolvedValueOnce({ items: [makeItem({ id: 2 })], totalPages: 3 })
      .mockResolvedValueOnce({ items: [makeItem({ id: 3 })], totalPages: 3 });
    const items = await collectCusWorksheetItems({ searchSuffix: 'BL12' });
    expect(items.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(listCusShipmentWorkspace).toHaveBeenCalledTimes(3);
    expect(listCusShipmentWorkspace).toHaveBeenNthCalledWith(1, expect.objectContaining({ page: 1, limit: 100, searchSuffix: 'BL12' }));
    expect(listCusShipmentWorkspace).toHaveBeenNthCalledWith(3, expect.objectContaining({ page: 3 }));
  });

  it('forwards only non-empty filters', async () => {
    listCusShipmentWorkspace.mockResolvedValue({ items: [], totalPages: 1 });
    await collectCusWorksheetItems({ direction: 'IMPORT' });
    expect(listCusShipmentWorkspace).toHaveBeenCalledWith(expect.objectContaining({ direction: 'IMPORT', bucket: undefined }));
  });
});

describe('mapCusWorksheetRow', () => {
  it('joins each of the seven columns from multi-line facts', () => {
    const row = mapCusWorksheetRow(makeItem());
    expect(row).toHaveLength(7);
    expect(row[0]).toBe('Khách Hàng A\nFactory A + Factory B\nTuyến Q7');
    expect(row[1]).toBe('BL123\nTK456');
    expect(row[4]).toContain(new Date('2026-09-01T00:00:00').toLocaleDateString('vi-VN'));
    expect(row[5]).toBe('note nội bộ');
    expect(row[6]).toContain('Đang chạy');
  });

  it('uses the fine-grained status label for NEW-bucket rows', () => {
    const row = mapCusWorksheetRow(makeItem({ bucket: 'NEW', status: 'AWAITING_DISPATCH' }));
    expect(row[6]).not.toContain('Đang chạy');
  });
});

describe('exportCusWorksheet', () => {
  beforeEach(() => { downloadCSV.mockReset(); });

  it('downloads the dated filename with title, subtitle and hidden totals', async () => {
    listCusShipmentWorkspace.mockResolvedValue({ items: [makeItem()], totalPages: 1 });
    const count = await exportCusWorksheet({});
    expect(count).toBe(1);
    const [filename, headers, rows, options] = downloadCSV.mock.calls[0];
    expect(filename).toMatch(/^ke-hoach-lo-hang-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(headers).toHaveLength(7);
    expect(rows).toHaveLength(1);
    expect(options.title).toBe('Tổng quan lô hàng');
    expect(options.subtitle).toBe('1 lô hàng');
    expect(options.hideTotals).toBe(true);
  });
});
