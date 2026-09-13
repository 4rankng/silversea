import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

const STALE_CHUNK_ERR = new TypeError(
  'Failed to fetch dynamically imported module: http://vantai.tingting.vip/assets/DriverTripDetailPage-BspMDth9.js',
);
const RELOAD_AT_KEY = 'tt-chunk-reload-at';

// One throw, then clean — so the "Thử lại" path can remount the child.
let shouldThrow = false;

function FlakyChild({ error }: { error: Error }) {
  if (shouldThrow) throw error;
  return <p>content restored</p>;
}

describe('ErrorBoundary stale-chunk self-heal', () => {
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    shouldThrow = false;
    sessionStorage.clear();
    reload = stubReload();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  function stubReload(): ReturnType<typeof vi.fn> {
    const reload = vi.fn();
    // jsdom marks location.reload as an own non-configurable property, so the
    // whole location object has to be swapped out to observe reload calls.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/', reload },
    });
    return reload;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('catches a stale-chunk crash and renders the reload panel instead of the dead-end error', async () => {
    shouldThrow = true;
    render(
      <ErrorBoundary>
        <FlakyChild error={STALE_CHUNK_ERR} />
      </ErrorBoundary>,
    );

    const panel = await screen.findByText(/đang tải lại trang/i);
    expect(panel).toBeTruthy();
    expect(screen.queryByText('Đã xảy ra lỗi')).toBeNull();

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(Number(sessionStorage.getItem(RELOAD_AT_KEY))).toBeGreaterThan(0);
  });

  it('still shows the manual error screen when the self-heal cooldown is spent', () => {
    shouldThrow = true;
    sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
    render(
      <ErrorBoundary>
        <FlakyChild error={STALE_CHUNK_ERR} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Đã xảy ra lỗi')).toBeTruthy();
    expect(screen.getByRole('button', { name: /thử lại/i })).toBeTruthy();
    expect(screen.queryByText(/đang tải lại trang/i)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps the manual retry screen and honors the fallback prop for non-chunk errors', () => {
    shouldThrow = true;
    render(
      <ErrorBoundary fallback={<p>custom fallback</p>}>
        <FlakyChild error={new Error('boom')} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('custom fallback')).toBeTruthy();
    expect(screen.queryByText(/đang tải lại trang/i)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('restores the child after a non-chunk error via the manual retry button', () => {
    shouldThrow = true;
    render(
      <ErrorBoundary>
        <FlakyChild error={new Error('boom')} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Đã xảy ra lỗi')).toBeTruthy();
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /thử lại/i }));

    expect(screen.getByText('content restored')).toBeTruthy();
    expect(screen.queryByText('Đã xảy ra lỗi')).toBeNull();
  });
});
