// Card 071026210510 — lead staging QA on cut 77bcdb85: the expense dialog
// answers the grant BEFORE typing. As hoangnh (OPS), open 'Khai chi phí' on
// lots not under their trucks → banner 'Lô này không thuộc xe bạn phụ trách…'
// immediately + Lưu disabled + form disabled. Non-mutating: dialog closes via
// Hủy only (Lưu stays disabled).
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_kb210510-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '77bcdb85' });
if (!String(health.buildHash || '').startsWith('77bcdb85')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hoangnh', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1100 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/ops/orders`, { waitUntil: 'networkidle2', timeout: 90000 });
  let rows = 0;
  for (let i = 0; i < 15 && !rows; i++) { await sleep(3000); rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length); }
  log('list', { rows });
  if (!rows) throw new Error('ops orders list empty');

  const results = [];
  for (let r = 0; r < Math.min(3, rows); r++) {
    // open the dialog from row r via its Khai chi phí button (real tap)
    const btnPt = await page.evaluate((idx) => {
      const tr = [...document.querySelectorAll('tbody tr')].filter((e) => e.offsetParent !== null)[idx];
      if (!tr) return null;
      const b = [...tr.querySelectorAll('button')].find((x) => /Khai chi phí/.test(x.textContent || ''));
      if (!b) return { err: 'no-button', rowText: (tr.textContent || '').replace(/\s+/g, ' ').slice(0, 60) };
      tr.scrollIntoView({ block: 'center' });
      const rr = tr.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const hit = document.elementsFromPoint(br.x + br.width / 2, br.y + br.height / 2)[0];
      if (!hit || !(hit === b || b.contains(hit))) return { err: 'covered', rowText: (tr.textContent || '').slice(0, 60) };
      return { x: Math.round(br.x + br.width / 2), y: Math.round(br.y + br.height / 2), rowText: (tr.textContent || '').replace(/\s+/g, ' ').slice(0, 60) };
    }, r);
    log(`row${r}-probe`, btnPt);
    if (!btnPt || btnPt.err || !btnPt.x) continue;
    await page.mouse.move(btnPt.x, btnPt.y); await page.mouse.down(); await page.mouse.up();
    // wait for the dialog
    let dlgOpen = false;
    for (let i = 0; i < 10 && !dlgOpen; i++) { await sleep(1000); dlgOpen = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]'))); }
    if (!dlgOpen) { results.push({ row: r, verdict: 'no-dialog' }); continue; }
    await sleep(1800); // let the write-scope probe land
    const scan = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      if (!dlg) return null;
      const text = dlg.textContent || '';
      const banner = text.includes('không thuộc xe bạn phụ trách');
      const save = [...dlg.querySelectorAll('button')].find((b) => /^Lưu$/.test((b.textContent || '').trim()));
      const fs = dlg.querySelector('fieldset');
      return {
        banner,
        bannerText: (text.match(/[^.]*không thuộc xe[^.]*\./) ?? [''])[0].trim(),
        saveDisabled: save ? save.disabled : null,
        fieldsetDisabled: fs ? fs.disabled : null,
        savePresent: Boolean(save),
      };
    });
    log(`row${r}-dialog-scan`, scan);
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-row${r}-dialog.png` });
    results.push({ row: r, rowText: btnPt.rowText, ...scan });
    // close via non-mutating path
    const closed = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      const b = dlg ? [...dlg.querySelectorAll('button')].find((x) => /^(Hủy|Đóng|Huỷ)$/i.test((x.textContent || '').trim())) : null;
      if (b) { b.click(); return 'button'; }
      return null;
    });
    if (!closed) await page.keyboard.press('Escape');
    await sleep(1400);
    const still = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')));
    if (still) { await page.keyboard.press('Escape'); await sleep(900); }
  }
  log('results', results);
  const refused = results.filter((x) => x.banner && x.saveDisabled === true);
  if (refused.length >= 1) log('PASS-immediate-refusal', { refusedRows: refused.map((x) => x.row) });
  else { log('FAIL-no-immediate-refusal', { results }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
