// Card 091026091550 — lead staging QA. Dispatch plan-board headers hold ONE
// line: on /dispatch (8 headers) and /dispatch-detail (9 headers), no header
// cell wraps at 1280/1440.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-09_card091026091550-dispatch-headers';
const EXPECT = '26d3f1f7';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: EXPECT });
if (!String(health.buildHash || '').startsWith(EXPECT)) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  const checkPage = async (path, w) => {
    await page.setViewport({ width: w, height: 900 });
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(5000);
    const audit = await page.evaluate(() => {
      // scope to the plan-board table: the table whose thead holds the
      // 'THỜI GIAN & LỊCH TRÌNH' header (case-insensitive)
      const tables = [...document.querySelectorAll('table')];
      const target = tables.find((t) => /thời gian\s*&\s*lịch trình/i.test(t.querySelector('thead')?.textContent || ''));
      if (!target) return { err: 'no plan-board table', tables: tables.length };
      const headers = [...target.querySelectorAll('thead th')].map((th) => {
        const r = th.getBoundingClientRect();
        // a header "wraps" when its content flows to 2+ lines. The card's
        // own HEAD measurement put the wrapped header row at ~51px and the
        // one-line row at ~36px; decide by Range client rects (line count)
        const range = document.createRange();
        range.selectNodeContents(th);
        const lineTops = new Set([...range.getClientRects()].filter((x) => x.height > 4).map((x) => Math.round(x.top)));
        const oneLine = lineTops.size <= 1 && r.height < 45;
        return { text: (th.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30), h: Math.round(r.height), oneLine, clipped: r.width === 0 };
      });
      return { headers };
    });
    log('headers', { path, w, ...audit });
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-${path.replaceAll('/', '')}-${w}.png` });
    return audit;
  };

  const d1280 = await checkPage('/dispatch', 1280);
  const d1440 = await checkPage('/dispatch', 1440);
  const dd1280 = await checkPage('/dispatch-detail', 1280);
  const dd1440 = await checkPage('/dispatch-detail', 1440);

  const all = [d1280, d1440, dd1280, dd1440];
  const bad = all.filter((a) => a.err || (a.headers ?? []).some((h) => !h.oneLine || h.clipped));
  log('verdict-input', { counts: all.map((a) => a.headers?.length), bad: bad.length });
  if (!bad.length && all.every((a) => (a.headers?.length ?? 0) >= 8)) log('PASS-one-line-headers', {});
  else { log('FAIL', { bad }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
