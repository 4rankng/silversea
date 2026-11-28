/**
 * Tooltip — the shared hover/focus hint and its viewport-clamp law (SIL-1258).
 *
 * Pinned contractually:
 *  - no label renders the children bare (no wrapper in the DOM);
 *  - the bubble is the real `.tooltip-content` span (aria-hidden — the control's
 *    own aria-label carries the accessible name), never the data-tip pseudo;
 *  - on hover/focus the bubble CLAMPS inside the viewport through daisyUI's
 *    `--tt-trans` hook: a trigger docked near the right edge (the /shipments
 *    drawer's [Khóa lô], clipped mid-sentence at 1440px) shifts its bubble
 *    left; the left edge mirrors; a mid-pane trigger stays centered; a bubble
 *    wider than its space pins its left edge;
 *  - left/right-side tips never take the horizontal clamp (their --tt-trans
 *    centers on the vertical axis);
 *  - the tail stays on the trigger: tokens.css re-declares --tt-trans on the
 *    ::after so the arrow does not ride the bubble away from the control.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Tooltip } from './Tooltip';

function renderTip(label?: ReactNode, side: 'top' | 'bottom' | 'left' | 'right' = 'bottom') {
  const result = render(
    <Tooltip label={label} side={side}>
      <button type="button" aria-label="Khóa lô">icon</button>
    </Tooltip>,
  );
  return { wrapper: result.container.querySelector<HTMLElement>('.d-tooltip'), bubble: result.container.querySelector<HTMLElement>('.d-tooltip-content') };
}

/** jsdom lays nothing out: place the wrapper and the bubble explicitly and
 *  let the clamp math read the stubbed boxes (viewport = jsdom's 1024px). */
function stubRects(wrapperLeft: number, wrapperWidth: number, bubbleWidth: number): void {
  const wrapper = document.querySelector<HTMLElement>('.d-tooltip');
  const bubble = document.querySelector<HTMLElement>('.d-tooltip-content');
  if (!wrapper || !bubble) throw new Error('the tip wrapper and bubble must render');
  vi.spyOn(wrapper, 'getBoundingClientRect').mockImplementation(function stubRect(this: Element) {
    return { width: wrapperWidth, height: 28, left: wrapperLeft, top: 0, right: wrapperLeft + wrapperWidth, bottom: 28, x: wrapperLeft, y: 0, toJSON: () => ({}) };
  });
  vi.spyOn(bubble, 'getBoundingClientRect').mockImplementation(function stubRect(this: Element) {
    return { width: bubbleWidth, height: 36, left: 0, top: 40, right: bubbleWidth, bottom: 76, x: 0, y: 40, toJSON: () => ({}) };
  });
}

describe('Tooltip — the hint pattern', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no label renders the children bare — no wrapper in the DOM', () => {
    renderTip(undefined);
    expect(document.querySelector('.d-tooltip')).toBeNull();
    expect(screen.getByRole('button', { name: 'Khóa lô' })).toBeTruthy();
  });

  it('the bubble is the measurable content span, aria-hidden, never the data-tip pseudo', () => {
    const { wrapper, bubble } = renderTip('Cần Kế toán xác nhận lại số liệu trước khi khóa lô.');
    expect(bubble?.textContent).toBe('Cần Kế toán xác nhận lại số liệu trước khi khóa lô.');
    expect(bubble?.getAttribute('aria-hidden')).toBe('true');
    expect(wrapper?.hasAttribute('data-tip')).toBe(false);
  });

  it('non-string labels ride the same content slot', () => {
    const { bubble } = renderTip(<em>gợi ý</em>);
    expect(bubble?.textContent).toBe('gợi ý');
  });
});

describe('Tooltip — the bubble clamps inside the viewport (SIL-1258)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a trigger docked near the RIGHT edge shifts its bubble left of center', () => {
    // Wrapper centered at 916: a 300px bubble centered there opens at 766 and
    // runs to 1066 — 54px past the 1024px viewport (the drawer [Khóa lô] clip).
    const { wrapper } = renderTip('Cần Kế toán xác nhận lại số liệu trước khi khóa lô.');
    stubRects(900, 32, 300);
    fireEvent.mouseEnter(wrapper!);
    expect(wrapper?.style.getPropertyValue('--tt-trans')).toBe('calc(-50% - 54px)');
  });

  it('a trigger docked near the LEFT edge shifts its bubble right of center', () => {
    // Center 36: a 300px bubble opens at −114 — under the sidebar.
    const { wrapper } = renderTip('Cần Kế toán xác nhận lại số liệu trước khi khóa lô.');
    stubRects(20, 32, 300);
    fireEvent.mouseEnter(wrapper!);
    expect(wrapper?.style.getPropertyValue('--tt-trans')).toBe('calc(-50% + 126px)');
  });

  it('a mid-pane trigger keeps the centered bubble', () => {
    const { wrapper } = renderTip('Chọn ít nhất một lô.');
    stubRects(450, 32, 300);
    fireEvent.mouseEnter(wrapper!);
    expect(wrapper?.style.getPropertyValue('--tt-trans')).toBe('');
  });

  it('a bubble wider than its space pins its left edge — the sentence start stays readable', () => {
    // 1200px bubble around center 512: no shift fits both margins (min 100 >
    // max −100), so the clamp pins left: 12.
    const { wrapper } = renderTip('Câu dài hơn cả màn hình.');
    stubRects(496, 32, 1200);
    fireEvent.mouseEnter(wrapper!);
    expect(wrapper?.style.getPropertyValue('--tt-trans')).toBe('calc(-50% + 100px)');
  });

  it('keyboard focus runs the same clamp', () => {
    const { wrapper } = renderTip('Cần Kế toán xác nhận lại số liệu trước khi khóa lô.');
    stubRects(900, 32, 300);
    fireEvent.focus(wrapper!);
    expect(wrapper?.style.getPropertyValue('--tt-trans')).toBe('calc(-50% - 54px)');
  });

  it('left/right-side tips never take the horizontal clamp — their hook centers on the other axis', () => {
    const { wrapper } = renderTip('Cần Kế toán xác nhận lại số liệu trước khi khóa lô.', 'right');
    stubRects(900, 32, 300);
    fireEvent.mouseEnter(wrapper!);
    expect(wrapper?.style.getPropertyValue('--tt-trans')).toBe('');
  });

  it('the tail stays on the trigger while the bubble slides', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../../styles/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.d-tooltip::after \{[^}]*--tt-trans: -50%;/);
  });
});
