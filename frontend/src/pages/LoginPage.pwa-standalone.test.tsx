import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchPwaStandalone } from '../lib/pwa-standalone';
import LoginPage from './LoginPage';

const { login } = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ login, sessionExpired: false }) }));

// User report 2026-10-20: after installing the web app to the iPhone Home
// Screen the login page still showed the web © footer. The fix hides
// web-only chrome through the `pwa-standalone` class on <html> (hybrid JS
// detector, because iOS WebKit evaluates the CSS media query false) plus the
// `hide-in-pwa` utility. These tests pin the DOM half of that chain; the CSS
// half is pinned by styles/pwa-standalone.styles.test.ts.
describe('login web-chrome hide hooks for installed PWAs', () => {
  afterEach(() => {
    document.documentElement.classList.remove('pwa-standalone');
    delete (window.navigator as Navigator & { standalone?: boolean }).standalone;
    vi.restoreAllMocks();
  });

  it('marks the © footer and the marketing hero copy as hide-in-pwa', () => {
    render(<LoginPage />);
    const footer = document.querySelector('.login-footer');
    expect(footer).toHaveClass('hide-in-pwa');
    expect(footer?.textContent).toContain('Ting Ting Software Solution');
    expect(document.querySelector('.login-visual__content')).toHaveClass('hide-in-pwa');
  });

  it('gets the html class when iOS reports navigator.standalone despite a false media query', () => {
    Object.defineProperty(window.navigator, 'standalone', {
      value: true,
      configurable: true,
      writable: true,
    });
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(display-mode: standalone)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => true,
    } as unknown as MediaQueryList);

    // What <App/>'s PwaStandaloneMarker effect runs on every launch.
    const stop = watchPwaStandalone();
    render(<LoginPage />);

    expect(document.documentElement).toHaveClass('pwa-standalone');
    // The footer stays in the DOM but carries the hook the standalone CSS
    // rule targets — jsdom cannot compute the cascade, so "hidden" is
    // asserted at the stylesheet-contract level.
    expect(document.querySelector('.login-footer')).toHaveClass('hide-in-pwa');
    stop();
  });

  it('gets the html class from the display-mode media query alone (Android/desktop install)', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(display-mode: standalone)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => true,
    } as unknown as MediaQueryList);

    const stop = watchPwaStandalone();
    render(<LoginPage />);
    expect(document.documentElement).toHaveClass('pwa-standalone');
    stop();
  });

  it('leaves the class off for a plain browser visit', () => {
    const stop = watchPwaStandalone();
    render(<LoginPage />);
    expect(document.documentElement).not.toHaveClass('pwa-standalone');
    stop();
  });
});
