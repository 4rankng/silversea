import { describe, it, expect } from 'vitest';
import { registerOverlay, unregisterOverlay, isOverlayOpen } from './overlayState';

describe('overlayState', () => {
  it('register/unregister toggles isOverlayOpen', () => {
    const before = isOverlayOpen();
    registerOverlay();
    expect(isOverlayOpen()).toBe(true);
    unregisterOverlay();
    expect(isOverlayOpen()).toBe(before);
  });

  it('count never goes negative (clamped at 0)', () => {
    unregisterOverlay();
    unregisterOverlay();
    unregisterOverlay();
    registerOverlay();
    expect(isOverlayOpen()).toBe(true);
    unregisterOverlay();
    expect(isOverlayOpen()).toBe(false);
  });

  it('DOM fallback detects role="dialog" even with no registry count', () => {
    expect(isOverlayOpen()).toBe(false);
    const el = document.createElement('div');
    el.setAttribute('role', 'dialog');
    document.body.appendChild(el);
    expect(isOverlayOpen()).toBe(true);
    el.remove();
    expect(isOverlayOpen()).toBe(false);
  });

  it('DOM fallback detects role="alertdialog" (case-insensitive)', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'ALERTDIALOG');
    document.body.appendChild(el);
    expect(isOverlayOpen()).toBe(true);
    el.remove();
  });
});
