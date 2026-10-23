import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '..');

// Chart geometry and vendored Untitled UI foundations may draw SVG directly;
// FinancePage keeps its donut/bar chart geometry (role="img" data charts).
const ALLOWED = [/[\\/]components[\\/]charts[\\/]/, /Sparkline\.tsx$/, /[\\/]untitled-ui[\\/]/, /[\\/]pages[\\/]FinancePage\.tsx$/];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : walk(p);
    return p.endsWith('.tsx') && !/\.test\.tsx$/.test(p) ? [p] : [];
  });
}

describe('icon sweep: icons come from lucide-react / @untitledui/icons', () => {
  it('has no hand-drawn inline <svg> outside chart geometry and vendored UI', () => {
    const offenders = walk(SRC)
      .filter((f) => !ALLOWED.some((re) => re.test(f)))
      .filter((f) => readFileSync(f, 'utf8').includes('<svg'))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('FinancePage only keeps chart svgs (role="img"), no icon svgs', () => {
    const src = readFileSync(join(SRC, 'pages/FinancePage.tsx'), 'utf8');
    const tags = src.match(/<svg\b[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) expect(t).toContain('role="img"');
  });
});
