import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(`src/${path}`, 'utf8');

describe('QA-AUDIT-UI-24C shared customer/pagination control ceiling', () => {
  it('uses the canonical token for customer navigation controls and keeps the phone tab bar on the fixed layer', () => {
    const css = read('pages/portal/CustomerPortalLayout.css');
    expect(css).not.toMatch(/44px|min-height:\s*52px/);
    expect(css).toMatch(/\.customer-shell__icon-button\s*\{[^}]*width:\s*var\(--control-touch-h\);[^}]*height:\s*var\(--control-touch-h\)/);
    expect(css).toMatch(/\.customer-shell__nav-item\s*\{[^}]*min-height:\s*var\(--control-touch-h\)/);
    expect(css).toMatch(/\.customer-shell__bottom-nav a\s*\{[^}]*min-height:\s*var\(--control-touch-h\)/);
    // Fixed layer, not in flow: docs/design-guidelines.md 2026-10-03 "§5 mechanism
    // revision — the phone tab bar returns to the fixed layer" (card 20260927_149,
    // real-iPhone evidence) supersedes the 2026-09-28 in-flow interim (e4d9a6c8)
    // this pin once asserted. The pin of record for this contract is
    // components/layout/bottom-nav.styles.test.ts ("customer portal bar follows the
    // same fixed pattern"); this line follows the same ruling.
    expect(css).toMatch(/\.customer-shell__bottom-nav\s*\{[^}]*position:\s*fixed/);
  });
  it('caps paginator buttons/jump and shared aging disclosure through the same token', () => {
    const css = read('design-system/Pagination.css');
    expect(css).not.toContain('44px');
    expect(css).toMatch(/\.ds-pagination__btn\s*\{[^}]*min-width:\s*var\(--control-touch-h\);[^}]*min-height:\s*var\(--control-touch-h\)/);
    expect(css).toMatch(/\.ds-pagination__jump input\s*\{[^}]*min-height:\s*var\(--control-touch-h\)/);
    expect(read('styles/financial-aging.css')).toMatch(/summary\s*\{[^}]*min-height:\s*var\(--control-touch-h\)/);
  });
});
