import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { IssueOrderFields } from './IssueOrderFields';
import type { IssueOrderDraft } from './useIssueOrder';

const mockRow: DispatchDetailPlanRow = {
  fulfillmentId: 101,
  version: 1,
  shipmentId: 1,
  shipmentVersion: 1,
  shipmentCode: 'SS-001',
  fulfillmentType: 'FCL_CONTAINER',
  cargoMode: 'FCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-09-10', runHour: 14 },
  customerRoute: { customerName: 'SilverSea', factoryName: null, deliveryPoint: 'Cảng Hải Phòng', routeName: null },
  docs: { billNumber: 'BL-001', tradeDirection: 'IMPORT', declarationNumbers: [] },
  container: { containerNumber: 'MSKU1234565', containerTypeLabel: '40HC', cargoWeightKg: '20000' },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: {
    carrierType: 'OWN',
    carrierName: 'SilverSea',
    externalCarrierId: null,
    externalCarrierVehicleId: null,
    assignedPlate: '15C-167.31',
  },
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  plannedEndAt: null,
  classification: 'SINGLE',
  ports: { pickupPortId: null, pickupPortName: null, pickupPortShortName: null, dropoffPortId: null, dropoffPortName: null, dropoffPortShortName: null },
  lotFullyPlated: true,
  isCombined: false,
};

describe('IssueOrderFields — no date/time picker (customer ruling)', () => {
  const baseDraft: IssueOrderDraft = {
    externalDriverName: '',
    externalDriverPhone: '',
  };

  it('renders no schedule UI for own-truck rows — driver line only', () => {
    render(
      <IssueOrderFields
        row={mockRow}
        ownTruck={{ id: 1, driverId: 1, driverName: 'Lương Văn Long' }}
        loadingOwnTruck={false}
        issueDraft={baseDraft}
        setIssueDraft={vi.fn()}
        onFieldTouched={vi.fn()}
        idPrefix="test-issue"
      />,
    );

    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(document.querySelector('input[type="time"]')).toBeNull();
    expect(screen.queryByText('Chọn nhanh ngày')).toBeNull();
    expect(screen.queryByText('Khung giờ phổ biến')).toBeNull();
    expect(screen.getByText(/Tài xế:/)).toBeTruthy();
    expect(screen.getByText(/Lương Văn Long/)).toBeTruthy();
  });

  it('renders external-carrier driver fields only — no schedule inputs', () => {
    const externalRow = { ...mockRow, dispatch: { ...mockRow.dispatch, carrierType: 'EXTERNAL' as const, assignedPlate: '51X-999.99' } };
    render(
      <IssueOrderFields
        row={externalRow}
        ownTruck={null}
        loadingOwnTruck={false}
        issueDraft={baseDraft}
        setIssueDraft={vi.fn()}
        onFieldTouched={vi.fn()}
        idPrefix="test-issue"
      />,
    );

    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(document.querySelector('input[type="time"]')).toBeNull();
    expect(screen.getByLabelText(/Tên tài xế/)).toBeTruthy();
    expect(screen.getByLabelText(/SĐT tài xế/)).toBeTruthy();
  });

  it('fires onFieldTouched when an external driver field changes', () => {
    const externalRow = { ...mockRow, dispatch: { ...mockRow.dispatch, carrierType: 'EXTERNAL' as const } };
    const onFieldTouched = vi.fn();
    render(
      <IssueOrderFields
        row={externalRow}
        ownTruck={null}
        loadingOwnTruck={false}
        issueDraft={baseDraft}
        setIssueDraft={vi.fn()}
        onFieldTouched={onFieldTouched}
        idPrefix="test-issue"
      />,
    );

    fireEvent.change(screen.getByLabelText(/Tên tài xế/), { target: { value: 'Trần Bình' } });
    expect(onFieldTouched).toHaveBeenCalled();
  });
});
