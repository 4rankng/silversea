import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePopoverPosition } from './usePopoverPosition';

function Harness({ align }: { align?: 'start' | 'end' } = {}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const position = usePopoverPosition(panel, trigger, true, 396, 200, align);
  return <><button ref={trigger}>Open</button><div ref={panel} data-testid="panel" style={{ ...position }} /></>;
}

describe('usePopoverPosition viewport anchoring', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each([[390, 844], [834, 1112], [1280, 600], [1440, 900]])('keeps expanded panels inside %ix%i', (width, height) => {
    vi.stubGlobal('innerWidth', width);
    vi.stubGlobal('innerHeight', height);
    vi.stubGlobal('visualViewport', undefined);
    let resize: ResizeObserverCallback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe = vi.fn();
      disconnect = disconnect;
    });
    const panelWidth = Math.min(396, width - 24);
    let panelHeight = 190;
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.dataset.testid === 'panel' ? panelWidth : 0; });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.dataset.testid === 'panel' ? panelHeight : 0; });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: width - 220, y: height - 270, width: 200, height: 34 }));
    const { unmount } = render(<Harness />);
    const panel = screen.getByTestId('panel');
    expect(Number.parseFloat(panel.style.top) + panelHeight).toBeLessThanOrEqual(height - 12);
    panelHeight = 415;
    act(() => resize([], {} as ResizeObserver));
    expect(Number.parseFloat(panel.style.top)).toBeGreaterThanOrEqual(12);
    expect(Number.parseFloat(panel.style.top) + panelHeight).toBeLessThanOrEqual(height - 12);
    expect(Number.parseFloat(panel.style.left)).toBeGreaterThanOrEqual(12);
    expect(Number.parseFloat(panel.style.left) + panelWidth).toBeLessThanOrEqual(width - 12);
    unmount();
    // TWO observers are released: the popover (its own height can change under
    // it) and the trigger (the bar re-wraps without a window resize).
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it('align: start flushes the panel LEFT edge to the trigger (SIL-631 floating cell editors)', () => {
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 900);
    vi.stubGlobal('visualViewport', undefined);
    let resize: ResizeObserverCallback = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe = vi.fn();
      disconnect = vi.fn();
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.dataset.testid === 'panel' ? 360 : 0; });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.dataset.testid === 'panel' ? 120 : 0; });
    // Anchor flush against x=520: end alignment would park the panel at
    // 520+200-360=360; start alignment must sit at the anchor's left edge.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 520, y: 300, width: 200, height: 34 }));
    const { unmount } = render(<Harness align="start" />);
    const panel = screen.getByTestId('panel');
    expect(Number.parseFloat(panel.style.left)).toBe(520);
    expect(Number.parseFloat(panel.style.top)).toBe(300 + 34 + 4);
    act(() => resize([], {} as ResizeObserver));
    expect(Number.parseFloat(panel.style.left)).toBe(520);
    unmount();
  });
});
