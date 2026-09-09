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
  classification: 'SINGLE',
  ports: { pickupPortId: null, pickupPortName: null, pickupPortShortName: null, dropoffPortId: null, dropoffPortName: null, dropoffPortShortName: null },
  lotFullyPlated: true,
  isCombined: false,
};

describe('IssueOrderFields — New Calendar Design', () => {
  it('renders quick days, 24h time inputs, DateInput with lang="en-GB", and common hours presets', () => {
    const draft: IssueOrderDraft = {
      plannedStartAt: '2026-09-10T14:00',
      plannedEndAt: '2026-09-10T16:00',
      externalDriverName: '',
      externalDriverPhone: '',
    };
    const setIssueDraft = vi.fn();
    const onFieldTouched = vi.fn();

    render(
      <IssueOrderFields
        row={mockRow}
        ownTruck={{ id: 1, driverId: 1, driverName: 'Lương Văn Long' }}
        loadingOwnTruck={false}
        issueDraft={draft}
        setIssueDraft={setIssueDraft}
        onFieldTouched={onFieldTouched}
        idPrefix="test-issue"
      />,
    );

    // Section headers
    expect(screen.getByText('Chọn nhanh ngày')).toBeTruthy();
    expect(screen.getByText('Khung giờ phổ biến')).toBeTruthy();

    // Quick day shortcuts
    expect(screen.getByRole('button', { name: 'Hôm nay' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ngày mai' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ngày kia' })).toBeTruthy();

    // Inputs: Giờ chạy, Giờ kết thúc, Ngày chạy
    const startTimeInput = document.getElementById('test-issue-start-101') as HTMLInputElement;
    const endTimeInput = document.getElementById('test-issue-end-101') as HTMLInputElement;
    const dateInput = document.getElementById('test-issue-date-101') as HTMLInputElement;

    expect(startTimeInput).toBeTruthy();
    expect(endTimeInput).toBeTruthy();
    expect(dateInput).toBeTruthy();

    expect(startTimeInput.type).toBe('time');
    expect(endTimeInput.type).toBe('time');
    expect(dateInput.type).toBe('date');

    // Pinned to 24h format and dd/mm/yyyy
    expect(startTimeInput.getAttribute('lang')).toBe('en-GB');
    expect(endTimeInput.getAttribute('lang')).toBe('en-GB');
    expect(dateInput.getAttribute('lang')).toBe('en-GB');

    expect(startTimeInput.value).toBe('14:00');
    expect(endTimeInput.value).toBe('16:00');
    expect(dateInput.value).toBe('2026-09-10');

    // Preset pills
    expect(screen.getByRole('button', { name: '08:00' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '10:00' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '13:30' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '16:00' })).toBeTruthy();
  });

  it('clicking a quick-day pill updates the date in both plannedStartAt and plannedEndAt', () => {
    let draft: IssueOrderDraft = {
      plannedStartAt: '2026-09-10T14:00',
      plannedEndAt: '2026-09-10T16:00',
      externalDriverName: '',
      externalDriverPhone: '',
    };
    const setIssueDraft = vi.fn((updater) => {
      draft = updater(draft);
    });
    const onFieldTouched = vi.fn();

    render(
      <IssueOrderFields
        row={mockRow}
        ownTruck={{ id: 1, driverId: 1, driverName: 'Lương Văn Long' }}
        loadingOwnTruck={false}
        issueDraft={draft}
        setIssueDraft={setIssueDraft}
        onFieldTouched={onFieldTouched}
        idPrefix="test-issue"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ngày mai' }));
    expect(setIssueDraft).toHaveBeenCalled();
    expect(onFieldTouched).toHaveBeenCalled();

    const expectedDate = new Date();
    expectedDate.setDate(expectedDate.getDate() + 1);
    const y = expectedDate.getFullYear();
    const m = String(expectedDate.getMonth() + 1).padStart(2, '0');
    const d = String(expectedDate.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    expect(draft.plannedStartAt).toBe(`${dateStr}T14:00`);
    expect(draft.plannedEndAt).toBe(`${dateStr}T16:00`);
  });

  it('clicking a common-hours preset updates start time and sets end time to +2 hours', () => {
    let draft: IssueOrderDraft = {
      plannedStartAt: '2026-09-10T14:00',
      plannedEndAt: '2026-09-10T16:00',
      externalDriverName: '',
      externalDriverPhone: '',
    };
    const setIssueDraft = vi.fn((updater) => {
      draft = updater(draft);
    });
    const onFieldTouched = vi.fn();

    render(
      <IssueOrderFields
        row={mockRow}
        ownTruck={{ id: 1, driverId: 1, driverName: 'Lương Văn Long' }}
        loadingOwnTruck={false}
        issueDraft={draft}
        setIssueDraft={setIssueDraft}
        onFieldTouched={onFieldTouched}
        idPrefix="test-issue"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '08:00' }));
    expect(setIssueDraft).toHaveBeenCalled();
    expect(onFieldTouched).toHaveBeenCalled();
    expect(draft.plannedStartAt).toBe('2026-09-10T08:00');
    expect(draft.plannedEndAt).toBe('2026-09-10T10:00');
  });

  it('displays the next-day badge (+1 ngày) when end time is overnight', () => {
    const draft: IssueOrderDraft = {
      plannedStartAt: '2026-09-10T22:00',
      plannedEndAt: '2026-09-11T02:00',
      externalDriverName: '',
      externalDriverPhone: '',
    };
    const setIssueDraft = vi.fn();
    const onFieldTouched = vi.fn();

    render(
      <IssueOrderFields
        row={mockRow}
        ownTruck={{ id: 1, driverId: 1, driverName: 'Lương Văn Long' }}
        loadingOwnTruck={false}
        issueDraft={draft}
        setIssueDraft={setIssueDraft}
        onFieldTouched={onFieldTouched}
        idPrefix="test-issue"
      />,
    );

    expect(screen.getByText('+1 ngày')).toBeTruthy();
  });
});
