import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaleBuildBanner } from './StaleBuildBanner';

// Card QA1-004: the watcher rides the shared qk.support.serverBuild query
// entry (react-query) instead of its own timer, so the banner tests drive the
// query's interval + focus semantics. The five laws are unchanged; only the
// call-cadence assertions adapt to the query client's dedup.

const get = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', () => ({ api: { get } }));

function renderBanner() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StaleBuildBanner />
    </QueryClientProvider>,
  );
}

function flush() {
  return act(async () => {});
}

async function tick(ms = 60_000) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  // react-query batches observer updates through a 0ms notify timer; one
  // extra flush lets the refetched data reach the banner's effect under
  // fake timers (real time this is same-instant).
  await act(async () => {
    vi.advanceTimersByTime(0);
  });
}

describe('stale build banner', () => {
  let reload: ReturnType<typeof vi.fn>;
  const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

  beforeEach(() => {
    get.mockReset();
    vi.useFakeTimers();
    reload = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { href: 'http://localhost/', reload } });
  });

  afterEach(async () => {
    await flush();
    vi.useRealTimers();
    if (visibilityDescriptor) {
      Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
    }
  });

  it('shows nothing while the server build matches the boot baseline (T2)', async () => {
    get.mockResolvedValue({ buildHash: 'boot-hash' });
    renderBanner();
    await flush();
    for (let i = 0; i < 3; i++) await tick();
    expect(screen.queryByRole('status')).toBeNull();
    expect(get).toHaveBeenCalledWith('/health');
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(2); // boot + interval polls
  });

  it('banners when the server build changes under the open tab (T1)', async () => {
    get.mockResolvedValueOnce({ buildHash: 'boot-hash' }).mockResolvedValue({ buildHash: 'cut-hash' });
    renderBanner();
    await flush();
    expect(screen.queryByRole('status')).toBeNull();
    await tick();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Phiên bản mới — tải lại?')).toBeTruthy();
  });

  it('reloads exactly once on click and never on its own (T1+T3)', async () => {
    get.mockResolvedValueOnce({ buildHash: 'boot-hash' }).mockResolvedValue({ buildHash: 'cut-hash' });
    renderBanner();
    await flush();
    await tick();
    await tick();
    expect(reload).not.toHaveBeenCalled(); // mismatched polls — still no auto-reload
    expect(get.mock.calls.length).toBeLessThanOrEqual(2); // stale is terminal: polling stops
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a failed poll never fabricates a mismatch; baseline waits for first success', async () => {
    get.mockRejectedValueOnce(new Error('blip')).mockResolvedValue({ buildHash: 'late-hash' });
    renderBanner();
    await flush();
    expect(screen.queryByRole('status')).toBeNull();
    await tick();
    await tick();
    expect(screen.queryByRole('status')).toBeNull();
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('does not refetch on regain while the entry is still fresh', async () => {
    get.mockResolvedValue({ buildHash: 'steady-hash' });
    renderBanner();
    await flush();
    const callsAtBoot = get.mock.calls.length;
    // Within the poll window a focus event reads the fresh cache entry — no
    // extra /health. (refetchIntervalInBackground keeps hidden tabs idle.)
    fireEvent(window, new Event('focus'));
    await flush();
    expect(get.mock.calls.length).toBe(callsAtBoot);
    await tick();
    expect(get.mock.calls.length).toBeGreaterThan(callsAtBoot); // interval resumed
  });
});
