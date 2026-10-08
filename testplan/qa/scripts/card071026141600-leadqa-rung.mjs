// Card 071026141600 — lead decision rung on cut 22837bc3 (decision authority
// 08/10). Productivity monthly table: % cells must stay on ONE line, header
// must not clip. Measures on staging at 6 widths using Range.getClientRects
// over TEXT nodes (MiniMax's corrected method — never cell-height/line-height).
// Read-only: navigation + measurement + screenshots.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card071026141600-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '22837bc3' });
if (!String(health.buildHash || '').startsWith('22837bc3')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hoapt', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/fleet/productivity`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4000);
  // monthly tab
  const tab = await page.evaluate(() => {
    const c = [...document.querySelectorAll('button,[role="tab"]')].filter((e) => e.offsetParent !== null).find((x) => /Từng xe trong 1 tháng/i.test((x.textContent || '').trim()));
    if (!c) return { err: 'no Tháng tab', sample: [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null).map((b) => (b.textContent || '').trim().slice(0, 16)).slice(0, 12) };
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  log('tab-probe', tab);
  if (tab.err) throw new Error('no monthly tab');
  await page.mouse.click(tab.x, tab.y);
  await sleep(2500);

  const WIDTHS = [1440, 1280, 1024, 768, 390];
  const perWidth = [];
  for (const w of WIDTHS) {
    await page.setViewport({ width: w, height: w <= 500 ? 844 : 900 });
    await sleep(1200);
    const m = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('td,th')].filter((c) => /\d+(\.\d+)?\s*%/.test(c.textContent || '') && c.offsetParent !== null);
      const wrapped = [];
      for (const c of cells) {
        for (const n of c.childNodes) {
          if (n.nodeType !== 3 || !/\d/.test(n.data || '')) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
          if (rects.length > 1) wrapped.push({ text: (n.data || '').trim().slice(0, 20), lines: rects.length });
        }
      }
      const clipped = [...document.querySelectorAll('th')].filter((c) => c.offsetParent !== null && c.scrollWidth > c.clientWidth + 1).map((c) => (c.textContent || '').trim().slice(0, 24));
      return { pctCells: cells.length, wrapped: wrapped.slice(0, 6), clippedHeaders: clipped.slice(0, 6) };
    });
    log('width', { w, ...m });
    perWidth.push({ w, ...m });
    if (w === 1440 || w === 390) await page.screenshot({ path: `${QA}/${SCOPE}_ui-${w}.png` });
  }
  const anyWrap = perWidth.some((x) => x.wrapped.length > 0);
  const anyClip = perWidth.some((x) => x.clippedHeaders.length > 0);
  if (!anyWrap && !anyClip) log('PASS-no-wrap-no-clip', { widths: WIDTHS });
  else { log('REPRO', { anyWrap, anyClip }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
