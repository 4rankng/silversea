import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/WorkflowFinance.css'), 'utf8');

describe('profitability report overflow contract', () => {
  it('wraps customer, source, and margin-status content instead of clipping it', () => {
    // Whitespace-tolerant: these rules are hand-maintained overrides, not
    // minified output, so the formatter is free to space after the colon.
    // The intent — every one of these surfaces WRAPS instead of clipping.
    const strong = css.match(/html \.workflow-profitability__table td:first-child>strong\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(strong, 'customer-name override exists').not.toBe('');
    expect(strong).toMatch(/overflow:\s*visible;/);
    // `clip`, never `ellipsis`/`hidden` — an ellipsis would re-truncate the
    // very customer name this rule exists to show in full.
    expect(strong).toMatch(/text-overflow:\s*clip;/);
    expect(strong).toMatch(/white-space:\s*normal;/);
    expect(strong).toMatch(/overflow-wrap:\s*anywhere/);
    // The final declaration in each of these compact rules carries no
    // trailing semicolon, so anchor on the property, not on `;`.
    expect(css).toMatch(/html \.workflow-profitability__table td small\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/html \.workflow-profitability__table \.workflow-profitability__sources,\s*html \.workflow-profitability__table \.workflow-profitability__sources a\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere/);
  });
});
