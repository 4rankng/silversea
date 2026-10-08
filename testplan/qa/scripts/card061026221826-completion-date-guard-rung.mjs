// Card 061026221826 — staging rung on 1c5a2ec5: the impossible pair
// (Ngày hoàn thành before Ngày khởi hành) must be REFUSED on the actuals
// edit (/trips/135/edit, admin), with the control save (same-day) passing.
// Real segment typing via trusted keys; screenshots per step.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-07_kb221826-completion-date';
const TRIP = '135';

const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '1c5a2ec5' });
if (!String(health.buildHash || '').startsWith('1c5a2ec5')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const token = (await login.json()).token;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1100 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/trips/${TRIP}/edit`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4500);
  await page.waitForSelector('#completedAt', { timeout: 20000 });

  const setDate = async (fieldId, value) => {
    const pt = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el || el.offsetParent === null) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, fieldId);
    if (!pt) throw new Error(`${fieldId} input not found`);
    await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.up();
    await sleep(200);
    await page.evaluate((id) => { const el = document.getElementById(id); el.focus(); el.select?.(); }, fieldId);
    await page.keyboard.type(value, { delay: 70 });
    await sleep(300);
  };

  const save = async () => {
    const btn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null).find((x) => /^Lưu cập nhật$/.test((x.textContent || '').trim()));
      if (!b) return null;
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (b.textContent || '').trim() };
    });
    if (!btn) throw new Error('save button not found');
    const got = await page.evaluate((pt) => document.elementFromPoint(pt.x, pt.y)?.textContent?.trim(), btn);
    if (!got) throw new Error(`save hit-test missed: ${got}`);
    await page.mouse.move(btn.x, btn.y); await page.mouse.down(); await page.mouse.up();
    await sleep(1500);
    // Completed trips reveal a required governance reason before the confirm.
    const reasonFilled = await page.evaluate(() => {
      const ta = document.getElementById('governanceReason');
      if (!ta || ta.offsetParent === null) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'QA rung card 061026221826 — sua ngay hoan thanh truoc ngay khoi hanh de kiem tra guard');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
    if (reasonFilled) { await sleep(500); }
    // Completed trips gate the save behind the house confirm — tap 'Áp dụng'.
    for (let i = 0; i < 8; i += 1) {
      const apply = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null).find((x) => /^Áp dụng$/.test((x.textContent || '').trim()));
        if (!b) return null;
        b.scrollIntoView({ block: 'center' });
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (apply) {
        const hit = await page.evaluate((pt) => document.elementFromPoint(pt.x, pt.y)?.textContent?.trim(), apply);
        if (hit && hit.includes('Áp dụng')) {
          await page.mouse.move(apply.x, apply.y); await page.mouse.down(); await page.mouse.up();
          await sleep(2500);
          return;
        }
      }
      await sleep(700);
    }
  };

  const errorText = () => page.evaluate(() => [...document.querySelectorAll('[role="alert"],[class*="error"]')].map((e) => (e.textContent || '').trim()).filter((t) => t.includes('Ngày hoàn thành'))[0] ?? null);

  // Attempt 1: impossible pair (05/10 < departure 07/10).
  await setDate('completedAt', '03/10/2026'); // different impossible date — same-value typing is deduped
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-before-save.png`, fullPage: false });
  await save();
  const err1 = await errorText();
  log('attempt-impossible', { refused: Boolean(err1), message: err1 });
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-refused.png`, fullPage: false });

  // Attempt 2: control (same-day, legal).
  if (err1) {
    await setDate('completedAt', '07/10/2026');
    await save();
    const err2 = await errorText();
    const after = await page.evaluate(() => ({ url: location.pathname, err: err2 }));
    log('attempt-control', after);
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-control-saved.png`, fullPage: false });
    const verify = await fetch(`${API}/trips/${TRIP}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    const t = verify.trip ?? verify;
    log('db-verify', { completedAt: t.completedAt, departureDate: t.departureDate });
    if (after.err || !String(t.completedAt || '').startsWith('2026-10-07')) { log('FAIL-control'); exitCode = 1; }
  } else { log('FAIL-impossible-pair-not-refused'); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
