import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentCusWorkspaceDetail } from '@tingting/shared';
import type { ShipmentListItem } from '../../../api/shipmentClient';

import { DispatchContainerDetailDrawer } from './DispatchContainerDetailDrawer';

const { getCusShipmentWorkspaceDetail, updateCusShipmentContainerLine, addCusShipmentContainerRow, removeCusShipmentContainerRow } = vi.hoisted(() => ({
  getCusShipmentWorkspaceDetail: vi.fn(),
  updateCusShipmentContainerLine: vi.fn(),
  addCusShipmentContainerRow: vi.fn(),
  removeCusShipmentContainerRow: vi.fn(),
}));
vi.mock('../../../api/shipmentClient', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getCusShipmentWorkspaceDetail,
    updateCusShipmentContainerLine,
    addCusShipmentContainerRow,
    removeCusShipmentContainerRow,
  };
});

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
    // FB-045 lan 2 + SIL-530 + SIL-555: 44px ordinal + 3×150 fixed columns
    // (two ports + appointment) + 130px Thao tác + 6 auto columns ≥92px
    // (container / loại cont / số tờ khai / điều vận / nhà xe / biển số) —
    // 1176px computed, 1180px floor keeps every one-line header beside the
    // giờ hẹn column.
    expect(css).toContain('min-width: 1180px');
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

  it.each(['CUS', 'ADMIN', 'MANAGER', 'DISPATCHER'])('role %s gets the click-to-edit affordance', async (role) => {
    authRole = role;
    getCusShipmentWorkspaceDetail.mockResolvedValue(backfillDetail());
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    expect(await screen.findByRole('button', { name: 'Sửa số tờ khai · MSKU1234567' })).toBeTruthy();
  });

  it.each(['ACCOUNTANT', 'DRIVER', 'OPS'])('role %s gets static text — no affordance the server would 403', async (role) => {
    authRole = role;
    getCusShipmentWorkspaceDetail.mockResolvedValue(backfillDetail());
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    await screen.findByRole('cell', { name: 'Chưa có tờ khai' });
    expect(screen.queryByRole('button', { name: /Sửa số tờ khai/ })).toBeNull();
  });

  // SIL-553 (id 627) — the ticket's exact repro path (staging build 9094e31c:
  // Điều vận saw plain text "Chưa có tờ khai", click opened nothing because
  // the drawer gate predated the SIL-551 writer law). Pin the dispatcher +
  // empty-placeholder click-through so a gate flip back fails here.
  it('SIL-553 repro — Điều vận clicks the empty "Chưa có tờ khai" cell: the editor opens and Esc keeps the placeholder', async () => {
    authRole = 'DISPATCHER';
    getCusShipmentWorkspaceDetail.mockResolvedValue(backfillDetail());
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    const placeholderCell = await screen.findByRole('button', { name: 'Sửa số tờ khai · MSKU1234567' });
    expect(placeholderCell.textContent).toContain('Chưa có tờ khai');
    fireEvent.click(placeholderCell);
    const input = screen.getByLabelText('Số tờ khai') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Sửa số tờ khai · MSKU1234567' })).toBeTruthy();
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
  });

  // SIL-631 (owner 28/10, GLOBAL) — the editor floats OUTSIDE the cell through
  // a body portal: the drawer's `.dispatch-container-detail__table-scroll`
  // (overflow-x: auto) can never clip the typed value again (the ticket's
  // "row 2 container-number editor shows only part of MSKU5500004").
  it('SIL-631 pin — the editor renders OUTSIDE the overflow table-scroll (body portal), never clipped by the column', async () => {
    authRole = 'DISPATCHER';
    getCusShipmentWorkspaceDetail.mockResolvedValue(backfillDetail());
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    const cell = await screen.findByRole('button', { name: 'Sửa số tờ khai · MSKU1234567' });
    fireEvent.click(cell);
    const input = screen.getByLabelText('Số tờ khai');
    const scroller = document.querySelector('.dispatch-container-detail__table-scroll');
    expect(scroller).toBeTruthy();
    expect(scroller!.contains(input)).toBe(false);
    expect(scroller!.contains(input.closest('[data-cell-editor-portal]') as Node)).toBe(false);
    expect(input.closest('[data-cell-editor-portal]')?.parentElement).toBe(document.body);
    // The cell keeps its (dimmed) value while editing — the row context
    // survives the edit (no-overlap doctrine: the popover never covers it).
    expect(document.querySelector('.dispatch-container-detail__decl-value.is-editing')).toBeTruthy();
  });

  it('SIL-553 — Điều vận Enter saves the per-cont declaration number through the container-line command', async () => {
    authRole = 'DISPATCHER';
    getCusShipmentWorkspaceDetail.mockResolvedValue(backfillDetail());
    const onSaved = vi.fn();
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa số tờ khai · MSKU1234567' }));
    const input = screen.getByLabelText('Số tờ khai');
    fireEvent.change(input, { target: { value: 'TK-SIL553-DV' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledWith(
      1,
      10,
      { expectedShipmentVersion: 7, declarationNumber: 'TK-SIL553-DV' },
      expect.any(String),
    ));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText('Số tờ khai')).toBeNull());
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

describe('DispatchContainerDetailDrawer — Số cont + Giờ hẹn + Thêm container (SIL-550)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRole = null;
    updateCusShipmentContainerLine.mockReset().mockResolvedValue({ line: {} });
    addCusShipmentContainerRow.mockReset().mockResolvedValue({ line: {} });
  });

  const editableFields = {
    containerNumber: { mode: 'DIRECT', reason: 'Bạn có thể cập nhật trực tiếp.' },
    customerAppointmentAt: { mode: 'DIRECT', reason: 'Bạn có thể cập nhật trực tiếp trước khi điều xe.' },
    liftSiteId: { mode: 'READ_ONLY', reason: 'x' },
    dropoffSiteId: { mode: 'READ_ONLY', reason: 'x' },
  };

  function detailWith(summaryOver: Record<string, unknown>, lineOver: Record<string, unknown> = {}) {
    return {
      summary: { id: 1, version: 4, cargoMode: 'FCL', ...summaryOver },
      containers: [{
        id: 10,
        ordinal: 1,
        containerNumber: 'MSKU1234567',
        containerTypeLabel: '20DC',
        declarationNumber: null,
        dispatchStatus: 'AWAITING_VEHICLE',
        carrierName: 'SilverSea',
        plateNumber: '15C-123.45',
        liftSite: null,
        dropoffSite: null,
        liftSiteId: null,
        dropoffSiteId: null,
        customerAppointmentAt: null,
        shipmentVersion: 7,
        fieldAccess: editableFields,
        ...lineOver,
      }],
      selectors: { ports: portCatalog },
    } as unknown as ShipmentCusWorkspaceDetail;
  }

  it('Gap 2 — Số cont click-to-edit: Enter saves containerNumber through the container-line command and resyncs', async () => {
    authRole = 'DISPATCHER';
    getCusShipmentWorkspaceDetail.mockResolvedValue(detailWith({}));
    const onSaved = vi.fn();
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} onSaved={onSaved} />);

    // The number editor alone keeps the header honest once loaded (ports
    // stay read-only; the view-only claim must be gone).
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa số container · MSKU1234567' }));
    expect(screen.queryByText(/Chỉ xem tại đây/)).toBeNull();
    const input = screen.getByLabelText('Số container') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'MSKU9999999' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));
    expect(updateCusShipmentContainerLine).toHaveBeenCalledWith(
      1,
      10,
      { expectedShipmentVersion: 7, containerNumber: 'MSKU9999999' },
      expect.any(String),
    );
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', message: 'Đã lưu số container.' })));
    await waitFor(() => expect(getCusShipmentWorkspaceDetail).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText('Số container')).toBeNull());
  });

  it('Gap 2 — READ_ONLY số cont renders static text with no affordance', async () => {
    authRole = 'DISPATCHER';
    getCusShipmentWorkspaceDetail.mockResolvedValue(detailWith({}, {
      fieldAccess: {
        ...editableFields,
        containerNumber: { mode: 'READ_ONLY', reason: 'Lô hàng đã khóa kế toán; không thể thay đổi container.' },
      },
    }));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    await screen.findByRole('rowheader', { name: /MSKU1234567/ });
    expect(screen.queryByRole('button', { name: /Sửa số container/ })).toBeNull();
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
  });

  it('Gap 2 — a number-less row names the missing value (Chưa có số container), never a bare dash', async () => {
    getCusShipmentWorkspaceDetail.mockResolvedValue(detailWith({}, { containerNumber: null }));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    expect(await screen.findByText('Chưa có số container')).toBeTruthy();
  });

  it('Gap 3 — Giờ hẹn click-to-edit: date + time commit saves customerAppointmentAt in the +07:00 wire contract', async () => {
    authRole = 'DISPATCHER';
    getCusShipmentWorkspaceDetail.mockResolvedValue(detailWith({}));
    const onSaved = vi.fn();
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa giờ hẹn đóng/trả · MSKU1234567' }));
    fireEvent.change(screen.getByLabelText(/Ngày hẹn đóng\/trả/), { target: { value: '2026-10-29' } });
    fireEvent.change(screen.getByLabelText(/Giờ hẹn đóng\/trả/), { target: { value: '21:20' } });
    fireEvent.keyDown(screen.getByLabelText(/Giờ hẹn đóng\/trả/), { key: 'Enter' });

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));
    expect(updateCusShipmentContainerLine).toHaveBeenCalledWith(
      1,
      10,
      { expectedShipmentVersion: 7, customerAppointmentAt: '2026-10-29T21:20:00+07:00' },
      expect.any(String),
    );
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', message: 'Đã lưu giờ hẹn đóng/trả.' })));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText(/Giờ hẹn đóng\/trả/)).toBeNull());
  });

  it('Gap 3 — a half-filled schedule refuses to save and keeps the editor open', async () => {
    authRole = 'DISPATCHER';
    getCusShipmentWorkspaceDetail.mockResolvedValue(detailWith({}));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa giờ hẹn đóng/trả · MSKU1234567' }));
    fireEvent.change(screen.getByLabelText(/Ngày hẹn đóng\/trả/), { target: { value: '2026-10-29' } });
    fireEvent.keyDown(screen.getByLabelText(/Ngày hẹn đóng\/trả/), { key: 'Enter' });

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      message: 'Vui lòng nhập đầy đủ cả ngày và giờ hẹn.',
    })));
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Giờ hẹn đóng\/trả/)).toBeTruthy();
  });

  it('Gap 3 — both fields blank clears the appointment', async () => {
    authRole = 'DISPATCHER';
    getCusShipmentWorkspaceDetail.mockResolvedValue(detailWith({}, { customerAppointmentAt: '2026-08-20T02:00:00.000Z' }));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa giờ hẹn đóng/trả · MSKU1234567' }));
    fireEvent.change(screen.getByLabelText(/Ngày hẹn đóng\/trả/), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/Giờ hẹn đóng\/trả/), { target: { value: '' } });
    fireEvent.keyDown(screen.getByLabelText(/Giờ hẹn đóng\/trả/), { key: 'Enter' });

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledWith(
      1,
      10,
      { expectedShipmentVersion: 7, customerAppointmentAt: null },
      expect.any(String),
    ));
  });

  it('Gap 3 — a tripped line (customerAppointmentAt READ_ONLY) keeps static text', async () => {
    authRole = 'DISPATCHER';
    getCusShipmentWorkspaceDetail.mockResolvedValue(detailWith({}, {
      customerAppointmentAt: '2026-08-20T02:00:00.000Z',
      fieldAccess: {
        ...editableFields,
        customerAppointmentAt: { mode: 'READ_ONLY', reason: 'Container đã có chuyến thực tế; hãy dùng luồng điều chỉnh điều vận.' },
      },
    }));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    await screen.findByText(/09:00.*20\/08\/2026/);
    expect(screen.queryByRole('button', { name: /Sửa giờ hẹn đóng\/trả/ })).toBeNull();
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
  });

  it('Gap 1 — Thêm container: the footer form adds a row through the container-add command and resyncs', async () => {
    authRole = 'DISPATCHER';
    getCusShipmentWorkspaceDetail.mockResolvedValue(detailWith({}));
    const onSaved = vi.fn();
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.click(await screen.findByRole('button', { name: /Thêm container/ }));
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'MSKU5555555' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));

    await waitFor(() => expect(addCusShipmentContainerRow).toHaveBeenCalledTimes(1));
    expect(addCusShipmentContainerRow).toHaveBeenCalledWith(
      1,
      { expectedShipmentVersion: 4, containerNumber: 'MSKU5555555' },
      expect.any(String),
    );
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', message: 'Đã thêm container vào lô.' })));
    await waitFor(() => expect(getCusShipmentWorkspaceDetail).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    // The form folded back to its button after the persisted add.
    expect(screen.queryByLabelText('Số container')).toBeNull();
  });

  it('Gap 1 — a refused add surfaces the backend reason verbatim and resyncs the detail', async () => {
    authRole = 'DISPATCHER';
    getCusShipmentWorkspaceDetail.mockResolvedValue(detailWith({}));
    addCusShipmentContainerRow.mockRejectedValue(new Error('Số container "MSKU5555555" đã tồn tại trong lô hàng.'));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: /Thêm container/ }));
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'MSKU5555555' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      message: 'Số container "MSKU5555555" đã tồn tại trong lô hàng.',
    })));
    await waitFor(() => expect(getCusShipmentWorkspaceDetail).toHaveBeenCalledTimes(2));
    // The form stays open for a correction.
    expect(screen.getByLabelText('Số container')).toBeTruthy();
  });

  it('Gap 1 — the add control never appears on an accounting-locked lot', async () => {
    authRole = 'CUS';
    getCusShipmentWorkspaceDetail.mockResolvedValue(detailWith({ activeLock: { id: 9, lockedBy: 'x' } }));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    await screen.findByText('MSKU1234567');
    expect(screen.queryByRole('button', { name: /Thêm container/ })).toBeNull();
  });

  it('Gap 1 — the add control never appears on an LCL lot', async () => {
    authRole = 'CUS';
    getCusShipmentWorkspaceDetail.mockResolvedValue(detailWith({ cargoMode: 'LCL' }));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    await screen.findByText('MSKU1234567');
    expect(screen.queryByRole('button', { name: /Thêm container/ })).toBeNull();
  });

  it('Gap 1 — the add control never appears for a role outside the writer law', async () => {
    authRole = 'ACCOUNTANT';
    getCusShipmentWorkspaceDetail.mockResolvedValue(detailWith({}));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    await screen.findByText('MSKU1234567');
    expect(screen.queryByRole('button', { name: /Thêm container/ })).toBeNull();
  });
});

describe('DispatchContainerDetailDrawer — XÓA CONT per-row delete (SIL-555, id 629)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRole = 'DISPATCHER';
    removeCusShipmentContainerRow.mockReset().mockResolvedValue({ removedId: 10, shipmentVersion: 8 });
  });

  function removeDetail(lineOver: Record<string, unknown> = {}, summaryOver: Record<string, unknown> = {}) {
    return {
      summary: { id: 1, version: 4, cargoMode: 'FCL', activeLock: null, ...summaryOver },
      containers: [{
        id: 10,
        ordinal: 1,
        containerNumber: 'MSKU5500004',
        containerTypeLabel: '40DC',
        declarationNumber: null,
        tripId: null,
        tripStatus: null,
        dispatchStatus: 'AWAITING_VEHICLE',
        carrierName: null,
        plateNumber: null,
        liftSite: null,
        dropoffSite: null,
        liftSiteId: null,
        dropoffSiteId: null,
        customerAppointmentAt: null,
        shipmentVersion: 7,
        fieldAccess: {
          containerNumber: { mode: 'DIRECT', reason: 'Bạn có thể cập nhật trực tiếp.' },
          customerAppointmentAt: { mode: 'DIRECT', reason: 'Bạn có thể cập nhật trực tiếp.' },
          liftSiteId: { mode: 'READ_ONLY', reason: 'x' },
          dropoffSiteId: { mode: 'READ_ONLY', reason: 'x' },
        },
        ...lineOver,
      }],
      selectors: { ports: portCatalog },
    } as unknown as ShipmentCusWorkspaceDetail;
  }

  it('renders the Thao tác column and deletes the row through the danger confirm (SIL-472 contract)', async () => {
    getCusShipmentWorkspaceDetail.mockResolvedValue(removeDetail());
    const onSaved = vi.fn();
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} onSaved={onSaved} />);

    expect(await screen.findByRole('button', { name: 'Xóa container MSKU5500004' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Thao tác' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa container MSKU5500004' }));

    // The confirm names the row it deletes (CUS-10 copy) and really deletes it.
    const dialog = await screen.findByRole('dialog', { name: 'Xác nhận thao tác' });
    expect(within(dialog).getByText('Xóa container MSKU5500004?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa container' }));

    await waitFor(() => expect(removeCusShipmentContainerRow).toHaveBeenCalledWith(
      1,
      10,
      { expectedShipmentVersion: 7 },
      expect.any(String),
    ));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', message: 'Đã xóa container MSKU5500004.' })));
    // Refresh danh sách sau khi xóa (SIL-177): drawer refetch + board ping.
    await waitFor(() => expect(getCusShipmentWorkspaceDetail).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Xóa container MSKU5500004?')).toBeNull());
  });

  it('Hủy closes the confirm without deleting or calling the API', async () => {
    getCusShipmentWorkspaceDetail.mockResolvedValue(removeDetail());
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Xóa container MSKU5500004' }));
    const dialog = await screen.findByRole('dialog', { name: 'Xác nhận thao tác' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));

    await waitFor(() => expect(screen.queryByText('Xóa container MSKU5500004?')).toBeNull());
    expect(removeCusShipmentContainerRow).not.toHaveBeenCalled();
  });

  it('SIL-177 guard: a row carrying a tờ khai disables the button with the guard reason', async () => {
    getCusShipmentWorkspaceDetail.mockResolvedValue(removeDetail({ declarationNumber: 'Q1-DECL-177' }));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    const button = await screen.findByRole('button', { name: 'Xóa container MSKU5500004' });
    expect(button).toHaveAttribute('disabled');
    expect(button).toHaveAttribute('title', 'Cont có tờ khai Q1-DECL-177 — gỡ tờ khai trước khi xóa');
    // The FE never warn-and-allows past the BE 409 guard: no dialog, no call.
    expect(removeCusShipmentContainerRow).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Xác nhận thao tác' })).toBeNull();
  });

  it('trip guard: a row already on a trip disables the button with the trip reason', async () => {
    getCusShipmentWorkspaceDetail.mockResolvedValue(removeDetail({ tripId: 5, tripStatus: 'CREATED' }));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    const button = await screen.findByRole('button', { name: 'Xóa container MSKU5500004' });
    expect(button).toHaveAttribute('disabled');
    expect(button).toHaveAttribute('title', 'Không thể xóa container đã gắn chuyến xe');
    expect(removeCusShipmentContainerRow).not.toHaveBeenCalled();
  });

  it('a CANCELED trip does not block the row (tripStatus CANCELED is free)', async () => {
    getCusShipmentWorkspaceDetail.mockResolvedValue(removeDetail({ tripId: 5, tripStatus: 'CANCELED' }));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    const button = await screen.findByRole('button', { name: 'Xóa container MSKU5500004' });
    expect(button).not.toHaveAttribute('disabled');
  });

  it('role law: a role outside the writer set never sees the button or the column', async () => {
    authRole = 'ACCOUNTANT';
    getCusShipmentWorkspaceDetail.mockResolvedValue(removeDetail());
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    await screen.findByText('MSKU5500004');
    expect(screen.queryByRole('columnheader', { name: 'Thao tác' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Xóa container/ })).toBeNull();
    expect(removeCusShipmentContainerRow).not.toHaveBeenCalled();
  });

  it('accounting lock: an activeLock lot never shows the button or the column', async () => {
    authRole = 'CUS';
    getCusShipmentWorkspaceDetail.mockResolvedValue(removeDetail({}, { activeLock: { id: 9, lockedBy: 'x' } }));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    await screen.findByText('MSKU5500004');
    expect(screen.queryByRole('columnheader', { name: 'Thao tác' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Xóa container/ })).toBeNull();
  });

  it('a refused remove surfaces the API reason, keeps the dialog open, and resyncs for a retry', async () => {
    getCusShipmentWorkspaceDetail.mockResolvedValue(removeDetail());
    removeCusShipmentContainerRow.mockRejectedValue(new Error('Lô hàng phải có ít nhất một container.'));
    render(<DispatchContainerDetailDrawer shipment={shipment} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Xóa container MSKU5500004' }));
    const dialog = await screen.findByRole('dialog', { name: 'Xác nhận thao tác' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa container' }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      message: 'Lô hàng phải có ít nhất một container.',
    })));
    // Guard rejection keeps the dialog open (retry / Hủy) and refetches so a
    // retry carries the fresh expectedShipmentVersion (add-flow parity).
    expect(screen.getByText('Xóa container MSKU5500004?')).toBeTruthy();
    await waitFor(() => expect(getCusShipmentWorkspaceDetail).toHaveBeenCalledTimes(2));
    expect(removeCusShipmentContainerRow).toHaveBeenCalledTimes(1);
  });
});
