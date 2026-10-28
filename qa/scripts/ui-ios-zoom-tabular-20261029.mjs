// SIL-558 (iOS input focus zoom) + SIL-562 (tabular-nums) — scoped UI probe.
// Drives the real /shipments surface at 390 and 1280 through the real login
// form, then asserts the computed values the two tickets pin:
//   SIL-558 — the search field computes 16px at 390 (the iOS focus-zoom floor;
//             Safari zooms a focused field below 16px, and the viewport zoom
//             lock is gone). Desktop 1280 keeps its compact scale.
//   SIL-562 — .ds-tabs__count and a data cell compute font-variant-numeric:
//             tabular-nums (live counts and numeric/date cells stop
//             reflowing between refreshes).
// Evidence: qa/2026-10-29_sil558-sil562_*.png / _driver.log
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7285';
const PASS = process.env.QA_PASS || 'Abc123';
const USER = process.env.QA_USER || 'admin';
const OUT = resolve('qa');

const log = [];
const say = (line) => { log.push(line); console.log(line); };

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new' });
const results = { sil558: {}, sil562: {} };

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) errors.push(`api ${r.status()} ${r.url().slice(0, 140)}`); });

  // Real login through the form.
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.type('input[name="username"]', USER);
  await page.type('input[name="password"]', PASS);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 1500));
  say(`login ok → ${new URL(page.url()).pathname}`);

  // ── /shipments at 1280 ──────────────────────────────────────────────────
  await page.goto(`${FE}/shipments`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1800));

  // SIL-562 at 1280: count + data cell computed font-variant-numeric.
  results.sil562.desktop = await page.evaluate(() => {
    const cs = (el) => (el ? getComputedStyle(el).fontVariantNumeric : 'MISSING');
    return { count: cs(document.querySelector('.ds-tabs__count')), td: cs(document.querySelector('table tbody td')) };
  });
  say(`SIL-562 @1280 computed font-variant-numeric: ${JSON.stringify(results.sil562.desktop)}`);
  await page.screenshot({ path: `${OUT}/2026-10-29_sil562_ui-shipments-1280.png` });
  say('screenshot qa/2026-10-29_sil562_ui-shipments-1280.png');

  // Desktop sanity for SIL-558: the touch band must NOT fire on pointer:fine.
  results.sil558.desktop = await page.evaluate(() => {
    const input = document.querySelector('.filter-bar__search input, .toolbar__search input, input[type="search"], .input');
    return input ? getComputedStyle(input).fontSize : 'MISSING';
  });
  say(`SIL-558 @1280 search/control font-size (desktop, unchanged expected): ${results.sil558.desktop}`);
  await page.screenshot({ path: `${OUT}/2026-10-29_sil558_ui-shipments-1280.png` });
  say('screenshot qa/2026-10-29_sil558_ui-shipments-1280.png');

  // ── /shipments at 390 (the ≤640px half of the band fires on width) ──────
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 900));
  results.sil558.mobile = await page.evaluate(() => {
    const input = document.querySelector('.filter-bar__search input, .toolbar__search input, input[type="search"], .input');
    if (!input) return { fontSize: 'MISSING' };
    input.focus();
    const cs = getComputedStyle(input);
    return {
      fontSize: cs.fontSize,
      focused: document.activeElement === input,
      tag: input.tagName.toLowerCase(),
      cls: String(input.className).slice(0, 60),
    };
  });
  say(`SIL-558 @390 focused field computed: ${JSON.stringify(results.sil558.mobile)}`);
  await page.screenshot({ path: `${OUT}/2026-10-29_sil558_ui-shipments-390.png` });
  say('screenshot qa/2026-10-29_sil558_ui-shipments-390.png');

  // SIL-562 at 390: the phone layout renders record cards — the tab count is
  // not in the DOM at this width, so assert only when it renders.
  results.sil562.mobile = await page.evaluate(() => {
    const cs = (el) => (el ? getComputedStyle(el).fontVariantNumeric : 'MISSING');
    return { count: cs(document.querySelector('.ds-tabs__count')), td: cs(document.querySelector('table tbody td')) };
  });
  say(`SIL-562 @390 computed font-variant-numeric: ${JSON.stringify(results.sil562.mobile)}`);
  say(results.sil562.mobile.count === 'MISSING'
    ? 'note: .ds-tabs__count not rendered at 390 (record-card layout) — the 1280 assertion carries the count rule'
    : 'note: count rendered at 390');

  results.errors = errors;
  say(errors.length ? `ERRORS: ${errors.join(' | ')}` : 'no console/api errors');
} finally {
  await browser.close();
}

const checks = [
  ['SIL-558 @390 focused field = 16px', /^16px$/.test(results.sil558.mobile?.fontSize ?? '')],
  ['SIL-558 @1280 desktop untouched (not 16px)', Boolean(results.sil558.desktop) && results.sil558.desktop !== '16px' && results.sil558.desktop !== 'MISSING'],
  ['SIL-562 @1280 count tabular-nums', results.sil562.desktop?.count === 'tabular-nums'],
  ['SIL-562 @1280 data cell tabular-nums', results.sil562.desktop?.td === 'tabular-nums'],
  ['SIL-562 @390 count tabular-nums (or record-card layout hides it)', results.sil562.mobile?.count === 'tabular-nums' || results.sil562.mobile?.count === 'MISSING'],
  ['SIL-562 @390 data cell tabular-nums', results.sil562.mobile?.td === 'tabular-nums'],
];
let failed = 0;
for (const [name, ok] of checks) { say(`${ok ? 'PASS' : 'FAIL'} — ${name}`); if (!ok) failed += 1; }
say(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
writeFileSync(`${OUT}/2026-10-29_sil558-sil562_ui-driver.log`, log.join('\n') + '\n');
process.exit(failed === 0 ? 0 : 1);
