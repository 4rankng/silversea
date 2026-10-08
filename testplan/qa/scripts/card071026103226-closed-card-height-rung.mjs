// Card 071026103226 — staging rung on cc25e5ae: the driver closed-trip card
// ('Chuyến đã hoàn thành', footer with 'Xem chứng từ giao hàng') is one row
// again: measured height <= 60px, no hint line, at the 390px contract width
// and 1280px. Driver dvthuc, real trip 96 (COMPLETED).
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-07_card071026103226-closed-card';
const TRIP = 96;

const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: 'cc25e5ae' });
if (!String(health.buildHash || '').startsWith('cc25e5ae')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dvthuc', password: 'Abc123' }) });
const token = (await login.json()).token;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.goto(`${BASE}/my-trips/${TRIP}`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(4500);
    const st = await page.evaluate(() => {
      const footer = document.querySelector('.driver-task-footer');
      const hint = document.querySelector('.driver-task-footer__hint');
      const btn = [...document.querySelectorAll('button,a')].find((x) => /Xem chứng từ giao hàng/.test(x.textContent || ''));
      const body = document.querySelector('.driver-task-footer__body');
      const fr = footer?.getBoundingClientRect();
      return {
        url: location.pathname,
        footerFound: Boolean(footer),
        footerH: fr ? Math.round(fr.height) : null,
        bodyVariantClosed: body?.className?.includes('--closed') ?? null,
        hasHint: Boolean(hint),
        btnText: btn ? (btn.textContent || '').trim() : null,
        btnVisible: btn ? btn.offsetParent !== null : false,
        cardTitle: (document.body.textContent || '').includes('Chuyến đã hoàn thành'),
      };
    });
    log(`measure-${width}`, st);
    await page.screenshot({ path: `${QA}/${SCOPE}_${width}.png`, fullPage: false });
    if (width === 390) {
      const ok = st.footerFound && st.footerH !== null && st.footerH <= 60 && st.hasHint === false && st.bodyVariantClosed === true && st.btnVisible;
      log('verdict-390', { ok });
      if (!ok) exitCode = 1;
    }
    await page.close();
  }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
