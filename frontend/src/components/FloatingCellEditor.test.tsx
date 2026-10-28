import { act, render, screen } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FloatingCellEditor } from './FloatingCellEditor';

/** One editing cell inside an overflow scroll box — the SIL-631 clip container
 *  (e.g. the drawer's `.dispatch-container-detail__table-scroll`). */
function EditingCellInScroller({ children }: { children: ReactNode }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  return (
    <div data-testid="scroller" style={{ overflow: 'hidden' }}>
      <div data-testid="cell" ref={anchorRef}>
        <FloatingCellEditor anchorRef={anchorRef} label="Số container · MSKU5500004">
          {children}
        </FloatingCellEditor>
      </div>
    </div>
  );
}

describe('FloatingCellEditor (SIL-631)', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('PIN — editor renders through a body portal, OUTSIDE the overflow container', () => {
    render(
      <EditingCellInScroller>
        <input aria-label="Số container" defaultValue="MSKU5500004XLONGTESTVALUE" />
      </EditingCellInScroller>,
    );
    const input = screen.getByLabelText('Số container');
    const panel = input.closest('[data-cell-editor-portal]');
    expect(panel).toBeTruthy();
    // The editor is a direct child of body — the overflow scroller (or any
    // `overflow`/containment on the table) can never clip the value.
    expect(panel!.parentElement).toBe(document.body);
    const scroller = screen.getByTestId('scroller');
    expect(scroller.contains(input)).toBe(false);
    expect(scroller.contains(panel!)).toBe(false);
    expect(screen.getByTestId('cell').contains(input)).toBe(false);
  });

  it('names the floating editor group for assistive tech', () => {
    render(
      <EditingCellInScroller>
        <input aria-label="Số container" />
      </EditingCellInScroller>,
    );
    const input = screen.getByLabelText('Số container');
    const panel = input.closest('[role="group"]') as HTMLElement | null;
    expect(panel).toBeTruthy();
    expect(panel!.getAttribute('aria-label')).toBe('Số container · MSKU5500004');
  });

  it('PIN — positions at the same-commit anchor bottom-start and drops the hidden state (self-healing)', async () => {
    // Regression for the review's HIGH: the anchor's ref attaches AFTER the
    // panel's layout effects when both mount in one commit (the notes-editor
    // wiring) — the hook's rAF passes must re-measure instead of leaving the
    // panel permanently invisible at the padding corner.
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 900);
    vi.stubGlobal('visualViewport', undefined);
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-cell-editor-portal') ? 360 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-cell-editor-portal') ? 120 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-cell-editor-portal')
        ? DOMRect.fromRect({ x: 0, y: 0, width: 360, height: 120 })
        : DOMRect.fromRect({ x: 520, y: 300, width: 200, height: 34 });
    });
    render(
      <EditingCellInScroller>
        <input aria-label="Số container" />
      </EditingCellInScroller>,
    );
    const panel = document.querySelector('[data-cell-editor-portal]') as HTMLElement;
    // Hidden until measured…
    expect(panel.style.opacity).toBe('0');
    // …then bottom-start at the anchor (align-top: edges align, gap 4):
    // top = anchor.bottom + gap, left = anchor.left.
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 80);
      await promise;
    });
    expect(panel.style.top).toBe('338px');
    expect(panel.style.left).toBe('520px');
    expect(panel.style.opacity).not.toBe('0');
    expect(panel.style.pointerEvents).not.toBe('none');
  });

  it('PIN — no-truncate: the editor host never ellipsizes and floors its width at the value font (52ch)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/FloatingCellEditor.css'), 'utf8');
    // The no-truncate doctrine (owner 28/10): a ≤50-char value shows WHOLE in
    // the floating editor — ellipsis/clipping in the editor is forbidden.
    expect(css).not.toContain('ellipsis');
    expect(css).not.toContain('text-overflow');
    expect(css).toContain('position: fixed');
    expect(css).toContain('var(--fce-value-ch, 52ch)');
    expect(css).toContain('min-width:');
  });

  it('PIN — no-truncate: converted editor bodies carry no ellipsis rule', () => {
    // Editor class fragments whose rule blocks must never ellipsize a value:
    // the drawer decl band, the detailed-plan decl band, the CUS ghost-line
    // editor and the master-plan notes editor (all rendered inside the host).
    const editorClassFragments = [
      'floating-cell-editor',
      'decl-editor',
      'decl-input',
      'decl-hint',
      'cus-lot-line--editor',
      'cus-lot-line__input',
      'notes-editor',
      'notes-input',
    ];
    const cssFiles = [
      'src/components/FloatingCellEditor.css',
      'src/features/dispatch/master-plan/DispatchContainerDetailDrawer.css',
      'src/features/dispatch/detailed-plan/DetailedPlanGrid.css',
      'src/pages/ShipmentsPage.css',
      'src/pages/DispatchPlanPage.css',
      'src/features/dispatch/master-plan/MasterPlanGrid.css',
    ];
    for (const file of cssFiles) {
      const css = readFileSync(resolve(process.cwd(), file), 'utf8');
      // Chunk = one rule OR one @media block (split on every '}'). Test the
      // WHOLE chunk (prelude included) so an ellipsized editor rule nested in
      // an @media block can never hide behind its outer selector.
      for (const block of css.split('}')) {
        if (!/ellipsis/.test(block)) continue;
        const hitsEditor = editorClassFragments.some((fragment) => block.includes(fragment));
        expect(hitsEditor, `${file}: editor rule may not ellipsize — ${block.trim().slice(0, 120)}`).toBe(false);
      }
    }
  });
});
