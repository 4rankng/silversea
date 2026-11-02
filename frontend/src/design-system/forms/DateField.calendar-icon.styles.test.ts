import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SIL-651 (id 756) — Trailing calendar icon affordance on date pickers.
 *
 * Owner reported: date inputs in filter bar "Từ / Đến" (and across the whole app)
 * showed only date text with no calendar icon at the trailing edge.
 *
 * Contract:
 * 1. Every date input must display a calendar icon at the trailing (right) edge.
 * 2. Clicking the icon opens the date popup identically to clicking the field.
 * 3. Density law: trailing icon must NOT change control height.
 * 4. No overlap: the icon must not crowd value text or caret (padding reserved).
 * 5. House tokens: color uses var(--ink-3), hover uses var(--ink), transparent background, zero border.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const dateCss = read('src/design-system/forms/BufferedUuiDateInput.css');

describe('SIL-651 date picker trailing calendar icon styles', () => {
  it('pins .uui-date-icon-btn house tokens, alignment and interaction states', () => {
    expect(dateCss).toContain('.uui-date-icon-btn {');
    const match = dateCss.match(/\.uui-date-icon-btn\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(match).toContain('display: inline-flex');
    expect(match).toContain('align-items: center');
    expect(match).toContain('justify-content: center');
    expect(match).toContain('flex: 0 0 auto');
    expect(match).toContain('margin-left: auto');
    expect(match).toContain('border: 0');
    expect(match).toContain('background: transparent');
    expect(match).toContain('color: var(--ink-3)');
    expect(match).toContain('cursor: pointer');

    const hover = dateCss.match(/\.uui-date-icon-btn:hover:not\(:disabled\)\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(hover).toContain('color: var(--ink)');

    const disabled = dateCss.match(/\.uui-date-icon-btn:disabled\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(disabled).toContain('opacity: 0.5');
    expect(disabled).toContain('cursor: not-allowed');
  });

  it('pins .date-input-wrap and .date-input-calendar-btn geometry and overlap protection', () => {
    const wrap = dateCss.match(/\.date-input-wrap\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(wrap).toContain('position: relative');
    expect(wrap).toContain('display: flex');
    expect(wrap).toContain('align-items: center');
    expect(wrap).toContain('width: 100%');

    const inputPad = dateCss.match(/\.date-input-wrap > input\[data-date-input\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(inputPad).toContain('padding-right: 32px !important');

    const btn = dateCss.match(/\.date-input-calendar-btn\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(btn).toContain('position: absolute');
    expect(btn).toContain('right: 8px');
    expect(btn).toContain('top: 50%');
    expect(btn).toContain('transform: translateY(-50%)');
    expect(btn).toContain('border: 0');
    expect(btn).toContain('background: transparent');
    expect(btn).toContain('color: var(--ink-3)');
  });

  it('pins .datetime-field-wrap and .datetime-field-calendar-btn geometry', () => {
    const wrap = dateCss.match(/\.datetime-field-wrap\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(wrap).toContain('position: relative');
    expect(wrap).toContain('display: flex');
    expect(wrap).toContain('align-items: flex-end');
    expect(wrap).toContain('gap: 6px');

    const btn = dateCss.match(/\.datetime-field-calendar-btn\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(btn).toContain('height: var(--control-compact-h, 32px)');
    expect(btn).toContain('border: 0');
    expect(btn).toContain('background: transparent');
    expect(btn).toContain('color: var(--ink-3)');
  });

  it('preserves density law: icon dimensions stay ≤ 24px and never expand control height', () => {
    for (const selector of ['.uui-date-icon-btn', '.date-input-calendar-btn', '.datetime-field-calendar-btn']) {
      const match = dateCss.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      expect(match, `${selector} exists`).not.toBe('');
      const widthMatch = match.match(/width:\s*(\d+)px/)?.[1];
      if (widthMatch) {
        expect(Number(widthMatch), `${selector} width`).toBeLessThanOrEqual(24);
      }
    }
  });

  it('preserves existing filter bar toolbar layout blocks for both with and without prefix', () => {
    expect(dateCss).toContain('.filter-bar > [data-input-wrapper]:not([data-has-prefix]):has(> .date-seg-group)');
    expect(dateCss).toContain('.filter-bar > [data-input-wrapper]:not([data-has-prefix]):has(> [data-date-boundary])');
  });
});

describe('SIL-651 source architecture pins', () => {
  it('BufferedUuiDateInput renders trailing calendar icon button in data-date-boundary', () => {
    const src = read('src/design-system/forms/BufferedUuiDateInput.tsx');
    expect(src).toContain("import { Calendar } from 'lucide-react';");
    expect(src).toContain('className="uui-date-icon-btn"');
    expect(src).toContain('<Calendar size={14} aria-hidden="true" />');
    expect(src).toContain('showCalendar()');
  });

  it('DateInput renders trailing calendar icon button in date-input-wrap', () => {
    const src = read('src/design-system/forms/DateInput.tsx');
    expect(src).toContain("import { Calendar } from 'lucide-react';");
    expect(src).toContain('className="date-input-wrap"');
    expect(src).toContain('className="date-input-calendar-btn"');
    expect(src).toContain('<Calendar size={14} aria-hidden="true" />');
  });

  it('DateTimeField renders trailing calendar icon button in datetime-field-wrap', () => {
    const src = read('src/design-system/forms/DateTimeField.tsx');
    expect(src).toContain("import { Calendar } from 'lucide-react';");
    expect(src).toContain('className="datetime-field-wrap"');
    expect(src).toContain('className="datetime-field-calendar-btn"');
    expect(src).toContain('<Calendar size={14} aria-hidden="true" />');
  });
});
