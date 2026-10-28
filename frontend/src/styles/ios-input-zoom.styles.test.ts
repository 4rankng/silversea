import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * iOS input focus-zoom contract — SIL-558.
 *
 * Mobile Safari zoom-jumps the viewport when a focused field's computed
 * font-size is under 16px, and the `maximum-scale=1` viewport lock that used
 * to suppress it is gone (SIL-557, WCAG 1.4.4). The touch bands therefore
 * compute field text to the 16px floor (`--control-zoom-safe-font-size`)
 * while control geometry keeps its compact tokens (30/34/40px). These pins
 * keep every shared field face on that token.
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('iOS input focus-zoom floor (SIL-558)', () => {
  it('defines the 16px zoom-safe field token', () => {
    expect(read('src/styles/tokens.css')).toMatch(
      /--control-zoom-safe-font-size:\s*16px;/,
    );
  });

  it('maps the touch control-field band to the zoom-safe token', () => {
    const tokens = read('src/styles/tokens.css');
    const band = tokens.match(
      /@media \(max-width: 640px\), \(pointer: coarse\) \{\s*:root \{\s*--control-field-font-size:[^}]+\}\s*\}/,
    )?.[0] ?? '';
    expect(band, 'touch --control-field-font-size band exists').not.toBe('');
    expect(band).toMatch(/--control-field-font-size:\s*var\(--control-zoom-safe-font-size\)/);
    expect(band).not.toMatch(/--text-input-touch-size/);
  });

  it('keeps the native .input touch bands on the zoom-safe token', () => {
    const responsive = read('src/styles/responsive.css');
    expect(responsive).toMatch(
      /\.input,\s*select\.input,\s*input\.input,\s*textarea\.input \{[^}]*font-size:\s*var\(--control-zoom-safe-font-size\)/,
    );
    expect(responsive).toMatch(
      /#root input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),\s*#root select,\s*#root textarea,\s*#root \.input \{[^}]*font-size:\s*var\(--control-zoom-safe-font-size\)/,
    );
    // No responsive rule may compute a focusable field under the iOS floor.
    expect(responsive).not.toMatch(/font-size:\s*var\(--text-input-touch-size\)/);
  });

  it('keeps the UUI control-typography touch variants on the zoom-safe token', () => {
    const typography = read('src/components/untitled-ui/base/control-typography.ts');
    expect(typography).not.toMatch(/--text-input-touch-size/);
    expect((typography.match(/--control-zoom-safe-font-size/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('keeps the known direct field-face rules on the zoom-safe token', () => {
    expect(read('src/components/Toolbar.css')).toMatch(
      /\.toolbar__search input \{[^}]*font-size:\s*var\(--control-zoom-safe-font-size\)/,
    );
    expect(read('src/components/Input.css')).toMatch(
      /\.input \{[^}]*font-size:\s*var\(--control-zoom-safe-font-size\)/,
    );
    expect(read('src/pages/FleetPage.css')).toMatch(
      /\.fleet-form \.input \{[^}]*font-size:\s*var\(--control-zoom-safe-font-size\)/,
    );
    expect(read('src/design-system/Pagination.css')).toMatch(
      /\.ds-pagination__jump input \{[^}]*font-size:\s*var\(--control-zoom-safe-font-size\)/,
    );
    expect(read('src/design-system/Modal.css')).toMatch(
      /\.modal__body \.field \.input:not\(textarea\) \{[^}]*font-size:\s*var\(--control-zoom-safe-font-size\)/,
    );
    expect(read('src/design-system/forms/SearchableSelect.css')).toMatch(
      /\.searchable-select__search-input \{[^}]*font-size:\s*var\(--control-zoom-safe-font-size\)/,
    );
  });

  it('stays necessary only while the viewport zoom lock is absent (SIL-557)', () => {
    const html = read('index.html');
    expect(html).toMatch(/name="viewport"/);
    expect(html).not.toMatch(/maximum-scale|user-scalable/);
  });
});
