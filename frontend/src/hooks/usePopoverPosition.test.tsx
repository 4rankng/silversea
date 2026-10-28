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

/** SIL-552: the floating editor of the SỐ CONTAINER cell anchors its LEFT
 *  edge to the trigger — a 300px panel right-aligned to a trigger in the
 *  left third of the drawer would drift away from the row it edits.
 *
 *  The trigger's rect is stubbed ON THE ELEMENT (a ref callback runs before
 *  the layout effect that positions the panel), so the assertion never
 *  depends on a global `getBoundingClientRect` spy that another file in a
 *  full-suite run may have replaced. */
const TRIGGER_RECT = DOMRect.fromRect({ x: 196, y: 480, width: 74, height: 36 });

function LeftAlignHarness() {
  const trigger = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const position = usePopoverPosition(panel, trigger, true, 300, 54, 'start');
  const attach = (element: HTMLButtonElement | null) => {
    trigger.current = element;
    if (element) vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(TRIGGER_RECT);
  };
  return <><button ref={attach} data-testid="trigger">Open</button><div ref={panel} data-testid="panel" style={{ ...position }} /></>;
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

  it('aligns a wide panel to the trigger\'s LEFT edge when asked (SIL-552)', () => {
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 900);
    vi.stubGlobal('visualViewport', undefined);
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(54);
    render(<LeftAlignHarness />);
    const panel = screen.getByTestId('panel');
    // The panel's LEFT edge rides the trigger's left edge — the panel opens
    // UNDER the row it edits instead of drifting to the viewport edge.
    expect(Number.parseFloat(panel.style.left)).toBe(TRIGGER_RECT.left);
    // It still opens below the trigger (there is room).
    expect(Number.parseFloat(panel.style.top)).toBeGreaterThan(480);
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
