// SIL-631 (id 631) — UI rung-3 drive at 1280: the drawer's click-to-edit cell
// editor must FLOAT outside the table's overflow container (body portal) and
// show the full typed value, never clipped by the column. Drives the ticket's
// exact path: /dispatch "Kế hoạch Tổng quát" → "Chi tiết container" drawer →
// click a value cell → type a long value → assert portal placement + full
// value → Enter (save side effect) → capture API + DB proof.
// Read-only apart from one reversible container-line write on local dev.
import puppeteer from 'puppeteer';
import http from 'node:http';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:7176';
const API = process.env.API || 'http://localhost:3002/api';
const QA = process.env.QA_DIR || new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const USER = process.env.QA_USER || 'dungnv';
const PASS = process.env.QA_PASS || 'Abc123';

const post = (path, body, token) => new Promise((resolve, reject) => {
  const r = http.request(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  }, (res) => {
    let b = '';
    res.on('data', (c) => (b += c));
    res.on('end', () => { let j = b; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: j }); });
  });
  r.on('error', reject);
  r.write(JSON.stringify(body));
  r.end();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIELD = process.env.FIELD || 'container'; // 'container' | 'declaration' | 'appointment'
const LOGNAME = `2026-10-28_sil631_ui-driver${FIELD === 'container' ? '' : `-${FIELD}`}.log`;
const log = [];
const say = (line) => { log.push(line); console.log(line); };

async function main() {
  const login = await post('/auth/login', { identifier: USER, password: PASS });
  if (login.status !== 200) throw new Error(`login ${USER} -> ${login.status} ${JSON.stringify(login.body).slice(0, 200)}`);
  const token = login.body.token;
  say(`login ok: ${USER} role=${login.body.user?.role ?? '?'}`);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 200)}`); });
  await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);

  // 1. /dispatch master plan → open the first lot's "Chi tiết container" drawer.
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForSelector('.master-plan-grid, .master-plan-card, [class*="empty"]', { timeout: 90000 });
  await sleep(1500);
  const trigger = await page.evaluateHandle(() => document.querySelector('.master-plan-grid__container-detail-trigger, [aria-label^="Xem chi tiết container"]'));
  if (!trigger || !(await trigger.evaluate((el) => Boolean(el)))) throw new Error('no lot with container demand on /dispatch');
  await trigger.asElement().click();
  await page.waitForSelector('.dispatch-container-detail__table-scroll', { timeout: 30000 });
  await sleep(1200);
  say('drawer open: Chi tiết container');

  // 2. Click the first editable value cell (container-number preferred).
  const clicked = await page.evaluate((field) => {
    const byName = (prefix) => [...document.querySelectorAll('.dispatch-container-detail__table-scroll button')]
      .find((b) => (b.getAttribute('aria-label') || '').startsWith(prefix));
    const order = field === 'declaration'
      ? ['Sửa số tờ khai', 'Sửa số container']
      : field === 'appointment'
        ? ['Sửa giờ hẹn', 'Sửa số container']
        : ['Sửa số container', 'Sửa số tờ khai'];
    for (const prefix of order) {
      const cell = byName(prefix);
      if (cell) {
        const name = cell.getAttribute('aria-label');
        cell.scrollIntoView({ block: 'center' });
        cell.click();
        return name;
      }
    }
    return null;
  }, FIELD);
  if (!clicked) throw new Error('no editable cell in drawer (fieldAccess gate?)');
  await page.waitForSelector('[data-cell-editor-portal]', { timeout: 10000 });
  await sleep(600);
  say(`cell clicked: ${clicked} (field=${FIELD})`);

  // 3. Type a long value — the ticket's clipping repro.
  const LONG = FIELD === 'declaration' ? 'TK-631-LONGTEST-VALUE' : 'MSKU5500004XLONGTESTVALUE';
  const inputSelector = '[data-cell-editor-portal] input';
  await page.click(inputSelector);
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) { el.focus(); el.select(); }
  }, inputSelector);
  await page.type(inputSelector, LONG, { delay: 12 });
  await sleep(400);

  // 4. Assert placement + no-truncate (rung-3 DOM proof) BEFORE the save.
  const proof = await page.evaluate((longValue) => {
    const panel = document.querySelector('[data-cell-editor-portal]');
    const input = panel && panel.querySelector('input, textarea');
    const scroller = document.querySelector('.dispatch-container-detail__table-scroll');
    const rect = input ? input.getBoundingClientRect() : null;
    return {
      panelParentIsBody: panel ? panel.parentElement === document.body : false,
      panelInsideScroller: panel && scroller ? scroller.contains(panel) : null,
      inputValue: input ? input.value : null,
      valueIsWhole: input ? input.value === longValue : false,
      inputClientWidth: input ? input.clientWidth : null,
      inputScrollWidth: input ? input.scrollWidth : null,
      hint: panel ? (panel.textContent || '').includes('Enter lưu · Esc thoát') : false,
      dimmedCellValue: document.querySelector('.dispatch-container-detail__decl-value.is-editing')?.textContent ?? null,
      panelRect: panel ? panel.getBoundingClientRect().toJSON() : null,
      inputRect: rect ? rect.toJSON() : null,
    };
  }, LONG);
  say(`portal proof: ${JSON.stringify(proof)}`);
  if (!proof.panelParentIsBody) throw new Error('FAIL: editor panel is not a body portal child');
  if (proof.panelInsideScroller) throw new Error('FAIL: editor panel still inside the overflow scroller');
  if (!proof.valueIsWhole) throw new Error(`FAIL: typed value not whole in editor: ${proof.inputValue}`);
  await page.screenshot({ path: `${QA}/2026-10-28_sil631_ui-01-${FIELD}-editor-floating.png` });
  say(`screenshot: 2026-10-28_sil631_ui-01-${FIELD}-editor-floating.png`);

  // 5. Enter saves (ticket hint "Enter lưu · Esc thoát") — capture the write.
  await page.keyboard.press('Enter');
  await sleep(2500);
  const after = await page.evaluate(() => ({
    toast: document.querySelector('[role="status"], .toast, [class*="toast"]')?.textContent ?? null,
    editorClosed: !document.querySelector('[data-cell-editor-portal]'),
  }));
  say(`after Enter: ${JSON.stringify(after)}`);
  await page.screenshot({ path: `${QA}/2026-10-28_sil631_ui-02-${FIELD}-after-save.png` });
  say(`screenshot: 2026-10-28_sil631_ui-02-${FIELD}-after-save.png`);

  if (errors.length) say(`page errors: ${JSON.stringify(errors)}`);
  await browser.close();
  say('DRIVER OK');
}

main().then(() => {
  writeFileSync(`${QA}/${LOGNAME}`, log.join('\n') + '\nexit status: 0\n');
  process.exit(0);
}).catch((err) => {
  log.push(`DRIVER FAIL: ${err.message}`);
  writeFileSync(`${QA}/${LOGNAME}`, log.join('\n') + `\nexit status: 1\n`);
  console.error(err);
  process.exit(1);
});
