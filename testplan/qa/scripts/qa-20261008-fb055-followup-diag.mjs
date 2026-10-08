// Read-only staging diagnosis for card 081026072302 (FB-055 follow-up):
// measure the 'Chứng từ giao hàng' footer card on trips 117/138/79/96 at 390px
// and dump computed layout so the ~80px cause is ground truth, not theory.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const OUT = '/tmp/fb055-followup';
const TRIPS = [117, 138, 79, 96];

const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash });

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'bqhuong', password: 'Abc123' }) });
const token = (await login.json()).token;
log('login', { ok: Boolean(token) });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  for (const trip of TRIPS) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.goto(`${BASE}/my-trips/${trip}`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(4500);
    const st = await page.evaluate(() => {
      const footer = document.querySelector('.driver-task-footer');
      const body = document.querySelector('.driver-task-footer__body');
      const summary = document.querySelector('.driver-task-footer__summary');
      const strong = summary?.querySelector('strong');
      const btn = [...document.querySelectorAll('.driver-task-footer a, .driver-task-footer button')].find((x) => /Xem chứng từ giao hàng/.test(x.textContent || ''));
      const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { h: Math.round(r.height), w: Math.round(r.width), display: cs.display, gridTemplateColumns: cs.gridTemplateColumns, gap: cs.gap, padding: cs.padding, lineHeight: cs.lineHeight, fontSize: cs.fontSize }; };
      const lines = (el) => { if (!el) return null; const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.2; return Math.round(el.getBoundingClientRect().height / lh); };
      return {
        url: location.pathname,
        title: document.title,
        pageTextHasDeadEnd: (document.body.textContent || '').includes('Không thể xác định chuyến đi'),
        footer: rect(footer),
        body: body ? { ...rect(body), cls: body.className } : null,
        summary: rect(summary),
        strong: strong ? { ...rect(strong), text: (strong.textContent || '').trim(), lines: lines(strong) } : null,
        btn: btn ? { ...rect(btn), lines: lines(btn.querySelector('span')) } : null,
        issuesLine: rect(document.querySelector('.driver-task-footer__issues')),
        readyLine: rect(document.querySelector('.driver-task-footer__ready')),
      };
    });
    log(`trip-${trip}`, st);
    await page.screenshot({ path: `${OUT}/trip-${trip}-390.png`, fullPage: false });
    await page.close();
  }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
} finally {
  writeFileSync(`${OUT}/diag.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
}
