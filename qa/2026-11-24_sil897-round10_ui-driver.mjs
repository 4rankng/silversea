// CR-010.1 SIL-897 (b)+(d) — staging repro driver (READ-ONLY).
// Build under test: vantai.tingting.vip buildHash 224c2c3c (origin/main HEAD,
// carries r9 sweep e6e583b0 + r10 reset cfda1ac2 + widths 03ed3b61).
//   (b) filtered grid parked at scrollLeft=600: do group/sub labels straddle
//       the dock edge WITHOUT data-occluded (QA: 'PHÍ CSHT'→'SHT',
//       'PHÍ CHI HỘ (CÓ HÓA ĐƠN)'→'PHÍ CH…')?
//   (d) unfiltered grid scrolled, then a keyword typed: does CƯỚC PHẢI THU
//       collapse behind the dock (QA round 10 "về 0"), or does the r10 reset
//       re-enter left?
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire('/Volumes/LexarSSD/projects/silversea/package.json');
const puppeteer = require('puppeteer');

const BASE = 'https://vantai.tingting.vip';
const OUT = path.resolve(import.meta.dirname);
const LOG = [];
const log = (step, obj = {}) => { LOG.push({ step, ...obj }); console.log(JSON.stringify({ step, ...obj })); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'hoapt', password: 'Abc123' }),
});
if (!login.ok) { log('STOP_login', { status: login.status }); process.exit(2); }
const { token } = await login.json();
log('login_ok');

const browser = await puppeteer.launch({ headless: true, args: ['--window-size=1600,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(`${BASE}/accounting/ghep-bo-debit`, { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => { localStorage.setItem('token', t); }, token);
await page.goto(`${BASE}/accounting/ghep-bo-debit`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.debit-merge__pane', { timeout: 20000 });
await sleep(800);

const snapshot = (label) => page.evaluate((name) => {
  const pane = document.querySelector('.debit-merge__pane');
  const table = document.querySelector('.debit-merge__table');
  const zoneEdge = table?.querySelector('thead th[data-sticky-last]')?.getBoundingClientRect().right
    ?? pane?.getBoundingClientRect().left ?? 0;
  const grab = (selector) => [...(table?.querySelectorAll(selector) ?? [])].map((th) => {
    const el = th.querySelector('.debit-merge__head-label');
    if (el == null) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      text: el.textContent,
      left: Math.round(r.left * 10) / 10,
      right: Math.round(r.right * 10) / 10,
      occludedAttr: el.hasAttribute('data-occluded'),
      visibility: cs.visibility,
      straddles: r.left < zoneEdge - 0.5 && r.right > zoneEdge + 0.5,
      underDock: r.right <= zoneEdge + 0.5,
    };
  }).filter(Boolean);
  return {
    name,
    scrollLeft: pane?.scrollLeft ?? -1,
    clientWidth: pane?.clientWidth ?? 0,
    scrollWidth: pane?.scrollWidth ?? 0,
    zoneEdge: Math.round(zoneEdge * 10) / 10,
    groups: grab('thead tr.debit-merge__groups-row th:not([data-sticky])'),
    subs: grab('thead tr.debit-merge__subs-row th:not([data-sticky])'),
    leaks: grab('thead tr.debit-merge__groups-row th:not([data-sticky]), thead tr.debit-merge__subs-row th:not([data-sticky])')
      .filter((l) => l.straddles && !l.occludedAttr),
  };
}, label);

const SEARCH = 'input[type="search"][aria-label="Tìm lô theo số Bill, container hoặc khách hàng"]';

// ── (d) unfiltered grid: scroll, then type a keyword ────────────────────────
log('D_S0_rest', await snapshot('D_S0_rest'));
await page.evaluate(() => { const p = document.querySelector('.debit-merge__pane'); p.scrollLeft = 600; });
await sleep(350);
log('D_S1_scrolled600', await snapshot('D_S1_scrolled600'));
await page.click(SEARCH);
await page.type(SEARCH, '9000', { delay: 120 });
await sleep(600);
log('D_S2_typed_while_scrolled', await snapshot('D_S2_typed_while_scrolled'));
await sleep(600);
log('D_S3_after_settle', await snapshot('D_S3_after_settle'));
await page.evaluate((sel) => {
  const input = document.querySelector(sel);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, SEARCH);
await sleep(600);
log('D_S4_cleared', await snapshot('D_S4_cleared'));

// ── (b) filtered grid parked at scrollLeft=600 ──────────────────────────────
await page.click(SEARCH);
await page.type(SEARCH, '9000', { delay: 120 });
await sleep(700);
log('B_S0_filtered_rest', await snapshot('B_S0_filtered_rest'));
await page.evaluate(() => { const p = document.querySelector('.debit-merge__pane'); p.scrollLeft = 600; });
await sleep(120); // mid-frame, before the rAF sweep
log('B_S1_filtered_scrolled600_raw', await snapshot('B_S1_filtered_scrolled600_raw'));
await sleep(500);
log('B_S2_filtered_scrolled600_settled', await snapshot('B_S2_filtered_scrolled600_settled'));
await page.screenshot({ path: path.join(OUT, '2026-11-24_sil897-round10_b-filtered-600.png') });
// also try a couple of scroll positions QA-adjacent (500/700)
for (const pos of [500, 700]) {
  await page.evaluate((v) => { document.querySelector('.debit-merge__pane').scrollLeft = v; }, pos);
  await sleep(500);
  log(`B_S${pos}_settled`, await snapshot(`B_S${pos}_settled`));
}
await page.screenshot({ path: path.join(OUT, '2026-11-24_sil897-round10_b-700.png') });

fs.writeFileSync(path.join(OUT, '2026-11-24_sil897-round10_ui-driver.log'), `${LOG.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');
await browser.close();
log('DRIVER_OK');
