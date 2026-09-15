import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePopoverPosition } from './usePopoverPosition';

function Harness() {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const position = usePopoverPosition(panel, trigger, true, 396, 200);
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
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
