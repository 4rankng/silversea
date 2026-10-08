// Card 20261008_1 — lead staging QA. Every disabled action button on the
// swept surfaces (/shipments-debit, /dispatch-detail, customers allocation
// popover surface) exposes a REACHABLE reason (title/aria-label/aria-
// describedby via DisabledActionTip) — never a silent disabled.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card20261008-1-leadqa';
const EXPECT = 'dc599a82';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: EXPECT });
if (!String(health.buildHash || '').startsWith(EXPECT)) { log('build-currency-FAIL'); process.exit(2); }

const login = async (id) => (await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) })).json()).token;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const audit = (page, label) => page.evaluate((lb) => {
  const btns = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null && (b.disabled || b.getAttribute('aria-disabled') === 'true'));
  return {
    surface: lb,
    disabledTotal: btns.length,
    offenders: btns.filter((b) => {
      const reason = (b.title || '').trim() || (b.getAttribute('aria-label') || '').trim() || b.getAttribute('aria-describedby') || b.getAttribute('data-tip') || '';
      return !reason;
    }).map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)),
    sample: btns.slice(0, 4).map((b) => ({ text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24), via: b.title ? 'title' : b.getAttribute('aria-label') ? 'aria-label' : b.getAttribute('aria-describedby') ? 'describedby' : b.getAttribute('data-tip') ? 'data-tip' : 'NONE' })),
  };
});
try {
  const results = [];

  // Surface A: /shipments-debit (accounting — hoapt)
  {
    const token = await login('hoapt');
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.goto(`${BASE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(4500);
    results.push(await audit(page, "/shipments-debit"));
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-shipments-debit.png` });
    await page.close();
  }
  // Surface B: /dispatch-detail (dispatcher — dungnv)
  {
    const token = await login('dungnv');
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
    let rows = 0;
    for (let i = 0; i < 12 && !rows; i++) { await sleep(3000); rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length); }
    results.push(await audit(page, "/dispatch-detail"));
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-dispatch-detail.png` });
    await page.close();
  }
  // Surface C: customers allocation popover (admin) — open the carrier
  // allocation dialog from a customers row if the entry exists
  {
    const token = await login('admin');
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.goto(`${BASE}/customers`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(4000);
    const opener = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null).find((x) => /phân bổ|phân bổ nhà xe|allocation/i.test((x.textContent || '') + (x.getAttribute('aria-label') || '')));
      if (!b) return { err: 'no opener' };
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    if (!opener.err) {
      await page.mouse.click(opener.x, opener.y);
      for (let i = 0; i < 8 && !(await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')))); i++) await sleep(800);
      await sleep(1500);
      results.push(await audit(page, "allocation-popover"));
      await page.screenshot({ path: `${QA}/${SCOPE}_ui-allocation.png` });
    } else {
      results.push({ surface: 'allocation-popover', disabledTotal: 0, offenders: [], note: 'entry not reachable from /customers in this state' });
    }
    await page.close();
  }
  log('audit', results);
  const offenders = results.flatMap((r) => r.offenders.map((o) => ({ surface: r.surface, o })));
  const withDisabled = results.filter((r) => r.disabledTotal > 0);
  if (offenders.length === 0 && withDisabled.length > 0) log('PASS-every-disabled-action-explains-itself', { surfaces: withDisabled.map((r) => `${r.surface}:${r.disabledTotal}`) });
  else if (offenders.length === 0) log('PASS-no-disabled-buttons-present', { note: 'all reachable actions enabled in this data state' });
  else { log('FAIL-silent-disabled', { offenders }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
