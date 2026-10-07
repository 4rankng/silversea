// Card 071026141550 UI rung — the create-lô port dropdown shows ONE VIP
// Greenport option ("Cảng VIP Greenport") after the catalog merge.
import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; appendFileSync(`${QA}/2026-10-07_card071026141550_ui-driver.log`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e)); };
const login = await fetch('https://vantai.tingting.vip/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { gotToken: Boolean(token), role: session.user?.role ?? session?.user?.roles ?? null });
const flat = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('https://vantai.tingting.vip/shipments/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
  let where;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    where = await page.evaluate(() => ({ url: location.pathname, hasPortField: (() => { const f = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); return f(document.body.innerText).includes('chon cang nang'); })() }));
    if (where.hasPortField) break;
  }
  if (!where.hasPortField) {
    where.tail = await page.evaluate(() => document.body.innerText.slice(-700));
  }
  step('page', where);
  if (!where.hasPortField) throw new Error('create page did not render Cảng nâng (url ' + where.url + ')');
  // Open the Cảng nâng searchable field and filter "VIP".
  const opened = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')];
    const f = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const target = inputs.find((i) => f(i.placeholder ?? '').includes('cang nang'))
      ?? inputs.find((i) => f(i.getAttribute('aria-label') ?? '').includes('cang nang'))
      ?? inputs.find((i) => { const cell = i.closest('td, [class*="cell"]'); return cell && f(cell.textContent ?? '').includes('cang nang'); });
    if (!target) return false;
    target.focus();
    return true;
  });
  step('focus', { opened });
  if (!opened) throw new Error('could not focus Cảng nâng input');
  await page.keyboard.type('VIP', { delay: 60 });
  await new Promise((r) => setTimeout(r, 3000));
  const options = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[role="option"], [role="listbox"] li, [data-qa="select-option"]')];
    return nodes.map((n) => n.textContent.trim()).filter((t) => t.length > 0);
  });
  step('options', { count: options.length, options });
  const vipOptions = options.filter((t) => /vip/i.test(t) && !/^[+＋]/.test(t.trim()));
  step('vip-options', { vipOptions });
  const fl = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (vipOptions.length !== 1 || !fl(vipOptions[0]).includes('cang vip greenport')) throw new Error('expected exactly one VIP Greenport option, got ' + JSON.stringify(vipOptions));
  await page.screenshot({ path: `${QA}/2026-10-07_card071026141550_ui-dropdown.png` });
  console.log('RUNG PASS');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e) });
  console.log('RUNG FAIL:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally { await browser.close(); }
