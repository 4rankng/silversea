// SIL-1127 (QA 27/11) — the suggestion panel's click-through contract: the
// ComboBox popover surface (empty state included) must pass presses through
// to the control beneath it, while option rows keep their pointer events.
// Only the suggestion layer (`data-trigger="ComboBox"`) is transparent —
// Select/menu panels keep capturing. House styles-test convention: the CSS
// file is the contract source (the browser hit-testing it guards cannot run
// under jsdom).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/untitled-ui/base/select/combobox.css'), 'utf8');

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
