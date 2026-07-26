/**
 * Wave 4 M8.1 — useOnline hook + OfflineBanner tests.
 *
 * The hook listens to navigator.onLine + window online/offline events.
 * The banner renders a Vietnamese message when offline, nothing when online.
 */
import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useOnline } from './useOnline';
import { OfflineBanner } from '../components/shared/OfflineBanner';

function OnlineProbe() {
  const online = useOnline();
  return <div data-testid="probe">{online ? 'online' : 'offline'}</div>;
}

describe('useOnline — M8.1 network-status hook', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  });

  it('reports online when navigator.onLine is true', () => {
    render(<OnlineProbe />);
    expect(screen.getByTestId('probe').textContent).toBe('online');
  });

  it('reports offline when navigator.onLine is false', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    render(<OnlineProbe />);
    expect(screen.getByTestId('probe').textContent).toBe('offline');
  });

  it('reacts to window offline/online events', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    render(<OnlineProbe />);
    expect(screen.getByTestId('probe').textContent).toBe('online');

    // Simulate going offline.
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(screen.getByTestId('probe').textContent).toBe('offline');

    // Simulate coming back online.
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(screen.getByTestId('probe').textContent).toBe('online');
  });
});

describe('OfflineBanner — M8.1 global offline indicator', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  });

  it('renders nothing when online', () => {
    const { container } = render(<OfflineBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the Vietnamese offline message when offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    render(<OfflineBanner />);
    const banner = screen.getByTestId('offline-banner');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.textContent).toMatch(/Mất kết nối/);
    expect(banner.textContent).toMatch(/đồng bộ khi có mạng/);
  });
});
