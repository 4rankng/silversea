import { useEffect, useRef } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTableArrowScroll } from './useTableArrowScroll';

/**
 * SIL-531 — the app-shell arrow-key contract: ←/→ scroll the tables of the
 * app horizontally, and yield wherever a key already has an owner (fields,
 * open overlays, modifier chords, scrollers that hold no table).
 */

function makeScroller(withTable: boolean): { host: HTMLDivElement; scrollBy: ReturnType<typeof vi.fn> } {
  const host = document.createElement('div');
  const scrollBy = vi.fn();
  Object.defineProperty(host, 'scrollWidth', { configurable: true, value: 2400 });
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 600 });
  host.getBoundingClientRect = () => new DOMRect(0, 0, 600, 400);
  (host as unknown as { scrollBy: unknown }).scrollBy = scrollBy;
  if (withTable) host.innerHTML = '<table><tbody><tr><td>SGH</td></tr></tbody></table>';
  document.body.appendChild(host);
  return { host, scrollBy };
}

function Harness(): null {
  useTableArrowScroll();
  return null;
}

// Captured at module load — before any spy replaces window.getComputedStyle —
// so the stub can delegate without recursing into itself.
const realComputed = window.getComputedStyle;

function stubOverflowX(...scrollers: HTMLElement[]) {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
    const base = realComputed.call(window, el as Element);
    if (scrollers.includes(el as HTMLElement)) return { overflowX: 'auto' } as unknown as CSSStyleDeclaration;
    return base;
  });
}

beforeEach(() => {
  vi.mocked(window.getComputedStyle).mockRestore?.();
  document.body.innerHTML = '';
});

describe('useTableArrowScroll (SIL-531 global table arrow scroll)', () => {
  it('ArrowRight scrolls the table scroller right; ArrowLeft back', () => {
    const { host, scrollBy } = makeScroller(true);
    stubOverflowX(host);
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(scrollBy).toHaveBeenCalledWith({ left: 360, behavior: 'auto' }); // max(120, 600*.6)
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -360, behavior: 'auto' });
  });

  it('an editable target keeps the native caret behaviour — no scroll', () => {
    const { host, scrollBy } = makeScroller(true);
    stubOverflowX(host);
    render(<Harness />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('an open overlay owns the arrows — no scroll', () => {
    const { host, scrollBy } = makeScroller(true);
    stubOverflowX(host);
    render(<Harness />);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('modifier chords (ctrl/meta/alt) never scroll', () => {
    const { host, scrollBy } = makeScroller(true);
    stubOverflowX(host);
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'ArrowRight', metaKey: true });
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('a horizontal scroller without a table inside is not a candidate', () => {
    const tableless = makeScroller(false);
    stubOverflowX(tableless.host);
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(tableless.scrollBy).not.toHaveBeenCalled();
  });

  it('the table under the pointer wins over the bigger one', () => {
    const big = makeScroller(true);
    const small = makeScroller(true);
    big.host.getBoundingClientRect = () => new DOMRect(0, 0, 600, 400);
    small.host.getBoundingClientRect = () => new DOMRect(0, 500, 300, 100);
    stubOverflowX(big.host, small.host);
    render(<Harness />);
    fireEvent.pointerMove(window, { clientX: 100, clientY: 520 });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(big.scrollBy).not.toHaveBeenCalled();
    expect(small.scrollBy).toHaveBeenCalledWith({ left: 360, behavior: 'auto' });
  });

  it('nothing scrollable → the key is left to the browser', () => {
    render(<Harness />);
    const event = fireEvent.keyDown(window, { key: 'ArrowRight' });
    // fireEvent returns true when default was NOT prevented.
    expect(event).toBe(true);
  });

  it('unmounts cleanly (listener removed)', () => {
    const { host, scrollBy } = makeScroller(true);
    stubOverflowX(host);
    const { unmount } = render(<Harness />);
    unmount();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
