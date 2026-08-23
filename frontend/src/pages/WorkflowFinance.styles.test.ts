import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/WorkflowFinance.css'), 'utf8');

describe('profitability report overflow contract', () => {
  it('wraps customer, source, and margin-status content instead of clipping it', () => {
    expect(css).toContain('html .workflow-profitability__table td:first-child>strong{max-width:100%;overflow:visible;text-overflow:clip;white-space:normal;overflow-wrap:anywhere}');
    expect(css).toContain('html .workflow-profitability__table td small{min-width:0;white-space:normal;overflow-wrap:anywhere}');
    expect(css).toContain('html .workflow-profitability__table .workflow-profitability__sources,html .workflow-profitability__table .workflow-profitability__sources a{min-width:0;white-space:normal;overflow-wrap:anywhere}');
  });
});
