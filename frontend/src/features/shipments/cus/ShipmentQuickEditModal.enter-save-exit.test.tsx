import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import type { ShipmentCusWorkspaceListItem } from '@tingting/shared';
import { afterAll, beforeAll, describe, expect, it, vi, beforeEach } from 'vitest';

const updateShipment = vi.fn();

vi.mock('../../../api/shipmentClient', () => ({
  updateShipment: (...args: unknown[]) => updateShipment(...args),
  createShipmentDeclaration: vi.fn(),
  deleteShipmentDeclaration: vi.fn(),
  updateShipmentDeclaration: vi.fn(),
}));

import { useCusQuickEdit } from './use-cus-quick-edit';
import { ShipmentQuickEditModal } from './ShipmentQuickEditModal';
import { ReducedMotionProvider } from '../../../hooks/usePrefersReducedMotion';

// The house Modal's exit ride is an animejs overlay animation that never
// settles in jsdom; with reduced motion the exit is synchronous, so this
// file stubs the media query and mounts the shared provider to assert the
// modal REALLY unmounts after the Enter-save (the ticket's "thoát").
beforeAll(() => {
  vi.stubGlobal('matchMedia', ((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent() { return true; },
  })) as unknown as typeof window.matchMedia);
});
afterAll(() => { vi.unstubAllGlobals(); });

/** Narrow LCL row WITHOUT a schedule (SIL-66 / CUS-02's "lô chưa có lịch"):
 * closingAt/plannedReturnAt/transportDate all empty, every access key
 * writable. Cast keeps the fixture honest about only what the hook reads. */
function schedulelessItem(): ShipmentCusWorkspaceListItem {
  const access = { mode: 'EDITABLE', reason: '' };
  return {
    id: 7,
    version: 3,
    cargoMode: 'LCL',
    direction: 'EXPORT',
    transportDate: null,
    closingAt: null,
    plannedReturnAt: null,
    customerNotes: '',
    operationalNotes: '',
    operational: {
      totalContainers: 0,
      plateAssignedContainers: 0,
      vehicleReadiness: 'NO_CONTAINERS',
    },
    raw: {},
    fieldAccess: {
      closingAt: access,
      plannedReturnAt: access,
    },
  } as unknown as ShipmentCusWorkspaceListItem;
}

/** Host wiring exactly as the Tổng quan page mounts it: state lives in the
 * hook, the modal only presents — so this test pins the FULL Enter → POST →
 * exit path, not just the keydown handler. */
function Harness({ item }: { item: ShipmentCusWorkspaceListItem }) {
  const [notice, setNotice] = useState<string | null>(null);
  const deps = {
    setError: vi.fn(),
    setNotice,
    loadList: vi.fn(async () => {}),
    invalidateDetail: vi.fn(),
  };
  const edit = useCusQuickEdit(deps);
  // Mount-once: open the schedule editor for the seeded row exactly as the
  // page's cell trigger would (the ticket's "vào sửa ngày giờ" step).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { edit.startQuickEdit(item, 'schedule'); }, []);
  return (
    <>
      {notice && <p data-testid="notice">{notice}</p>}
      <ShipmentQuickEditModal
        open={Boolean(edit.quickEditDraft)}
        draft={edit.quickEditDraft}
        item={item}
        saving={edit.savingQuickEdit}
        error={edit.quickEditError}
        onDraftChange={edit.setQuickEditDraft}
        close={edit.closeQuickEdit}
        save={() => void edit.saveQuickEdit(item)}
      />
    </>
  );
}

describe('SIL-66 (CUS-02): Enter in the schedule quick-edit saves AND exits', () => {
  beforeEach(() => {
    updateShipment.mockReset();
    updateShipment.mockResolvedValue({});
  });

  it('a schedule-less LCL lot: type giờ + ngày, Enter on the date → one PATCH, modal closes back to the list', async () => {
    const item = schedulelessItem();
    render(<ReducedMotionProvider><Harness item={item} /></ReducedMotionProvider>);

    // The schedule editor mounts for the schedule-less lot.
    const timeInput = await screen.findByLabelText('Giờ');
    expect(timeInput).toBeTruthy();
    const modalForm = document.querySelector('.cus-quick-edit-modal') as HTMLFormElement;
    expect(modalForm).toBeTruthy();

    // Type a complete giờ (single-box TimeInput) — hand-typed, picker closed.
    fireEvent.change(timeInput, { target: { value: '08:30' } });
    expect((timeInput as HTMLInputElement).value).toBe('08:30');

    // Type the date segment by segment (dd/mm/yyyy of "Ngày đóng/trả").
    const seg = (key: string) => modalForm.querySelector<HTMLInputElement>(`[data-seg="${key}"]`)!;
    fireEvent.change(seg('dd'), { target: { value: '25' } });
    fireEvent.change(seg('mm2'), { target: { value: '12' } });
    fireEvent.change(seg('yyyy'), { target: { value: '2026' } });

    // Enter on the LAST date segment: the field's own law lets a complete
    // valid draft's Enter flow to the host form (root-cause fix: the two
    // submit buttons sit in the modal footer OUTSIDE the <form>, so the form
    // answers Enter itself through requestSubmit — same submit path the
    // "Lưu thay đổi" footer button rides).
    fireEvent.keyDown(seg('yyyy'), { key: 'Enter' });

    // One PATCH with the composed schedule (EXPORT → closingAt), then the
    // draft clears — the modal EXITS instead of standing open over the list.
    await waitFor(() => expect(updateShipment).toHaveBeenCalledTimes(1));
    expect(updateShipment).toHaveBeenCalledWith(7, {
      expectedVersion: 3,
      expectedDeliveryDate: '2026-12-25',
      closingAt: '2026-12-25T08:30:00+07:00',
    });
    await waitFor(() => expect(screen.queryByLabelText('Giờ')).toBeNull());
    // The animated modal shell exits on its own frame — the footer's submit
    // button (the one that used to sit outside the <form>) disappears with
    // it: the user is back on the list, not standing in the popup.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Lưu thay đổi' })).toBeNull(), { timeout: 3000 });
    await waitFor(() => expect(screen.getByTestId('notice').textContent).toBe('Đã cập nhật lịch đóng/trả.'));
  });

  it('Enter on an INCOMPLETE draft never fires the PATCH (a stale timestamp must not save)', async () => {
    const item = schedulelessItem();
    render(<ReducedMotionProvider><Harness item={item} /></ReducedMotionProvider>);

    const timeInput = await screen.findByLabelText('Giờ');
    fireEvent.change(timeInput, { target: { value: '08:30' } });
    // No date typed — the draft is incomplete.

    fireEvent.keyDown(timeInput, { key: 'Enter' });
    fireEvent.keyDown(timeInput, { key: 'Enter' });

    // The hook's own guard refuses the incomplete schedule…
    expect(await screen.findByText('Chọn ngày đóng/trả trước khi nhập giờ.')).toBeTruthy();
    // …and no PATCH ever fired.
    expect(updateShipment).not.toHaveBeenCalled();
  });
});
