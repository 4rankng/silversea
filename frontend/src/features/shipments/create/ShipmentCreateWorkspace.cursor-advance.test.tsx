import { act, fireEvent, render, screen } from '@testing-library/react';
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

/**
 * SIL-65 (CUS-01) — cursor jump giờ → phút on the CUS create surface
 * (/shipments/new · FCL container row's "Ngày giờ đóng trả").
 *
 * The engine lives in DateTimeSegments (auto-advance on a complete in-range
 * segment); this pins the behavior at the WORKSPACE surface the ticket names:
 * gõ '08' ở ô giờ THEN focus tự sang ô phút, không rơi phím số, và không kẹt —
 * phút complete hands off to the date day segment (the entry keeps flowing).
 */
describe('SIL-65 (CUS-01): create-flow appointment segments auto-advance', { timeout: 30000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [],
    });
  });

  it("typing '08' into Giờ jumps the cursor to Phút; the minute digit is not dropped", async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    const hh = row1Segment('Giờ — Ngày giờ đóng trả');
    act(() => hh.focus());

    // First digit: incomplete hour — the cursor stays on Giờ.
    fireEvent.change(hh, { target: { value: '0' } });
    expect(document.activeElement).toBe(hh);

    // Second digit completes '08' in range → the cursor jumps to Phút by
    // itself (the ticket's exact acceptance).
    fireEvent.change(hh, { target: { value: '08' } });
    const mm = row1Segment('Phút — Ngày giờ đóng trả');
    expect(document.activeElement).toBe(mm);

    // Typing the minute must not drop or overwrite the hour — no lost digit.
    fireEvent.change(mm, { target: { value: '30' } });
    expect(hh).toHaveValue('08');
    expect(mm).toHaveValue('30');
  });

  it('a completed năm hands the cursor to the giờ segment — entry never gets stuck (SIL-608 date-first)', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    // SIL-608: NGÀY leads the row's datetime field, GIỜ closes it. The old
    // minute→day hand-off died with the time-first order; the no-stuck law
    // now crosses at the end of the date: year complete → giờ.
    const dd = row1Segment('Ngày — Ngày giờ đóng trả');
    act(() => dd.focus());
    fireEvent.change(dd, { target: { value: '14' } });
    const mm2 = row1Segment('Tháng — Ngày giờ đóng trả');
    expect(document.activeElement).toBe(mm2);

    fireEvent.change(mm2, { target: { value: '11' } });
    const yyyy = row1Segment('Năm — Ngày giờ đóng trả');
    expect(document.activeElement).toBe(yyyy);

    fireEvent.change(yyyy, { target: { value: '2026' } });
    // The date half is complete → focus flows into the giờ segment
    // (same hand-off law, reversed direction per SIL-608).
    const hh = row1Segment('Giờ — Ngày giờ đóng trả');
    expect(document.activeElement).toBe(hh);
    // The typed draft is retained visibly across the hand-off.
    expect(dd).toHaveValue('14');
    expect(mm2).toHaveValue('11');
    expect(yyyy).toHaveValue('2026');
  });
});
