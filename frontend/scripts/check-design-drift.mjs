// design-drift ratchet — the piecemeal guard.
//
// The operator's complaint (2026-09-27): "UI UX are all random piecemeals per
// page, not consistent, coherent at all." Audit evidence from the same day:
// 1051 raw hex occurrences across 85 page files, 818 raw border-radius
// declarations of which 343 (42%) are off the sanctioned ladder, 125 raw
// box-shadows, 49 distinct @media widths across 152 files and 26 distinct
// @container widths. None of that was visible to a reviewer, and every session
// added a little more.
//
// This script is a RATCHET, not a cleanup: it counts the divergence that
// already exists, records it in a committed baseline, and FAILS when any count
// grows. Cleaning up is free (the script prints when the baseline can be
// lowered); adding a new raw value is a deliberate, reviewable act.
//
// Usage:
//   node scripts/check-design-drift.mjs            # verify against the baseline
//   node scripts/check-design-drift.mjs --update   # rewrite the baseline
//   node scripts/check-design-drift.mjs --report   # print the census only

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FE_ROOT = resolve(HERE, '..');
const SRC = resolve(FE_ROOT, 'src');
const BASELINE = resolve(FE_ROOT, 'design-drift.baseline.json');
// The shared layer defines the system (tokens, primitives) and the vendored
// primitives are upstream code: neither is drift.
const EXCLUDED = [/^styles\//, /^design-system\//, /components\/untitled-ui\//, /\.test\./];

// The sanctioned ladders live in docs/design-system/01-tokens.md; keep these in
// step with it. Radii: r-sm 8 / r 12 / r-lg 18 / r-xl 24, badge 6, pill 999.
const SANCTIONED_RADII = new Set([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 999, 9999]);

function cssFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    if (!entry.name.endsWith('.css')) return [];
    const rel = relative(SRC, path).replaceAll('\\', '/');
    return EXCLUDED.some((pattern) => pattern.test(rel)) ? [] : [path];
  });
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Count per-file so the report can name the worst offenders. */
function censusFile(path) {
  const css = stripComments(readFileSync(path, 'utf8'));
  const declarations = css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/gi);
  const counts = {
    hexDirect: 0,
    hexFallback: 0,
    radiusOffLadder: 0,
    rawShadow: 0,
    rawZIndex: 0,
    untokenizedTransition: 0,
  };
  const mediaWidths = new Set();
  const containerWidths = new Set();

  for (const match of css.matchAll(/@media[^{]*\(([^)]*)\)/g)) {
    for (const width of match[1].matchAll(/(?:min|max)-width\s*:\s*(\d+)px/g)) mediaWidths.add(width[1]);
  }
  for (const match of css.matchAll(/@container[^{]*\(([^)]*)\)/g)) {
    for (const width of match[1].matchAll(/(?:min|max)-width\s*:\s*(\d+)px/g)) containerWidths.add(width[1]);
  }

  for (const [, prop, value] of declarations) {
    const name = prop.toLowerCase();
    const hasHex = /#[0-9a-f]{3,8}\b/i.test(value);
    if (hasHex) {
      if (/var\([^)]*#/i.test(value)) counts.hexFallback += 1;
      else counts.hexDirect += 1;
    }
    if (/^border(-[a-z]+)*-radius$/.test(name)) {
      if (!/var\(/.test(value)) {
        for (const px of value.matchAll(/(\d+(?:\.\d+)?)px/g)) {
          if (!SANCTIONED_RADII.has(Number(px[1]))) counts.radiusOffLadder += 1;
        }
      }
    }
    if (name === 'box-shadow' && !/var\(|none/.test(value)) counts.rawShadow += 1;
    if (name === 'z-index' && /^-?\d+$/.test(value.trim())) counts.rawZIndex += 1;
    if (name === 'transition' && !/var\(--t-/.test(value)) counts.untokenizedTransition += 1;
  }

  return { counts, mediaWidths, containerWidths };
}

const files = cssFiles(SRC);
const perFile = new Map();
const totals = {
  hexDirect: 0,
  hexFallback: 0,
  radiusOffLadder: 0,
  rawShadow: 0,
  rawZIndex: 0,
  untokenizedTransition: 0,
  mediaWidthValues: new Set(),
  containerWidthValues: new Set(),
};

for (const path of files) {
  const { counts, mediaWidths, containerWidths } = censusFile(path);
  const rel = relative(FE_ROOT, path).replaceAll('\\', '/');
  const interesting = Object.values(counts).some((n) => n > 0);
  if (interesting) perFile.set(rel, counts);
  for (const key of Object.keys(counts)) totals[key] += counts[key];
  for (const width of mediaWidths) totals.mediaWidthValues.add(width);
  for (const width of containerWidths) totals.containerWidthValues.add(width);
}

const measured = {
  scannedFiles: files.length,
  hexDirect: totals.hexDirect,
  hexFallback: totals.hexFallback,
  radiusOffLadder: totals.radiusOffLadder,
  rawShadow: totals.rawShadow,
  rawZIndex: totals.rawZIndex,
  untokenizedTransition: totals.untokenizedTransition,
  mediaWidthValues: totals.mediaWidthValues.size,
  containerWidthValues: totals.containerWidthValues.size,
};

const args = process.argv.slice(2);
const wantReport = args.includes('--report');
const wantUpdate = args.includes('--update');

const worst = [...perFile.entries()]
  .map(([file, counts]) => ({ file, score: counts.hexDirect * 3 + counts.radiusOffLadder + counts.rawShadow * 2 + counts.rawZIndex }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 10);

console.log(`design-drift: ${measured.scannedFiles} page CSS files scanned`);
for (const [key, value] of Object.entries(measured)) {
  if (key !== 'scannedFiles') console.log(`  ${key.padEnd(24)} ${value}`);
}
console.log('  worst files             ' + worst.slice(0, 4).map((w) => `${w.file}(${w.score})`).join(' '));

if (wantReport) process.exit(0);

if (wantUpdate || !existsSync(BASELINE)) {
  writeFileSync(BASELINE, `${JSON.stringify({ note: 'Ratchet: counts may fall, never rise. Regenerate with `pnpm design:drift --update` after a deliberate cleanup.', measured, worstFiles: worst }, null, 2)}\n`);
  console.log(`design-drift: baseline written to ${relative(FE_ROOT, BASELINE)}`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).measured;
const grown = Object.entries(measured).filter(([key, value]) => key !== 'scannedFiles' && value > (baseline[key] ?? 0));
const shrunk = Object.entries(measured).filter(([key, value]) => key !== 'scannedFiles' && value < (baseline[key] ?? 0));

if (grown.length) {
  console.error('\n✗ design drift GREW — a raw value or a new breakpoint entered a page stylesheet.');
  for (const [key, value] of grown) console.error(`  ${key}: ${baseline[key]} → ${value}`);
  console.error('\n  Use a token/primitive instead (docs/design-system/01-tokens.md), or, if this is a');
  console.error('  deliberate system change, update the ladder in docs AND run: pnpm design:drift --update');
  process.exit(1);
}

if (shrunk.length) {
  console.log('\ndesign drift fell — lower the baseline with: pnpm design:drift --update');
  for (const [key, value] of shrunk) console.log(`  ${key}: ${baseline[key]} → ${value}`);
}
console.log('design drift: no growth.');
