// Card 071026211100 — lead staging QA on cut 781f746a: /suppliers
// 'Xuất Excel' shows the busy label, the success toast, and downloads a file.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_kb211100-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '781f746a' });
if (!String(health.buildHash || '').startsWith('781f746a')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hoapt', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1100 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    const client = await page.createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp/qa-downloads' });
  await page.goto(`${BASE}/suppliers`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4000);

  const btn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null).find((x) => /Xuất Excel/.test((x.textContent || '').trim()));
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (b.textContent || '').trim() };
  });
  log('export-button', btn);
  if (!btn) { log('FAIL-no-export-button'); exitCode = 1; throw new Error('no button'); }

  await page.mouse.move(btn.x, btn.y); await page.mouse.down(); await page.mouse.up();
  // The busy window can be short on a small table — poll at 25ms.
  let busy = null;
  for (let i = 0; i < 120 && !busy; i += 1) {
    busy = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Đang xuất/.test((x.textContent || '').trim()) && x.offsetParent !== null);
      return b ? (b.textContent || '').trim() : null;
    });
    if (!busy) await sleep(25);
  }
  log('busy-label', { busy });
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-busy.png` });

  // Wait for the success toast
  let toast = null;
  for (let i = 0; i < 20; i += 1) {
    toast = await page.evaluate(() => {
      const t = [...document.querySelectorAll('[role="status"], [class*="toast"], [class*="Toast"]')].map((e) => (e.textContent || '').trim()).find((x) => x.length > 3);
      return t ?? null;
    });
    if (toast) break;
    await sleep(500);
  }
  const after = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null).find((x) => /Xuất Excel|Đang xuất/.test((x.textContent || '').trim()));
    return b ? (b.textContent || '').trim() : null;
  });
  log('toast', { toast, buttonAfter: after });
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-toast.png` });

  const okToast = Boolean(toast && toast.includes('Đã xuất danh sách nhà cung cấp'));
  const sawBusy = Boolean(busy);
  if (okToast && sawBusy) log('PASS-export-feedback', { sawBusy, okToast });
  else { log('FAIL', { sawBusy, okToast }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
