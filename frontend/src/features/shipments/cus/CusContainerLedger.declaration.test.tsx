// Card 261022095235a (CUS-05): per-container tờ khai inline edit on the
// shared container ledger (drawer Tổng quan + lot-detail management host).
// Pins: cell renders value/placeholder; click-to-edit + Enter commits an
// immediate per-row save whose payload carries declarationNumber; the
// server's declarationSync fan-out reaches the toast; the explicit Copy
// affordance only appears for a persisted number with empty siblings and
// rides the one-call copy endpoint; Esc dismisses and reverts.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentCusWorkspaceDetail } from '@tingting/shared';
import { ToastProvider } from '../../../components/shared/Toast';
import { ContainerLedger } from './CusContainerLedger';

const { updateCusShipmentContainerLine, copyCusShipmentContainerDeclaration } = vi.hoisted(() => ({
  updateCusShipmentContainerLine: vi.fn(),
  copyCusShipmentContainerDeclaration: vi.fn(),
}));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/shipmentClient')>()),
  updateCusShipmentContainerLine,
  copyCusShipmentContainerDeclaration,
}));
vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/dispatchPlanningClient')>()),
  completeDispatchExternalTrip: vi.fn(),
}));

const fieldAccess = (mode: 'DIRECT' | 'READ_ONLY' = 'DIRECT') => ({
  declarationNumber: { mode, reason: mode === 'READ_ONLY' ? 'Lô đã khóa kế toán.' : null },
});

function buildDetail(overrides: {
  declarationNumber?: string | null;
  siblingDeclarations?: Array<string | null>;
  declarationAccess?: 'DIRECT' | 'READ_ONLY';
} = {}): ShipmentCusWorkspaceDetail {
  const numbers = [
    overrides.declarationNumber ?? null,
    ...(overrides.siblingDeclarations ?? [null, null]),
  ];
  return {
    summary: {
      id: 1,
      version: 4,
      cargoMode: 'FCL',
      fieldAccess: fieldAccess(overrides.declarationAccess ?? 'DIRECT'),
    },
    containers: numbers.map((declarationNumber, index) => ({
      id: 10 + index,
      ordinal: index + 1,
      containerNumber: `MSKU123456${index}`,
      declarationNumber,
      dispatchStatus: 'AWAITING_VEHICLE',
      customerAppointmentAt: null,
      containerTypeId: 5,
      routeId: 7,
      liftSiteId: 3,
      dropoffSiteId: 4,
      plateNumber: null,
      shipmentVersion: 4,
      raw: { containerNumber: `MSKU123456${index}`, containerTypeId: 5, cargoWeightKg: '12500', cargoVolumeCbm: '26.25', routeId: 7 },
      permissions: {
        carrierEditable: true, plateEditable: true, containerTypeEditable: true,
        routeEditable: true, liftSiteEditable: true, dropoffSiteEditable: true,
        customerAppointmentEditable: true,
      },
    })),
    selectors: { externalCarriers: [], ports: [], containerTypes: [], routes: [], carrierVehicles: [] },
  } as unknown as ShipmentCusWorkspaceDetail;
}

function renderLedger(detail: ShipmentCusWorkspaceDetail, opts: { onDetailStale?: () => void } = {}) {
  const onLineSaved = vi.fn();
  render(
    <ToastProvider>
      <ContainerLedger
        detail={detail}
        onLineSaved={onLineSaved}
        getIdempotencyKey={() => 'test-key'}
        clearIdempotencyKey={() => {}}
        idPrefix="test"
        onDetailStale={opts.onDetailStale}
      />
    </ToastProvider>,
  );
  return { onLineSaved };
}

const declarationTriggers = () => screen.getAllByRole('button', { name: /Số tờ khai của container/ });

describe('ContainerLedger tờ khai inline cell (card 261022095235a)', () => {
  beforeEach(() => {
    updateCusShipmentContainerLine.mockReset();
    copyCusShipmentContainerDeclaration.mockReset();
  });

  it('renders the persisted number and an input placeholder for empty rows', () => {
    renderLedger(buildDetail({ declarationNumber: 'TK-2026-001' }));
    const triggers = declarationTriggers();
    expect(triggers).toHaveLength(3);
    expect(triggers[0].textContent).toBe('TK-2026-001');
    expect(triggers[1].textContent).toBe('Nhập tờ khai');
  });

  it('shows the Copy affordance only beside a persisted number while empty siblings remain', () => {
    renderLedger(buildDetail({ declarationNumber: 'TK-2026-001' }));
    const copyButtons = screen.getAllByRole('button', { name: /Copy số tờ khai TK-2026-001/ });
    expect(copyButtons).toHaveLength(1);
    // Empty rows never carry the fan-out action.
    expect(screen.queryAllByRole('button', { name: /Copy số tờ khai (?!TK-2026-001)/ })).toHaveLength(0);
  });

  it('hides the Copy affordance when every sibling already carries a number', () => {
    renderLedger(buildDetail({
      declarationNumber: 'TK-A',
      siblingDeclarations: ['TK-A', 'TK-B'],
    }));
    expect(screen.queryAllByRole('button', { name: /Copy số tờ khai/ })).toHaveLength(0);
  });

  it('commits an immediate per-row save carrying declarationNumber and reports the sync fan-out', async () => {
    const detail = buildDetail({ declarationNumber: null });
    const onDetailStale = vi.fn();
    const { onLineSaved } = renderLedger(detail, { onDetailStale });
    updateCusShipmentContainerLine.mockResolvedValue({
      line: { ...detail.containers[0], declarationNumber: 'TK-2026-777', shipmentVersion: 5 },
      declarationSync: { updatedContainerIds: [11, 12] },
    });

    fireEvent.click(declarationTriggers()[0]);
    const input = screen.getByLabelText(/Số tờ khai của container MSKU1234560/);
    fireEvent.change(input, { target: { value: 'TK-2026-777' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));
    const [shipmentId, containerId, patch] = updateCusShipmentContainerLine.mock.calls[0];
    expect(shipmentId).toBe(1);
    expect(containerId).toBe(10);
    expect(patch.expectedShipmentVersion).toBe(4);
    expect(patch.declarationNumber).toBe('TK-2026-777');
    // FB-109 + SIL-184 (CUS-05 clarify): the save IS the auto-sync — the
    // toast states the server's reported fan-out, never a client-side guess,
    // and no longer claims the siblings were "còn trống" (an edit-sync drags
    // in-sync copies along too).
    expect(await screen.findByText(/Đã lưu tờ khai — tự đồng bộ sang 2 cont khác của lô/)).toBeTruthy();
    await waitFor(() => expect(onLineSaved).toHaveBeenCalled());
    // Review 22/10 (TOKHAI-R2, drawer host): a fan-out commit rewrote the
    // SIBLING rows server-side; the drawer's onLineSaved patches only the
    // saved line into its cached detail, so the ledger must ALSO fire the
    // whole-detail reload channel or the siblings keep reading "Nhập tờ khai".
    expect(onDetailStale).toHaveBeenCalledTimes(1);
  });

  it('keeps the editor open through an in-flight blur and a failed commit (browser disable-blur guard)', async () => {
    renderLedger(buildDetail({ declarationNumber: null }));
    // Controllable promise: hold the commit in flight while we blur.
    let settleCommit;
    updateCusShipmentContainerLine.mockReturnValue(new Promise((resolve, reject) => { settleCommit = reject; }));

    fireEvent.click(declarationTriggers()[0]);
    const input = screen.getByLabelText(/Số tờ khai của container MSKU1234560/);
    fireEvent.change(input, { target: { value: 'TK-INFLIGHT' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // While the commit is in flight, focus moves off the input (real browsers
    // do this when controls disable) — the blur must NOT close the editor.
    const editorSpan = input.closest('.cus-declaration-editor') as HTMLElement;
    fireEvent.blur(editorSpan, { relatedTarget: null });
    expect(screen.getByLabelText(/Số tờ khai của container MSKU1234560/)).toBeTruthy();

    // The server rejects — the editor STAYS open with the typed draft so the
    // user can correct it (the cell's documented failure contract).
    settleCommit!(new Error('Số tờ khai đã thuộc lô hàng khác.'));
    expect(await screen.findByText(/Số tờ khai đã thuộc lô hàng khác/)).toBeTruthy();
    const stillOpen = screen.getByLabelText(/Số tờ khai của container MSKU1234560/) as HTMLInputElement;
    expect(stillOpen.value).toBe('TK-INFLIGHT');
  });

  it('keeps the editor open when the commit fails (server error surfaces via toast)', async () => {
    renderLedger(buildDetail({ declarationNumber: null }));
    updateCusShipmentContainerLine.mockRejectedValue(new Error('Số tờ khai đã thuộc lô hàng khác.'));

    fireEvent.click(declarationTriggers()[0]);
    const input = screen.getByLabelText(/Số tờ khai của container MSKU1234560/);
    fireEvent.change(input, { target: { value: 'TK-TAKEN' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText(/Số tờ khai đã thuộc lô hàng khác/)).toBeTruthy();
    // Editor stays open with the draft — the user can correct or Esc away.
    expect(screen.getByLabelText(/Số tờ khai của container MSKU1234560/)).toBeTruthy();
  });

  it('Esc dismisses and reverts the draft (no save, no leak on reopen)', () => {
    renderLedger(buildDetail({ declarationNumber: 'TK-KEEP' }));
    fireEvent.click(declarationTriggers()[0]);
    const input = screen.getByLabelText(/Số tờ khai của container MSKU1234560/);
    fireEvent.change(input, { target: { value: 'TK-DRAFT' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
    const trigger = declarationTriggers()[0];
    expect(trigger.textContent).toBe('TK-KEEP');
    // Reopen reseeds from the persisted value, not the abandoned draft.
    fireEvent.click(trigger);
    expect(screen.getByLabelText(/Số tờ khai của container MSKU1234560/)).toHaveValue('TK-KEEP');
  });

  it('rides the one-call copy endpoint and toasts the written count', async () => {
    const onDetailStale = vi.fn();
    renderLedger(buildDetail({ declarationNumber: 'TK-2026-001' }), { onDetailStale });
    copyCusShipmentContainerDeclaration.mockResolvedValue({ updatedContainerIds: [11, 12], shipmentVersion: 5 });

    fireEvent.click(screen.getByRole('button', { name: /Copy số tờ khai TK-2026-001/ }));

    await waitFor(() => expect(copyCusShipmentContainerDeclaration).toHaveBeenCalledTimes(1));
    const [shipmentId, containerId, body] = copyCusShipmentContainerDeclaration.mock.calls[0];
    expect(shipmentId).toBe(1);
    expect(containerId).toBe(10);
    expect(body.expectedShipmentVersion).toBe(4);
    expect(await screen.findByText(/Đã copy số tờ khai sang 2 cont còn trống/)).toBeTruthy();
    // Review 22/10: the copy rewrote SIBLINGS server-side — the whole-detail
    // reload channel fires so the drawer's cached sibling cells update.
    expect(onDetailStale).toHaveBeenCalledTimes(1);
  });

  it('renders read-only values when fieldAccess says READ_ONLY (accounting lock)', () => {
    renderLedger(buildDetail({ declarationNumber: 'TK-LOCKED', declarationAccess: 'READ_ONLY' }));
    // No trigger, no copy — plain values only.
    expect(screen.queryAllByRole('button', { name: /Số tờ khai của container/ })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /Copy số tờ khai/ })).toHaveLength(0);
    expect(screen.getByText('TK-LOCKED')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBe(2);
  });
});
