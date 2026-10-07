// Card 20261007_394 (supersedes 393) — staging rung on 0ea3b35d: correcting a
// COMPLETED trip no longer demands a typed governance reason. Flow on
// /trips/135/edit (admin): set Ngày hoàn thành to a legal later date, save —
// the old gate refused with 'Vui lòng nhập lý do điều chỉnh...' before the
// confirm; now the house confirm ('Áp dụng') appears directly with the reason
// box left empty, the save proceeds, and the DB holds the new value.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-07_kb394-reason-free-save';
const TRIP = '135';

const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '0ea3b35d' });
if (!String(health.buildHash || '').startsWith('0ea3b35d')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const token = (await login.json()).token;
const before = await fetch(`${API}/trips/${TRIP}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const t0 = before.trip ?? before;
log('trip-before', { completedAt: t0.completedAt, departureDate: t0.departureDate });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const saves = [];
  page.on('response', async (res) => { const m = res.request().method(); if (m === 'PUT' || m === 'POST' || m === 'PATCH') { saves.push({ m, s: res.status(), u: res.url().replace(BASE, '').slice(0, 80) }); } });
  await page.setViewport({ width: 1920, height: 1100 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/trips/${TRIP}/edit`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4500);
  await page.waitForSelector('#completedAt', { timeout: 20000 });
  const tap = async (pt) => { await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.up(); };

  // Tap + focus the completedAt segments, type the legal later date.
  const pt = await page.evaluate(() => { const el = document.getElementById('completedAt'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await tap(pt);
  await sleep(200);
  await page.evaluate(() => { const el = document.getElementById('completedAt'); el.focus(); el.select(); });
  await page.keyboard.type('07/10/2026', { delay: 70 });
  await page.keyboard.press('Tab'); // trusted blur commits the buffered date text
  await sleep(500);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-date-typed.png`, fullPage: false });

  // Save — reason box stays EMPTY the whole run.
  const sv = await page.evaluate(() => { const btn = [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null).find((x) => /^Lưu cập nhật$/.test((x.textContent || '').trim())); if (!btn) return null; btn.scrollIntoView({ block: 'center' }); const r = btn.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  if (!sv) throw new Error('save button not found');
  await tap(sv);

  let applied = false; let sawReasonRefusal = false; let sawConfirm = false;
  for (let i = 0; i < 15; i += 1) {
    await sleep(1000);
    const st = await page.evaluate(() => {
      const body = document.body.textContent || '';
      const btns = [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null);
      const apply = btns.find((x) => /^Áp dụng$/.test((x.textContent || '').trim()));
      const refusal = body.includes('nhập lý do') || body.includes('lý do là bắt buộc');
      const applyPt = apply ? (() => { apply.scrollIntoView({ block: 'center' }); const r = apply.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })() : null;
      return { refusal, apply: applyPt, url: location.pathname, reasonVisible: Boolean(document.getElementById('governanceReason')?.offsetParent) };
    });
    if (st.refusal) sawReasonRefusal = true;
    if (st.apply) {
      sawConfirm = true;
      if (!applied) { await tap(st.apply); applied = true; }
    }
    if (st.url !== `/trips/${TRIP}/edit` || st.refusal) break;
    if (i === 14) log('timeout-still-on-edit', {});
  }
  log('flow', { sawReasonRefusal, sawConfirm, applied, saves });
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-final.png`, fullPage: false });

  const after = await fetch(`${API}/trips/${TRIP}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const t1 = after.trip ?? after;
  const persisted = String(t1.completedAt || '').startsWith('2026-10-07');
  log('db-verify', { completedAt: t1.completedAt, departureDate: t1.departureDate, persisted });
  const ok = sawConfirm && applied && !sawReasonRefusal && persisted;
  log('verdict', { ok });
  if (!ok) exitCode = 1;
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
