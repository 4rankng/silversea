/**
 * SIL-1034 (K4.23) — ShipmentExternalPlateSection: the /shipments/:id review
 * page's PHÂN XE read-edit strip. Chứng từ (CUS) lands here from the create
 * flow and legacy links; the section is the ONLY plate surface on this page,
 * reading through the CUS-admitted cus-workspace detail and writing through
 * the shared SIL-714 external-plate dialog (server allowlist already admits
 * CUS). Pins: awaiting external lines offer the entry, plated/OWN/terminal
 * lines stay read-only, non-external lots render nothing, load errors speak,
 * and a save refetches so the plate replaces the "Chờ biển" slot.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentCusWorkspaceContainerLine, ShipmentCusWorkspaceDetail } from '@tingting/shared';
import type * as ShipmentClientModule from '../../../api/shipmentClient';
import type * as ToastModule from '../../../components/shared/Toast';

const { getDetailMock, getContextMock, updatePlateMock, toastMock } = vi.hoisted(() => ({
  getDetailMock: vi.fn(),
  getContextMock: vi.fn(),
  updatePlateMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('../../../api/shipmentClient', async (importOriginal) => {
  const actual = await importOriginal<typeof ShipmentClientModule>();
  return {
    ...actual,
    getCusShipmentWorkspaceDetail: getDetailMock,
    getExternalTripPlateContext: getContextMock,
    updateExternalTripPlate: updatePlateMock,
  };
});

vi.mock('../../../components/shared/Toast', async (importOriginal) => {
  const actual = await importOriginal<typeof ToastModule>();
  return {
    ...actual,
    useToast: () => ({ toast: toastMock }),
  };
});

import { ShipmentExternalPlateSection } from './ShipmentExternalPlateSection';

function makeLine(overrides: Record<string, unknown> & { id: number; ordinal: number }): ShipmentCusWorkspaceContainerLine {
  return {
    operationalSiteId: null,
    containerNumber: `TCNU${String(5000000 + overrides.id).slice(0, 7)}`,
    declarationNumber: null,
    containerTypeId: null,
    containerTypeLabel: '40HC',
    routeId: null,
    routeName: null,
    dispatchStatus: 'AWAITING_VEHICLE',
    tripId: 39,
    tripStatus: 'CREATED',
    tripDepartureDate: null,
    carrierType: 'EXTERNAL',
    externalCarrierId: 33,
    externalCarrierVehicleId: null,
    carrierName: 'ATS',
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

function makeDetail(containers: ShipmentCusWorkspaceContainerLine[]): ShipmentCusWorkspaceDetail {
  return { containers, selectors: { operationalSites: [] } } as unknown as ShipmentCusWorkspaceDetail;
}

beforeEach(() => {
  getDetailMock.mockReset();
  getContextMock.mockReset();
  updatePlateMock.mockReset();
  toastMock.mockReset();
});

describe('ShipmentExternalPlateSection — SIL-1034 (K4.23)', () => {
  it('shows the awaiting external trip with the plate entry and the Chờ biển slot', async () => {
    getDetailMock.mockResolvedValue(makeDetail([
      makeLine({ id: 1, ordinal: 1, tripId: 39, carrierType: 'EXTERNAL', tripStatus: 'CREATED', plateNumber: null, carrierName: 'ATS' }),
    ]));
    render(<ShipmentExternalPlateSection shipmentId={113} />);
    await waitFor(() => expect(getDetailMock).toHaveBeenCalledWith(113));
    expect(await screen.findByText('ATS')).toBeTruthy();
    expect(screen.getByText('Chờ biển')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Cập nhật biển số' });
    expect(button).toBeTruthy();
  });

  it('keeps plated and terminal lines read-only — no entry on a line the gate refuses', async () => {
    getDetailMock.mockResolvedValue(makeDetail([
      makeLine({ id: 1, ordinal: 1, tripId: 39, carrierType: 'EXTERNAL', tripStatus: 'CREATED', plateNumber: '29H-456.78' }),
      makeLine({ id: 3, ordinal: 2, tripId: 41, carrierType: 'EXTERNAL', tripStatus: 'COMPLETED', plateNumber: null }),
    ]));
    render(<ShipmentExternalPlateSection shipmentId={113} />);
    expect(await screen.findByText('29H-456.78')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cập nhật biển số' })).toBeNull();
    // Only the plate-less terminal line reads "Chờ biển"; the plated line
    // shows its plate instead.
    expect(screen.getAllByText('Chờ biển')).toHaveLength(1);
  });

  it('renders nothing on a lot without external trips', async () => {
    getDetailMock.mockResolvedValue(makeDetail([
      makeLine({ id: 1, ordinal: 1, tripId: 40, carrierType: 'OWN', tripStatus: 'CREATED' }),
    ]));
    const { container } = render(<ShipmentExternalPlateSection shipmentId={113} />);
    await waitFor(() => expect(getDetailMock).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('[data-component="external-plate-section"]')).toBeNull());
  });

  // K2.45 (SIL-1082 round 3, QA comment 8974) — /shipments/:id used to carry
  // no reason at all; the line's server-read paymentTermWarning now quotes
  // verbatim on the strip, and a healthy line stays silent.
  it('quotes the payment-term reason on the line and stays silent without one', async () => {
    const reason = 'Chưa xác định hạn thanh toán: nhà cung cấp liên kết đã bị xóa ("QA45-NT04" (#54)); hồ sơ nhà xe "QA45-NT04" (#74) cũng đã bị xóa.';
    getDetailMock.mockResolvedValue(makeDetail([
      makeLine({ id: 1, ordinal: 1, tripId: 39, carrierType: 'EXTERNAL', tripStatus: 'IN_TRANSIT', paymentTermWarning: reason }),
      makeLine({ id: 2, ordinal: 2, tripId: 41, carrierType: 'EXTERNAL', tripStatus: 'IN_TRANSIT', paymentTermWarning: null }),
    ]));
    render(<ShipmentExternalPlateSection shipmentId={113} />);
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(reason);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('speaks on load failure instead of rendering an empty strip', async () => {
    getDetailMock.mockRejectedValue(new Error('Lô ngoài phạm vi'));
    render(<ShipmentExternalPlateSection shipmentId={113} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Lô ngoài phạm vi')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cập nhật biển số' })).toBeNull();
  });

  it('saves through the shared dialog and refetches so the plate replaces Chờ biển', async () => {
    getDetailMock
      .mockResolvedValueOnce(makeDetail([
        makeLine({ id: 1, ordinal: 1, tripId: 39, carrierType: 'EXTERNAL', tripStatus: 'CREATED', plateNumber: null, carrierName: 'ATS' }),
      ]))
      .mockResolvedValueOnce(makeDetail([
        makeLine({ id: 1, ordinal: 1, tripId: 39, carrierType: 'EXTERNAL', tripStatus: 'CREATED', plateNumber: '29H-456.78', carrierName: 'ATS' }),
      ]));
    getContextMock.mockResolvedValue({ tripId: 39, tripCode: 'TRP-202610-0015', status: 'CREATED', carrierType: 'EXTERNAL', version: 7, externalPlateNumber: null });
    updatePlateMock.mockResolvedValue({ tripId: 39, tripCode: 'TRP-202610-0015', status: 'CREATED', carrierType: 'EXTERNAL', version: 8, externalPlateNumber: '29H-456.78' });

    render(<ShipmentExternalPlateSection shipmentId={113} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cập nhật biển số' }));
    const plate = await screen.findByLabelText('Biển số xe *') as HTMLInputElement;
    fireEvent.change(plate, { target: { value: '29H-456.78' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu biển số' }));

    await waitFor(() => expect(updatePlateMock).toHaveBeenCalledWith(
      39,
      expect.objectContaining({ externalPlateNumber: '29H-456.78', expectedVersion: 7 }),
    ));
    // The section refetches and the saved plate replaces the awaiting slot.
    await waitFor(() => expect(getDetailMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('29H-456.78')).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cập nhật biển số' })).toBeNull());
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });
});
