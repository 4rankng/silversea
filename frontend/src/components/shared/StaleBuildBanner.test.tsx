import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaleBuildBanner } from './StaleBuildBanner';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', () => ({ api: { get } }));

function flush() {
  return act(async () => {});
}

async function tick(ms = 60_000) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
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
    render(<StaleBuildBanner />);
    await flush();
    for (let i = 0; i < 3; i++) await tick();
    expect(screen.queryByRole('status')).toBeNull();
    expect(get).toHaveBeenCalledTimes(4); // boot check + 3 polls
    expect(get).toHaveBeenCalledWith('/health');
  });

  it('banners when the server build changes under the open tab (T1)', async () => {
    get.mockResolvedValueOnce({ buildHash: 'boot-hash' }).mockResolvedValue({ buildHash: 'cut-hash' });
    render(<StaleBuildBanner />);
    await flush();
    expect(screen.queryByRole('status')).toBeNull();
    await tick();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Phiên bản mới — tải lại?')).toBeTruthy();
  });

  it('reloads exactly once on click and never on its own (T1+T3)', async () => {
    get.mockResolvedValueOnce({ buildHash: 'boot-hash' }).mockResolvedValue({ buildHash: 'cut-hash' });
    render(<StaleBuildBanner />);
    await flush();
    await tick();
    await tick();
    await tick();
    expect(reload).not.toHaveBeenCalled(); // 3 mismatched polls — still no auto-reload
    expect(get).toHaveBeenCalledTimes(2); // polling stops once stale; banner waits for the click
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a failed poll never fabricates a mismatch; baseline waits for first success', async () => {
    get.mockRejectedValueOnce(new Error('blip')).mockResolvedValue({ buildHash: 'late-hash' });
    render(<StaleBuildBanner />);
    await flush();
    expect(screen.queryByRole('status')).toBeNull();
    await tick();
    await tick();
    expect(screen.queryByRole('status')).toBeNull();
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('polling pauses hidden and checks immediately on regain', async () => {
    get.mockResolvedValue({ buildHash: 'steady-hash' });
    render(<StaleBuildBanner />);
    await flush();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    await tick();
    await tick();
    expect(get).toHaveBeenCalledTimes(1); // hidden: interval idle
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    await flush();
    expect(get).toHaveBeenCalledTimes(2); // immediate check on regain
    await tick();
    expect(get).toHaveBeenCalledTimes(3); // interval resumed
  });
});


