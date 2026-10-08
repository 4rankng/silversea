// Card 071026210540 — /ops/wallet: where do bare (₫-less) money cells render?
// Read-only staging pass as hoangnh: collect number-like texts with their
// element classes and nearest section heading.
import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const CARD = 'card071026210540';
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; appendFileSync(`${QA}/2026-10-07_${CARD}_ui-driver.log`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch('https://vantai.tingting.vip/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hoangnh', password: 'Abc123' }) });
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { gotToken: Boolean(token), role: session.user?.role ?? null });
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('https://vantai.tingting.vip/ops/wallet', { waitUntil: 'domcontentloaded', timeout: 60000 });
  let ready = false;
  for (let i = 0; i < 15 && !ready; i++) {
    await sleep(3000);
    ready = await page.evaluate(() => document.body.innerText.includes('Sổ quỹ'));
  }
  step('page', { ready });
  if (!ready) throw new Error('Sổ quỹ view did not render');
  const census = await page.evaluate(() => {
    const bareRe = /^-?\d{1,3}(\.\d{3})+$/;
    const out = [];
    for (const el of document.querySelectorAll('td, strong, .expense-money, span')) {
      const t = (el.textContent ?? '').trim();
      if (el.children.length === 0 && bareRe.test(t)) {
        const row = el.closest('tr');
        const table = el.closest('table');
        const heads = table ? [...table.querySelectorAll('th')].map((th) => th.textContent.trim()) : [];
        const cellIndex = row ? [...row.children].indexOf(el) : -1;
        out.push({
          text: t,
          cls: (el.className ?? '').toString().slice(0, 40),
          heads: heads.slice(0, 8),
          cellIndex,
          rowText: row?.innerText?.replace(/\s+/g, ' ').slice(0, 140) ?? null,
        });
        if (out.length >= 25) break;
      }
    }
    return out;
  });
  step('census', { count: census.length, items: census.slice(0, 15) });
  await page.screenshot({ path: `${QA}/2026-10-07_${CARD}_ui-wallet.png` });
  console.log('RUNG EVIDENCE CAPTURED');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e) });
  console.log('RUNG FAIL:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally { await browser.close(); }
