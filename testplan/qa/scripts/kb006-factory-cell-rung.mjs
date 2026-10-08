// Card 061026172801 (FB-006) — LOCAL UI rung: the CUS create-lô factory cell
// shows its detail affordance once a factory is picked, and the popover opens.
// Role CUS (thanhdc, local seed). Expectation per the card: nút kính lúp / nút
// xem chi tiết nhà máy hiển thị và dùng được.
import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const DRIVER_LOG = `${QA}/2026-10-07_card061026172801_ui-driver.log`;
const L = [];
const step = (s, o) => {
  const e = { at: new Date().toISOString(), step: s, ...o };
  L.push(e);
  appendFileSync(DRIVER_LOG, JSON.stringify(e) + '\n');
  console.log(JSON.stringify(e));
};

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login thanhdc failed: ${login.status}`);
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { user: 'thanhdc (CUS, local seed)', gotToken: Boolean(token) });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => step('goto', { note: 'networkidle timeout — continue' }));
  await page.waitForFunction(() => document.body.innerText.includes('Khách hàng'), { timeout: 90000 });
  const custInput = await page.evaluateHandle(() => {
    const lbl = [...document.querySelectorAll('label')].find((l) => (l.textContent || '').includes('Khách hàng'));
    return (lbl?.closest('div') ?? document).querySelector('input, [role="combobox"]');
  });
  await custInput.asElement().click();
  await page.keyboard.type('Long Minh');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="option"]')].some((o) => (o.textContent || '').toLowerCase().includes('long minh')), { timeout: 30000 });
  await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || '').toLowerCase().includes('long minh'))?.click());
  step('customer-picked');
  await page.waitForSelector('input[placeholder="Chọn nhà máy"]', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));
  const facInput = await page.$('input[placeholder="Chọn nhà máy"]');
  await facInput.click();
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => document.querySelector('[role="option"]')?.click());
  step('factory-picked', { how: 'first option' });
  await page.waitForFunction(() => document.querySelectorAll('button[aria-label^="Xem chi tiết nhà máy"]').length > 0, { timeout: 15000 }).catch(() => {});
  const probe = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label^="Xem chi tiết nhà máy"]');
    if (!btn) return { detailButton: false };
    const cs = getComputedStyle(btn);
    return { detailButton: true, visible: cs.display !== 'none' && cs.width !== '0px', ariaExpanded: btn.getAttribute('aria-expanded') };
  });
  step('probe-factory-cell', probe);
  if (!probe.detailButton) throw new Error('detail button MISSING after factory pick — the reported regression');
  await page.evaluate(() => document.querySelector('button[aria-label^="Xem chi tiết nhà máy"]')?.click());
  await new Promise((r) => setTimeout(r, 500));
  const pop = await page.evaluate(() => {
    const dlg = document.querySelector('.factory-detail-pop, [role="dialog"]');
    return { popoverOpen: Boolean(dlg), text: (dlg?.textContent || '').slice(0, 100) };
  });
  step('popover', pop);
  if (!pop.popoverOpen) throw new Error('detail popover did not open');
  await page.screenshot({ path: `${QA}/2026-10-07_card061026172801_ui-factory-cell.png`, fullPage: true });
  step('screenshot', { path: 'qa/2026-10-07_card061026172801_ui-factory-cell.png', note: 'read-only rung — the create form is not saved; no persisted mutation exists by design' });
} finally { await browser.close(); }
appendFileSync(DRIVER_LOG, 'DRIVER OK\n');
console.log('DRIVER OK');
