import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ShipmentDetail } from '../../../api/shipmentClient';
import { ShipmentDetailContainers } from './ShipmentDetailContainers';

const originalMedia = window.matchMedia;
function viewport(width: number) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: width <= Number(query.match(/max-width:\s*(\d+)/)?.[1] ?? 0),
    media: query, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  });
}
afterEach(() => { window.matchMedia = originalMedia; });
const container: ShipmentDetail['containers'][number] = {
  id: 7, shipmentId: 1, containerTypeId: 1, containerTypeName: "20'DC",
  containerNumber: 'TGHU1234567', sealNumber: 'SEAL-01', cargoWeightKg: '1000.00',
  notes: 'Giao tại kho theo lịch', customerAppointmentAt: '2026-10-01T01:30:00.000Z',
  plannedVehiclePlate: '15H-154.98', pairKind: 'KEP',
};
const assignment: ShipmentDetail['carrierAssignments'][number] = {
  fulfillmentId: 31, fulfillmentVersion: 1, shipmentContainerId: 7,
  containerTypeCode: '20DC', containerTypeName: "20'DC", carrierType: 'EXTERNAL',
  externalCarrierId: 3, externalCarrierName: 'Gaya Container Lines',
};

describe('QA-AUDIT-UI-36 shipment container reading', () => {
  it('shows primary facts and discloses every remaining matrix field on phone', () => {
    viewport(390); render(<ShipmentDetailContainers containers={[container]} assignments={[assignment]} />);
    const record = screen.getByRole('article', { name: 'TGHU1234567' });
    expect(within(record).getByText("20'DC")).toBeVisible();
    expect(within(record).getByText('Gaya Container Lines')).toBeVisible();
    expect(within(record).getByText('15H-154.98')).toBeVisible();
    const details = within(record).getByText('Chi tiết').parentElement;
    fireEvent.click(within(record).getByText('Chi tiết'));
    // jsdom has no native summary activation; assert the real disclosure mapping.
    expect(details?.tagName).toBe('DETAILS');
    expect(within(record).getByText('[KẸP]')).toBeTruthy();
    expect(within(record).getByText('SEAL-01')).toBeTruthy();
    expect(within(record).getByText('08:30 01/10/2026')).toBeTruthy();
    expect(within(record).getByText('1000.00')).toBeTruthy();
    expect(within(record).getByText('Giao tại kho theo lịch')).toBeTruthy();
    expect(within(record).queryByRole('checkbox')).toBeNull();
    expect(within(record).queryByRole('link')).toBeNull();
  });
  it('uses an honest missing-number title and preserves the same desktop values', () => {
    viewport(390);
    const view = render(<ShipmentDetailContainers containers={[{ ...container, containerNumber: null }]} assignments={[]} />);
    expect(screen.getByRole('article', { name: 'Chưa có số container' })).toBeTruthy();
    viewport(768); view.unmount();
    render(<ShipmentDetailContainers containers={[container]} assignments={[assignment]} />);
    expect(screen.queryByRole('article')).toBeNull();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(8);
    for (const value of ['TGHU1234567', 'Gaya Container Lines', '15H-154.98', 'SEAL-01', '08:30 01/10/2026', '1000.00', 'Giao tại kho theo lịch', '[KẸP]']) {
      expect(within(table).getByText(value)).toBeTruthy();
    }
  });
});
