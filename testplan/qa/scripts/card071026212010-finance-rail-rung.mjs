// Card 071026212010 — /finance "Báo cáo lãi lỗ": do the 4 summary-rail cards
// render values? Read-only staging pass as admin; dumps the rail's dt/dd texts.
import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const CARD = 'card071026212010';
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; appendFileSync(`${QA}/2026-10-08_${CARD}_ui-driver.log`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch('https://vantai.tingting.vip/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { gotToken: Boolean(token), role: session.user?.role ?? null });
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  const failed = [];
  page.on('response', (res) => {
    const url = res.request().url();
    if (url.includes('/api/') && res.status() >= 400) failed.push({ url: url.replace('https://vantai.tingting.vip', ''), status: res.status() });
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('https://vantai.tingting.vip/finance', { waitUntil: 'domcontentloaded', timeout: 60000 });
  let ready = false;
  for (let i = 0; i < 15 && !ready; i++) {
    await sleep(3000);
    ready = await page.evaluate(() => document.body.innerText.includes('Báo cáo lãi lỗ'));
  }
  step('page', { ready, failed4xx5xx: failed });
  const rail = await page.evaluate(() => {
    const section = document.querySelector('section.summary-rail');
    if (!section) return null;
    return [...section.querySelectorAll('.summary-rail__item')].map((el) => ({
      label: el.querySelector('dt')?.textContent ?? null,
      value: el.querySelector('dd')?.textContent ?? null,
    }));
  });
  // month selector state, for the record
  const monthUi = await page.evaluate(() => {
    const hits = [];
    for (const el of document.querySelectorAll('select, button, [role="combobox"]')) {
      const t = (el.textContent ?? '').trim();
      if (/Tháng|T\d{1,2}|10|2026/.test(t) && t.length < 40) hits.push({ tag: el.tagName, text: t });
    }
    return hits.slice(0, 8);
  });
  step('rail', { rail, monthUi });
  await page.screenshot({ path: `${QA}/2026-10-08_${CARD}_ui-finance-rail.png` });
  console.log('RUNG EVIDENCE CAPTURED');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e) });
  console.log('RUNG FAIL:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally { await browser.close(); }
