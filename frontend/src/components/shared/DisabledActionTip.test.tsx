/**
 * DisabledActionTip — the aria-disabled + aria-described explanation pattern
 * and its edge-clamp law.
 *
 * Pinned contractually:
 *  - an enabled action (reason null) renders bare — the wrapper adds nothing;
 *  - a blocked action keeps aria-describedby pointing at the reason, which
 *    renders twice: sr-only for assistive tech, a hover/focus bubble;
 *  - the bubble alignment CLAMPS to the visible pane: a control docked near
 *    the left edge (e.g. [Khóa lô] beside the sidebar) left-aligns its bubble
 *    instead of centering it under the sidebar; the right edge mirrors it;
 *  - the CSS carries the unclipped contract: the start bubble pins at the
 *    wrapper's left edge (left:0, transform:none), the bubble width stays
 *    capped to the viewport, and it rides above the sticky dock z-ladder.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DisabledActionTip } from './DisabledActionTip';

function renderTip(reason: string | null) {
  return render(
    <DisabledActionTip id="tip-under-test" reason={reason}>
      <button type="button" aria-disabled={reason != null || undefined}>Hành động</button>
    </DisabledActionTip>,
  );
}

/** jsdom lays nothing out: place the wrapper explicitly and let the clamp
 *  math read the stubbed box. No `main`/`.app-body` ancestor exists in the
 *  test DOM, so the pane bounds fall back to the viewport (1024px). */
function stubWrapperRect(left: number, width: number): void {
  const wrapper = document.querySelector<HTMLElement>('.disabled-action-tip');
  if (!wrapper) throw new Error('the tip wrapper must render');
  vi.spyOn(wrapper, 'getBoundingClientRect').mockImplementation(function stubRect(this: Element) {
    return { width, height: 32, left, top: 0, right: left + width, bottom: 32, x: left, y: 0, toJSON: () => ({}) };
  });
}

describe('DisabledActionTip — the explanation pattern', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('an enabled action renders bare — the wrapper adds nothing to the DOM', () => {
    renderTip(null);
    expect(document.querySelector('.disabled-action-tip')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hành động' }).getAttribute('aria-describedby')).toBeNull();
  });

  it('a blocked action keeps its handler-reachable face and describes itself twice', () => {
    renderTip('Không thể khóa lô: còn khoản chi phí chờ duyệt.');
    const button = screen.getByRole('button', { name: 'Hành động' });
    // aria-disabled (never the native disabled attribute): the control stays
    // in the tab order and hoverable, so the explanation stays reachable.
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toBe('tip-under-test-disabled-reason');
    // sr-only reason for assistive tech + the visual bubble.
    expect(document.getElementById('tip-under-test-disabled-reason')?.className).toContain('sr-only');
    const bubble = document.querySelector<HTMLElement>('.disabled-action-tip__bubble');
    expect(bubble?.textContent).toBe('Không thể khóa lô: còn khoản chi phí chờ duyệt.');
    expect(bubble?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('DisabledActionTip — the bubble clamps to the visible pane', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a control near the LEFT edge left-aligns its bubble instead of centering it under the sidebar', () => {
    renderTip('Không thể khóa lô: Lô BL-1 còn 3 khoản chi phí chưa được Kế toán duyệt.');
    // Wrapper centered at x=145: a centered 360px bubble would open ~35px
    // left of the viewport — behind the sidebar in the real shell.
    stubWrapperRect(100, 90);
    fireEvent.mouseEnter(document.querySelector<HTMLElement>('.disabled-action-tip')!);
    expect(document.querySelector<HTMLElement>('.disabled-action-tip')?.getAttribute('data-align')).toBe('start');
  });

  it('keyboard focus runs the same clamp', () => {
    renderTip('Cần quyền khóa lô hàng.');
    stubWrapperRect(100, 90);
    fireEvent.focus(document.querySelector<HTMLElement>('.disabled-action-tip')!);
    expect(document.querySelector<HTMLElement>('.disabled-action-tip')?.getAttribute('data-align')).toBe('start');
  });

  it('a mid-pane control keeps the centered bubble', () => {
    renderTip('Chọn ít nhất một lô.');
    stubWrapperRect(500, 120);
    fireEvent.mouseEnter(document.querySelector<HTMLElement>('.disabled-action-tip')!);
    expect(document.querySelector<HTMLElement>('.disabled-action-tip')?.getAttribute('data-align')).toBe('center');
  });

  it('a control near the RIGHT edge end-aligns its bubble', () => {
    renderTip('Chọn ít nhất một lô.');
    stubWrapperRect(900, 120);
    fireEvent.mouseEnter(document.querySelector<HTMLElement>('.disabled-action-tip')!);
    expect(document.querySelector<HTMLElement>('.disabled-action-tip')?.getAttribute('data-align')).toBe('end');
  });

  it('the CSS carries the unclipped contract', () => {
    const css = readFileSync(resolve(import.meta.dirname, './DisabledActionTip.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // Left edge: the bubble pins at the wrapper's left edge — left:0 with no
    // transform — so it can never reach under the sidebar.
    expect(css).toMatch(/\.disabled-action-tip\[data-align='start'\] \.disabled-action-tip__bubble \{[^}]*left: 0;[^}]*transform: none;/);
    // Right edge mirrors it.
    expect(css).toMatch(/\.disabled-action-tip\[data-align='end'\] \.disabled-action-tip__bubble \{[^}]*right: 0;[^}]*transform: none;/);
    // Width-capped wrap: a long block reason never runs past the viewport.
    expect(css).toMatch(/\.disabled-action-tip__bubble \{[^}]*max-width: min\(360px, calc\(100vw - 24px\)\);/);
    // The bubble rides above the sticky dock z-ladder (docked cells reach z 6).
    expect(css).toMatch(/\.disabled-action-tip__bubble \{[^}]*z-index: 30;/);
    // Reveal rides the WRAPPER's hover/focus — the aria-disabled control
    // stays hoverable/focusable where a natively disabled one would not.
    expect(css).toMatch(/\.disabled-action-tip:hover \.disabled-action-tip__bubble,\s*\.disabled-action-tip:focus-within \.disabled-action-tip__bubble \{\s*display: block;/);
  });
});
