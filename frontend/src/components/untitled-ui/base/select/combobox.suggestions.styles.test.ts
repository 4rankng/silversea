// SIL-1127 (QA 27/11) — the suggestion panel's click-through contract: the
// ComboBox popover surface (empty state included) must pass presses through
// to the control beneath it, while option rows keep their pointer events.
// Only the suggestion layer (`data-trigger="ComboBox"`) is transparent —
// Select/menu panels keep capturing. House styles-test convention: the CSS
// file is the contract source (the browser hit-testing it guards cannot run
// under jsdom).
//
// SIL-1271 (QA 28/11): the transparent panel must not cost reachability —
// the options LISTBOX is the scroll surface and keeps its pointer events, so
// its scrollbar is grabbable and every option stays reachable by browsing
// (the old panel-owned scrollbar could not be mouse-dragged and a grab
// closed the menu). Scrolling the list also never chains into the page —
// a page scroll dismisses the menu mid-browse.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/untitled-ui/base/select/combobox.css'), 'utf8');

function ruleBody(head: RegExp): string {
  const match = css.match(new RegExp(`${head.source}\\s*\\{([^}]*)\\}`));
  expect(match, `expected a rule matching ${head}`).toBeTruthy();
  return match![1];
}

describe('combobox suggestion panel click-through (SIL-1127)', () => {
  it('passes presses through the panel surface and keeps option rows clickable', () => {
    expect(css).toMatch(/\.uui-select-popover\[data-trigger="ComboBox"\]\s*\{[^}]*pointer-events:\s*none;/);
    expect(css).toMatch(/\.uui-select-popover\[data-trigger="ComboBox"\]\s*\[role='option'\]\s*\{[^}]*pointer-events:\s*auto;/);
    // The empty-state explanation renders inside a display:contents role=option
    // wrapper — it must pass through too or it re-blocks the button beneath.
    expect(css).toMatch(/\.uui-select-popover\[data-trigger="ComboBox"\]\s*\[role='status'\]\s*\{[^}]*pointer-events:\s*none;/);
  });

  it('never disables pointer events on the Select/menu panel — only the suggestion layer', () => {
    const selectRule = css.match(/\.react-aria-Popover\[data-trigger="Select"\][^{]*\{[^}]*\}/);
    expect(selectRule?.[0] ?? '').not.toContain('pointer-events');
  });
});

describe('combobox option list scroll reachability (SIL-1271)', () => {
  it('the listbox owns the scroll: pointer-events, a fit cap and internal scrolling', () => {
    const listbox = ruleBody(/\.uui-select-popover\[data-trigger="ComboBox"\]\s*\[role='listbox'\]/);
    expect(listbox).toContain('pointer-events: auto');
    expect(listbox).toMatch(/overflow-y:\s*auto\s*!important/);
    expect(listbox).toMatch(/max-height:\s*calc\(min\(var\(--popover-fit,\s*360px\),\s*360px,\s*calc\(100dvh - 48px\)\) - 8px\)\s*!important/);
    // The cap rides the fit variable, so the list never spills past the
    // viewport whatever the trigger position.
    expect(listbox).toContain('--popover-fit');
  });

  it('scrolling the list never chains into the page (a page scroll dismisses the menu)', () => {
    const listbox = ruleBody(/\.uui-select-popover\[data-trigger="ComboBox"\]\s*\[role='listbox'\]/);
    expect(listbox).toMatch(/overscroll-behavior:\s*contain/);
  });

  it('the empty state still passes presses through — nothing to scroll, nothing to capture', () => {
    const empty = ruleBody(/\.uui-select-popover\[data-trigger="ComboBox"\]\s*\[role='listbox'\]:has\(\[role='status'\]\)/);
    expect(empty).toContain('pointer-events: none');
    expect(empty).toMatch(/max-height:\s*none\s*!important/);
  });
});
