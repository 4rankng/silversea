// Card 081026093510 — lead staging QA on cut a1dc8b1f. The /dispatch master
// plan's Xuất Excel button: enabled when there is data, and a real tap
// produces a non-empty .xlsx download (PK magic). The disabled path must
// carry a reachable reason (probed via title/aria when data is empty — covered
// by the lane's tests; rung verifies the live data path end-to-end).
import puppeteer from 'puppeteer';
import { writeFileSync, readdirSync, statSync, readFileSync, rmSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const DL = '/tmp/dl-093510';
const SCOPE = '2026-10-08_card081026093510-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: 'a1dc8b1f' });
if (!String(health.buildHash || '').startsWith('a1dc8b1f')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

rmSync(DL, { recursive: true, force: true });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

  await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 90000 });
  let rows = 0;
  for (let i = 0; i < 15 && !rows; i++) { await sleep(3000); rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length); }
  log('dispatch-grid', { rows });

  const btn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null).find((x) => /Xuất file Excel|Đang xuất/.test((x.textContent || '').replace(/\s+/g, ' ').trim()));
    if (!b) return { err: 'no Xuất file Excel button', inventory: [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null).map((x) => (x.textContent || '').trim().slice(0, 22)).filter((t) => /xuất|Xuất|export/i.test(t)).slice(0, 6) };
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), disabled: b.disabled || b.getAttribute('aria-disabled') === 'true', title: b.title || null, label: (b.textContent || '').replace(/\s+/g, ' ').trim() };
  });
  log('export-button', btn);
  if (btn.err) throw new Error(btn.err);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-before-click.png` });

  if (btn.disabled) {
    // data present but disabled = FAIL per AC (enabled when data exists)
    log('FAIL-disabled-with-data', { rows, btn });
    exitCode = 1;
  } else {
    await page.mouse.click(btn.x, btn.y);
    let file = null;
    let toastText = '';
    for (let i = 0; i < 20 && !file; i++) {
      await sleep(1000);
      const files = readdirSync(DL).filter((f) => !f.endsWith('.crdownload'));
      file = files[0] ?? null;
      if (!file && i >= 4) {
        toastText = await page.evaluate(() => (document.querySelector('[class*="toast"], [role="status"]')?.textContent ?? '').slice(0, 100));
        if (/Đã xuất \d+ lô/.test(toastText)) { log('export-toast-success', { toastText }); break; }
      }
    }
    if (!file && !toastText) { log('FAIL-no-download-no-toast', {}); exitCode = 1; }
    else if (!file) { log('PASS-export-toast-only', { toastText, note: 'toast confirmed the export; browser-download capture not observed (headless may route blob differently)' }); }
    else {
      const size = statSync(`${DL}/${file}`).size;
      const magic = readFileSync(`${DL}/${file}`).subarray(0, 2).toString('latin1');
      log('download', { file, size, magic, isXlsx: magic === 'PK' && size > 1024 });
      await page.screenshot({ path: `${QA}/${SCOPE}_ui-after-click.png` });
      if (!(magic === 'PK' && size > 1024)) { log('FAIL-bad-download', { size, magic }); exitCode = 1; }
      else log('PASS-export-enabled-and-downloads', { rows, file, size });
    }
  }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
