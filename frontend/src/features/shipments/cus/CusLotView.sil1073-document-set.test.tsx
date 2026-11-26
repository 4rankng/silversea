/**
 * SIL-1073 (K3.104, Layer 2) — the CUS drawer's "Hồ sơ gốc" fact cell. The
 * KB's Lớp-2 status (Còn thiếu · Đang bổ sung · Đã đủ) rides the workspace
 * item beside the Lớp-1 custody cell — the two layers never merge — and the
 * missing-document names render inside the cell.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { CusLotView } from './CusLotView';

function makeItem(overrides: Record<string, unknown>): ShipmentCusWorkspaceListItem {
  return {
    id: 1301,
    customerName: 'Long Minh',
    cargoMode: 'FCL',
    isCombined: false,
    declarationNumbers: [],
    billOrBookNumber: 'W5C-K3105-A',
    shippingLineName: null,
    appointmentGroups: [],
    plannedReturnAt: null,
    customerNotes: null,
    operationalNotes: null,
    raw: { tradeDirection: 'IMPORT', isAdHoc: false },
    operational: { scheduleReadiness: 'SCHEDULED', vehicleReadiness: 'READY', missingCarrierContainers: 0, missingPlateContainers: 0 },
    finance: { isLoss: false, hasPendingRecovery: false, customerChargeTotalsAvailable: false, customerInvoiceTotal: null, customerNoInvoiceTotal: null, totalCost: null },
    documentCustody: { status: 'OPS_HOLDING', label: 'Ops đang giữ' },
    documentSet: { status: 'MISSING', label: 'Còn thiếu', missingDocuments: [], receiverName: null, receivedOn: null, changedAt: null, changedByName: null, editable: false },
    accountingConfirmation: { status: 'PENDING' },
    activeLock: null,
    action: { kind: 'NONE', enabled: false },
    debitNote: { available: true },
    ...overrides,
  } as unknown as ShipmentCusWorkspaceListItem;
}

function renderView(item: ShipmentCusWorkspaceListItem) {
  return render(
    <CusLotView
      item={item}
      detail={{ summary: item, containers: [] as ShipmentCusWorkspaceContainerLine[], selectors: { operationalSites: [] } } as never}
      loading={false}
      error={undefined}
      onRetry={() => {}}
    />,
  );
}

describe('SIL-1073 — drawer "Hồ sơ gốc" (Lớp 2)', () => {
  it('the status label renders under Hồ sơ gốc, beside (not merged with) the Lớp-1 custody cell', () => {
    renderView(makeItem({}));
    expect(screen.getByText('Hồ sơ gốc')).toBeTruthy();
    expect(screen.getByText('Còn thiếu')).toBeTruthy();
    // Lớp 1 stays its own fact: the custody label never carries the set state.
    expect(screen.getByText('Phơi phiếu')).toBeTruthy();
    expect(screen.getByText('Ops đang giữ')).toBeTruthy();
  });

  it('a recorded missing-document list names the owed documents inside the cell', () => {
    renderView(makeItem({
      documentSet: { status: 'SUPPLEMENTING', label: 'Đang bổ sung', missingDocuments: ['Biên bản giao nhận (bản gốc)'], receiverName: null, receivedOn: null, changedAt: null, changedByName: null, editable: false },
    }));
    expect(screen.getByText('Đang bổ sung')).toBeTruthy();
    expect(screen.getByText(/Biên bản giao nhận \(bản gốc\)/)).toBeTruthy();
  });

  it('a complete set reads Đã đủ — the only state that proves receiver + actual date', () => {
    renderView(makeItem({
      documentSet: { status: 'COMPLETE', label: 'Đã đủ', missingDocuments: [], receiverName: 'chị Lan', receivedOn: '2026-11-25', changedAt: null, changedByName: null, editable: false },
    }));
    expect(screen.getByText('Đã đủ')).toBeTruthy();
  });

  it('a producer predating the field stays quiet (optional wire field)', () => {
    renderView(makeItem({ documentSet: undefined }));
    expect(screen.getByText('Chưa xác định')).toBeTruthy();
  });
});
