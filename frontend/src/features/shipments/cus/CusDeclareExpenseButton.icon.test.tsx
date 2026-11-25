// SIL-994 — [+ Khai chi phí] broke onto two lines in the lot detail surfaces:
// the "+" glyph fell onto its own line.
//
// Cause: the icon was written INSIDE the button's children, so the shared
// button wrapped the children in its own <span data-text> label. Tailwind's
// preflight makes `svg { display: block }`, and that span is a flex item of
// the button (blockified) — so the icon became a block box on its own line
// and the text dropped below it.
//
// The button already owns the right slot for a leading glyph: `iconLeading`,
// which renders the icon as a SIBLING flex item of the label span. The icon
// must therefore live there, not inside the children.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type {
  ShipmentCusWorkspaceDetail,
  ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { CusLotView } from './CusLotView';
import { CusLotDrawerFooter } from './CusLotDrawerFooter';

function makeItem(): ShipmentCusWorkspaceListItem {
  return {
    id: 994,
    customerName: 'Khách SIL-994',
    cargoMode: 'FCL',
    isCombined: false,
    declarationNumbers: [],
    billOrBookNumber: 'BILL-994',
    shippingLineName: null,
    appointmentGroups: [],
    plannedReturnAt: null,
    customerNotes: null,
    operationalNotes: null,
    raw: { tradeDirection: 'IMPORT', isAdHoc: false },
    operational: {
      scheduleReadiness: 'SCHEDULED',
      vehicleReadiness: 'READY',
      missingCarrierContainers: 0,
      missingPlateContainers: 0,
    },
    finance: {
      isLoss: false,
      hasPendingRecovery: false,
      customerChargeTotalsAvailable: false,
      customerInvoiceTotal: null,
      customerNoInvoiceTotal: null,
      totalCost: null,
    },
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
    id: 994,
    customer: { id: 1, name: 'Khách SIL-994' },
    containers: [],
    summary: { declarationNumbers: [] },
    selectors: { operationalSites: [] },
    notes: { operational: null, customer: null },
    timeline: { departureDate: null, returnDate: null },
  } as unknown as ShipmentCusWorkspaceDetail;
}

/** The icon must be a flex item of the button, never a block inside the label. */
function expectIconBesideLabel(button: HTMLElement): void {
  const label = button.querySelector('[data-text]');
  expect(label).toBeTruthy();
  expect(label?.querySelector('svg')).toBeNull();

  const icon = button.querySelector('svg');
  expect(icon).toBeTruthy();
  expect(icon?.parentElement).toBe(button);
  expect(icon?.getAttribute('data-icon')).toBe('leading');
}

describe('Khai chi phí button icon placement (SIL-994)', () => {
  it('keeps the "+" glyph on the button\'s own line in the lot detail card', () => {
    render(
      <CusLotView
        item={makeItem()}
        detail={makeDetail()}
        loading={false}
        onRetry={vi.fn()}
        onDeclareExpense={vi.fn()}
      />,
    );

    const btn = screen.getByRole('button', { name: 'Khai chi phí' });
    expectIconBesideLabel(btn);
  });

  it('keeps the "+" glyph on the button\'s own line in the drawer footer', () => {
    render(
      <CusLotDrawerFooter
        canEdit={false}
        locked={false}
        onEdit={vi.fn()}
        onOpenLedger={vi.fn()}
        onDeclareExpense={vi.fn()}
      />,
    );

    const btn = screen.getByRole('button', { name: 'Khai chi phí' });
    expectIconBesideLabel(btn);
  });
});
