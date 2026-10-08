// Card 081026072303 — lead staging QA (build f802a425 carries all fixes).
// Item 1: nav 'Theo dõi hoàn cược' — no 'nôp' typo. Item 2: P&L 'Cố định đội
// xe' consistent (no 'Cỗ định'). Item 3: profit-split line spacing. Items 4/5
// are wording dispositions recorded by the lane (kept terms) — verified by
// absence of the typo forms only.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card081026072303-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash });

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hoapt', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  // expand sidebar sections, then scan nav
  await page.goto(`${BASE}/finance`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4500);
  for (let i = 0; i < 4; i++) {
    const tog = await page.evaluate(() => {
      const t = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null).find((x) => x.getAttribute('aria-expanded') === 'false');
      if (!t) return null;
      const r = t.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    if (!tog) break;
    await page.mouse.click(tog.x, tog.y);
    await sleep(700);
  }
  const nav = await page.evaluate(() => {
    const items = [...document.querySelectorAll('a,button')].filter((e) => e.offsetParent !== null).map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim());
    return {
      hasNoTypo: !items.some((t) => /nôp/i.test(t)),
      hasDeposit: items.some((t) => /Theo dõi hoàn cược/i.test(t)),
      depositLabel: (items.find((t) => /hoàn cược/i.test(t)) || '').slice(0, 30),
    };
  });
  log('nav-scan', nav);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-sidebar.png` });

  // P&L page: legend + row consistency, profit-split line
  const fin = await page.evaluate(() => {
    const body = (document.body.textContent || '').replace(/\s+/g, ' ');
    const profitLine = (body.match(/cho\s*[A-ZĐ][^\s]*\s*\(\d+%\)/g) ?? []).slice(0, 3);
    return {
      hasCoDinh: /Cố định đội xe/.test(body),
      hasCoSoVariant: /Cỗ định/i.test(body),
      codinhCount: (body.match(/Cố định đội xe/g) ?? []).length,
      profitLineSample: profitLine,
      gluedProfit: /cho[A-ZĐ]/.test(body) && !/cho [A-ZĐ]/.test(body),
    };
  });
  log('finance-scan', fin);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-finance.png` });

  const checks = [
    { what: "nav không còn 'nôp'", ok: nav.hasNoTypo },
    { what: "nav có 'Theo dõi hoàn cược'", ok: nav.hasDeposit },
    { what: "P&L không còn 'Cỗ định'", ok: !fin.hasCoSoVariant },
    { what: "P&L dùng 'Cố định đội xe' nhất quán (≥2 chỗ)", ok: fin.codinhCount >= 2 },
    { what: 'dòng chia lợi nhuận không dính "cho+tên"', ok: !fin.gluedProfit },
  ];
  log('checks', checks);
  if (checks.every((c) => c.ok)) log('PASS-diacritics-batch2', { nav, fin });
  else { log('FAIL', { checks }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
