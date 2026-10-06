// Card 061026174602 — LOCAL UI rung: /finance "Xuất Excel" must show the busy
// label while exporting and a success toast after; real trusted tap.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { status: health.status, buildHash: health.buildHash, note: 'dev = live source' });
const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'ketoan', password: 'Abc123' }) });
if (!login.ok) throw new Error(`login ${login.status}`);
const token = (await login.json()).token;
log('login', { user: 'ketoan', role: 'ACCOUNTANT (local demo)' });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1000 });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp/qa-downloads' });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/finance`, { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 4000));

  // Find + tap the export button (trusted pointer), atomic measure.
  let target = null;
  for (let a = 0; a < 6; a += 1) {
    target = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Xuất Excel/.test(x.textContent || '') && x.offsetParent !== null);
      if (!b) return { missing: true };
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      const vh = window.innerHeight;
      return (r.y > 60 && r.y < vh - 60) ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : { offscreen: true };
    });
    if (target && !target.missing && !target.offscreen) break;
    await new Promise((r) => setTimeout(r, 900));
  }
  if (!target || target.missing) throw new Error('Xuất Excel button not found');
  const hit = await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.textContent?.trim(), target);
  if (!hit || !hit.includes('Xuất Excel')) throw new Error(`hit-test missed: ${hit}`);
  await page.mouse.move(target.x, target.y); await page.mouse.down(); await page.mouse.up();
  log('clicked', { button: 'Xuất Excel' });

  // Busy label should appear immediately while the workbook builds.
  await new Promise((r) => setTimeout(r, 400));
  const busy = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Đang xuất…/.test(x.textContent || ''));
    return { busyVisible: Boolean(b), disabled: b?.disabled ?? null };
  });
  log('busy-state', busy);

  // Toast after completion.
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((x) => /Xuất Excel/.test(x.textContent || '')), { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 500));
  const toastState = await page.evaluate(() => {
    const t = (document.body.textContent || '');
    const el = [...document.querySelectorAll('[class*="toast"], [role="status"], [role="alert"]')]
      .find((x) => /Đã xuất Báo cáo lãi lỗ/.test(x.textContent || ''));
    return { textPresent: /Đã xuất Báo cáo lãi lỗ ra tệp Excel\./.test(t), elFound: Boolean(el), elText: el ? (el.textContent || '').trim().slice(0, 120) : null };
  });
  log('toast-state', toastState);
  await page.screenshot({ path: `${QA}/2026-10-06_card061026174602_ui-toast.png` });
  log('screenshot', { path: 'qa/2026-10-06_card061026174602_ui-toast.png' });
  if (!toastState.textPresent) throw new Error('success toast text not found after export');
} finally {
  await browser.close();
}
writeFileSync(`${QA}/2026-10-06_card061026174602_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
console.log('DRIVER OK');
