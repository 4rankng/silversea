import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

/**
 * `filter-bar-mode` — who owns the secondary criteria: the bar or the `Bộ lọc`
 * dialog (card 20260927_152, operator 2026-09-27: "when there is enough space
 * we try our best to display all filters, not group inside bo loc" … "group
 * inside bo loc is only when we have no other choice due to screensize
 * limitation").
 *
 * The rule is the operator's own two-row cap read as a decision procedure: keep
 * every criterion inline while the strip still fits TWO rows; the moment the
 * rows would become three, the criteria move into `Bộ lọc`. That is a measured
 * question, so `ListFilterBar` measures its own rows and publishes the verdict
 * here, and `FilterDropdown` renders its children inline or behind its trigger
 * accordingly. ONE copy of each criterion exists at any moment — no duplicated
 * markup, no duplicated ids, no ambiguous queries.
 *
 * The controller is monotone, which is what keeps it from flapping between the
 * two modes at a fixed width:
 *   - inline mode that fits     → remember `fitWidth` (the widest content width
 *                                 known to fit) and stay inline;
 *   - inline mode that overflows → remember `needWidth` (one px past the width
 *                                 that overflowed) and switch to the dialog.
 * The mode is then a pure function of the current width: inline while
 * `width >= needWidth`, dialog below it. A resize that crosses the threshold
 * flips to inline, which either fits (and raises `fitWidth`) or overflows again
 * (and raises `needWidth`) — so a threshold is re-learned in at most one frame,
 * never oscillated per frame.
 */

export type FilterBarMode = 'inline' | 'dialog' | 'dialog-presets';

const MODE_CONTEXT = createContext<FilterBarMode>('dialog');

/** The mode the surrounding `ListFilterBar` measured; `dialog` without a bar. */
export const useFilterBarMode = () => useContext(MODE_CONTEXT);

export const FilterBarModeProvider = MODE_CONTEXT.Provider;

const VIEW_CONTROLS_CONTEXT = createContext<ReactNode>(null);

/**
 * A view control the bar hosts but does not own — the column picker of card
 * 20260928_193. It obeys the SAME measured placement as a criterion: on the bar
 * while the strip is `inline`, and inside `Bộ lọc` once the bar has folded
 * (a view control may not be the item that pushes a frozen surface onto a third
 * row). `ListFilterBar` publishes it here and renders it itself in `inline` mode
 * only; `FilterDropdown` renders it in the dialog panel, so exactly one instance
 * exists at any moment and the picker never becomes a declared breakpoint.
 */
export const useFilterBarViewControls = () => useContext(VIEW_CONTROLS_CONTEXT);

export const FilterBarViewControlsProvider = VIEW_CONTROLS_CONTEXT.Provider;

/** Dead band: the width must grow this far past a failing width to retry inline. */
const RETRY_SLACK = 32;

/**
 * Visual lines inside the bar: a line is a set of the bar's items whose vertical
 * ranges overlap. Counting by `top` alone would split a line as soon as two
 * items differ in height (a 53px label stack next to a 30px button), and the
 * search's own error line belongs to the search cell, not to a line of its own.
 */
function countLines(bar: HTMLElement): number {
  const boxes = [...bar.children]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .sort((a, b) => a.top - b.top);
  const used: { top: number; bottom: number }[] = [];
  for (const r of boxes) {
    const line = used.find((c) => {
      const overlap = Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top);
      return overlap > 0.5 * Math.min(c.bottom - c.top, r.height);
    });
    if (line) {
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else {
      used.push({ top: r.top, bottom: r.bottom });
    }
  }
  return used.length;
}

/**
 * Measures a bar against the two-row budget and returns the mode its criteria
 * (and, in the last step, its quick ranges) should render in.
 *
 * The ladder has three rungs, each decided by a MEASURED row count, never by a
 * breakpoint:
 *   `inline`         criteria in the bar, ranges in the bar;
 *   `dialog`         criteria in `Bộ lọc`, ranges still in the bar (the shape
 *                    the strip uses from ~594px down to ~460px);
 *   `dialog-presets` criteria AND ranges in `Bộ lọc` — the phone shape, where
 *                    the two-row rule can only hold if the ranges leave the bar
 *                    (operator 2026-09-27: "if need more than 2 rows then group
 *                    into bo loc button").
 * Pass the returned ref to the bar element.
 */
export function useFilterBarFit(barRef: RefObject<HTMLElement | null>, maxLines = 2): FilterBarMode {
  const [mode, setMode] = useState<FilterBarMode>('inline');
  // Two thresholds, one per retry step, each = a width the step could NOT fit
  // at, plus a dead band. They persist across renders, which is what makes the
  // verdict width-deterministic instead of frame-deterministic — the first
  // measure can run against a half-settled shell, and measuring the overflowing
  // item widths there would lock the deepest fold on forever.
  const needInline = useRef(0);
  const needRanges = useRef(0);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () => {
      const content = bar.clientWidth;
      if (content <= 0) return;
      // Step back one rung when the width has grown past the threshold that
      // folded it. Re-learning is what keeps a fold from being permanent after a
      // one-off narrow frame.
      if (mode === 'dialog' && content >= needInline.current) {
        setMode('inline');
        return;
      }
      if (mode === 'dialog-presets' && content >= needRanges.current) {
        setMode('dialog');
        return;
      }
      if (countLines(bar) <= maxLines) return;
      if (mode === 'inline') {
        needInline.current = Math.max(needInline.current, content + RETRY_SLACK);
        setMode('dialog');
        return;
      }
      needRanges.current = Math.max(needRanges.current, content + RETRY_SLACK);
      if (mode === 'dialog') setMode('dialog-presets');
    };
    measure();
    // The shell can settle (sidebar collapse, container max-width, web fonts)
    // between this first measure and the observer attaching, leaving no further
    // resize to react to — so one rAF pass re-measures the settled layout.
    const frame = requestAnimationFrame(measure);
    if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(frame);
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [barRef, maxLines, mode]);

  return mode;
}
