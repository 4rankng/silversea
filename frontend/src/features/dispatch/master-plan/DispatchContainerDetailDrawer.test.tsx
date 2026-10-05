import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentCusWorkspaceDetail } from '@tingting/shared';
import type { ShipmentListItem } from '../../../api/shipmentClient';

import { DispatchContainerDetailDrawer } from './DispatchContainerDetailDrawer';

const { getCusShipmentWorkspaceDetail, updateCusShipmentContainerLine } = vi.hoisted(() => ({
  getCusShipmentWorkspaceDetail: vi.fn(),
  updateCusShipmentContainerLine: vi.fn(),
}));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/shipmentClient')>()),
  getCusShipmentWorkspaceDetail,
  updateCusShipmentContainerLine,
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
    dispatchStatus: 'AWAITING_VEHICLE',
    carrierName: 'SilverSea',
    plateNumber: '15C-123.45',
    liftSite: 'Cảng Cát Lái',
    dropoffSite: 'Nhà máy ABC',
    customerAppointmentAt: '2026-08-20T02:00:00.000Z',
  }],
} as unknown as ShipmentCusWorkspaceDetail;

const portCatalog = [
  { id: 7, code: 'HP', name: 'Cảng Hải Phòng', label: 'Cảng Hải Phòng' },
  { id: 9, code: 'CL', name: 'Cảng Cát Lái', label: 'Cảng Cát Lái' },
];

function backfillDetail(overrides: Record<string, unknown> = {}) {
  return {
    summary: { id: 1, version: 4, cargoMode: 'FCL' },
    containers: [{
      id: 10,
      ordinal: 1,
      containerNumber: 'MSKU1234567',
      containerTypeLabel: '20DC',
      dispatchStatus: 'COMPLETED',
      carrierName: 'SilverSea',
      plateNumber: '15C-123.45',
      liftSite: null,
      dropoffSite: null,
      liftSiteId: null,
      dropoffSiteId: null,
      customerAppointmentAt: null,
      shipmentVersion: 7,
      fieldAccess: {
        liftSiteId: { mode: 'DIRECT', reason: 'Bạn có thể bổ sung cảng nâng/hạ sau khi điều xe.' },
        dropoffSiteId: { mode: 'DIRECT', reason: 'Bạn có thể bổ sung cảng nâng/hạ sau khi điều xe.' },
      },
      ...overrides,
    }],
    selectors: { ports: portCatalog },
  } as unknown as ShipmentCusWorkspaceDetail;
}

describe('DispatchContainerDetailDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the dispatcher-authorized workspace detail and renders per-container schedule data in place', async () => {
    getCusShipmentWorkspaceDetail.mockResolvedValue(detail);
    const onClose = vi.fn();
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={onClose} />);

    expect(await screen.findByRole('dialog', { name: 'Chi tiết container' })).toBeTruthy();
    expect(screen.getByText('BL-01 · Công ty ABC')).toBeTruthy();
    expect(screen.queryByText(/SS-000100/)).toBeNull();
    await waitFor(() => expect(getCusShipmentWorkspaceDetail).toHaveBeenCalledWith(1));
    expect(screen.getByRole('columnheader', { name: 'STT' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '1' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: /MSKU1234567/ })).toBeTruthy();
    expect(await screen.findByText('MSKU1234567')).toBeTruthy();
    expect(screen.getByText(/09:00.*20\/08\/2026/)).toBeTruthy();
    expect(screen.getByText('Chờ phân xe')).toBeTruthy();
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

  it('offers port backfill editors when lift/drop fieldAccess is DIRECT and saves a pick through the container-line route', async () => {
    getCusShipmentWorkspaceDetail.mockResolvedValue(backfillDetail());
    updateCusShipmentContainerLine.mockResolvedValue({});
    const onSaved = vi.fn();
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} onSaved={onSaved} />);

    const liftTrigger = await screen.findByRole('button', { name: 'Cảng nâng của container MSKU1234567' });
    expect(liftTrigger).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cảng hạ của container MSKU1234567' })).toBeTruthy();
    // The header must stop claiming view-only once the ports are editable.
    expect(screen.queryByText(/Chỉ xem tại đây/)).toBeNull();

    fireEvent.click(liftTrigger);
    const search = screen.getByRole('combobox', { name: 'Tìm cảng nâng' });
    fireEvent.change(search, { target: { value: 'Hải Phòng' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Cảng Hải Phòng' }));

    // The client generates its own Idempotency-Key header for this one-shot
    // save (same as the other workspace one-shot callers).
    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledWith(
      1,
      10,
      { expectedShipmentVersion: 7, liftSiteId: 7 },
    ));
    // The drawer refetches its own detail and tells the page so the board's
    // CẢNG NÂNG/HẠ columns refetch from the same container columns.
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getCusShipmentWorkspaceDetail).toHaveBeenCalledTimes(2));
  });

  it('keeps lift/drop cells static when fieldAccess is READ_ONLY (locked lot or unauthorized role)', async () => {
    getCusShipmentWorkspaceDetail.mockResolvedValue(backfillDetail({
      fieldAccess: {
        liftSiteId: { mode: 'READ_ONLY', reason: 'Lô hàng đã khóa kế toán; không thể thay đổi container.' },
        dropoffSiteId: { mode: 'READ_ONLY', reason: 'Lô hàng đã khóa kế toán; không thể thay đổi container.' },
      },
    }));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    await screen.findByText('MSKU1234567');
    expect(screen.queryByRole('button', { name: /Cảng (nâng|hạ) của container/ })).toBeNull();
    expect(screen.getByText(/Chỉ xem tại đây/)).toBeTruthy();
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
  });

  it('surfaces a failed port save and resyncs the editor to persisted state', async () => {
    getCusShipmentWorkspaceDetail.mockResolvedValue(backfillDetail());
    updateCusShipmentContainerLine.mockRejectedValue(new Error('Cảng nâng/hạ không còn hiệu lực trong danh mục cảng, bãi.'));
    const onSaved = vi.fn();
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} onSaved={onSaved} />);

    const liftTrigger = await screen.findByRole('button', { name: 'Cảng nâng của container MSKU1234567' });
    fireEvent.click(liftTrigger);
    fireEvent.change(screen.getByRole('combobox', { name: 'Tìm cảng nâng' }), { target: { value: 'Hải Phòng' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Cảng Hải Phòng' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Cảng nâng/hạ không còn hiệu lực trong danh mục cảng, bãi.');
    expect(onSaved).not.toHaveBeenCalled();
    // Resync: the failed save refetches the persisted detail (call 2).
    await waitFor(() => expect(getCusShipmentWorkspaceDetail).toHaveBeenCalledTimes(2));
  });
});
