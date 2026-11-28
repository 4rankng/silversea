// SIL-1144 (KB Ch.10 §10.6.7, QA-Retest4 28/11) — the CUS lot review drawer
// carries the "Tờ khai hải quan" register: one row per container with the
// §3.4.2 completeness pills (có tờ khai cấp container = ĐẦY ĐỦ; không có =
// VẪN THIẾU), a per-row delete riding the drawer's own declaration save
// command with an empty value, and the '+ Thêm tờ khai' slot reusing the
// SIL-717 add-container flow. An LCL lot has no container rows: its
// lot-level number reads as ONE read-only register row. A locked
// fieldAccess renders the rows without the buttons, captioned with the lock
// reason — exactly like the sheet's SỐ TỜ KHAI cell.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
  ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { CusLotView } from './CusLotView';

function makeLine(overrides: Partial<ShipmentCusWorkspaceContainerLine> & { id: number; ordinal: number }): ShipmentCusWorkspaceContainerLine {
  return {
    operationalSiteId: null,
    containerNumber: `MSKU${String(100000 + overrides.id).slice(0, 7)}0`,
    declarationNumber: null,
    containerTypeId: null,
    containerTypeLabel: '40DC',
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
    raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: null, cargoVolumeCbm: null, routeId: null },
    fieldAccess: {},
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

function makeItem(overrides: Partial<ShipmentCusWorkspaceListItem> = {}): ShipmentCusWorkspaceListItem {
  return {
    id: 77,
    customerName: 'Khách SIL-1144',
    cargoMode: 'FCL',
    isCombined: false,
    declarationNumbers: [],
    billOrBookNumber: 'BILL-1144',
    shippingLineName: null,
    appointmentGroups: [],
    plannedReturnAt: null,
    customerNotes: null,
    operationalNotes: null,
    raw: { tradeDirection: 'IMPORT', isAdHoc: false },
    operational: { scheduleReadiness: 'SCHEDULED', vehicleReadiness: 'READY', missingCarrierContainers: 0, missingPlateContainers: 0 },
    finance: { isLoss: false, hasPendingRecovery: false, customerChargeTotalsAvailable: false, customerInvoiceTotal: null, customerNoInvoiceTotal: null, totalCost: null },
    documentCustody: { status: 'NONE', label: null },
    accountingConfirmation: { status: 'PENDING' },
    activeLock: null,
    action: { kind: 'NONE', enabled: false },
    debitNote: { available: true },
    ...overrides,
  } as unknown as ShipmentCusWorkspaceListItem;
}

function makeDetail(item: ShipmentCusWorkspaceListItem, lines: ShipmentCusWorkspaceContainerLine[]): ShipmentCusWorkspaceDetail {
  return { summary: item, containers: lines, selectors: { operationalSites: [], containerTypes: [] } } as unknown as ShipmentCusWorkspaceDetail;
}

function renderView({
  item = makeItem(),
  lines = [],
  editable = true,
  lockReason = null,
  actions,
  onAddContainer,
}: {
  item?: ShipmentCusWorkspaceListItem;
  lines?: ShipmentCusWorkspaceContainerLine[];
  editable?: boolean;
  lockReason?: string | null;
  actions?: {
    onSaveDeclaration: (line: ShipmentCusWorkspaceContainerLine, value: string) => Promise<void>;
    onCopyDeclaration: (line: ShipmentCusWorkspaceContainerLine) => Promise<void>;
  };
  onAddContainer?: (entry: unknown) => Promise<boolean>;
} = {}) {
  return render(
    <CusLotView
      item={item}
      detail={makeDetail(item, lines)}
      loading={false}
      error={undefined}
      onRetry={() => {}}
      canEditDeclaration={editable}
      declarationLockReason={lockReason}
      declarationActions={actions}
      onAddContainer={onAddContainer}
      addContainerSource={lines[lines.length - 1] ?? null}
    />,
  );
}

const lines = () => [
  makeLine({ id: 11, ordinal: 1, containerNumber: 'MSKU1000110', declarationNumber: 'TK-DẦU' }),
  makeLine({ id: 12, ordinal: 2, containerNumber: 'MSKU1000120', declarationNumber: null }),
];

describe('CusLotView — SIL-1144 Tờ khai hải quan register trên ngăn trượt', () => {
  it('renders the register section with per-container pills (Đầy đủ / Vẫn thiếu)', () => {
    renderView({ lines: lines() });
    const section = document.querySelector('[aria-labelledby="cus-lot-decl-77"]') as HTMLElement;
    expect(section).toBeTruthy();
    expect(section.querySelector('h3')?.textContent).toContain('Tờ khai hải quan');

    const first = section.querySelectorAll('.cus-lot-decl-reg-row')[0] as HTMLElement;
    expect(first).toBeTruthy();
    expect(first.textContent).toContain('Container 1 · MSKU1000110');
    expect(first.textContent).toContain('Đầy đủ');
    expect(first.textContent).toContain('TK-DẦU');

    const second = section.querySelectorAll('.cus-lot-decl-reg-row')[1] as HTMLElement;
    expect(second.textContent).toContain('Container 2 · MSKU1000120');
    expect(second.textContent).toContain('Vẫn thiếu');
    expect(second.textContent).toContain('Chưa có tờ khai');
  });

  it('the per-row delete rides the drawer save command with an empty value, only for the named row', async () => {
    const onSaveDeclaration = vi.fn().mockResolvedValue(undefined);
    renderView({
      lines: lines(),
      actions: { onSaveDeclaration, onCopyDeclaration: vi.fn().mockResolvedValue(undefined) },
    });
    const filled = screen.getByRole('button', { name: 'Xóa tờ khai TK-DẦU' });
    const empty = screen.getByRole('button', { name: 'Xóa tờ khai Container 2 · MSKU1000120' });
    // An empty row has nothing to clear — the delete stays disabled.
    expect((empty as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(filled);
    await waitFor(() => expect(onSaveDeclaration).toHaveBeenCalledTimes(1));
    expect(onSaveDeclaration.mock.calls[0]![0].id).toBe(11);
    expect(onSaveDeclaration.mock.calls[0]![1]).toBe('');
  });

  it("'+ Thêm tờ khai' reuses the add-container flow and dies without the host write", async () => {
    const onAddContainer = vi.fn().mockResolvedValue(true);
    const first = renderView({ lines: lines(), onAddContainer });
    expect(screen.getByRole('button', { name: '+ Thêm tờ khai' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Thêm tờ khai' }));
    // The shared add form opens (the declaration slot IS a new container row).
    expect(await screen.findByLabelText(/^Số container/)).toBeTruthy();
    first.unmount();

    // Without the host write (role/lock gate) the register renders no add.
    renderView({ lines: lines() });
    expect(screen.queryByRole('button', { name: '+ Thêm tờ khai' })).toBeNull();
  });

  it('a locked declaration renders read-only rows captioned with the lock reason', () => {
    renderView({
      lines: lines(),
      editable: false,
      lockReason: 'Lô hàng đã khóa kế toán; không thể sửa tờ khai.',
    });
    const section = document.querySelector('[aria-labelledby="cus-lot-decl-77"]') as HTMLElement;
    expect(section.querySelector('.cus-lot-decl-reg-row__delete')).toBeNull();
    expect(section.textContent).toContain('Lô hàng đã khóa kế toán; không thể sửa tờ khai.');
    expect(section.textContent).toContain('Vẫn thiếu');
  });

  it('an LCL lot reads its lot-level number as one read-only register row', () => {
    renderView({
      item: makeItem({ cargoMode: 'LCL', declarationNumbers: ['TK-LO-1'] }),
      lines: [],
      editable: true,
      actions: { onSaveDeclaration: vi.fn().mockResolvedValue(undefined), onCopyDeclaration: vi.fn().mockResolvedValue(undefined) },
    });
    const section = document.querySelector('[aria-labelledby="cus-lot-decl-77"]') as HTMLElement;
    expect(section.textContent).toContain('Tờ khai cấp lô');
    expect(section.textContent).toContain('TK-LO-1');
    expect(section.textContent).toContain('Đầy đủ');
    expect(section.querySelector('.cus-lot-decl-reg-row__delete')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Thêm tờ khai' })).toBeNull();
  });
});
