import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/design-system/forms/UuiSelectField.css'), 'utf8');

// Card 20260924_1 (image1, HIGH) — the shared untitled-ui Popover pins its
// box to the trigger width (w-(--trigger-width)) with overflow-x-hidden, so
// an option longer than a narrow trigger clipped mid-word with no ellipsis
// ("Có hóa đơn · Nâ"). The adapter's default popover class widens the box
// with max-content: min-width floors the trigger width for short options and
// lets long options size the popover. CSS-only — no select logic touched.
// Design law §4 (docs/design-guidelines.md): values are never clipped.
describe('select popover never clips an option label (card 20260924_1, image1)', () => {
  it('the default popover class grows past the trigger with min-width: max-content', () => {
    expect(css).toMatch(/\.ds-uui-select__popover\s*\{[^}]*min-width:\s*max-content/);
  });
});

describe('UuiSelectField leading icon (card 20260926_57)', () => {
  it('forwards the icon prop to both control branches', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/design-system/forms/UuiSelectField.tsx'), 'utf8');
    // declared + destructured + forwarded to the ComboBox and the Select branch
    expect(src).toMatch(/icon\?: ReactNode/);
    expect(src.match(/icon=\{icon\}/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
