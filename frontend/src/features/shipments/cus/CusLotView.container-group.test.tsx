// SIL-508 (owner 26/10): the Thông tin hàng sheet merges LOẠI + TRỌNG LƯỢNG
// into the SỐ CONTAINER column as a three-line group (SỐ / LOẠI / TRỌNG
// LƯỢNG). Each line click-to-edits its own container-line field through the
// host's onSaveField command — the SIL-483 ghost-line contract: commit
// resolves true → the editor closes, false → it stays open (the error rode
// the host toast); Escape/outside reverts. Lines the page gate or the line's
// own fieldAccess denies render plain text and never advertise editing.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
  ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { CusLotView, type CusLotContainerLineActions } from './CusLotView';

const direct = { mode: 'DIRECT' as const, reason: 'writable' };
const readOnly = { mode: 'READ_ONLY' as const, reason: 'khóa' };

function makeLine(overrides: Partial<ShipmentCusWorkspaceContainerLine> & { id: number; ordinal: number }): ShipmentCusWorkspaceContainerLine {
  return {
    operationalSiteId: null,
    containerNumber: `MSKU${String(100000 + overrides.id).slice(0, 7)}0`,
    declarationNumber: null,
    containerTypeId: 3,
    containerTypeLabel: '20DC',
    routeId: null,
    routeName: null,
    dispatchStatus: 'AWAITING_VEHICLE',
    tripId: null,
    tripStatus: null,
    carrierType: null,
    externalCarrierId: null,
    externalCarrierVehicleId: null,
    carrierName: null,
    plateNumber: null,
    liftSiteId: null,
    liftSite: null,
    dropoffSiteId: null,
    dropoffSite: null,
    customerAppointmentAt: null,
    raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: '24000.00', cargoVolumeCbm: null, routeId: null },
    fieldAccess: {
      containerNumber: direct,
      containerTypeId: direct,
      cargoWeightKg: direct,
    },
    permissions: {
      carrierEditable: false, plateEditable: false, containerTypeEditable: false,
      routeEditable: false, liftSiteEditable: false, dropoffSiteEditable: false,
      customerAppointmentEditable: false,
    },
    shipmentVersion: 1,
    relatedTripVersion: null,
    ...overrides,
  } as ShipmentCusWorkspaceContainerLine;
}

function makeItem(): ShipmentCusWorkspaceListItem {
  return {
    id: 78,
    customerName: 'Khách SIL-508',
    cargoMode: 'FCL',
    isCombined: false,
    declarationNumbers: [],
    billOrBookNumber: 'BILL-508',
    shippingLineName: null,
    appointmentGroups: [],
    plannedReturnAt: null,
    customerNotes: null,
    operationalNotes: null,
    raw: { tradeDirection: 'EXPORT', isAdHoc: false },
    operational: { scheduleReadiness: 'SCHEDULED', vehicleReadiness: 'READY', missingCarrierContainers: 0, missingPlateContainers: 0 },
    finance: { isLoss: false, hasPendingRecovery: false, customerChargeTotalsAvailable: false, customerInvoiceTotal: null, customerNoInvoiceTotal: null, totalCost: null },
    documentCustody: { status: 'NONE', label: null },
    accountingConfirmation: { status: 'PENDING' },
    activeLock: null,
    action: { kind: 'NONE', enabled: false },
    debitNote: { available: true },
  } as unknown as ShipmentCusWorkspaceListItem;
}

const CONTAINER_TYPE_CATALOG = [
  { id: 3, code: '20DC', name: 'Dry 20ft', label: '20DC — Dry 20ft' },
  { id: 4, code: '40HC', name: 'High Cube 40ft', label: '40HC — High Cube 40ft' },
];

function makeDetail(lines: ShipmentCusWorkspaceContainerLine[]): ShipmentCusWorkspaceDetail {
  return {
    summary: makeItem(),
    containers: lines,
    selectors: { containerTypes: CONTAINER_TYPE_CATALOG },
  } as unknown as ShipmentCusWorkspaceDetail;
}

function renderView({
  lines,
  canEditCargoLines = false,
  actions,
}: {
  lines: ShipmentCusWorkspaceContainerLine[];
  canEditCargoLines?: boolean;
  actions?: CusLotContainerLineActions;
}) {
  return render(
    <CusLotView
      item={makeItem()}
      detail={makeDetail(lines)}
      loading={false}
      error={undefined}
      onRetry={() => {}}
      canEditCargoLines={canEditCargoLines}
      containerLineActions={actions}
    />,
  );
}

describe('CusLotView — SIL-508 nhóm SỐ CONTAINER 3 dòng', () => {
  it('gộp LOẠI + TRỌNG LƯỢNG vào cột Số container: bảng còn 10 cột, nhóm đủ 3 dòng micro-label', () => {
    renderView({ lines: [makeLine({ id: 21, ordinal: 1 })] });
    for (const header of ['STT', 'Số container', 'Số tờ khai', 'Nhà máy', 'Tuyến đường', 'Nhà xe / BKS', 'Cảng nâng', 'Cảng hạ', 'Đóng / trả', 'Trạng thái']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeTruthy();
    }
    expect(screen.queryByRole('columnheader', { name: 'Loại' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Trọng lượng' })).toBeNull();
    // The three stacked lines ride one cell under the Số container header.
    expect(screen.getByText('MSKU1000210')).toBeTruthy();
    expect(screen.getByText('20DC')).toBeTruthy();
    expect(screen.getByText('24 tấn')).toBeTruthy();
    const labels = screen.getAllByText('Số').length + screen.getAllByText('Loại').length + screen.getAllByText('Trọng lượng').length;
    expect(labels).toBeGreaterThanOrEqual(3);
  });

  it('read-only: dòng trống nêu thiếu bằng chữ (QA-AUDIT-UI-08), không render trigger edit', () => {
    renderView({ lines: [makeLine({ id: 22, ordinal: 1, containerNumber: null })] });
    expect(screen.getByText('Chưa có số cont')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Số container — dòng 1/ })).toBeNull();
  });

  it('SỐ: click mở editor, Enter commit onSaveField(containerNumber); commit false giữ editor mở', async () => {
    const onSaveField = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    renderView({
      lines: [makeLine({ id: 23, ordinal: 1 })],
      canEditCargoLines: true,
      actions: { onSaveField },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Số container — dòng 1' }));
    const input = screen.getByLabelText('Số container — dòng 1') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: 'msku9998887' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSaveField).toHaveBeenNthCalledWith(1, expect.anything(), 'containerNumber', 'msku9998887'));
    // false → the editor stays open for the retry.
    expect(screen.getByLabelText('Số container — dòng 1')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Số container — dòng 1'), { target: { value: 'MSKU9998888' } });
    fireEvent.keyDown(screen.getByLabelText('Số container — dòng 1'), { key: 'Enter' });
    await waitFor(() => expect(onSaveField).toHaveBeenNthCalledWith(2, expect.anything(), 'containerNumber', 'MSKU9998888'));
    // true → the editor closes; the ghost trigger (same accessible name) returns.
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Số container — dòng 1' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Số container — dòng 1' })).toBeTruthy();
  });

  it('SỐ: Escape hoàn draft về giá trị persisted', () => {
    renderView({
      lines: [makeLine({ id: 24, ordinal: 1 })],
      canEditCargoLines: true,
      actions: { onSaveField: vi.fn().mockResolvedValue(true) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Số container — dòng 1' }));
    const input = screen.getByLabelText('Số container — dòng 1') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'CHƯA-LƯU' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Số container — dòng 1' })).toBeNull();
    expect(screen.getByText('MSKU1000240')).toBeTruthy();
  });

  it('LOẠI: UuiSelectField chọn loại commit ngay onSaveField(containerTypeId)', async () => {
    const onSaveField = vi.fn().mockResolvedValue(true);
    renderView({
      lines: [makeLine({ id: 25, ordinal: 1 })],
      canEditCargoLines: true,
      actions: { onSaveField },
    });
    // UuiSelectField exposes a hidden native select — drive it by the
    // selected option's display value (the file's own proven idiom).
    fireEvent.change(screen.getByDisplayValue('20DC'), { target: { value: '4' } });
    await waitFor(() => expect(onSaveField).toHaveBeenCalledWith(expect.anything(), 'containerTypeId', '4'));
  });

  it('TRỌNG LƯỢNG: editor seed giá trị raw, là ô SỐ (chữ không lọt vào được), commit onSaveField(cargoWeightKg)', async () => {
    const onSaveField = vi.fn().mockResolvedValue(true);
    renderView({
      lines: [makeLine({ id: 26, ordinal: 1 })],
      canEditCargoLines: true,
      actions: { onSaveField },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Trọng lượng — dòng 1' }));
    const input = screen.getByLabelText('Trọng lượng — dòng 1') as HTMLInputElement;
    // SIL-552 (owner 28/10, design lock): the weight editor is a NUMBER input
    // (the house stepper stays hidden) — the control itself refuses every
    // non-numeric character, which is what SIL-508's "lọc ký tự" filter did
    // in JS.
    expect(input.type).toBe('number');
    expect(input.getAttribute('min')).toBe('0');
    expect(input.value).toBe('24000.00');
    // Letters never land in the field: a number control sanitizes them away.
    fireEvent.change(input, { target: { value: '24.5abc00' } });
    expect((screen.getByLabelText('Trọng lượng — dòng 1') as HTMLInputElement).value).not.toContain('abc');
    fireEvent.change(input, { target: { value: '24.500' } });
    expect((screen.getByLabelText('Trọng lượng — dòng 1') as HTMLInputElement).value).toBe('24.500');
    fireEvent.keyDown(screen.getByLabelText('Trọng lượng — dòng 1'), { key: 'Enter' });
    await waitFor(() => expect(onSaveField).toHaveBeenCalledWith(expect.anything(), 'cargoWeightKg', '24.500'));
  });

  it('fieldAccess READ_ONLY trên từng dòng chặn edit dù gate trang mở', () => {
    renderView({
      lines: [makeLine({
        id: 27,
        ordinal: 1,
        fieldAccess: { containerNumber: readOnly, containerTypeId: direct, cargoWeightKg: direct },
      } as ShipmentCusWorkspaceContainerLine)],
      canEditCargoLines: true,
      actions: { onSaveField: vi.fn().mockResolvedValue(true) },
    });
    expect(screen.queryByRole('button', { name: 'Số container — dòng 1' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Loại container — dòng 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Trọng lượng — dòng 1' })).toBeTruthy();
  });

  it('gate trang đóng (canEditCargoLines=false): cả 3 dòng chỉ là text, không trigger', () => {
    renderView({
      lines: [makeLine({ id: 28, ordinal: 1 })],
      canEditCargoLines: false,
      actions: { onSaveField: vi.fn().mockResolvedValue(true) },
    });
    expect(screen.queryByRole('button', { name: 'Số container — dòng 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Loại container — dòng 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Trọng lượng — dòng 1' })).toBeNull();
  });
});
