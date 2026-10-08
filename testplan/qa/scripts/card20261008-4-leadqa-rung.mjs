// Card 20261008_4 — lead staging QA. Permission/error toasts: an aborted
// in-flight request must NOT fire a permission toast (the deterministic
// half the card fixes); the action-naming half is pinned by the lane's
// tests (no safely-reachable 403 flow on staging for the Ops role —
// recorded as Not covered).
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card20261008-4-leadqa';
const EXPECT = 'dc599a82';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: EXPECT });
if (!String(health.buildHash || '').startsWith(EXPECT)) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hoangnh', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => {
    localStorage.setItem('token', t);
    window.__toasts = [];
    const hit = /Không có quyền|Không tải được|từ chối/i;
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const t2 = (n.textContent || '').trim();
        if (t2.length <= 90 && hit.test(t2)) window.__toasts.push({ at: Date.now(), text: t2.slice(0, 100) });
      }
    }).observe ?? null;
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver((muts) => {
        for (const m of muts) for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          const t2 = (n.textContent || '').trim();
          if (t2.length <= 90 && hit.test(t2)) window.__toasts.push({ at: Date.now(), text: t2.slice(0, 100) });
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
  }, token);

  // Arm the abort and navigate in the SAME run: one wallet request is
  // aborted mid-flight; a permission/error toast must NOT appear for it.
  await page.setRequestInterception(true);
  let aborted = false;
  page.on('request', (req) => {
    if (!aborted && /\/api\/ops\/wallet\/summary/.test(req.url())) {
      aborted = true;
      req.abort('failed').catch(() => {});
      return;
    }
    req.continue().catch(() => {});
  });
  await page.goto(`${BASE}/ops/wallet`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(5000);
  const toasts = await page.evaluate(() => window.__toasts ?? []);
  const degraded = await page.evaluate(() => {
    const main = (document.querySelector('main') ?? document.body).textContent || '';
    return { hasRetry: /Thử lại/.test(main), hasDash: /—/.test(main.slice(0, 2000)) };
  });
  await page.setRequestInterception(false);
  log('abort-leg', { aborted, toasts, degraded });
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-after-abort.png` });

  // control leg: reload WITHOUT interception — no toasts on a healthy load
  await page.goto(`${BASE}/ops/wallet`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4000);
  const controlToasts = await page.evaluate(() => window.__toasts ?? []);
  log('control-leg', { toastsAfterHealthyReload: controlToasts.length });

  if (aborted && toasts.length === 0 && controlToasts.length === 0) log('PASS-aborted-request-fires-no-toast', { degraded, note: 'action-naming half covered by lane pin tests — no reachable 403 flow for OPS on staging' });
  else { log('FAIL', { toasts, controlToasts }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
