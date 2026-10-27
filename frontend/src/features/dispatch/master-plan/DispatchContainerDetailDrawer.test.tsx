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

const toastMock = vi.fn();
vi.mock('../../../components/shared/Toast', () => ({
  useToastOptional: () => ({ toast: toastMock }),
}));

let authRole: string | null = null;
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => (authRole == null ? undefined : { user: { userId: 1, role: authRole } }),
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
      declarationNumber: null,
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
    authRole = null;
    updateCusShipmentContainerLine.mockReset().mockResolvedValue({
      line: {},
      declarationSync: { updatedContainerIds: [11, 12] },
    });
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
    // FB-045 lan 2 + SIL-530: 44px ordinal + 3×150 fixed columns (two ports +
    // appointment) + 6 auto columns ≥92px (container / loại cont / số tờ khai /
    // điều vận / nhà xe / biển số) — 1046px computed, 1050px floor keeps every
    // one-line header beside the giờ hẹn column.
    expect(css).toContain('min-width: 1050px');
    expect(css).toMatch(/\.dispatch-container-detail__table tbody th,[\s\S]*?\.dispatch-container-detail__table tbody td\s*\{[\s\S]*?white-space:\s*normal;/);
    expect(css).toMatch(/@container \(max-width: 760px\)[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).not.toContain('searchable-select');
    // SIL-530: the decl cell carries its own click-to-edit band (same pattern
    // as the detailed-plan grid's SIL-591 cell — value button + inline input).
    expect(css).toContain('.dispatch-container-detail__decl-value--action');
    expect(css).toContain('.dispatch-container-detail__decl-input');
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

describe('DispatchContainerDetailDrawer — SỐ TỜ KHAI column (SIL-530, per-cont SIL-521)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRole = null;
    updateCusShipmentContainerLine.mockReset().mockResolvedValue({
      line: {},
      declarationSync: { updatedContainerIds: [11, 12] },
    });
  });

  it('renders the Số tờ khai column with the container line value as static text when unauthenticated', async () => {
    getCusShipmentWorkspaceDetail.mockResolvedValue(backfillDetail({ declarationNumber: 'TK-R42RV-001' }));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    expect(await screen.findByRole('columnheader', { name: 'Số tờ khai' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'TK-R42RV-001' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sửa số tờ khai/ })).toBeNull();
  });

  it('names the missing value (Chưa có tờ khai) — never a bare dash', async () => {
    getCusShipmentWorkspaceDetail.mockResolvedValue(backfillDetail());
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    expect(await screen.findByRole('cell', { name: 'Chưa có tờ khai' })).toBeTruthy();
  });

  it.each(['CUS', 'ADMIN', 'MANAGER'])('role %s gets the click-to-edit affordance', async (role) => {
    authRole = role;
    getCusShipmentWorkspaceDetail.mockResolvedValue(backfillDetail());
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    expect(await screen.findByRole('button', { name: 'Sửa số tờ khai · MSKU1234567' })).toBeTruthy();
  });

  it.each(['DISPATCHER', 'ACCOUNTANT', 'DRIVER'])('role %s gets static text — no affordance the server would 403', async (role) => {
    authRole = role;
    getCusShipmentWorkspaceDetail.mockResolvedValue(backfillDetail());
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    await screen.findByRole('cell', { name: 'Chưa có tờ khai' });
    expect(screen.queryByRole('button', { name: /Sửa số tờ khai/ })).toBeNull();
  });

  it('click → inline input → Enter saves through the container-line command, toasts the FB-109 siblings and resyncs', async () => {
    authRole = 'CUS';
    getCusShipmentWorkspaceDetail.mockResolvedValue(backfillDetail());
    const onSaved = vi.fn();
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa số tờ khai · MSKU1234567' }));
    const input = screen.getByLabelText('Số tờ khai') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'TK-NEW-01' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));
    expect(updateCusShipmentContainerLine).toHaveBeenCalledWith(
      1,
      10,
      { expectedShipmentVersion: 7, declarationNumber: 'TK-NEW-01' },
      expect.any(String),
    );
    // FB-109 auto-copy toast: the mocked result synced 2 siblings.
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'success',
      message: expect.stringContaining('2 container'),
    })));
    // The drawer refetches its detail and pings the board.
    await waitFor(() => expect(getCusShipmentWorkspaceDetail).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    // The editor closed; the refetched value shows as text.
    await waitFor(() => expect(screen.queryByLabelText('Số tờ khai')).toBeNull());
  });

  it('Enter with no change closes the editor without a write', async () => {
    authRole = 'CUS';
    getCusShipmentWorkspaceDetail.mockResolvedValue(backfillDetail({ declarationNumber: 'TK-KEEP' }));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa số tờ khai · MSKU1234567' }));
    const input = screen.getByLabelText('Số tờ khai') as HTMLInputElement;
    expect(input.value).toBe('TK-KEEP');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByLabelText('Số tờ khai')).toBeNull());
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
    expect(getCusShipmentWorkspaceDetail).toHaveBeenCalledTimes(1);
  });

  it('Escape reverts — the persisted value survives, nothing is written', async () => {
    authRole = 'CUS';
    getCusShipmentWorkspaceDetail.mockResolvedValue(backfillDetail({ declarationNumber: 'TK-KEEP' }));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa số tờ khai · MSKU1234567' }));
    const input = screen.getByLabelText('Số tờ khai');
    fireEvent.change(input, { target: { value: 'TK-CHANGED' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByRole('cell', { name: 'TK-KEEP' })).toBeTruthy();
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
  });

  it('a refused save surfaces the backend reason verbatim and keeps the editor open', async () => {
    authRole = 'CUS';
    getCusShipmentWorkspaceDetail.mockResolvedValue(backfillDetail());
    updateCusShipmentContainerLine.mockRejectedValue(new Error('Số tờ khai đã thuộc lô hàng khác. Vui lòng kiểm tra lại trước khi lưu.'));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa số tờ khai · MSKU1234567' }));
    const input = screen.getByLabelText('Số tờ khai');
    fireEvent.change(input, { target: { value: 'TK-DUP' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      message: 'Số tờ khai đã thuộc lô hàng khác. Vui lòng kiểm tra lại trước khi lưu.',
    })));
    // The editor stays open (draft intact) for a correction; no resync.
    expect(screen.getByLabelText('Số tờ khai')).toBeTruthy();
    expect(getCusShipmentWorkspaceDetail).toHaveBeenCalledTimes(1);
  });

  it('the same cell re-edits after a successful save — saving clears on success (regression: stale saving dead-locked the next click)', async () => {
    authRole = 'CUS';
    // The refetch returns the persisted line — the same tr key keeps the cell
    // instance alive across it, which is exactly what a stale saving=true
    // would dead-lock.
    getCusShipmentWorkspaceDetail
      .mockResolvedValueOnce(backfillDetail({ declarationNumber: 'TK-FIRST' }))
      .mockResolvedValue(backfillDetail({ declarationNumber: 'TK-SECOND' }));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    // First save lands and the drawer resyncs to the persisted value.
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa số tờ khai · MSKU1234567' }));
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: 'TK-SECOND' } });
    fireEvent.keyDown(screen.getByLabelText('Số tờ khai'), { key: 'Enter' });
    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sửa số tờ khai · MSKU1234567' }).textContent).toContain('TK-SECOND'));

    // The SAME cell must open its editor again instead of ignoring the click.
    fireEvent.click(screen.getByRole('button', { name: 'Sửa số tờ khai · MSKU1234567' }));
    const reopened = screen.getByLabelText('Số tờ khai') as HTMLInputElement;
    expect(reopened.value).toBe('TK-SECOND');
    fireEvent.change(reopened, { target: { value: 'TK-THIRD' } });
    fireEvent.keyDown(reopened, { key: 'Enter' });
    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(2));
    expect(updateCusShipmentContainerLine).toHaveBeenLastCalledWith(
      1,
      10,
      { expectedShipmentVersion: 7, declarationNumber: 'TK-THIRD' },
      expect.any(String),
    );
  });

  it('blur reverts the draft — no partial value lingers, nothing is written', async () => {
    authRole = 'CUS';
    getCusShipmentWorkspaceDetail.mockResolvedValue(backfillDetail({ declarationNumber: 'TK-KEEP' }));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa số tờ khai · MSKU1234567' }));
    const input = screen.getByLabelText('Số tờ khai');
    fireEvent.change(input, { target: { value: 'TK-TYPED-AWAY' } });
    fireEvent.blur(input);
    expect(screen.getByRole('cell', { name: 'TK-KEEP' })).toBeTruthy();
    expect(screen.queryByLabelText('Số tờ khai')).toBeNull();
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
  });
});
