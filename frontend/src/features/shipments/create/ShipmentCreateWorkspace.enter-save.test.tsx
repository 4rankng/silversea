import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap } = vi.hoisted(() => ({ getBootstrap: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));

import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/shipments/new']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentCreateWorkspace />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** First container row's "Ngày giờ đóng trả" segment by aria label suffix. */
function row1Segment(label: string): HTMLInputElement {
  const all = screen.getAllByLabelText(
    (content, element) => content === label && Boolean(element?.closest('[data-seg-part]')),
  );
  expect(all.length).toBeGreaterThanOrEqual(1);
  return all[0] as HTMLInputElement;
}

/** The whole first-row split field must still show the typed draft — the
 * FB-002 lần 3 contract: Enter saves through the form and never wipes the
 * typed input (card 211026034109). */
function row1FieldText(): string {
  const group = row1Segment('Giờ — Ngày giờ đóng trả').closest('[data-split-datetime]');
  return Array.from(group?.querySelectorAll<HTMLInputElement>('input[data-seg]') ?? [])
    .map((input) => input.value)
    .join('|');
}

describe('shipment create Enter law (FB-002 lần 3, card 211026034109)', () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [],
    });
  });

  it('a COMPLETE typed "Ngày giờ đóng trả" + Enter rides the form save: issues paint and the typed input is KEPT (no wipe, no silent dead key)', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    // Type a complete datetime into the first container row, segment by
    // segment, exactly like the staging flow (QA tiepvv, N2 probe).
    fireEvent.change(row1Segment('Giờ — Ngày giờ đóng trả'), { target: { value: '16' } });
    fireEvent.change(row1Segment('Phút — Ngày giờ đóng trả'), { target: { value: '30' } });
    fireEvent.change(row1Segment('Ngày — Ngày giờ đóng trả'), { target: { value: '22' } });
    fireEvent.change(row1Segment('Tháng — Ngày giờ đóng trả'), { target: { value: '11' } });
    const year = row1Segment('Năm — Ngày giờ đóng trả');
    fireEvent.change(year, { target: { value: '2026' } });
    expect(row1FieldText()).toBe('16|30|22|11|2026');

    // Enter on the last (year) segment: the field lets a COMPLETE draft's
    // Enter bubble to the form, which must answer it through the same save
    // the "Tạo lô hàng" topline button rides. Before the fix this key was a
    // SILENT dead key (implicit submission never fires: no submit button
    // lives inside the form).
    fireEvent.keyDown(year, { key: 'Enter', code: 'Enter' });

    // The save ran: the app-owned summary paints the missing identity
    // fields (the form is still missing Khách hàng etc.).
    const alert = await screen.findByText(/^Cần bổ sung \d+ thông tin$/);
    expect(alert).toBeTruthy();

    // …and nothing the operator typed was wiped — the datetime draft and the
    // field stay exactly as typed (the "mất trắng input" regression).
    await waitFor(() => {
      const wrap = document.querySelector('[data-field-id="shipment-customer"]');
      expect(wrap?.contains(document.activeElement)).toBe(true);
    }, { timeout: 2000 });
    expect(row1FieldText()).toBe('16|30|22|11|2026');
  }, 20000);

  it('an INCOMPLETE giờ draft keeps its own swallow: Enter runs NO save, the field says why, and the typed giờ survives', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fireEvent.change(row1Segment('Giờ — Ngày giờ đóng trả'), { target: { value: '16' } });
    fireEvent.change(row1Segment('Phút — Ngày giờ đóng trả'), { target: { value: '30' } });
    const minute = row1Segment('Phút — Ngày giờ đóng trả');
    fireEvent.keyDown(minute, { key: 'Enter', code: 'Enter' });

    // The segmented field owns this Enter (incomplete draft must never
    // submit) — the form law must not steal it: no validation summary.
    expect(screen.queryByText(/^Cần bổ sung \d+ thông tin$/)).toBeNull();
    expect(await screen.findByText('Nhập đủ giờ và ngày hợp lệ.')).toBeTruthy();
    expect(row1FieldText()).toBe('16|30|||');
  }, 20000);

  it('Shift+Enter never saves and bare Enter in the notes textarea stays a newline key (Ctrl+Enter saves)', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    const notes = screen.getByLabelText('Ghi chú cho khách hàng');
    fireEvent.change(notes, { target: { value: 'ghi chu FB-002' } });

    fireEvent.keyDown(notes, { key: 'Enter', shiftKey: true });
    expect(screen.queryByText(/^Cần bổ sung \d+ thông tin$/)).toBeNull();

    fireEvent.keyDown(notes, { key: 'Enter' });
    expect(screen.queryByText(/^Cần bổ sung \d+ thông tin$/)).toBeNull();

    fireEvent.keyDown(notes, { key: 'Enter', ctrlKey: true });
    expect(await screen.findByText(/^Cần bổ sung \d+ thông tin$/)).toBeTruthy();
  }, 20000);
});
