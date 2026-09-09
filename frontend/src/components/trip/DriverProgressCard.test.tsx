/**
 * Wave 4 M8.4 slice 2 — DriverProgressCard tests.
 *
 * Mocks the driverClient + the offlineQueue singleton at the module
 * boundary so the test exercises the component's own orchestration:
 * enqueue → drain → success refresh / offline retry hint.
 *
 * Coverage (PRD M08-04-03):
 *   - renders the form (eventType select + occurredAt + note + submit);
 *   - loads the existing timeline via listProgress;
 *   - submit enqueues an op with a UUID v4 idempotency key, drains, and on
 *     success shows "Đã lưu tiến độ" + refreshes the timeline;
 *   - offline (drain returns failed) shows a retry hint + the pending op.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DriverProgressEventType } from '@tingting/shared';

const { listProgressMock, recordProgressMock, enqueueMock, drainMock } = vi.hoisted(() => ({
  listProgressMock: vi.fn(),
  recordProgressMock: vi.fn(),
  enqueueMock: vi.fn(),
  drainMock: vi.fn(),
}));

vi.mock('../../api/driverClient', () => ({
  driverClient: {
    listProgress: listProgressMock,
    recordProgress: recordProgressMock,
  },
}));

// Mock the offline-queue singleton. enqueue returns a synthetic op; drain
// returns whatever the test configures (done/failed/conflicts).
vi.mock('../../lib/offline-queue', () => ({
  offlineQueue: {
    enqueue: enqueueMock,
    drain: drainMock,
    listQueued: vi.fn().mockResolvedValue([]),
  },
  uuidv4: () => 'test-uuid-v4-key',
}));

import { DriverProgressCard } from './DriverProgressCard';

const EVENT = (overrides: Partial<{ id: number; eventType: string; occurredAt: string; note: string | null }> = {}) => ({
  id: 1, eventType: 'DEPARTED', occurredAt: '2026-07-26T08:00:00Z', note: null, createdAt: '2026-07-26T08:00:00Z',
  ...overrides,
});

const QUEUED_OP = (overrides: Partial<{ id: string; status: string; body: unknown; lastError: string | null }> = {}) => ({
  id: 'test-uuid-v4-key',
  endpoint: 'driver.progress',
  method: 'POST' as const,
  path: '/driver/me/trips/42/progress',
  body: { eventType: 'DEPARTED', occurredAt: '2026-07-26T01:00:00.000Z' },
  status: 'QUEUED',
  retryCount: 0,
  lastError: null,
  createdAt: '2026-07-26T01:00:00Z',
  updatedAt: '2026-07-26T01:00:00Z',
  ...overrides,
});

function renderCard(tripId = 42) {
  return render(<DriverProgressCard tripId={tripId} />);
}

describe('DriverProgressCard — M8.4 progress form + offline wiring', () => {
  beforeEach(() => {
    listProgressMock.mockReset();
    recordProgressMock.mockReset();
    enqueueMock.mockReset();
    drainMock.mockReset();
    listProgressMock.mockResolvedValue({ items: [] });
    enqueueMock.mockResolvedValue(QUEUED_OP());
  });

  it('renders the form (eventType select + occurredAt + note + submit)', async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText('Loại sự kiện')).toBeTruthy());
    expect(screen.getByText('Thời điểm xảy ra')).toBeTruthy();
    // "Ghi chú" appears in both the label and possibly the timeline; scope
    // to the form's label by querying the input's associated label.
    expect(screen.getByPlaceholderText(/đổ 80 lít/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ghi tiến độ/ })).toBeTruthy();
  });

  it('loads the existing timeline via listProgress', async () => {
    listProgressMock.mockResolvedValue({ items: [EVENT({ id: 1, eventType: 'DEPARTED', note: 'đúng giờ' })] });
    renderCard();
    await waitFor(() => expect(screen.getByText('đúng giờ')).toBeTruthy());
    expect(listProgressMock).toHaveBeenCalledWith(42);
  });

  it('accepts a time-first 24h entry and submits its ISO conversion (hard 24h contract)', async () => {
    // 2026-09-09 hard requirement: combined date+time entry is `HH:mm DD/MM/YYYY`
    // — never a locale-formatted datetime-local (12h AM/PM on en-US browsers).
    listProgressMock.mockResolvedValue({ items: [] });
    enqueueMock.mockResolvedValue(QUEUED_OP());
    drainMock.mockResolvedValue({ done: 0, failed: 0, conflicts: 0 });

    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: /Ghi tiến độ/ })).toBeTruthy());

    const field = screen.getByPlaceholderText('HH:mm DD/MM/YYYY');
    fireEvent.change(field, { target: { value: '14:30 20/08/2026' } });
    expect((field as HTMLInputElement).defaultValue).toBe('14:30 20/08/2026');

    fireEvent.click(screen.getByRole('button', { name: /Ghi tiến độ/ }));
    await waitFor(() => expect(enqueueMock).toHaveBeenCalledTimes(1));
    // Same conversion the card applies (browser-local wall clock → ISO), so
    // the assertion holds in any test-runner timezone.
    expect(enqueueMock.mock.calls[0][0].body.occurredAt)
      .toBe(new Date('2026-08-20T14:30').toISOString());
  });

  it('submit enqueues an op with a UUID idempotency key, drains, and on success shows "Đã lưu tiến độ"', async () => {
    // After the successful drain, listProgress returns the new event.
    listProgressMock.mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [EVENT({ id: 10, eventType: 'DEPARTED' })] });
    drainMock.mockResolvedValue({ done: 1, failed: 0, conflicts: 0 });

    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: /Ghi tiến độ/ })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Ghi tiến độ/ }));

    await waitFor(() => expect(enqueueMock).toHaveBeenCalledTimes(1));
    const enqueued = enqueueMock.mock.calls[0][0];
    expect(enqueued.endpoint).toBe('driver.progress');
    expect(enqueued.method).toBe('POST');
    expect(enqueued.body).toMatchObject({ eventType: DriverProgressEventType.DEPARTED });

    await waitFor(() => expect(drainMock).toHaveBeenCalledTimes(1));
    // The drain callback (send) calls recordProgress with the idempotency key.
    const sendFn = drainMock.mock.calls[0][0];
    await sendFn(QUEUED_OP());
    expect(recordProgressMock).toHaveBeenCalledTimes(1);
    expect(recordProgressMock.mock.calls[0][2]).toBe('test-uuid-v4-key');

    expect(screen.getByText(/Đã lưu tiến độ/)).toBeTruthy();
  });

  it('offline (drain returns failed) shows a retry hint + the pending op', async () => {
    listProgressMock.mockResolvedValue({ items: [] });
    const failedOp = QUEUED_OP({ status: 'FAILED', lastError: 'mất mạng' });
    enqueueMock.mockResolvedValue(failedOp);
    drainMock.mockResolvedValue({ done: 0, failed: 1, conflicts: 0 });

    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: /Ghi tiến độ/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Ghi tiến độ/ }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/mất mạng|sẽ thử lại|Không thể gửi/)).toBeTruthy();
  });

  it('shows the empty state when no events exist', async () => {
    listProgressMock.mockResolvedValue({ items: [] });
    renderCard();
    await waitFor(() => expect(screen.getByText(/Chưa có sự kiện tiến độ/)).toBeTruthy());
  });
});
