import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(`src/${path}`, 'utf8');

describe('QA-AUDIT-UI-24C shared customer/pagination control ceiling', () => {
  it('uses the canonical token for customer navigation controls and keeps the in-flow phone shell', () => {
    const css = read('pages/portal/CustomerPortalLayout.css');
    expect(css).not.toMatch(/44px|min-height:\s*52px/);
    expect(css).toMatch(/\.customer-shell__icon-button\s*\{[^}]*width:\s*var\(--control-touch-h\);[^}]*height:\s*var\(--control-touch-h\)/);
    expect(css).toMatch(/\.customer-shell__nav-item\s*\{[^}]*min-height:\s*var\(--control-touch-h\)/);
    expect(css).toMatch(/\.customer-shell__bottom-nav a\s*\{[^}]*min-height:\s*var\(--control-touch-h\)/);
    expect(css).toMatch(/\.customer-shell__bottom-nav\s*\{[^}]*position:\s*static/);
  });
  it('caps paginator buttons/jump and shared aging disclosure through the same token', () => {
    const css = read('design-system/Pagination.css');
    expect(css).not.toContain('44px');
    expect(css).toMatch(/\.ds-pagination__btn\s*\{[^}]*min-width:\s*var\(--control-touch-h\);[^}]*min-height:\s*var\(--control-touch-h\)/);
    expect(css).toMatch(/\.ds-pagination__jump input\s*\{[^}]*min-height:\s*var\(--control-touch-h\)/);
    expect(read('styles/financial-aging.css')).toMatch(/summary\s*\{[^}]*min-height:\s*var\(--control-touch-h\)/);
  });
});
