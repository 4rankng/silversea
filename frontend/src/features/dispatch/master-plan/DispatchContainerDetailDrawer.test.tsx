import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentCusWorkspaceDetail } from '@tingting/shared';
import type { ShipmentListItem } from '../../../api/shipmentClient';

import { DispatchContainerDetailDrawer } from './DispatchContainerDetailDrawer';

const { getCusShipmentWorkspaceDetail } = vi.hoisted(() => ({
  getCusShipmentWorkspaceDetail: vi.fn(),
}));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/shipmentClient')>()),
  getCusShipmentWorkspaceDetail,
}));

const shipment = {
  id: 1,
  shipmentCode: 'SS-000100',
  customerName: 'Công ty ABC',
  blNumber: 'BL-01',
  bookingRef: null,
} as ShipmentListItem;

const detail = {
  containers: [{
    id: 10,
    ordinal: 1,
    containerNumber: 'MSKU1234567',
    containerTypeLabel: '40HC',
    dispatchStatus: 'PLANNED',
    carrierName: 'SilverSea',
    plateNumber: '15C-123.45',
    liftSite: 'Cảng Cát Lái',
    dropoffSite: 'Nhà máy ABC',
    customerAppointmentAt: '2026-08-20T02:00:00.000Z',
  }],
} as unknown as ShipmentCusWorkspaceDetail;

describe('DispatchContainerDetailDrawer', () => {
  it('loads the dispatcher-authorized workspace detail and renders per-container schedule data in place', async () => {
    getCusShipmentWorkspaceDetail.mockResolvedValue(detail);
    const onClose = vi.fn();
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={onClose} />);

    expect(await screen.findByRole('dialog', { name: 'Chi tiết cont' })).toBeTruthy();
    await waitFor(() => expect(getCusShipmentWorkspaceDetail).toHaveBeenCalledWith(1));
    expect(screen.getByRole('columnheader', { name: 'STT' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '1' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'MSKU1234567' })).toBeTruthy();
    expect(await screen.findByText('MSKU1234567')).toBeTruthy();
    expect(screen.getByText(/09:00.*20\/8\/26/)).toBeTruthy();
    expect(screen.getByText('Đã phân xe')).toBeTruthy();
    expect(screen.getByText(/Chỉ xem tại đây/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Lưu container/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the drawer layout responsive without carrying the CUS editor controls', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/DispatchContainerDetailDrawer.css'), 'utf8');
    expect(css).toContain('min-width: 900px');
    expect(css).toMatch(/\.dispatch-container-detail__table tbody th,[\s\S]*?\.dispatch-container-detail__table tbody td\s*\{[\s\S]*?white-space:\s*normal;/);
    expect(css).toMatch(/@container \(max-width: 760px\)[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).not.toContain('searchable-select');
  });
});
