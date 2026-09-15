import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOnline } from './useOnline';
import { assertConnectionForMutation } from '../lib/connection';

function Probe() { return <span data-testid="connection">{useOnline() ? 'online' : 'blocked'}</span>; }
beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('internet-required reachability', () => {
  it('does not trust navigator.onLine before a successful service probe', async () => {
    let resolve!: (response: Response) => void;
    const request = new Promise<Response>((r) => { resolve = r; });
    vi.stubGlobal('fetch', vi.fn(() => request));
    render(<Probe />);
    expect(screen.getByTestId('connection')).toHaveTextContent('blocked');
    expect(() => assertConnectionForMutation()).toThrow(/Chưa gửi/);
    await act(async () => { resolve(new Response(null, { status: 200 })); });
    expect(screen.getByTestId('connection')).toHaveTextContent('online');
    expect(() => assertConnectionForMutation()).not.toThrow();
  });

  it('blocks on service failure, shares one probe, and only resumes after real recovery', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    render(<><Probe /><Probe /></>);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(() => assertConnectionForMutation()).toThrow();
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(screen.getAllByTestId('connection').every((n) => n.textContent === 'online')).toBe(true));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every((call) => call[1].method === 'HEAD')).toBe(true);
  });

  it('ignores a late successful probe after an offline event', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolve = r; })));
    render(<Probe />);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    await act(async () => resolve(new Response(null, { status: 200 })));
    expect(screen.getByTestId('connection')).toHaveTextContent('blocked');
    expect(() => assertConnectionForMutation()).toThrow();
  });
});
