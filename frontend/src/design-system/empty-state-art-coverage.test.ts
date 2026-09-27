import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Empty-state art coverage (docs/design-guidelines.md §6): every empty state
 * renders the shared art through `lib/emptyIllustrations`, and no surface
 * renders a bare title+description block.
 *
 * Why a source-level guard: the failure mode is a *new* call site that forgets
 * `context`, and it is invisible in review — the surface just looks plainer
 * than its neighbours. Measured 2026-09-27: 72 call sites, 21 with no art.
 */

const SRC = resolve(process.cwd(), 'src');
// The design-system preview page exists to SHOW the variants (icon-only,
// preview shapes) side by side — it is the one legitimate art-less host.
const ALLOWED_ART_LESS = [join('pages', '_designSystemPreview.tsx')];

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith('.tsx') && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

describe('empty-state art coverage', () => {
  it('every <EmptyState> call site resolves art from the shared resolver', () => {
    const offenders: string[] = [];
    let total = 0;

    for (const path of tsxFiles(SRC)) {
      const source = readFileSync(path, 'utf8');
      const rel = relative(SRC, path);
      if (ALLOWED_ART_LESS.includes(rel)) continue;
      for (const match of source.matchAll(/<EmptyState\b[\s\S]*?\/>/g)) {
        total += 1;
        const block = match[0];
        // `context=` is the typed resolver key; `illustration=` is the legacy
        // key the resolver still understands. Either counts as art.
        if (!/\bcontext=|\billustration=/.test(block)) {
          const line = source.slice(0, match.index).split('\n').length;
          const title = (block.match(/title="([^"]{0,60})/) || [])[1] ?? '';
          offenders.push(`${rel}:${line} "${title}"`);
        }
      }
    }

    // Sanity: the scan must actually see the call sites (a broken glob would
    // otherwise make this test vacuously green).
    expect(total).toBeGreaterThan(50);
    expect(offenders, `empty states without shared art:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('every resolver context points at a file that exists in public/', () => {
    const source = readFileSync(resolve(SRC, 'lib/emptyIllustrations.ts'), 'utf8');
    const paths = new Set<string>();
    // The table builds paths from `BASE` (`${BASE}/empty-1.png`) and spells a
    // few bespoke slots out in full — read both, or the scan is vacuous.
    for (const m of source.matchAll(/`\$\{BASE\}(\/[A-Za-z0-9._-]+)`/g)) paths.add(m[1]);
    for (const m of source.matchAll(/'(\/assets\/illustrations\/[^']+)'/g)) paths.add(m[1]);
    // Every category (4 PNG + 8 webp) and every bespoke slot must be reachable
    // from the scan; a silent regex break would otherwise pass.
    expect(paths.size).toBeGreaterThanOrEqual(15);
    const seen: Record<string, true> = {};
    for (const assetPath of paths) {
      if (seen[assetPath]) continue;
      seen[assetPath] = true;
      const onDisk = resolve(process.cwd(), 'public/assets/illustrations', assetPath.replace(/^\//, ''));
      expect(() => readFileSync(onDisk), `${assetPath} is missing from public/`).not.toThrow();
      expect(readFileSync(onDisk).byteLength, `${assetPath} is empty`).toBeGreaterThan(0);
    }
  });
});
