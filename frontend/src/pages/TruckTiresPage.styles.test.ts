import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

describe('tire workbench inherits house surfaces', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/pages/TruckTiresPage.css'), 'utf8');
  const page = readFileSync(resolve(process.cwd(), 'src/pages/TruckTiresPage.tsx'), 'utf8');
  it('uses shared panel and action recipes rather than private canvas paint', () => {
    expect(page.match(/className="panel ttp-panel/g)).toHaveLength(4);
    expect(page).toContain('className="panel__head ttp-section-head"');
    expect(page).toContain('className="btn btn--secondary ttp-back"');
    expect(css).not.toMatch(/\.ttp-panel\s*\{[^}]*background:/);
    expect(css).not.toMatch(/gradient\(/);
    expect(css).not.toMatch(/\b44px|translateY\(-1px\)|0 0 0 4px/);
  });
});
