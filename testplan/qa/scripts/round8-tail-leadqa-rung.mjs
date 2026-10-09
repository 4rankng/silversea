// Round-8 tail spot-check (lead corroboration of parallel-session verdicts).
// (1) FB-061 seed purge: no QA seed rows on /accounting/invoice-tracking or
//     /finance/treasury. (2) 230550 export toast: tapping Xuất on /debt and
//     /profit surfaces a success toast.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-09_round8-tail-leadqa';
const EXPECT = 'e9339ad1';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: EXPECT });
if (!String(health.buildHash || '').startsWith(EXPECT)) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hoapt', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  // (1) seed purge — invoice tracking + treasury must not show QA seed strings
  for (const [name, path] of [['invoice-tracking', '/accounting/invoice-tracking'], ['treasury', '/finance/treasury']]) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(4500);
    const body = await page.evaluate(() => (document.body.textContent || '').replace(/\s+/g, ' '));
    const seeds = {
      nccQaLead: body.includes('NCC QA Lead'),
      leadQa376: body.includes('LEAD-QA-376'),
      acbKhongDau: /Tai khoan (cong ty|thuong mai)/.test(body),
    };
    log('seed-scan', { surface: name, seeds });
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-${name}.png` });
    if (seeds.nccQaLead || seeds.leadQa376 || (name === 'treasury' && seeds.acbKhongDau)) {
      log('FAIL-seed-visible', { surface: name, seeds }); exitCode = 1;
    }
  }

  // (2) export toast — tap Xuất on /debt then /profit (finance P&L panel)
  for (const [name, path, btnRe] of [
    ['debt', '/debt', /Xuất báo cáo/i],
    ['profit', '/profit', /Xuất XLSX|Xuất Excel/i],
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(5000);
    const btn = await page.evaluate((reSrc) => {
      const re = new RegExp(reSrc, 'i');
      const el = [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()) && b.offsetParent !== null && !b.disabled);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, btnRe.source);
    log('export-btn', { surface: name, btn });
    if (!btn) { log('FAIL-no-button', { surface: name }); exitCode = 1; continue; }
    await page.mouse.move(btn.x, btn.y);
    await page.mouse.down(); await page.mouse.up();
    await sleep(2500);
    const toast = await page.evaluate(() => {
      const t = [...document.querySelectorAll('[class*="toast"], [role="status"], [role="alert"]')].filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed')
        .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      return t.slice(0, 4);
    });
    log('export-toast', { surface: name, toast });
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-export-${name}.png` });
    if (!toast.some((t) => /xuất|export/i.test(t))) { log('FAIL-no-toast', { surface: name, toast }); exitCode = 1; }
  }

  if (exitCode === 0) log('PASS-round8-tail', {});
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
