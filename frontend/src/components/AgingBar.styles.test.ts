import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SIL-1252 (id 1529) — the `.aging-bar__seg` palette is SHARED chrome (rendered
 * by /debt, /payables and any future consumer), so it must ship with the global
 * entry, never with one page's lazy CSS chunk. At HEAD the palette lived in
 * DashboardPage.css: entering /debt directly (the Kế toán landing) never loads
 * the Dashboard chunk, every seg rendered `rgba(0,0,0,0)` and the bar read as
 * an empty gray strip (QA build 61999831).
 */

const sheet = readFileSync(resolve(process.cwd(), 'src/components/AgingBar.css'), 'utf8');
const entry = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

const SEG_FILLS: Array<[string, string]> = [
  ['--ok', '--accent'],
  ['--t1', '--warning'],
  ['--t2', '--wf-amber-mid'],
  ['--t3', '--warning-deep'],
  ['--t4', '--danger'],
];

describe('SIL-1252 — aging-bar segment palette ownership', () => {
  it('keeps the five segment fills token-backed in the shared AgingBar sheet', () => {
    for (const [modifier, token] of SEG_FILLS) {
      expect(sheet, `.aging-bar__seg${modifier}`).toMatch(
        new RegExp(`\\.aging-bar__seg${modifier}\\s*\\{[^}]*background:\\s*var\\(${token}(?:,[^)]*)?\\)`),
      );
    }
  });

  it('imports the shared palette from the global entry so every route chunk sees it', () => {
    // The defect class: palette on a lazy page chunk. index.css is the
    // aggregator for className-based shared sheets (no owning .tsx) — the
    // palette must ride it, so a direct land on /debt or /payables renders
    // colored segments without ever loading the Dashboard chunk.
    expect(entry).toMatch(/@import\s+"\.\/components\/AgingBar\.css";/);
  });

  it('owns the palette in exactly one sheet — no page CSS re-declares segment fills', () => {
    for (const page of [
      'src/pages/DashboardPage.css',
      'src/pages/DebtListPage.css',
      'src/pages/PayableListPage.css',
    ]) {
      expect(readFileSync(resolve(process.cwd(), page), 'utf8'), `${page} must not re-own the palette`).not.toMatch(
        /\.aging-bar__seg--[a-z0-9]+\s*\{[^}]*background/,
      );
    }
  });
});
