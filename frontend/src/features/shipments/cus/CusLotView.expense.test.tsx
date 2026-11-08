// SIL-748 Part B — drawer Chi tiết lô hàng: nút [Khai chi phí] cho role Ops
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusWorkspaceDetail,
  ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { CusLotView } from './CusLotView';

function makeItem(): ShipmentCusWorkspaceListItem {
  return {
    id: 748,
    customerName: 'Khách SIL-748',
    cargoMode: 'FCL',
    isCombined: false,
    declarationNumbers: [],
    billOrBookNumber: 'BILL-748',
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
    direction: 'IMPORT',
    status: 'READY_FOR_DISPATCH',
    statusLabel: 'Chờ điều xe',
    containerCount: 0,
    transportDate: null,
    routeName: 'Hải Phòng',
  } as unknown as ShipmentCusWorkspaceListItem;
}

function makeDetail(): ShipmentCusWorkspaceDetail {
  return {
    id: 748,
    customer: { id: 1, name: 'Khách SIL-748' },
    containers: [],
    summary: { declarationNumbers: [] },
    selectors: { operationalSites: [] },
    notes: { operational: null, customer: null },
    timeline: { departureDate: null, returnDate: null },
  } as unknown as ShipmentCusWorkspaceDetail;
}

describe('CusLotView — SIL-748 Khai chi phí in drawer body', () => {
  it('renders [Khai chi phí] button in Nhận diện lô card when onDeclareExpense is provided and handles click', () => {
    const onDeclareExpense = vi.fn();
    render(
      <CusLotView
        item={makeItem()}
        detail={makeDetail()}
        loading={false}
        onRetry={vi.fn()}
        onDeclareExpense={onDeclareExpense}
      />,
    );

    const btn = screen.getByRole('button', { name: /Khai chi phí/ });
    expect(btn).toBeTruthy();
    expect(btn.className).toContain('cus-lot-declare-expense');
    fireEvent.click(btn);
    expect(onDeclareExpense).toHaveBeenCalledTimes(1);
  });

  it('does not render [Khai chi phí] button when onDeclareExpense is omitted', () => {
    render(
      <CusLotView
        item={makeItem()}
        detail={makeDetail()}
        loading={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /Khai chi phí/ })).toBeNull();
  });
});
